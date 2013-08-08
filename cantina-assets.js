var app = require('cantina')
  , async = require('async');

if (app.conf.get('optimize:status') === 'enabled') {
  app.optimize = {};
  app.hook('start').add(-500, require('./lib/css.js'));
  app.hook('start').add(-500, require('./lib/js.js'));
  app.hook('start').add(-500, require('./lib/templates.js'));
}
