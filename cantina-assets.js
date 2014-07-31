module.exports = function (app) {
  app.assets = {};

  var css = app.require('./lib/css.js')
    , js = app.require('./lib/js.js')
    , templates = app.require('./lib/templates.js');

  if (app.conf.get('assets:optimize') === 'enabled') {
    app.hook('start').add(-503, css.optimize);
    app.hook('start').add(-502, js.optimize);
    app.hook('start').add(-501, templates.optimize);
  }

  return app.assets;
};