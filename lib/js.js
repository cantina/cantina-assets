var fs = require('fs')
  , path = require('path')
  , crypto = require('crypto')
  , uglify = require('uglify-js')
  , dish = require('dish')
  , async = require('async')
  , glob = require('glob');

module.exports = function (app) {
  var namespaces
    , confScripts
    , reset = []
    , api = {};

  // Helper to run all js modifiers.
  api.optimize = function optimize (cb) {
    app.log('optimizing js ...');

    namespaces = Object.keys(app.conf.get('assets:js'));
    confScripts = app.conf.get('scripts');

    // Setup namespaces.
    app.assets.js = {};
    namespaces.forEach(function (namespace) {
      app.assets.js[namespace] = {};
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
    var conf = app.conf.get('assets:js:' + namespace);
    if (conf.aggregate) {
      app.log('- aggregating `' + namespace + '` js ...');
      var content = ''
        , files = {}
        , scripts = {}
        , requireConfig = {}
        , dirs = conf.dirs || []
        , amd = /\b(define\()\s*(['"]?)/igm
        , umd = /if *\( *typeof +module *===? *['"]object['"] *&& *typeof +define *!==? ['"]function['"]\) *{[^}]*?}[^]*?(define)/igm;

      async.series([
         // Collect javascript files.
        function (next) {
          var match = conf.match;
          if (match) {
            match = new RegExp(match.join('|'));
          }
          var exclude = conf.exclude;
          if (exclude) {
            exclude = new RegExp(exclude.join('|'));
          }

          // Look in specified dirs. Push empty string to look in app.root too.
          if (dirs.indexOf('') < 0) dirs.push('');
          dirs.forEach(function (dir) {
            dir = path.join((conf.root || app.root), dir, '/public');
            glob.sync(dir + '/**/*.js').forEach(function (file) {
              var key = file.substr(dir.length + 1);
              if ((!match || key.match(match)) && (!exclude || !exclude.test(key))) {
                if (fs.existsSync(file)) {
                  files[key] = file;
                }
              }
            });
          });

          next();
        },

        // Read RequireJS config file for custom module naming.
        function (next) {
          // Find requireJS config file (first one found in specified dirs).
          var confFile;
          dirs.forEach(function (dir) {
            var file = path.join((conf.root || app.root), dir, '/public/js/config.js');
            if (!confFile && fs.existsSync(file)) {
              confFile = file;
            }
          });

          // Read the config.
          if (confFile) {
            fs.readFile(confFile, 'utf8', function (err, config) {
              if (err) return next(err);
              config = config.replace('requirejs.config({', 'requireConfig = {').replace('});', '};');
              eval(config);
              next();
            });
          }
          else {
            next();
          }
        },

        // Make sure we only aggregate files that are actually used.
        function (next) {
          // Start with local scripts explicitly added to conf.
          confScripts.filter(function (url) {
            return (url[0] === '/');
          }).forEach(function (url) {
            var key = url.replace(/^\//, '');
            scripts[key] = files[key];
          });

          // Modules will be added during the hash creation below.
          next();
        },

        // Create build hash out of file contents.
        function (next) {
          var always = conf.always;
          if (always) {
            always = new RegExp(always.join('|'));
          }
          async.reduce(
            Object.keys(files),
            '',
            function (memo, key, cb) {
              fs.readFile(files[key], 'utf8', function (err, file) {
                if (err) return cb(err);

                // strip UMD wrapper
                if (umd.test(file)) {
                  file = file.replace(umd, '$1');
                }

                // If this is a local module, search for loaded modules and add
                // them to the scripts to aggregate.
                if (key.match(/^(?:shared\/)?js/)) {
                  // Anything that isn't explicitly required (perhaps in a loop or
                  // via a config object) needs to be specifically included via
                  // the conf
                  if (always && key.match(always)) {
                    scripts[key] = files[key];
                  }

                  // Find sync requires.
                  var matches = file.match(/require\(['"]([^'"]*)['"]\)/g) || [];

                  // Find AMD dependencies.
                  if (key.match(/^(?:shared\/)?js/)) {
                    var depMatches = file.match(/define\(\[[^\]]*\]/g);
                    if (depMatches) {
                      depMatches.forEach(function (match) {
                        var names;
                        match = match.replace('define([', 'names = [');
                        eval(match);
                        matches = matches.concat(names);
                      });
                    }
                  }

                  matches = matches
                    .map(function (match){
                      return match.replace(/require\(['"]/, '').replace(/['"]\)$/, '');
                    })
                    .filter(function (match) {
                      return match.indexOf('text!') < 0;
                    })
                    .map(function (name) {
                      if (requireConfig.paths[name]) {
                        return requireConfig.paths[name] + '.js';
                      }
                      else if (name.indexOf('shared/js/') === 0) {
                        return name + '.js';
                      }
                      else {
                        return 'js/' + name + '.js';
                      }
                    })
                    .map(function (name) {
                      return name.replace(/^\.\.\//, '');
                    })
                    .forEach(function (name) {
                      if (files[name]) {
                        scripts[name] = files[name];
                      }
                    });
                }
                // Add to hash aggregate.
                cb(err, memo + file);
              });
            },
            function (err, result) {
              if (err) return next(err);
              app.assets.js[namespace].hash = crypto.createHash('md5').update(result).digest('hex');
              next();
            }
          );
        },

        // Check cache.
        function (next) {
          // Skip if no cache mechanism, or it's disabled.
          if (!app.cache) return next();
          if (!app.conf.get('assets:js:' + namespace + ':cache')) return next();

          // Look up in cache.
          var cacheKey = 'assets:' + app.assets.js[namespace].hash;
          app.cache.get(cacheKey, function (err, result) {
            if (err) return next(err);

            // If no result, continue to build.
            if (!result) return next();

            // Set content. Flag as from cache to skip further processing.
            app.assets.js[namespace].content = result.data;
            app.assets.js[namespace].fromCache = true;
            next();
          });
        },

        // Concatenate files together.
        function (next) {
          if (app.assets.js[namespace].fromCache) return next();

          var exclude = conf.exclude;
          if (exclude) {
            exclude = new RegExp('(' + exclude.join(')|(') + ')');
          }
          async.forEachSeries(Object.keys(scripts), function (key, done) {
            if (!exclude || !exclude.test(key)) {
              var file = scripts[key]
                , name = null
                , shimDeps
                , shimExport;

              fs.readFile(file, 'utf8', function (err, js) {
                if (err) return done(err);

                // If file defines a module, add module name.
                if (key.match(/^(?:shared\/)?js/)) {
                  // App file.
                  name = key.slice(key.indexOf('js/') === 0 ? 3 : 0, -3);
                }

                // Loop through RequireJS config paths for custom module names.
                Object.keys(requireConfig.paths).forEach(function (configName) {
                  var path = requireConfig.paths[configName];
                  if (key === (path.replace('../', '') + '.js')) {
                    name = configName;
                  }
                });

                if (name) {
                  // strip UMD wrapper (again)
                  if (umd.test(js)) {
                    js = js.replace(umd, '$1');
                  }

                  // File is already AMD-compatible.
                  if (amd.test(js)) {
                    // Ensure no anonymous defines.
                    js = js.replace(amd, function amdDeanonymizer (match, defineSubstr, quotemark) {
                      return defineSubstr + (quotemark ? quotemark : "'" + name + "', ");
                    });
                  }
                  // Convert to AMD.
                  else {
                    shimDeps = shimExport = '';
                    if (requireConfig.shim && requireConfig.shim[name]) {
                      if (requireConfig.shim[name].deps) {
                        shimDeps = "['" + requireConfig.shim[name].deps.join("', '") + "'], ";
                      }
                      if (requireConfig.shim[name].exports) {
                        shimExport = "\n\n" +
                                      "  // Shim Export\n" +
                                      "  return typeof " + requireConfig.shim[name].exports + " === 'undefined' ? window." + requireConfig.shim[name].exports + " : " + requireConfig.shim[name].exports + ";\n";
                      }
                    }
                    js = "define('" + name + "', " + shimDeps + "function () {\n" +
                           js.split('\n').map(function (line) { return '  ' + line; }).join('\n') +
                           shimExport +
                         "\n});";
                  }
                }

                // Find local scripts, then remove them from the conf.
                var conf = confScripts
                  .filter(function (url) {
                    return (url[0] === '/');
                  })
                  .filter(function (url) {
                    return (!exclude || !exclude.test(url));
                  });

                var keep = confScripts
                  .filter(function (url) {
                    return conf.indexOf(url) < 0;
                  });

                app.conf.reset('scripts', keep);

                // Add to content.
                content += '/* ' + key + ' */\n';
                content += js + '\n\n';
                done();
              });
            }
            else {
              done();
            }
          }, next);
        },

        // Massage the contents.
        function (next) {
          if (app.assets.js[namespace].fromCache) return next();

          // WTF moment?
          content = content.replace("define('moment', \"moment\",", "define('moment', ");
          app.assets.js[namespace].content = content;
          next();
        }
      ], function (err) {
        if (err) return cb(err);
        // Override conf js with the aggregate.
        reset.push('/assets/js/' + app.assets.js[namespace].hash + '-' + namespace + '.js');
        app.conf.set('scripts', reset);
        cb();
      });
    }
    else {
      cb();
    }
  };

  // Minify contents.
  api.minifyAll = function (cb) {
    async.forEachSeries(namespaces, api.minify, cb);
  };
  api.minify = function minify (namespace, cb) {
    if (app.assets.js[namespace].fromCache) return cb();

    if (app.conf.get('assets:js:' + namespace + ':minify') && app.assets.js[namespace].content) {
      app.log('- minifying `' + namespace + '` js (could take a while) ...');
      app.assets.js[namespace].content = uglify.minify(app.assets.js[namespace].content, {
        fromString: true,
        mangle: {
          except: ['require', 'requirejs', 'define']
        }
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
    if (app.assets.js[namespace].fromCache) return cb();

    // Cache the content.
    if (app.conf.get('assets:js:' + namespace + ':cache') && app.assets.js[namespace].content) {
      var cacheKey = 'assets:' + app.assets.js[namespace].hash
        , cacheTags = {
            assets: ['*', 'js', namespace, namespace + ':js']
          }
        ;

      // Set the cache.
      app.log('- caching `' + namespace + '` js ...');
      app.cache.set(cacheKey, app.assets.js[namespace].content, cacheTags, cb);
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
    if (app.conf.get('assets:js:' + namespace + ':serve') && app.assets.js[namespace].content) {
      app.log('- serving `' + namespace + '` js ' + (app.assets.js[namespace].fromCache ? '(from cache)' : '') + ' ...');
      app.middleware.get(-1200, '/assets/js/' + app.assets.js[namespace].hash + '-' + namespace + '.js', dish(app.assets.js[namespace].content, {
        headers: {
          'Content-Type': 'text/javascript'
        }
      }));
    }
    cb();
  };

  return api;
};
