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
  , glob = require('glob')
  , namespaces = Object.keys(app.conf.get('assets:js'))
  , confScripts = app.conf.get('scripts')
  , reset = [];

// Setup namespaces on start.
app.hook('start').add(-1000, function (cb) {
  namespaces.forEach(function (namespace) {
    app.assets.js[namespace] = {};
  });
  cb();
});

// Aggregate files into one.
exports.aggregateAll = function (cb) {
  async.forEachSeries(namespaces, exports.aggregate, cb);
};
exports.aggregate = function aggregate (namespace, cb) {
  var conf = app.conf.get('assets:js:' + namespace);
  if (conf.aggregate) {
    console.log('- aggregating ' + namespace + ' js ...');
    var content = ''
      , files = {}
      , scripts = {}
      , dirs = {}
      , key = null
      , hash = null
      , requireConfig = {};

    async.series([
       // Collect javascript files.
      function (next) {
        var match = conf.match;
        if (match) {
          match = new RegExp('(' + match.join(')|(') + ')');
        }
        var exclude = conf.exclude;
        if (exclude) {
          exclude = new RegExp('(' + exclude.join(')|(') + ')');
        }
        var dir = app.root + '/public/';
        glob.sync(dir + '**/*.js').forEach(function (file) {
          key = file.substr(dir.length);
          // console.log(key);
          if (!files[key] && (!match || key.match(match)) && (!exclude || !exclude.test(key))) {
          // if (!files[key]) {
            files[key] = file;
          }
        });
        // console.log(files);
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
            // console.log(key);
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
        // @todo: why is this needed?
        if (namespace === 'local') {
          scripts['js/boot.js'] = files['js/boot.js'];
        }
        next();
      },

      // Concatenate files together.
      function (next) {
        var exclude = conf.exclude;
        if (exclude) {
          exclude = new RegExp('(' + exclude.join(')|(') + ')');
        }
        // console.log(scripts);
        async.forEachSeries(Object.keys(scripts), function (key, done) {
          if (!exclude || !exclude.test(key)) {
            var file = scripts[key]
              , name = null
              , shimDeps
              , shimExport;

              if (!file) console.log(key);

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
              var conf = confScripts
                .filter(function (url) {
                  return (url[0] === '/');
                })
                .filter(function (url, i) {
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
        app.assets.js[namespace].hash = hash;
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
    console.log('- minifying ' + namespace + ' js (could take a while) ...');
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
  if (app.conf.get('assets:js:' + namespace + ':serve')) {
    console.log('- serving ' + namespace + ' js ...');
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
  console.log('optimizing js ...');
  async.series([
    exports.aggregateAll.bind(app),
    exports.minifyAll.bind(app),
    exports.serveAll.bind(app)
  ], cb);
};
