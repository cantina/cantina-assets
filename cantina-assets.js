var app = require('cantina');

app.assets = module.exports = {
  css: require('./lib/css.js'),
  js: require('./lib/js.js'),
  templates: require('./lib/templates.js')
};

if (app.conf.get('assets:optimize') === 'enabled') {
  app.hook('start').add(-503, app.assets.css.optimize);
  app.hook('start').add(-502, app.assets.js.optimize);
  app.hook('start').add(-501, app.assets.templates.optimize);
}
