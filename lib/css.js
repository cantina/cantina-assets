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
  , namespaces = Object.keys(app.conf.get('assets:css'))
  , styles = app.conf.get('styles')
  , reset = [];

// Setup namespaces.
app.assets.css = exports;
namespaces.forEach(function (namespace) {
  app.assets.css[namespace] = {};
});

// Aggregate files into one.
exports.aggregateAll = function (cb) {
  async.forEachSeries(namespaces, exports.aggregate, cb);
};
exports.aggregate = function aggregate (namespace, cb) {
  var conf = app.conf.get('assets:css:' + namespace);
  if (conf.aggregate) {
    console.log('- aggregating `' + namespace + '` css ...');
    var files = {}
      , content = ''
      , hash = null;

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

        styles.forEach(function (key) {
          if (!files[key] && (!match || key.match(match)) && (!exclude || !exclude.test(key))) {
            files[key] = path.join(app.root, 'public', key);
          }
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
exports.prefixAll = function (cb) {
  async.forEachSeries(namespaces, exports.prefix, cb);
};
exports.prefix = function prefix (namespace, cb) {
  if (app.conf.get('assets:css:' + namespace + ':prefix')) {
    console.log('- prefixing `' + namespace + '` css ...');
    app.assets.css[namespace].content = prefixer(app.assets.css[namespace].content);
  }
  cb();
};

// Minify contents.
exports.minifyAll = function (cb) {
  async.forEachSeries(namespaces, exports.minify, cb);
};
exports.minify = function minify (namespace, cb) {
  if (app.conf.get('assets:css:' + namespace + ':minify')) {
    console.log('- minifying `' + namespace + '` css ...');
    app.assets.css[namespace].content = sqwish.minify(app.assets.css[namespace].content);
  }
  cb();
};

// Serve file.
exports.serveAll = function (cb) {
  async.forEachSeries(namespaces, exports.serve, cb);
};
exports.serve = function serve (namespace, cb) {
  if (app.conf.get('assets:css:' + namespace + ':serve') && app.assets.css[namespace].content) {
    console.log('- serving `' + namespace + '` css ...');
    app.middleware.get(-1200, '/assets/css/' + app.assets.css[namespace].hash + '-' + namespace + '.css', dish(app.assets.css[namespace].content, {
      headers: {
        'Content-Type': 'text/css'
      }
    }));
  }
  cb();
};

// Helper to run all css modifiers.
exports.optimize = function optimize (cb) {
  console.log('optimizing css ...');
  async.series([
    exports.aggregateAll,
    exports.prefixAll,
    exports.minifyAll,
    exports.serveAll
  ], cb);
};