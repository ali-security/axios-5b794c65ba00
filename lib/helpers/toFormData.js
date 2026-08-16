'use strict';

var utils = require('../utils');
var AxiosError = require('../core/AxiosError');

/**
 * Convert a data object to FormData
 * @param {Object} obj
 * @param {?Object} [formData]
 * @param {?Object} [options]
 * @returns {Object}
 **/

function toFormData(obj, formData, options) {
  // eslint-disable-next-line no-param-reassign
  formData = formData || new FormData();

  var maxDepth = options && options.maxDepth !== undefined ? options.maxDepth : 100;

  var stack = [];

  function convertValue(value) {
    if (value === null) return '';

    if (utils.isDate(value)) {
      return value.toISOString();
    }

    if (utils.isArrayBuffer(value) || utils.isTypedArray(value)) {
      return typeof Blob === 'function' ? new Blob([value]) : Buffer.from(value);
    }

    return value;
  }

  // `build` only depth-checks values it walks itself, but a `key{}` meta token
  // short-circuits that walk and hands the whole subtree to JSON.stringify -
  // which recurses natively and overflows the stack on deeply nested input.
  // Enforce the same cap up front so the meta token cannot bypass it.
  function assertValueDepth(value, depth) {
    // An explicit `Infinity` cap opts out of the limit, so skip the walk entirely.
    if (maxDepth === Infinity) {
      return;
    }

    if (depth > maxDepth) {
      throw new AxiosError(
        'Maximum object depth of ' + maxDepth + ' exceeded (got ' + depth + ' levels)',
        AxiosError.ERR_FORM_DATA_DEPTH_EXCEEDED
      );
    }

    if (!utils.isObject(value) || stack.indexOf(value) !== -1) {
      return;
    }

    stack.push(value);

    utils.forEach(value, function each(el) {
      assertValueDepth(el, depth + 1);
    });

    stack.pop();
  }

  function build(data, parentKey, depth) {
    // eslint-disable-next-line no-param-reassign
    depth = depth || 0;

    if (utils.isPlainObject(data) || utils.isArray(data)) {
      if (depth > maxDepth) {
        throw new AxiosError(
          'Maximum object depth of ' + maxDepth + ' exceeded (got ' + depth + ' levels)',
          AxiosError.ERR_FORM_DATA_DEPTH_EXCEEDED
        );
      }

      if (stack.indexOf(data) !== -1) {
        throw Error('Circular reference detected in ' + parentKey);
      }

      stack.push(data);

      utils.forEach(data, function each(value, key) {
        if (utils.isUndefined(value)) return;
        var fullKey = parentKey ? parentKey + '.' + key : key;
        var arr;

        if (value && !parentKey && typeof value === 'object') {
          if (utils.endsWith(key, '{}')) {
            assertValueDepth(value, 1);
            // eslint-disable-next-line no-param-reassign
            value = JSON.stringify(value);
          } else if (utils.endsWith(key, '[]') && (arr = utils.toArray(value))) {
            // eslint-disable-next-line func-names
            arr.forEach(function(el) {
              !utils.isUndefined(el) && formData.append(fullKey, convertValue(el));
            });
            return;
          }
        }

        build(value, fullKey, depth + 1);
      });

      stack.pop();
    } else {
      formData.append(parentKey, convertValue(data));
    }
  }

  build(obj);

  return formData;
}

module.exports = toFormData;
