var utils = require('../../../lib/utils');
var mergeConfig = require('../../../lib/core/mergeConfig');

describe('Prototype Pollution Protection', function() {
  function clearPollution() {
    // Clean up any pollution that might have occurred
    delete Object.prototype.polluted;
    delete Object.prototype.auth;
    delete Object.prototype.username;
    delete Object.prototype.password;
    delete Object.prototype.common;
    delete Object.prototype.proxy;
    delete Object.prototype['Content-Type'];
  }

  // Defensive: clear before and after each test so pollution leaking from
  // another spec cannot poison the first test here, and a failure mid-test
  // cannot poison the next one.
  beforeEach(clearPollution);
  afterEach(clearPollution);

  describe('utils.merge', function() {
    it('should filter __proto__ key at top level', function() {
      var result = utils.merge({}, {__proto__: {polluted: 'yes'}, safe: 'value'});

      expect(Object.prototype.polluted).toBeUndefined();
      expect(result.safe).toEqual('value');
      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
    });

    it('should filter constructor key at top level', function() {
      var result = utils.merge({}, {constructor: {polluted: 'yes'}, safe: 'value'});

      expect(result.safe).toEqual('value');
      expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false);
    });

    it('should filter prototype key at top level', function() {
      var result = utils.merge({}, {prototype: {polluted: 'yes'}, safe: 'value'});

      expect(result.safe).toEqual('value');
      expect(Object.prototype.hasOwnProperty.call(result, 'prototype')).toBe(false);
    });

    it('should filter __proto__ key in nested objects', function() {
      var result = utils.merge({}, {
        headers: {
          __proto__: {polluted: 'nested'},
          'Content-Type': 'application/json'
        }
      });

      expect(Object.prototype.polluted).toBeUndefined();
      expect(result.headers['Content-Type']).toEqual('application/json');
      expect(Object.prototype.hasOwnProperty.call(result.headers, '__proto__')).toBe(false);
    });

    it('should filter constructor key in nested objects', function() {
      var result = utils.merge({}, {
        headers: {
          constructor: {prototype: {polluted: 'nested'}},
          'Content-Type': 'application/json'
        }
      });

      expect(Object.prototype.polluted).toBeUndefined();
      expect(result.headers['Content-Type']).toEqual('application/json');
      expect(Object.prototype.hasOwnProperty.call(result.headers, 'constructor')).toBe(false);
    });

    it('should filter prototype key in nested objects', function() {
      var result = utils.merge({}, {
        headers: {
          prototype: {polluted: 'nested'},
          'Content-Type': 'application/json'
        }
      });

      expect(result.headers['Content-Type']).toEqual('application/json');
      expect(Object.prototype.hasOwnProperty.call(result.headers, 'prototype')).toBe(false);
    });

    it('should filter dangerous keys in deeply nested objects', function() {
      var result = utils.merge({}, {
        level1: {
          level2: {
            __proto__: {polluted: 'deep'},
            prototype: {polluted: 'deep'},
            safe: 'value'
          }
        }
      });

      expect(Object.prototype.polluted).toBeUndefined();
      expect(result.level1.level2.safe).toEqual('value');
      expect(
        Object.prototype.hasOwnProperty.call(result.level1.level2, '__proto__')
      ).toBe(false);
    });

    it('should still merge regular properties correctly', function() {
      var result = utils.merge({a: 1, b: {c: 2}}, {b: {d: 3}, e: 4});

      expect(result.a).toEqual(1);
      expect(result.b.c).toEqual(2);
      expect(result.b.d).toEqual(3);
      expect(result.e).toEqual(4);
    });

    it('should handle JSON.parse payloads safely', function() {
      var malicious = JSON.parse('{"__proto__": {"polluted": "yes"}}');
      var result = utils.merge({}, malicious);

      expect(Object.prototype.polluted).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
    });

    it('should handle nested JSON.parse payloads safely', function() {
      var malicious = JSON.parse('{"headers": {"constructor": {"prototype": {"polluted": "yes"}}}}');
      var result = utils.merge({}, malicious);

      expect(Object.prototype.polluted).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(result.headers, 'constructor')).toBe(false);
    });

    it('should not merge incoming values into an inherited target', function() {
      Object.prototype.proxy = {auth: 'polluted', username: 'polluted-user'};

      var result = utils.merge({}, {
        proxy: {
          host: 'localhost'
        }
      });

      expect(result.proxy.host).toEqual('localhost');
      expect(Object.prototype.hasOwnProperty.call(result.proxy, 'auth')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(result.proxy, 'username')).toBe(false);
      // Nothing can be read off the prototype chain either: the merged object has none.
      expect(Object.getPrototypeOf(result.proxy)).toBe(null);
      expect(result.proxy.auth).toBeUndefined();
      expect(result.proxy.username).toBeUndefined();
    });

    it('should not copy polluted inherited header buckets into nested headers', function() {
      Object.prototype.common = {'x-polluted-common': 'yes'};

      var result = utils.merge({}, {
        headers: {
          common: {
            Accept: 'application/json'
          }
        }
      });

      expect(result.headers.common.Accept).toEqual('application/json');
      expect(
        Object.prototype.hasOwnProperty.call(result.headers.common, 'x-polluted-common')
      ).toBe(false);
      expect(Object.getPrototypeOf(result.headers)).toBe(null);
      expect(Object.getPrototypeOf(result.headers.common)).toBe(null);
    });

    it('should not surface an inherited header value from a merged headers object', function() {
      // Read-side gadget: `Content-Type` is read straight off the merged headers
      // object to pick the request body encoding, so an inherited value is enough
      // to change what axios puts on the wire.
      Object.prototype['Content-Type'] = 'multipart/form-data';

      var headers = utils.merge({}, {Accept: 'application/json'});

      expect(headers['Content-Type']).toBeUndefined();
      expect(headers.Accept).toEqual('application/json');
    });
  });

  describe('mergeConfig', function() {
    it('should filter dangerous keys at top level', function() {
      var result = mergeConfig({}, {
        __proto__: {polluted: 'yes'},
        constructor: {polluted: 'yes'},
        prototype: {polluted: 'yes'},
        url: '/api/test'
      });

      expect(Object.prototype.polluted).toBeUndefined();
      expect(result.url).toEqual('/api/test');
      // `result` is created with a null prototype, so it has no `hasOwnProperty`
      // method of its own to call.
      var hasOwn = Object.prototype.hasOwnProperty;
      expect(hasOwn.call(result, '__proto__')).toBe(false);
      expect(hasOwn.call(result, 'constructor')).toBe(false);
      expect(hasOwn.call(result, 'prototype')).toBe(false);
    });

    it('should filter dangerous keys in headers', function() {
      var result = mergeConfig({}, {
        headers: {
          __proto__: {polluted: 'yes'},
          'Content-Type': 'application/json'
        }
      });

      expect(Object.prototype.polluted).toBeUndefined();
      expect(result.headers['Content-Type']).toEqual('application/json');
      expect(Object.prototype.hasOwnProperty.call(result.headers, '__proto__')).toBe(false);
    });

    it('should filter dangerous keys in custom config properties', function() {
      var result = mergeConfig({}, {
        customProp: {
          __proto__: {polluted: 'yes'},
          safe: 'value'
        }
      });

      expect(Object.prototype.polluted).toBeUndefined();
      expect(result.customProp.safe).toEqual('value');
      expect(
        Object.prototype.hasOwnProperty.call(result.customProp, '__proto__')
      ).toBe(false);
    });

    it('should still merge configs correctly', function() {
      var config1 = {
        baseURL: 'https://api.example.com',
        timeout: 1000,
        headers: {
          common: {
            Accept: 'application/json'
          }
        }
      };

      var config2 = {
        url: '/users',
        timeout: 5000,
        headers: {
          common: {
            'Content-Type': 'application/json'
          }
        }
      };

      var result = mergeConfig(config1, config2);

      expect(result.baseURL).toEqual('https://api.example.com');
      expect(result.url).toEqual('/users');
      expect(result.timeout).toEqual(5000);
      expect(result.headers.common.Accept).toEqual('application/json');
      expect(result.headers.common['Content-Type']).toEqual('application/json');
    });
  });
});
