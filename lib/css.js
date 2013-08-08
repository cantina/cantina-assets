var app = require('cantina')
  , path = require('path')
  , fs = require('fs')
  , mkdirp = require('mkdirp')
  , rimraf = require('rimraf')
  , crypto = require('crypto')
  , sqwish = require('sqwish')
  , dish = require('dish')
  , prefix = require('./prefix')
  , async = require('async');

module.exports = function optimizeCSS (cb) {
  var content = {
        local: '',
        vendor: ''
      }
    , files = {}
    , sets = {}
    , key = null
    , hash = null;

  if (app.conf.get('optimize:css:aggregate')) {
    async.series([
      // Collect stylesheets.
      // Files are mapped according to the relative path browsers would use to
      // access them. Overrides by multiple toolkits and the vhost are
      // accounted for.
      function (next) {
        var dir = app.root + '/public';
        app.glob.sync(dir + '/**/*.css').forEach(function (file) {
          key = file.substr(dir.length + 1);
          if (!files[key]) {
            files[key] = file.substr(app.root.length + 1);
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
            next();
          }
        );
      },

      // Figure out which stylesheets to aggregate.
      function (next) {
        var exclude = app.conf.get('optimize:css:exclude');
        if (exclude) {
          exclude = new RegExp('(' + exclude.join(')|(') + ')');
        }

        // Find local stylesheets, then remove them from the conf.
        var stylesheets = app.conf.get('styles')
          .filter(function (file){
            return (file[0] === '/');
          })
          .filter(function (file, i) {
            return (!exclude || !exclude.test(file));
          });

        var keep = app.conf.get('styles')
          .filter(function (file) {
            return stylesheets.indexOf(file) < 0;
          });

        app.conf.reset('styles', keep);

        stylesheets = stylesheets.map(function (file){
          return file.substr(1);
        });

        sets = {
          local: stylesheets.filter(function (url) { return !url.match(/^vendor/); }),
          vendor: stylesheets.filter(function (url) { return url.match(/^vendor/); })
        };

        next();
      },

      // Concatenate local styles.
      function (next) {
        async.forEachSeries(sets.local, function (key, done) {
          var file = path.join(app.root, files[key])
            , dir;

          fs.readFile(file, 'utf8', function (err, css) {
            if (err) return done(err);

            // Auto-prefix stylesheets.
            if (app.conf.get('optimize:css:prefix')) {
              css = prefix(css);
            }

            // Add to aggregate.
            content.local += '\n\n/* ' + key + ' */\n';
            content.local += css;

            done();
          });
        }, next);
      },

      // Concatenate vendor styles.
      function (next) {
        async.forEachSeries(sets.vendor, function (key, done) {
          var file = path.join(app.root, files[key])
            , dir;

          fs.readFile(file, 'utf8', function (err, css) {
            if (err) return done(err);

            // Deal with relative urls in vendor stylesheets.
            if (key.indexOf('vendor/') === 0) {
              dir = path.dirname(key);
              css = css.replace(/url\(['"]?([^\)'"]*)['"]?\)/gi, function (match, url, offset) {
                if (url.indexOf('data:') < 0) {
                  return 'url("/' + path.normalize(dir + '/' + url) + '")';
                }
                return match;
              });
            }

            // Add to aggregate.
            content.vendor += '\n\n/* ' + key + ' */\n';
            content.vendor += css;

            done();
          });
        }, next);
      },

      // Minify contents.
      function (next) {
        if (app.conf.get('optimize:css:minify')) {
          console.log('minifying css (could take a while) ...');
          content.local = sqwish.minify(content.local);
          content.vendor = sqwish.minify(content.vendor);
        }
        next();
      },

      // Cache and serve the aggregates.
      function (next) {
        app.optimize.css = content;
        app.conf.set('styles', [
          '/optimize/css/' + hash + '-vendor.css',
          '/optimize/css/' + hash + '.css'
        ]);
        app.middleware.get(-1200, '/optimize/css/' + hash + '-vendor.css', dish(content.vendor, {
          headers: {
            'Content-Type': 'text/css'
          }
        }));
        app.middleware.get(-1200, '/optimize/css/' + hash + '.css', dish(content.local, {
          headers: {
            'Content-Type': 'text/css'
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