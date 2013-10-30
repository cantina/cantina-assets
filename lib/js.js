var app = require('cantina')
  , fs = require('fs')
  , crypto = require('crypto')
  , uglify = require('uglify-js')
  , dish = require('dish')
  , async = require('async')
  , glob = require('glob')
  , namespaces = Object.keys(app.conf.get('assets:js'))
  , confScripts = app.conf.get('scripts')
  , reset = [];

// Setup namespaces.
app.assets.js = exports;
namespaces.forEach(function (namespace) {
  app.assets.js[namespace] = {};
});

// Aggregate files into one.
exports.aggregateAll = function (cb) {
  async.forEachSeries(namespaces, exports.aggregate, cb);
};
exports.aggregate = function aggregate (namespace, cb) {
  var conf = app.conf.get('assets:js:' + namespace);
  if (conf.aggregate) {
    app.log('- aggregating `' + namespace + '` js ...');
    var content = ''
      , files = {}
      , scripts = {}
      , key = null
      , hash = null
      , requireConfig = {}
      , amd = /(^|[^\.])(define\()(\s?)/i
      , umd = /if *\( *typeof +module *===? *['"]object['"] *&& *typeof +define *!==? ['"]function['"]\) *{[^}]*?}[^]*?(define)/im;

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
        var dir = app.root + '/public/';
        glob.sync(dir + '**/*.js').forEach(function (file) {
          key = file.substr(dir.length);
          if (!files[key] && (!match || key.match(match)) && (!exclude || !exclude.test(key))) {
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
        var md5 = crypto.createHash('md5');
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
                // If this is a controller or widget, add it (they are loaded async).
                if (key.match(/_controller\.js|_widget\.js/gi)) {
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

            hash = md5.update(result).digest('hex');
            app.assets.js[namespace].hash = hash;
            next();
          }
        );
      },

      // Concatenate files together.
      function (next) {
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
                // Ensure no anonymous defines.
                if (amd.test(js)) {
                  js = js.replace(amd, "$1define('" + name + "', ");
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
        // WTF moment?
        content = content.replace("define('moment', \"moment\",", "define('moment', ");
        app.assets.js[namespace].content = content;
        next();
      }
    ], function (err) {
      if (err) return cb(err);
      // Override conf js with the aggregate.
      reset.push('/assets/js/' + hash + '-' + namespace + '.js');
      app.conf.set('scripts', reset);
      cb();
    });
  }
  else {
    cb();
  }
};

// Minify contents.
exports.minifyAll = function (cb) {
  async.forEachSeries(namespaces, exports.minify, cb);
};
exports.minify = function minify (namespace, cb) {
  if (app.conf.get('assets:js:' + namespace + ':minify')) {
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

// Serve file.
exports.serveAll = function (cb) {
  async.forEachSeries(namespaces, exports.serve, cb);
};
exports.serve = function serve (namespace, cb) {
  if (app.conf.get('assets:js:' + namespace + ':serve') && app.assets.js[namespace].content) {
    app.log('- serving `' + namespace + '` js ...');
    app.middleware.get(-1200, '/assets/js/' + app.assets.js[namespace].hash + '-' + namespace + '.js', dish(app.assets.js[namespace].content, {
      headers: {
        'Content-Type': 'text/javascript'
      }
    }));
  }
  cb();
};

// Helper to run all js modifiers.
exports.optimize = function optimize (cb) {
  app.log('optimizing js ...');
  async.series([
    exports.aggregateAll.bind(app),
    exports.minifyAll.bind(app),
    exports.serveAll.bind(app)
  ], cb);
};
