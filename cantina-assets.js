var app = require('cantina');

app.assets = module.exports = {};
require('./lib/css.js');
require('./lib/js.js');
require('./lib/templates.js');

if (app.conf.get('assets:optimize') === 'enabled') {
  app.hook('start').add(-503, app.assets.css.optimize);
  app.hook('start').add(-502, app.assets.js.optimize);
  app.hook('start').add(-501, app.assets.templates.optimize);
}
