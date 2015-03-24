var autoprefixer = require('autoprefixer-core');

module.exports = function (app) {
  var processor;

  // Default conf.
  app.conf.add({
    assets: {
      prefix: {
        browsers: ['> 1%', 'IE >= 9'],
        cascade: false
      }
    }
  });

  // Create processor.
  processor = autoprefixer(app.conf.get('assets:prefix'));

  // Prefix the given css.
  return function prefix (css) {
    return processor.process(css).css;
  };
};
