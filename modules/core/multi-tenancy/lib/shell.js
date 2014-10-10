// DecentCMS (c) 2014 Bertrand Le Roy, under MIT. See LICENSE.txt for licensing details.
'use strict';
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var path = require('path');
var fs = require('fs');
var t = require('../../localization/lib/t');

/**
 * @description
 * A shell is the representation of a tenant in the system.
 * A shell has its own enabled services, that can be required by modules
 * running in its context.
 * 
 * @constructor
 * @param {Object}  options
 * @param {String}  [options.name]             The name of the tenant.
 * @param {String}  [options.host]             The host name under which the tenant answers.
 * @param {Number}  [options.port]             The port to which the tenant answers.
 * @param {String}  [options.cert]             The path to the SSL certificate to use with this tenant.
 * @param {String}  [options.key]              The path to the SSL key to use with this tenant.
 * @param {String}  [options.pfx]              The path to the pfx SSL certificate to use with this tenant.
 * @param {Array}   [options.features]         The list of enabled feature names on this tenant.
 * @param {Object}  [options.services]         The enabled services keyed by service name.
 * @param {Boolean} [options.active]           True if the tenant is active.
 */
function Shell(options) {
  options = options || {};
  this.name = options.name;
  this.host = options.host || 'localhost';
  this.port = options.port || 80;
  this.https = !!options.https;
  this.cert = options.cert;
  this.key = options.key;
  this.pfx = options.pfx;
  this.features = options.features || [];
  this.availableModules = options.availableModules || {};
  this.services = options.services || {};
  this.active = !(options.active === false);
  this.serviceManifests = {};
  this.loaded = false;
}

util.inherits(Shell, EventEmitter);

/**
 * @description
 * An empty shell that you can use to initialize services if you don't need multitenancy.
 */
Shell.empty = new Shell({
  name: "Empty shell"
});

/**
 * @description
 * The list of tenants.
 */
Shell.list = {};

/**
 * @description
 * Creates a shell from its settings file.
 * @param {String} sitePath The path of the settings file.
 * @param {Object} [defaults] Default settings.
 * @returns {Shell} The new shell
 */
Shell.load = function(sitePath, defaults) {
  defaults = defaults || {};
  var settingsPath = path.join(sitePath, 'settings.json');
  var settings = require(settingsPath);
  for (var settingName in defaults) {
    if (!(settingName in settings)) {
      settings[settingName] = defaults[settingName];
    }
  }
  console.log(t('Loaded site settings from %s', settingsPath));
  return new Shell(settings);
}

/**
 * @description
 * Discovers all tenants in the ./sites directory.
 * 
 * @param {Object} defaults  Default settings for the shells.
 * @param {String} rootPath  The root path where to look for shell settings files.
 *                           Defaults to ./sites
 */
Shell.discover = function(defaults, rootPath) {
  rootPath = rootPath || './sites';
  console.log(t('Discovering tenants in %s', rootPath));
  var siteNames = fs.readdirSync(rootPath);
  siteNames.forEach(function(siteName) {
    var resolvedSitePath = path.resolve(rootPath, siteName);
    try {
      var shell = Shell.load(resolvedSitePath, defaults);
      Shell.list[siteName] = shell;
    }
    catch(ex) {
      ex.path = resolvedSitePath;
      ex.message = t('Failed to load site settings from %s.', settingsPath);
      throw ex;
    }
  });
};

/**
 * @description
 * Returns the shell that should handle this request.
 * 
 * @param {IncomingMessage} req The request
 */
Shell.resolve = function(req) {
  for (var shellName in Shell.list) {
    var shell = Shell.list[shellName];

    if (shell.active && shell.canHandle(req)) {
      return shell;
    }
  }
  return null; // Unresolved requests should not go to a default shell
}

/**
 * @description
 * Determines if the shell can handle that request.
 *
 * @param {IncomingMessage} req The request
 * @returns {Boolean} true if the shell can handle the request.
 */
