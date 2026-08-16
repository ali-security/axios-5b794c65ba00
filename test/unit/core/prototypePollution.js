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
    delete Object.prototype.data;
    delete Object.prototype.proxy;
    delete Object.prototype.paramsSerializer;
    delete Object.prototype.serialize;
    delete Object.prototype.encode;
    delete Object.prototype.transport;
    delete Object.prototype.transformRequest;
    delete Object.prototype.transformResponse;
    delete Object.prototype.adapter;
    delete Object.prototype.formSerializer;
    delete Object.prototype.env;
    delete Object.prototype.parseReviver;
    delete Object.prototype.headers;
    delete Object.prototype['Content-Type'];
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

    it('should create nested plain objects that do not inherit proxy credentials', function () {
      // Read-side gadget: the merged object used to inherit from Object.prototype, so
      // `result.proxy.auth` resolved to the attacker's value even though nothing ever
      // merged an `auth` key in - and the http adapter then turned it into credentials.
      Object.prototype.auth = 'polluted';
      Object.prototype.username = 'polluted-user';
      Object.prototype.password = 'polluted-pass';

      var result = utils.merge({}, {
        proxy: {
          host: 'localhost',
          nested: {
            enabled: true
          }
        }
      });

      assert.strictEqual(Object.getPrototypeOf(result), null);
      assert.strictEqual(Object.getPrototypeOf(result.proxy), null);
      assert.strictEqual(Object.getPrototypeOf(result.proxy.nested), null);
      assert.strictEqual(result.proxy.host, 'localhost');
      assert.strictEqual(result.proxy.auth, undefined);
      assert.strictEqual(result.proxy.username, undefined);
      assert.strictEqual(result.proxy.password, undefined);
      assert.strictEqual(result.proxy.nested.auth, undefined);
    });

    it('should create null-prototype header buckets that cannot read polluted values', function () {
      Object.prototype.common = {'x-polluted-common': 'yes'};
      Object.prototype.get = {'x-polluted-get': 'yes'};

      var result = utils.merge({}, {
        headers: {
          common: {
            Accept: 'application/json'
          },
          get: {
            'x-own-get': 'yes'
          }
        }
      });

      assert.strictEqual(result.headers.common.Accept, 'application/json');
      assert.strictEqual(result.headers.get['x-own-get'], 'yes');
      assert.strictEqual(result.headers.common['x-polluted-common'], undefined);
      assert.strictEqual(result.headers.get['x-polluted-get'], undefined);
      assert.strictEqual(Object.getPrototypeOf(result.headers), null);
      assert.strictEqual(Object.getPrototypeOf(result.headers.common), null);
      assert.strictEqual(Object.getPrototypeOf(result.headers.get), null);
    });

    it('should not surface an inherited header value from a merged headers object', function () {
      // `Content-Type` is read straight off the merged headers object by
      // defaults.transformRequest to pick the body encoding, so an inherited value
      // is enough to change what axios puts on the wire.
      Object.prototype['Content-Type'] = 'multipart/form-data';

      var headers = utils.merge({}, {Accept: 'application/json'});

      assert.strictEqual(headers['Content-Type'], undefined);
      assert.strictEqual(headers.Accept, 'application/json');
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
      var polluted = {request: function () {}};
      Object.prototype.transport = polluted;

      var result = mergeConfig({}, {url: '/a'});

      assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'transport'), false);
      // Reading via the prototype chain must not surface the polluted value.
      assert.strictEqual(result.transport, undefined);
      assert.notStrictEqual(result.transport, polluted);
    });

    it('should not inherit transformRequest from Object.prototype', function () {
      var polluted = function () { return 'hijacked'; };
      Object.prototype.transformRequest = polluted;

      var result = mergeConfig({}, {url: '/a'});

      assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'transformRequest'), false);
      assert.strictEqual(result.transformRequest, undefined);
      assert.notStrictEqual(result.transformRequest, polluted);
    });

    it('should not inherit transformResponse from Object.prototype', function () {
      var polluted = function () { return 'hijacked'; };
      Object.prototype.transformResponse = polluted;

      var result = mergeConfig({}, {url: '/a'});

      assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'transformResponse'), false);
      assert.strictEqual(result.transformResponse, undefined);
      assert.notStrictEqual(result.transformResponse, polluted);
    });

    it('should not inherit adapter from Object.prototype', function () {
      var polluted = function () { return 'hijacked'; };
      Object.prototype.adapter = polluted;

      var result = mergeConfig({}, {url: '/a'});

      assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'adapter'), false);
      assert.strictEqual(result.adapter, undefined);
      assert.notStrictEqual(result.adapter, polluted);
    });

    it('should not inherit arbitrary keys from Object.prototype', function () {
      Object.prototype.polluted = 'yes';

      var result = mergeConfig({}, {url: '/a'});

      assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'polluted'), false);
      assert.strictEqual(result.polluted, undefined);
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

    it('should create nested plain config objects that do not inherit proxy credentials', function () {
      Object.prototype.auth = 'polluted';
      Object.prototype.username = 'polluted-user';
      Object.prototype.password = 'polluted-pass';

      var result = mergeConfig({}, {
        proxy: {
          host: 'localhost',
          port: 4000
        }
      });

      assert.strictEqual(Object.getPrototypeOf(result.proxy), null);
      assert.strictEqual(result.proxy.auth, undefined);
      assert.strictEqual(result.proxy.username, undefined);
      assert.strictEqual(result.proxy.password, undefined);
    });

    it('should not throw when Object.prototype get and set are polluted', function () {
      // A property descriptor built as an object literal inherits the polluted
      // accessors, so `Object.defineProperty` rejects it as both an accessor and a
      // data descriptor - turning pollution into a synchronous throw on every request.
      Object.prototype.get = function () {};
      Object.prototype.set = function () {};

      assert.doesNotThrow(function () {
        mergeConfig({}, {
          url: '/users',
          headers: {
            common: {
              Accept: 'application/json'
            }
          }
        });
      });
    });

    it('should prepare request headers without descriptor errors when get and set are polluted', function (done) {
      Object.prototype.get = function () {};
      Object.prototype.set = function () {};

      var instance = axios.create({
        adapter: function adapter(config) {
          assert.strictEqual(config.headers.Accept, 'application/json');
          return Promise.resolve({
            data: null,
            status: 200,
            statusText: 'OK',
            headers: {},
            config: config
          });
        },
        headers: {
          common: {
            Accept: 'application/json'
          }
        }
      });

      // Clear as soon as the request settles rather than waiting for `afterEach`:
      // polluted accessors on Object.prototype are hostile to any library that builds
      // a property descriptor as an object literal, mocha's own runner included.
      instance.get('/users').then(function () {
        clearPollution();
        done();
      }).catch(function (error) {
        clearPollution();
        done(error);
      });
    });
  });

  describe('request method aliases', function () {
    function dispatchWithAdapter(run) {
      var seen;

      return run({
        transformRequest: [],
        transformResponse: [],
        adapter: function adapter(config) {
          seen = config;
          return Promise.resolve({
            data: null,
            status: 200,
            statusText: 'OK',
            headers: {},
            config: config
          });
        }
      }).then(function () {
        return seen;
      });
    }

    // `axios.get`/`delete`/`head`/`options` are bodyless, but they used to copy
    // `(config || {}).data` into the merged config - so a polluted
    // Object.prototype turned every one of them into a request carrying an
    // attacker-controlled body.
    ['delete', 'get', 'head', 'options'].forEach(function (method) {
      it('should not copy inherited data into the bodyless ' + method + ' alias', function () {
        Object.prototype.data = 'polluted';

        return dispatchWithAdapter(function (config) {
          return axios[method]('/users', config);
        }).then(function (config) {
          assert.strictEqual(config.data, undefined);
        });
      });
    });

    it('should still send an explicitly configured data value for bodyless aliases', function () {
      Object.prototype.data = 'polluted';

      return dispatchWithAdapter(function (config) {
        config.data = 'own';
        return axios.get('/users', config);
      }).then(function (config) {
        assert.strictEqual(config.data, 'own');
      });
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

    it('should not let an inherited Content-Type change the body put on the wire', function (done) {
      // End-to-end form of the read-side gadget: nothing sets `Content-Type` on this
      // request, so a polluted Object.prototype used to decide how the payload was
      // encoded and what the server actually received.
      Object.prototype['Content-Type'] = 'multipart/form-data';

      var received = null;

      server = http.createServer(function (req, res) {
        var body = '';
        req.on('data', function (chunk) {
          body += chunk;
        });
        req.on('end', function () {
          received = {contentType: req.headers['content-type'], body: body};
          res.setHeader('Content-Type', 'text/plain');
          res.end('ok');
        });
      }).listen(4444, function () {
        axios.post('http://localhost:4444/', {field: 'value'}).then(function () {
          clearPollution();
          assert.strictEqual(received.contentType, 'application/json');
          assert.strictEqual(received.body, '{"field":"value"}');
          done();
        }).catch(function (error) {
          clearPollution();
          done(error);
        });
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

    it('should not read an inherited Content-Type when choosing the body encoding', function () {
      // The merged headers object used to inherit from Object.prototype, so a polluted
      // `Content-Type` was read back here and switched every object payload from JSON
      // to multipart form data - handing the body to a different serializer.
      Object.prototype['Content-Type'] = 'multipart/form-data';

      var headers = utils.merge({}, {});
      var data = transformData.call({}, {field: 'value'}, headers, defaults.transformRequest);

      assert.strictEqual(data, '{"field":"value"}');
      assert.strictEqual(headers['Content-Type'], 'application/json');
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
