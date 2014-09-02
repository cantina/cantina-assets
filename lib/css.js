var path = require('path')
  , fs = require('fs')
  , mkdirp = require('mkdirp')
  , rimraf = require('rimraf')
  , crypto = require('crypto')
  , sqwish = require('sqwish')
  , dish = require('dish')
  , prefixer = require('./prefix')
  , async = require('async')
  ;

module.exports = function (app) {
  var namespaces = Object.keys(app.conf.get('assets:css'))
    , styles = app.conf.get('styles')
    , reset = []
    , api = {};

  // Setup namespaces.
  app.assets.css = {};
  namespaces.forEach(function (namespace) {
    app.assets.css[namespace] = {};
  });

  // Aggregate files into one.
  api.aggregateAll = function (cb) {
    async.forEachSeries(namespaces, api.aggregate, cb);
  };
  api.aggregate = function aggregate (namespace, cb) {
    var conf = app.conf.get('assets:css:' + namespace);
    if (conf.aggregate) {
      app.log('- aggregating `' + namespace + '` css ...');
      var files = {}
        , content = ''
        , hash = null
        , dirs = conf.dirs || []
        ;

      async.series([
        // Collect stylesheets for this namespace.
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
            styles.forEach(function (key) {
              if ((!match || key.match(match)) && (!exclude || !exclude.test(key))) {
                var file = path.join((conf.root || app.root), dir, 'public', key);
                if (fs.existsSync(file)) {
                  files[key] = file;
                }
              }
            });
          });

          next();
        },

        // Create build hash out of file contents.
        function (next) {
          var md5 = crypto.createHash('md5');
          async.reduce(
            Object.keys(files),
            '',
            function (memo, key, cb) {
              var file = files[key];
              fs.readFile(file, 'utf8', function (err, file) {
                if (err) return cb(err);
                cb(err, memo + file);
              });
            },
            function (err, result) {
              if (err) return next(err);

              hash = md5.update(result).digest('hex');
              app.assets.css[namespace].hash = hash;
              next();
            }
          );
        },

        // Check cache.
        function (next) {
          // Skip if no cache mechanism, or it's disabled.
          if (!app.cache) return next();
          if (!app.conf.get('assets:css:' + namespace + ':cache')) return next();

          // Look up in cache.
          var cacheKey = 'assets:' + app.assets.css[namespace].hash;
          app.cache.get(cacheKey, function (err, result) {
            if (err) return next(err);

            // If no result, continue to build.
            if (!result) return next();

            // Set content. Flag as from cache to skip further processing.
            app.assets.css[namespace].content = result.data;
            app.assets.css[namespace].fromCache = true;
            next();
          });
        },

        // Concatenate stylesheets.
        function (next) {
          if (app.assets.css[namespace].fromCache) return next();

          async.forEachSeries(Object.keys(files), function (key, done) {
            var file = files[key]
              , dir;

            fs.readFile(file, 'utf8', function (err, css) {
              if (err) return done(err);

              // Deal with relative urls in vendor stylesheets.
              // @todo: make this optional/regex-based? /vendor/ is too specific.
              if (key.indexOf('/vendor/') === 0) {
                dir = path.dirname(key);
                css = css.replace(/url\(['"]?([^\)'"]*)['"]?\)/gi, function (match, url, offset) {
                  if (url.indexOf('data:') < 0) {
                    return 'url("' + path.normalize(dir + '/' + url) + '")';
                  }
                  return match;
                });
              }

              // Add to aggregate.
              content += '/* ' + key + ' */\n';
              content += css + '\n\n';

              app.assets.css[namespace].content = content;
              done();
            });
          }, next);
        }
      ], function (err) {
        if (err) return cb(err);

        // Override conf styles with the aggregate.
        reset.push('/assets/css/' + app.assets.css[namespace].hash + '-' + namespace + '.css');
        app.conf.reset('styles', reset);
        cb();
      });
    }
    else {
      cb();
    }
  };

  // Auto-prefix stylesheets.
  api.prefixAll = function (cb) {
    async.forEachSeries(namespaces, api.prefix, cb);
  };
  api.prefix = function prefix (namespace, cb) {
    if (app.assets.css[namespace].fromCache) return cb();

    if (app.conf.get('assets:css:' + namespace + ':prefix') && app.assets.css[namespace].content) {
      app.log('- prefixing `' + namespace + '` css ...');
      app.assets.css[namespace].content = prefixer(app.assets.css[namespace].content);
    }
    cb();
  };

  // Minify contents.
  api.minifyAll = function (cb) {
    async.forEachSeries(namespaces, api.minify, cb);
  };
  api.minify = function minify (namespace, cb) {
    if (app.assets.css[namespace].fromCache) return cb();

    if (app.conf.get('assets:css:' + namespace + ':minify') && app.assets.css[namespace].content) {
      app.log('- minifying `' + namespace + '` css ...');
      app.assets.css[namespace].content = sqwish.minify(app.assets.css[namespace].content);
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
    if (app.assets.css[namespace].fromCache) return cb();

    // Cache the content.
    if (app.conf.get('assets:css:' + namespace + ':cache') && app.assets.css[namespace].content) {
      var cacheKey = 'assets:' + app.assets.css[namespace].hash
        , cacheTags = {
            assets: ['*', 'css', namespace, namespace + ':css']
          }
        ;

      // Set the cache.
      app.log('- caching `' + namespace + '` css ...');
      app.cache.set(cacheKey, app.assets.css[namespace].content, cacheTags, cb);
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
    if (app.conf.get('assets:css:' + namespace + ':serve') && app.assets.css[namespace].content) {
      app.log('- serving `' + namespace + '` css ' + (app.assets.css[namespace].fromCache ? '(from cache)' : '') + ' ...');
      app.middleware.get(-1200, '/assets/css/' + app.assets.css[namespace].hash + '-' + namespace + '.css', dish(app.assets.css[namespace].content, {
        headers: {
          'Content-Type': 'text/css'
        }
      }));
    }
    cb();
  };

  // Helper to run all css modifiers.
  api.optimize = function optimize (cb) {
    app.log('optimizing css ...');
    async.series([
      api.aggregateAll,
      api.prefixAll,
      api.minifyAll,
      api.cacheAll,
      api.serveAll
    ], cb);
  };

  return api;
};
