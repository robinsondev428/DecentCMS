// DecentCMS (c) 2014 Bertrand Le Roy, under MIT. See LICENSE.txt for licensing details.
'use strict';
// TODO: alternates
var fs = require('fs');
var path = require('path');

/**
 * @description
 * A rendering strategy that uses templates files, going through view engines.
 * @param shell
 * @constructor
 */
var TemplateRenderingStrategy = {
  service: 'rendering-strategy',
  scope: 'request',
  feature: 'template-rendering-strategy',
  dependencies: ['decent-core-io'],
  init: function(scope) {
    var fileResolver = scope.require('file-resolution');
    var shapeHelper = scope.require('shape');
    var viewEngines = scope.getServices('view-engine');
    var extensionExpression = '(' + viewEngines
      .map(function(viewEngine) {return viewEngine.extension;})
      .join('|') + ')';
    var viewEngineMap = {};
    for (var i = 0; i < viewEngines.length; i++) {
      viewEngineMap[viewEngines[i].extension] = viewEngines[i];
    }
    var shapeTemplates = scope.shapeTemplates = scope.shapeTemplates || {};

    scope.on('decent.core.shape.render', function(payload) {
      var shape = payload.shape;
      var renderer = payload.renderStream;
      var temp = shapeHelper.temp(shape);
      if (temp.html) {
        renderer.write(temp.html);
        return;
      }
      var meta = shapeHelper.meta(shape);
      var shapeName = meta.type;
      if (!shapeName) {
        shapeName = meta.type = 'zone';
      }
      var template = shapeTemplates[shapeName];
      if (!template) {
        var templatePath = fileResolver.resolve(
          'views', new RegExp(shapeName + '\\.' + extensionExpression));
        if (templatePath) {
          var extension = path.extname(templatePath).substr(1);
          var viewEngine = viewEngineMap[extension];
          template = viewEngine.load(templatePath);
        }
      }
      if (template) {
        shapeTemplates[shapeName] = template;
        template(shape, renderer, scope);
      }
    });
  }
};

module.exports = TemplateRenderingStrategy;