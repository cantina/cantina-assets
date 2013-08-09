var app = require('cantina')
  , path = require('path')
  , fs = require('fs')
  , mkdirp = require('mkdirp')
  , rimraf = require('rimraf')
  , crypto = require('crypto')
  , sqwish = require('sqwish')
  , dish = require('dish')
  , prefixer = require('./prefix')
  , async = require('async')
  , conf = app.conf.get('assets:css')
  , namespaces = Object.keys(conf);

// Setup namespaces on start.
app.hook('start').add(-500, function (cb) {
  namespaces.forEach(function (namespace) {
    app.assets.css[namespace] = {};
  });
  cb();
});

// Aggregate files into one.
exports.aggregate = function aggregate (cb) {
  async.forEachSeries(namespaces, function (namespace, complete) {
    if (conf[namespace].aggregate) {
      console.log('- aggregating ' + namespace + ' css ...');
      var contents = ''
        , files = {}
        , key = null
        , hash = null;

      async.series([
        // Collect stylesheets for this namespace.
        function (next) {
          var dir = app.root + '/public';
          var match = conf[namespace].match;
          if (match) {
            match = new RegExp('(' + match.join(')|(') + ')');
          }

          app.glob.sync(dir + '/**/*.css').forEach(function (file) {
            key = file.substr(dir.length);
            if (!files[key] && (app.conf.get('styles').indexOf(key) !== -1) && (!match || key.match(match))) {
              files[key] = file.substr(app.root.length + 1);
            }
          });

          app.assets.css[namespace].files = files;
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
                cb(err, memo + file);
              });
            },
            function (err, result) {
              hash = md5.update(result).digest('hex');
              app.assets.css[namespace].hash = hash;
              next();
            }
          );
        },

        // Concatenate stylesheets.
        function (next) {
          async.forEachSeries(Object.keys(files), function (key, done) {
            var file = path.join(app.root, files[key])
              , dir;

            fs.readFile(file, 'utf8', function (err, css) {
              if (err) return done(err);

              // Deal with relative urls in stylesheets.
              if (key.indexOf('/vendor/') === 0) {
                dir = path.dirname(key);
                css = css.replace(/url\(['"]?([^\)'"]*)['"]?\)/gi, function (match, url, offset) {
                  if (url.indexOf('data:') < 0) {
                    return 'url("/' + path.normalize(dir + '/' + url) + '")';
                  }
                  return match;
                });
              }

              // Add to aggregate.
              contents += '\n\n/* ' + key + ' */\n';
              contents += css;

              app.assets.css[namespace].contents = contents;

              done();
            });
          }, next);
        }
      ], complete);
    }
    else {
      complete();
    }
  }, function (err) {
    // Override conf styles with the aggregates.
    var styles = [];
    namespaces.forEach(function (namespace) {
      styles.push('/assets/css/' + app.assets.css[namespace].hash + '-' + namespace + '.css');
    });
    app.conf.reset('styles', styles);
    cb();
  });
};

// Auto-prefix stylesheets.
exports.prefix = function prefix (cb) {
  namespaces.forEach(function (namespace) {
    if (conf[namespace].prefix) {
      console.log('- prefixing ' + namespace + ' css ...');
      app.assets.css[namespace].contents = prefixer(app.assets.css[namespace].contents);
    }
  });
  cb();
};

// Minify contents.
exports.minify = function minify (cb) {
  namespaces.forEach(function (namespace) {
    if (conf[namespace].minify) {
      console.log('- minifying ' + namespace + ' css (could take a while) ...');
      app.assets.css[namespace].contents = sqwish.minify(app.assets.css[namespace].contents);
    }
  });
  cb();
};

// Serve file.
exports.serve = function serve (cb) {
  namespaces.forEach(function (namespace) {
    if (conf[namespace].serve) {
      console.log('- serving ' + namespace + ' css ...');
      app.middleware.get(-1200, '/assets/css/' + app.assets.css[namespace].hash + '-' + namespace + '.css', dish(app.assets.css[namespace].contents, {
        headers: {
          'Content-Type': 'text/css'
        }
      }));
    }
  });
  cb();
};

// Helper to run all asset modifiers.
exports.optimize = function optimize (cb) {
  console.log('optimizing css ...');
  async.series([
    exports.aggregate.bind(app),
    exports.prefix.bind(app),
    exports.minify.bind(app),
    exports.serve.bind(app)
  ], cb);
};
