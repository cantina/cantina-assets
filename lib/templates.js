var path = require('path')
  , fs = require('fs')
  , mkdirp = require('mkdirp')
  , rimraf = require('rimraf')
  , crypto = require('crypto')
  , Handlebars = require('handlebars')
  , uglify = require('uglify-js')
  , dish = require('dish')
  , async = require('async')
  , glob = require('glob');

module.exports = function (app) {
  var namespaces
    , api = {};

  // Helper to run all template modifiers.
  api.optimize = function optimize (cb) {
    app.log('optimizing templates ...');

    namespaces = Object.keys(app.conf.get('assets:templates'));

    // Setup namespaces.
    app.assets.templates = {};
    namespaces.forEach(function (namespace) {
      app.assets.templates[namespace] = {};
    });

    async.series([
      api.aggregateAll.bind(app),
      api.minifyAll.bind(app),
      api.cacheAll.bind(app),
      api.serveAll.bind(app)
    ], cb);
  };

  // Aggregate files into one.
  api.aggregateAll = function (cb) {
    async.forEachSeries(namespaces, api.aggregate, cb);
  };
  api.aggregate = function aggregate (namespace, cb) {
    var conf = app.conf.get('assets:templates:' + namespace);
    if (conf.aggregate && app.conf.get('assets:js:' + namespace + ':aggregate')) {
      app.log('- aggregating `' + namespace + '` templates ...');
      var templates = {}
        , content = ''
        , files = {}
        , key = null
        , hash = null
        , dirs = conf.dirs || []
        ;

      async.series([
        // Collect possible templates.
        function (next) {
          var match = conf.match;
          if (match) {
            match = new RegExp('(' + match.join(')|(') + ')');
          }
          var exclude = conf.exclude;
          if (exclude) {
            exclude = new RegExp('(' + exclude.join(')|(') + ')');
          }

          // Look in specified dirs. Push empty string to look in app.root too.
          if (dirs.indexOf('') < 0) dirs.push('');
          dirs.forEach(function (dir) {
            dir = path.join((conf.root || app.root), dir, '/public');
            glob.sync(dir + '/**/*.hbs').forEach(function (file) {
              key = file.substr(dir.length + 1);
              key = key.substring(0, key.length - 4);
              if ((!match || key.match(match)) && (!exclude || !exclude.test(key))) {
                if (fs.existsSync(file)) {
                  files[key] = file;
                }
              }
            });
          });

          next();
        },

        // Scan js for the templates that are actually in use and collect them.
        function (next) {
          var matches = app.assets.js[namespace].content.match(/['"]hbs\!([^'"]*)/g);
          if (matches) {
            matches = matches.map(function (match) {
              return match.replace(/['"]hbs\!/, '');
            });
            matches.forEach(function (name) {
              if (name.match(/^(?:[.\/])*shared/)) {
                templates[name] = files[name.replace('shared/', 'shared/templates/')];
              }
              else {
                templates[name] = files['templates/' + name];
              }
            });
          }
          next();
        },

        // Create build hash out of file contents.
        function (next) {
          var md5 = crypto.createHash('md5');
          async.reduce(
            Object.keys(templates),
            '',
            function (memo, key, cb) {
              var file = templates[key];
              fs.readFile(file, 'utf8', function (err, file) {
                if (err) return cb(err);
                cb(err, memo + file);
              });
            },
            function (err, result) {
              if (err) return next(err);
              hash = md5.update(result).digest('hex');
              app.conf.set('assets:templates:' + namespace + ':hash', hash);
              app.assets.templates[namespace].hash = hash;
              next();
            }
          );
        },

        // Check cache.
        function (next) {
          // Skip if no cache mechanism, or it's disabled.
          if (!app.cache) return next();
          if (!app.conf.get('assets:templates:' + namespace + ':cache')) return next();

          // Look up in cache.
          var cacheKey = 'assets:' + app.assets.templates[namespace].hash;
          app.cache.get(cacheKey, function (err, result) {
            if (err) return next(err);

            // If no result, continue to build.
            if (!result) return next();

            // Set content. Flag as from cache to skip further processing.
            app.assets.templates[namespace].content = result.data;
            app.assets.templates[namespace].fromCache = true;
            next();
          });
        },

        // Compile and concatenate templates together, per locale.
        function (next) {
          if (app.assets.templates[namespace].fromCache) return next();

          var exclude = conf.exclude;
          if (exclude) {
            exclude = new RegExp('(' + exclude.join(')|(') + ')');
          }

          async.forEach(Object.keys(templates), function (key, templateDone) {
            if (!exclude || !exclude.test(key)) {
              var file = templates[key];
              fs.readFile(file, 'utf8', function (err, file) {
                if (err) return next(err);
                content += '/* ' + key + ' */\n';
                content += '(function() {\n';
                content += "templates['" + key + "'] = Handlebars.template(\n\n";
                content += Handlebars.precompile(file);
                content += '\n\n);\n';
                content += '})();\n\n';
                templateDone();
              });
            }
            else {
              templateDone();
            }
          }, next);
        },

        function (next) {
          if (app.assets.templates[namespace].fromCache) return next();

          // Wrap content in AMD definition.
          content = "define(['handlebars'], function (Handlebars) {\n" +
                      'var templates = {};\n\n' +
                      content +
                      'return templates;\n' +
                      "});";
          app.assets.templates[namespace].content = content;
          next();
        }
      ], cb);
    }
    else {
      app.conf.set('assets:templates:' + namespace + ':aggregate', false);
      cb();
    }
  };

  // Minify contents.
  api.minifyAll = function (cb) {
    async.forEachSeries(namespaces, api.minify, cb);
  };
  api.minify = function minify (namespace, cb) {
    if (app.assets.templates[namespace].fromCache) return cb();

    if (app.conf.get('assets:templates:' + namespace + ':minify') && app.assets.templates[namespace].content) {
      app.log('- minifying `' + namespace + '` templates (could take a while) ...');
      app.assets.templates[namespace].content = uglify.minify(app.assets.templates[namespace].content, {
        fromString: true
      }).code;
    }
    cb();
  };

  // Cache contents.
  api.cacheAll = function (cb) {
    async.forEachSeries(namespaces, api.cache, cb);
  };
  api.cache = function cache (namespace, cb) {
    // Skip if no cache mechanism, or if we already loaded from the cache.
    if (!app.cache) return cb();
    if (app.assets.templates[namespace].fromCache) return cb();

    // Cache the content.
    if (app.conf.get('assets:templates:' + namespace + ':cache') && app.assets.templates[namespace].content) {
      var cacheKey = 'assets:' + app.assets.templates[namespace].hash
        , cacheTags = {
            assets: ['*', 'templates', namespace, namespace + ':templates']
          }
        ;

      // Set the cache.
      app.log('- caching `' + namespace + '` templates ...');
      app.cache.set(cacheKey, app.assets.templates[namespace].content, cacheTags, cb);
    }
    else {
      cb();
    }
  };

  // Serve file.
  api.serveAll = function (cb) {
    async.forEachSeries(namespaces, api.serve, cb);
  };
  api.serve = function serve (namespace, cb) {
    if (app.conf.get('assets:templates:' + namespace + ':serve') && app.assets.templates[namespace].content) {
      app.log('- serving `' + namespace + '` templates ' + (app.assets.templates[namespace].fromCache ? '(from cache)' : '') + ' ...');
      app.middleware.get(-1200, '/assets/templates/' + app.assets.templates[namespace].hash + '-' + namespace + '.js', dish(app.assets.templates[namespace].content, {
        headers: {
          'Content-Type': 'text/javascript'
        }
      }));
    }
    cb();
  };

  return api;
};
