'use strict';

var assert = require('assert');
var buildURL = require('../../../lib/helpers/buildURL');

function pollute() {
  Object.defineProperty(Object.prototype, 'encode', {
    value: function () {
      return 'polluted';
    },
    configurable: true
  });
  Object.defineProperty(Object.prototype, 'serialize', {
    value: function () {
      return 'polluted=1';
    },
    configurable: true
  });
}

describe('helpers::buildURL', function () {
  function clearPollution() {
    delete Object.prototype.encode;
    delete Object.prototype.serialize;
  }

  beforeEach(clearPollution);
  afterEach(clearPollution);

  it('should ignore inherited params serializer options', function () {
    // A placeholder `paramsSerializer: {}` reaches this helper as a plain object
    // inheriting from Object.prototype, so an attacker who already polluted the
    // prototype used to control both the encoder and the whole serializer.
    pollute();

    assert.strictEqual(buildURL('/foo', {a: 'b c'}, {}), '/foo?a=b+c');
  });

  it('should ignore an inherited serializer when a serializer function is given', function () {
    pollute();

    var serialized = buildURL('/foo', {a: 'b'}, function serialize(params) {
      return 'own=' + params.a;
    });

    assert.strictEqual(serialized, '/foo?own=b');
  });

  it('should still honour an own serialize option', function () {
    pollute();

    var serialized = buildURL('/foo', {a: 'b'}, {
      serialize: function serialize(params) {
        return 'own=' + params.a;
      }
    });

    assert.strictEqual(serialized, '/foo?own=b');
  });

  it('should still honour an own encode option', function () {
    pollute();

    var serialized = buildURL('/foo', {a: 'b c'}, {
      encode: function encode(value) {
        return String(value).toUpperCase();
      }
    });

    assert.strictEqual(serialized, '/foo?A=B C');
  });

  it('should keep supporting a plain serializer function', function () {
    var calledWith = null;

    var serialized = buildURL('/foo', {foo: 'bar'}, function serialize(params) {
      calledWith = params;
      return 'foo=bar';
    });

    assert.strictEqual(serialized, '/foo?foo=bar');
    assert.deepStrictEqual(calledWith, {foo: 'bar'});
  });
});
