var transformations = {
  'border-radius: ([^;]*)': function (parts) {
    return [
      '-webkit-border-radius: ' + parts[0] + ';',
      '   -moz-border-radius: ' + parts[0] + ';',
      '        border-radius: ' + parts[0] + ';'
    ];
  },
  'transform: ([^;]*)': function (parts) {
    return [
      '-webkit-transform: ' + parts[0] + ';',
      '   -moz-transform: ' + parts[0] + ';',
      '    -ms-transform: ' + parts[0] + ';',
      '        transform: ' + parts[0] + ';'
    ];
  },
  'box-sizing: ([^;]*)': function (parts) {
    return [
      '-webkit-box-sizing: ' + parts[0] + ';',
      '   -moz-box-sizing: ' + parts[0] + ';',
      '    -ms-box-sizing: ' + parts[0] + ';',
      '        box-sizing: ' + parts[0] + ';'
    ];
  },
  'user-select: ([^;]*)': function (parts) {
    return [
      '-webkit-user-select: ' + parts[0] + ';',
      '   -moz-user-select: ' + parts[0] + ';',
      '    -ms-user-select: ' + parts[0] + ';',
      '        user-select: ' + parts[0] + ';'
    ];
  }
};

module.exports = function (css) {
  Object.keys(transformations).forEach(function (key) {
    var regex = new RegExp('\n(\\s*)' + key.replace(' ', '\\s*') + '[^;]*;', 'gi');
    css = css.replace(regex, function () {
      var parts = Array.prototype.slice.call(arguments, 0)
        , match = parts.shift()
        , indent = parts.shift()
        , str = parts.pop()
        , offset = parts.pop();

        var ret = transformations[key](parts, match.substr(1 + indent.length));
        if (typeof ret === 'string') {
          return '\n' + indent + ret;
        }
        else {
          return '\n' + indent + ret.join('\n' + indent);
        }
    });
  });
  return css;
};
