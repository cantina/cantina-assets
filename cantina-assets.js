module.exports = function (app) {
  app.assets = {};

  if (app.conf.get('assets:optimize') === 'enabled') {
    app.hook('start').add(-503, app.require('./lib/css.js').optimize);
    app.hook('start').add(-502, app.require('./lib/js.js').optimize);
    app.hook('start').add(-501, app.require('./lib/templates.js').optimize);
  }

  return app.assets;
};