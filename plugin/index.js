
var fs = require('fs');
var path = require('path');

var vm = require('vm');
var util = require('util');

var webpack = require('webpack');
var MemoryFS = require('memory-fs');
var ejs = require('ejs');

function createScript(fileContent, funcName) {
  return vm.createScript(util.format(
    '(function () { %s; return %s; })()',
    fileContent.toString(),
    funcName
  )).runInNewContext({
    require: require,
    process: Object.assign({}, process, {
      env: Object.assign(process.env, {
        NODE_ENV: 'production'
      })
    }),
    console: console,
    global: {}
  });
}

function createRenderer(options) {
  return Promise.resolve().then(function () {
    return new Promise(function (resolve, reject) {
      var mfs = new MemoryFS();
      var config = require(options.config);
      var compiler = webpack(config);
      compiler.outputFileSystem = mfs;
      compiler.run(function(compilerError) {
        /* istanbul ignore if */
        if (compilerError) { reject(compilerError); }
        else {
          var filePath = path.join(config.output.path, config.output.filename);
          mfs.readFile(filePath, function (readFileError, fileContent) {
            /* istanbul ignore if */
            if (readFileError) { reject(readFileError); }
            else { resolve(createScript(fileContent, config.output.library)); }
          });
        }
      });
    });
  });
}

function getFileName(location) {
  var parts = location.split('/').filter(function (part) {
    return !!part.length;
  });
  if (!parts.length || parts[parts.length - 1].indexOf('.') === -1) {
    parts.push('index.html');
  }
  return path.join.apply(path, parts);
}

function getAssetPaths(assets, extension) {
  return Object.keys(assets).filter(function (key) {
    var regex = '\.' + extension + '(?:\\?|$)';
    return key.search(new RegExp(regex)) > -1;
  });
}

function Plugin(options) {
  this.options = Object.assign(
    {
      locations: ['/'],
      template: path.resolve(__dirname, './template.ejs'),
      config: path.resolve(__dirname, '../etc/webpack.node')
    },
    options
  );
}

Plugin.prototype.apply = function(compiler) {
  var options = this.options;
  var renderHTML = ejs.compile(
    fs.readFileSync(this.options.template, 'utf-8')
  );
  compiler.plugin('emit', function(compilation, callback) {
    var jsPaths = getAssetPaths(compilation.assets, 'js');
    var cssPaths = getAssetPaths(compilation.assets, 'css');
    createRenderer(options)
    .then(function (renderReact) {
      return Promise.all(options.locations.map(function (location) {
        return renderReact(location, options)
        .then(function (result) {
          var html = renderHTML(Object.assign({}, options, result, {
            js: jsPaths, css: cssPaths
          }));
          compilation.assets[getFileName(location)] = {
            source: function() { return html; },
            size: function() { return html.length; }
          };
        });
      }));
    })
    .catch(function () {
      /* istanbul ignore if */
      if (options.debug) {
        console.log.apply(console, arguments); // eslint-disable-line no-console
      }
    })
    .then(function () { callback(); });
  });
};

Plugin.createRenderer = createRenderer;
Plugin.getFileName = getFileName;

module.exports = Plugin;
