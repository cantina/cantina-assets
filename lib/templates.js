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
  , glob = require('glob');

module.exports = function optimizeTemplates (cb) {
  var templates = {}
    , content = ''
    , files = {}
    , key = null
    , hash = null;

  if (app.conf.get('optimize:js:aggregate') && app.conf.get('optimize:templates:aggregate')) {
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
        var matches = app.optimize.js.match(/['"]hbs\!([^'"]*)/g);
        if (matches){
          matches = matches.map(function (match){
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
            next();
          }
        );
      },

      // Compile and concatenate templates together, per locale.
      function (next) {
        var exclude = app.conf.get('optimize:css:exclude');
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

       // Minify contents.
      function (next) {
        if (app.conf.get('optimize:templates:minify')) {
          console.log('minifying templates (could take a while) ...');
          content = uglify.minify(content, {
            fromString: true
          }).code;
        }
        next();
      },

      // Cache and serve the aggregates.
      function (next) {
        app.optimize.templates = content;

        // Wrap content in AMD definition.
        content = "define(['handlebars'], function (Handlebars) {\n" +
                          'var templates = {};\n\n' +
                          content +
                          'return templates;\n' +
                          "});";

        app.middleware.get(-1200, '/optimize/templates/' + hash + '.js', dish(content, {
          headers: {
            'Content-Type': 'text/javascript'
          }
        }));

        app.conf.set('optimize:templates:hash', hash);
        next();
      }
    ], cb);
  }
  else {
    app.conf.set('optimize:templates:aggregate', false);
    cb();
  }
};