'use strict';

var utils = require('./../utils');

function encode(val) {
  return encodeURIComponent(val).
    replace(/%3A/gi, ':').
    replace(/%24/g, '$').
    replace(/%2C/gi, ',').
    replace(/%20/g, '+').
    replace(/%5B/gi, '[').
    replace(/%5D/gi, ']');
}

/**
 * Build a URL by appending params to the end
 *
 * @param {string} url The base of the url (e.g., http://www.google.com)
 * @param {object} [params] The params to be appended
 * @param {function|object} [options] A serializer function, or an options object
 *   carrying `serialize` and/or `encode` functions
 * @returns {string} The formatted url
 */
module.exports = function buildURL(url, params, options) {
  /*eslint no-param-reassign:0*/
  if (!params) {
    return url;
  }

  var _encode = encode;
  var serializeFn;

  // Resolve the serializer options as own properties only. A `paramsSerializer`
  // object reaching this helper may be a plain clone that inherits from a
  // polluted Object.prototype, and `encode`/`serialize` values injected there
  // must never be allowed to take over query-string serialization.
  if (options) {
    if (utils.isFunction(options)) {
      serializeFn = options;
    } else {
      _encode = (utils.hasOwnProp(options, 'encode') && options.encode) || encode;
      serializeFn = utils.hasOwnProp(options, 'serialize') ? options.serialize : undefined;
    }
  }

  var serializedParams;
  if (serializeFn) {
    serializedParams = serializeFn(params);
  } else if (utils.isURLSearchParams(params)) {
    serializedParams = params.toString();
  } else {
    var parts = [];

    utils.forEach(params, function serialize(val, key) {
      if (val === null || typeof val === 'undefined') {
        return;
      }

      if (utils.isArray(val)) {
        key = key + '[]';
      } else {
        val = [val];
      }

      utils.forEach(val, function parseValue(v) {
        if (utils.isDate(v)) {
          v = v.toISOString();
        } else if (utils.isObject(v)) {
          v = JSON.stringify(v);
        }
        parts.push(_encode(key) + '=' + _encode(v));
      });
    });

    serializedParams = parts.join('&');
  }

  if (serializedParams) {
    var hashmarkIndex = url.indexOf('#');
    if (hashmarkIndex !== -1) {
      url = url.slice(0, hashmarkIndex);
    }

    url += (url.indexOf('?') === -1 ? '?' : '&') + serializedParams;
  }

  return url;
};
