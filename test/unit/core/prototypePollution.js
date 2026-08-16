'use strict';

var assert = require('assert');
var utils = require('../../../lib/utils');
var dispatchRequest = require('../../../lib/core/dispatchRequest');

describe('Prototype Pollution Protection (node)', function () {
  function clearPollution() {
    delete Object.prototype.polluted;
    delete Object.prototype.auth;
    delete Object.prototype.username;
    delete Object.prototype.password;
    delete Object.prototype.common;
    delete Object.prototype.get;
    delete Object.prototype.post;
    delete Object.prototype.set;
    delete Object.prototype.proxy;
  }

  // Defensive: clear before and after each test so pollution leaking from
  // another suite cannot poison the first test here, and a failure mid-test
  // cannot poison the next one.
  beforeEach(clearPollution);
  afterEach(clearPollution);

  describe('utils.merge', function () {
    it('should not merge incoming values into an inherited target', function () {
      Object.prototype.proxy = {auth: 'polluted', username: 'polluted-user'};

      var result = utils.merge({}, {
        proxy: {
          host: 'localhost'
        }
      });

      assert.strictEqual(result.proxy.host, 'localhost');
      assert.strictEqual(Object.prototype.hasOwnProperty.call(result.proxy, 'auth'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(result.proxy, 'username'), false);
    });

    it('should not copy polluted inherited header buckets into nested headers', function () {
      Object.prototype.common = {'x-polluted-common': 'yes'};

      var result = utils.merge({}, {
        headers: {
          common: {
            Accept: 'application/json'
          }
        }
      });

      assert.strictEqual(result.headers.common.Accept, 'application/json');
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(result.headers.common, 'x-polluted-common'),
        false
      );
    });
  });

  describe('dispatchRequest', function () {
    function dispatchWithHeaders(config) {
      var seen;

      config.transformRequest = [];
      config.transformResponse = [];
      config.adapter = function adapter(dispatched) {
        seen = dispatched.headers;
        return Promise.resolve({
          data: null,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: dispatched
        });
      };

      return dispatchRequest(config).then(function () {
        return seen;
      });
    }

    it('should not pick up an inherited common header bucket', function () {
      Object.prototype.common = {'x-polluted-common': 'yes'};

      return dispatchWithHeaders({
        method: 'get',
        url: '/foo',
        headers: {'x-request': 'request'}
      }).then(function (headers) {
        assert.strictEqual(headers['x-request'], 'request');
        assert.strictEqual(headers['x-polluted-common'], undefined);
      });
    });

    it('should not pick up an inherited per-method header bucket', function () {
      Object.prototype.post = {'x-polluted-post': 'yes'};

      return dispatchWithHeaders({
        method: 'post',
        url: '/foo',
        headers: {'x-request': 'request'}
      }).then(function (headers) {
        assert.strictEqual(headers['x-request'], 'request');
        assert.strictEqual(headers['x-polluted-post'], undefined);
      });
    });

    it('should not spread an inherited non-object method bucket into indexed headers', function () {
      Object.prototype.get = function polluted() {};

      return dispatchWithHeaders({
        method: 'get',
        url: '/foo',
        headers: {'x-request': 'request'}
      }).then(function (headers) {
        assert.strictEqual(headers['x-request'], 'request');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(headers, '0'), false);
      });
    });
  });

  describe('AxiosError', function () {
    it('should define descriptors without inherited getter or setter keys', function () {
      var axiosErrorPath = require.resolve('../../../lib/core/AxiosError');
      var cached = require.cache[axiosErrorPath];

      Object.prototype.get = function () {};
      Object.prototype.set = function () {};

      try {
        assert.doesNotThrow(function () {
          delete require.cache[axiosErrorPath];
          require('../../../lib/core/AxiosError');
        });
      } finally {
        // Put the original module instance back so later suites keep comparing
        // against the same AxiosError constructor they loaded at startup.
        require.cache[axiosErrorPath] = cached;
      }
    });
  });
});
