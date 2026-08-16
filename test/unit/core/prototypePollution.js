'use strict';

var assert = require('assert');
var http = require('http');
var axios = require('../../../index');
var utils = require('../../../lib/utils');
var dispatchRequest = require('../../../lib/core/dispatchRequest');
var mergeConfig = require('../../../lib/core/mergeConfig');
var transformData = require('../../../lib/core/transformData');
var defaults = require('../../../lib/defaults');

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
    delete Object.prototype.transport;
    delete Object.prototype.transformRequest;
    delete Object.prototype.transformResponse;
    delete Object.prototype.formSerializer;
    delete Object.prototype.env;
    delete Object.prototype.parseReviver;
    delete Object.prototype.headers;
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

  describe('mergeConfig', function () {
    it('should not inherit transport from Object.prototype', function () {
      Object.prototype.transport = {request: function () {}};

      var result = mergeConfig({}, {url: '/a'});

      assert.strictEqual(result.hasOwnProperty('transport'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'transport'), false);
    });

    it('should not inherit transformRequest from Object.prototype', function () {
      Object.prototype.transformRequest = function () { return 'hijacked'; };

      var result = mergeConfig({}, {url: '/a'});

      assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'transformRequest'), false);
    });

    it('should not inherit transformResponse from Object.prototype', function () {
      Object.prototype.transformResponse = function () { return 'hijacked'; };

      var result = mergeConfig({}, {url: '/a'});

      assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'transformResponse'), false);
    });

    it('should not inherit arbitrary keys from Object.prototype', function () {
      Object.prototype.polluted = 'yes';

      var result = mergeConfig({}, {url: '/a'});

      assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'polluted'), false);
    });

    it('should not merge an inherited value of the other config into an own property', function () {
      // The own `headers` key of config2 is iterated, and the pre-fix
      // implementation read `config1['headers']` directly as the merge target -
      // picking the attacker-controlled inherited object up off
      // Object.prototype and folding its keys into the produced config.
      Object.prototype.headers = {'X-Evil': 'yes'};

      var result = mergeConfig({}, {headers: {A: '1'}});

      assert.strictEqual(result.headers.A, '1');
      assert.strictEqual(Object.prototype.hasOwnProperty.call(result.headers, 'X-Evil'), false);
      assert.strictEqual(result.headers['X-Evil'], undefined);
    });
  });

  describe('http adapter', function () {
    var server;

    afterEach(function () {
      if (server) {
        server.close();
        server = null;
      }
    });

    it('should not route a request through an inherited config.transport', function (done) {
      var hijacked = false;

      // An attacker-controlled `transport` on Object.prototype used to be read
      // straight off the config, handing the whole request to their transport.
      Object.prototype.transport = {
        request: function () {
          hijacked = true;
          throw new Error('hijacked transport');
        }
      };

      server = http.createServer(function (req, res) {
        res.setHeader('Content-Type', 'text/plain');
        res.end('real transport');
      }).listen(4444, function () {
        axios.get('http://localhost:4444/').then(function (response) {
          assert.strictEqual(hijacked, false);
          assert.strictEqual(response.data, 'real transport');
          done();
        }).catch(done);
      });
    });
  });

  describe('defaults.transformRequest', function () {
    it('should not build form data with an inherited env.FormData', function () {
      var hijacked = false;

      // `this.env.FormData` used to resolve through the prototype chain, so a
      // polluted `env` let an attacker substitute the FormData implementation
      // that receives the request payload.
      function EvilFormData() {
        hijacked = true;
      }
      EvilFormData.prototype.append = function () {};
      Object.prototype.env = {FormData: EvilFormData};

      var headers = {'Content-Type': 'multipart/form-data'};

      try {
        // Called with a bare config as `this`, exactly like dispatchRequest does.
        // Without an own `env` the fixed code has no FormData implementation and
        // falls back to the global one, which does not exist on older Node
        // versions - the security assertion is only that the attacker's
        // implementation was never reached.
        transformData.call({}, {field: 'value'}, headers, defaults.transformRequest);
      } catch (e) {
        // ignored on purpose, see above
        assert.ok(e);
      }

      assert.strictEqual(hijacked, false);
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
