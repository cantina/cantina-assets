var app = require('cantina')
  , path = require('path')
  , fs = require('fs')
  , mkdirp = require('mkdirp')
  , rimraf = require('rimraf')
  , crypto = require('crypto')
  , Handlebars = require('handlebars')
  , uglify = require('uglify-js')
  , dish = require('dish')
  , async = require('async')
  , glob = require('glob')
  , namespaces = Object.keys(app.conf.get('assets:templates'));

// Setup namespaces.
app.assets.templates = exports;
namespaces.forEach(function (namespace) {
  app.assets.templates[namespace] = {};
});

// Aggregate files into one.
exports.aggregateAll = function (cb) {
  async.forEachSeries(namespaces, exports.aggregate, cb);
};
exports.aggregate = function aggregate (namespace, cb) {
  var conf = app.conf.get('assets:templates:' + namespace);
  if (conf.aggregate) {
    console.log('- aggregating ' + namespace + ' templates (could take a while) ...');
    var templates = {}
      , content = ''
      , files = {}
      , key = null
      , hash = null;

    async.series([
      // Collect possible templates.
      function (next) {
        var dir = app.root + '/public';
        glob.sync(dir + '/**/*.hbs').forEach(function (file) {
          key = file.substr(dir.length + 1);
          key = key.substring(0, key.length - 4);
          if (!files[key]) {
            files[key] = file;
          }
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
            if (name.match(/shared/)) {
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

      // Compile and concatenate templates together, per locale.
      function (next) {
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
exports.minifyAll = function (cb) {
  async.forEachSeries(namespaces, exports.minify, cb);
};
exports.minify = function minify (namespace, cb) {
  if (app.conf.get('assets:templates:' + namespace + ':minify')) {
    console.log('- minifying ' + namespace + ' templates (could take a while) ...');
    app.assets.templates[namespace].content = uglify.minify(app.assets.templates[namespace].content, {
      fromString: true
    }).code;
  }
  cb();
};

// Serve file.
exports.serveAll = function (cb) {
  async.forEachSeries(namespaces, exports.serve, cb);
};
exports.serve = function serve (namespace, cb) {
  if (app.conf.get('assets:templates:' + namespace + ':serve')) {
    console.log('- serving ' + namespace + ' templates ...');
    app.middleware.get(-1200, '/assets/templates/' + app.assets.templates[namespace].hash + '-' + namespace + '.js', dish(app.assets.templates[namespace].content, {
      headers: {
        'Content-Type': 'text/javascript'
      }
    }));
  }
  cb();
};

// Helper to run all template modifiers.
exports.optimize = function optimize (cb) {
  console.log('optimizing templates ...');
  async.series([
    exports.aggregateAll.bind(app),
    exports.minifyAll.bind(app),
    exports.serveAll.bind(app)
  ], cb);
};