Shell.prototype.canHandle = function(req) {
  var host = req.headers.host;
  return (
    (
      ((this.https && this.port === 443) || this.port === 80)
      && this.host === host
    )
    || (this.host + ':' + this.port === host)
  )
  && (
    !this.path
    || req.url.substr(0, this.path.length) === this.path
  );
}

/**
 * @description
 * Enables or disables the tenant.
 * 
 * @param {Boolean} state If provided, sets the enabled state of the tenant. Otherwise, enables the tenant.
 */
Shell.prototype.enable = function(state) {
  this.active = typeof state === 'undefined' || !!state;
};

/**
 * @description
 * Disables the tenant.
 */
Shell.prototype.disable = function() {
  this.active = false;
};

/**
 * @description
 * Loads all enabled services in each module.
 */
Shell.prototype.load = function() {
  if (this.loaded || !this.availableModules) return;
  for (var modulePath in this.availableModules) {
    this.loadModule(modulePath);
  }
  this.loaded = true;
};

/**
 * @description
 * Loads all the services in the module under the path passed as a parameter.
 * Services are loaded while respecting the dependency order.
 * 
 * @param {String} moduleName  The name of the module to load.
 */
Shell.prototype.loadModule = function(moduleName) {
  var self = this;
  var manifest = this.availableModules[moduleName];
  if (manifest.loaded) return;
  manifest.loaded = true;
  var features = this.features;
  var services = manifest.services;
  for (var serviceName in services) {
    var service = services[serviceName];
    var serviceFeature = service.feature;
    if (serviceFeature && features.indexOf(serviceFeature) === -1) continue;
    var servicePath = path.resolve(manifest.physicalPath, service.path + ".js");
    if (self.serviceManifests[servicePath]) continue;
    var dependencies = service.dependencies;
    if (dependencies) {
      dependencies.forEach(function(dependencyPath) {
        self.loadModule(dependencyPath);
      });
    }
    var ServiceClass = require(servicePath);
    if (!self.services[serviceName]) {
      self.services[serviceName] = [ServiceClass];
    }
    else {
      self.services[serviceName].push(ServiceClass);
    }
    self.serviceManifests[servicePath] = service;
    if (ServiceClass.init) {
      ServiceClass.init(self);
    }
    console.log(t('Loaded service %s from %s', serviceName, servicePath));
  }
};

/**
 * @description
 * Returns an instance of a service implementing the named contract passed as a parameter.
 * If more than one service exists in the tenant for that contract, one instance that
 * has no dependency on any other service for that contract is returned. Do not
 * count on any particular service being returned if that is the case.
 * A new instance is returned every time the function is called.
 * 
 * @param {String} service  The name of the contract for which a service instance is required.
 */
Shell.prototype.require = function(service) {
  var services = this.services[service];
  if (Array.isArray(services)) {
    return services.length > 0 ? new (services[services.length - 1])(this) : null;
  }
  return null;
};

/**
 * @description
 * Returns a list of service instances that are implementing the named contract passed as a parameter.
 * The services are returned in order of dependency: if service A has a dependency
 * on service B, B is guaranteed to appear earlier in the list.
 * New instances are returned every time the function is called.
 * 
 * @param {String} service  The name of the contract for which service instances are required.
 */
Shell.prototype.getServices = function(service) {
  return this.services[service]
    .map(function(serviceClass) {
    return new serviceClass(this);
  });
};

/**
 * @description
 * Handles the request for the tenant
 * 
 * @param {http.IncomingMessage} req Request
 * @param {http.ServerResponse}  res Response
 */
Shell.prototype.handleRequest = function(req, res) {
  var payload = {
    req: req,
    res: res,
    handled: false
  };
  this.emit(Shell.handleRouteEvent, payload);

  if (payload.handled) return;

  res.writeHead(404, {'Content-Type': 'text/plain'});
  res.end(t('There\'s no such page on %s.\nURL: %s\nHeaders: %j', this.name, req.url, req.headers));
};

/**
 * @description
 * The event that is broadcast when a route needs to be resolved.
 * @type {string}
 */
Shell.handleRouteEvent = Shell.prototype.handleRouteEvent = 'decentcms.core.shell.handle-route';

  module.exports = Shell;