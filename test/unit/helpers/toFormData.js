'use strict';

var assert = require('assert');
var FormData = require('form-data');
var toFormData = require('../../../lib/helpers/toFormData');
var AxiosError = require('../../../lib/core/AxiosError');

function buildDeep(depth) {
  var head = {};
  var cur = head;

  for (var i = 0; i < depth; i++) {
    cur.x = {};
    cur = cur.x;
  }

  return head;
}

describe('helpers::toFormData', function () {
  describe('depth limit (GHSA-62hf-57xw-28j9)', function () {
    it('should throw a bounded error for deeply nested payloads instead of overflowing the stack', function () {
      var payload = { leaf: 1 };
      for (var i = 0; i < 2500; i++) {
        payload = { a: payload };
      }

      assert.throws(function () {
        toFormData(payload, new FormData());
      }, function (err) {
        return err && /Maximum object depth/.test(err.message);
      });
    });

    it('should depth-check objects stringified by the meta token', function () {
      // A `key{}` meta token hands the value straight to JSON.stringify, which
      // recurses natively - so without an up-front depth check this payload
      // overflows the stack instead of raising the bounded axios error.
      assert.throws(function () {
        toFormData({'evil{}': buildDeep(10000)}, new FormData());
      }, function (err) {
        return err && err.code === AxiosError.ERR_FORM_DATA_DEPTH_EXCEEDED;
      });
    });

    it('should still stringify meta token values within the depth cap', function () {
      var form = new FormData();
      var appended = [];

      form.append = function (key, value) {
        appended.push([key, value]);
      };

      toFormData({'obj{}': {a: {b: 'c'}}}, form);

      assert.deepStrictEqual(appended, [['obj{}', '{"a":{"b":"c"}}']]);
    });

    it('should accept payloads well under the depth cap', function () {
      var payload = { leaf: 1 };
      for (var i = 0; i < 50; i++) {
        payload = { a: payload };
      }

      assert.doesNotThrow(function () {
        toFormData(payload, new FormData());
      });
    });
  });
});
