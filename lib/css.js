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
  , namespaces = Object.keys(conf)
  , stylesheets = app.conf.get('styles')
  , styles = [];

// Setup namespaces on start.
app.hook('start').add(-500, function (cb) {
  namespaces.forEach(function (namespace) {
    app.assets.css[namespace] = {};
  });
  cb();
});

// Aggregate files into one.
exports.aggregateAll = function (cb) {
  async.forEachSeries(namespaces, exports.aggregate, cb);
};
exports.aggregate = function aggregate (namespace, cb) {
  if (conf[namespace].aggregate) {
    console.log('- aggregating ' + namespace + ' css ...');
    var files = {}
      , contents = ''
      , hash = null;

    async.series([
      // Collect stylesheets for this namespace.
      function (next) {
        var match = conf[namespace].match;
        if (match) {
          match = new RegExp('(' + match.join(')|(') + ')');
        }

        stylesheets.forEach(function (key) {
          if (!files[key] && (!match || key.match(match))) {
            files[key] = path.join(app.root, 'public', key);
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
            contents += '/* ' + key + ' */\n';
            contents += css + '\n\n';

            app.assets.css[namespace].contents = contents;
            done();
          });
        }, next);
      }
    ], function (err) {
      // Override conf styles with the aggregate.
      styles.push('/assets/css/' + app.assets.css[namespace].hash + '-' + namespace + '.css');
      app.conf.reset('styles', styles);
      cb();
    });
  }
  else {
    cb();
  }
};

// Auto-prefix stylesheets.
exports.prefixAll = function (cb) {
  async.forEachSeries(namespaces, exports.prefix, cb);
};
exports.prefix = function prefix (namespace, cb) {
  if (conf[namespace].prefix) {
    console.log('- prefixing ' + namespace + ' css ...');
    app.assets.css[namespace].contents = prefixer(app.assets.css[namespace].contents);
  }
  cb();
};

// Minify contents.
exports.minifyAll = function (cb) {
  async.forEachSeries(namespaces, exports.minify, cb);
};
exports.minify = function minify (namespace, cb) {
  if (conf[namespace].minify) {
    console.log('- minifying ' + namespace + ' css (could take a while) ...');
    app.assets.css[namespace].contents = sqwish.minify(app.assets.css[namespace].contents);
  }
  cb();
};

// Serve file.
exports.serveAll = function (cb) {
  async.forEachSeries(namespaces, exports.serve, cb);
};
exports.serve = function serve (namespace, cb) {
  if (conf[namespace].serve) {
    console.log('- serving ' + namespace + ' css ...');
    app.middleware.get(-1200, '/assets/css/' + app.assets.css[namespace].hash + '-' + namespace + '.css', dish(app.assets.css[namespace].contents, {
      headers: {
        'Content-Type': 'text/css'
      }
    }));
  }
  cb();
};

// Helper to run all asset modifiers.
exports.optimize = function optimize (cb) {
  console.log('optimizing css ...');
  async.series([
    exports.aggregateAll.bind(app),
    exports.prefixAll.bind(app),
    exports.minifyAll.bind(app),
    exports.serveAll.bind(app)
  ], cb);
};
