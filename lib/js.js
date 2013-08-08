var app = require('cantina')
  , path = require('path')
  , fs = require('fs')
  , mkdirp = require('mkdirp')
  , rimraf = require('rimraf')
  , crypto = require('crypto')
  , uglify = require('uglify-js')
  , dish = require('dish')
  , _ = require('underscore')
  , async = require('async')
  , glob = require('glob');

module.exports = function optimizeJavascript (cb) {
  var content = ''
    , files = {}
    , scripts = {}
    , dirs = {}
    , key = null
    , hash = null
    , requireConfig = {};

  if (app.conf.get('optimize:js:aggregate')) {
    async.series([
      // Collect javascript files.
      function (next) {
        var dir = app.root + '/public/';
        glob.sync(dir + '**/*.js').forEach(function (file) {
          key = file.substr(dir.length);
          if (!files[key]) {
            files[key] = file;
          }
        });
        next();
      },

      // Read RequireJS config file for custom module naming.
      function (next) {
        fs.readFile(app.root + '/public/js/config.js', 'utf8', function (err, config) {
          if (err) return next(err);
          config = config.replace('requirejs.config({', 'requireConfig = {').replace('});', '};');
          eval(config);
          next();
        });
      },

      // Make sure we only aggregate files that are actually used.
      function (next) {
        // Start with local scripts explicitly added to conf.
        app.conf.get('scripts').filter(function (url) {
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
        var md5 = crypto.createHash('md5');
        async.reduce(
          Object.keys(files),
          '',
          function (memo, key, cb) {
            var file = files[key];
            fs.readFile(file, 'utf8', function (err, file) {
              if (err) return cb(err);

              // If this is a local module, search for loaded modules and add
              // them to the scripts to aggregate.
              if (key.indexOf('js/') === 0) {
                // If this is a controller or widget, add it (they are loaded async).
                if (key.match(/_controller\.js|_widget\.js/gi)) {
                  scripts[key] = files[key];
                }

                // Find sync requires.
                var matches = file.match(/require\(['"]([^'"]*)['"]\)/g) || [];

                // Find AMD dependencies.
                if (key.indexOf('js/') === 0) {
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
            hash = md5.update(result).digest('hex');
            next();
          }
        );
      },

      // Add boot.
      function (next) {
        scripts['js/boot.js'] = files['js/boot.js'];
        next();
      },

      // Concatenate files together.
      function (next) {
        var exclude = app.conf.get('optimize:js:exclude');
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
              // If file defines a module, add module name.
              if (key.match(/^js/)) {
                // App file.
                name = key.slice(3, -3);
              }

              // Loop through RequireJS config paths for custom module names.
              _(requireConfig.paths).forEach(function (path, configName) {
                if (key === (path.replace('../', '') + '.js')) {
                  name = configName;
                }
              });

              if (name) {
                // File is already AMD-compatible.
                if (js.match(/(define\()(\s?)/i)) {
                  js = js.replace(/(define\()(\s?)/i, "define('" + name + "', ");
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
                                    "  return window." + requireConfig.shim[name].exports + ";\n";
                    }
                  }
                  js = "define('" + name + "', " + shimDeps + "function () {\n" +
                         js.split('\n').map(function (line) { return '  ' + line; }).join('\n') +
                         shimExport +
                       "\n});";
                }
              }

              // Find local scripts, then remove them from the conf.
              var conf = app.conf.get('scripts')
                .filter(function (url) {
                  return (url[0] === '/');
                })
                .filter(function (url, i) {
                  return (!exclude || !exclude.test(url));
                });

              var keep = app.conf.get('scripts')
                .filter(function (url) {
                  return conf.indexOf(url) < 0;
                });

              app.conf.reset('scripts', keep);

              // Add to content.
              content += '\n\n/* ' + key + ' */\n';
              content += js;
              content += '\n';
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
        // WTF moment?
        content = content.replace("define('moment', \"moment\",", "define('moment', ");

        next();
      },

      // Minify contents.
      function (next) {
        if (app.conf.get('optimize:js:minify')) {
          console.log('minifying javascript (could take a while) ...');
          content = uglify.minify(content, {
            fromString: true,
            mangle: {
              except: ['require', 'requirejs', 'define']
            }
          }).code;
          next();
        }
        else {
          next();
        }
      },

      // Cache and serve the aggregate.
      function (next) {
        app.optimize.js = content;
        app.conf.set('scripts', ['/optimize/js/' + hash + '.js']);
        app.middleware.get(-1200, '/optimize/js/' + hash + '.js', dish(content, {
          headers: {
            'Content-Type': 'text/javascript'
          }
        }));
        next();
      }
    ], cb);
  }
  else {
    cb();
  }
};