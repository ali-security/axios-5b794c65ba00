var axios = require('../../../index');
var http = require('http');
var https = require('https');
var net = require('net');
// Pre-load `dns` so it isn't lazy-required from inside an http request
// after a test pollutes `Object.prototype.get` — on older Node versions
// the lazy `Object.defineProperty` call in dns.js inherits the polluted
// getter and throws "Getter must be a function".
require('dns');
var url = require('url');
var zlib = require('zlib');
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var pkg = require('./../../../package.json');
var server, proxy;
var AxiosError = require('../../../lib/core/AxiosError');
var FormData = require('form-data');
var formidable = require('formidable');

describe('supports http with nodejs', function () {

  function clearPrototypePollution() {
    delete Object.prototype.auth;
    delete Object.prototype.username;
    delete Object.prototype.password;
    delete Object.prototype.common;
    delete Object.prototype.get;
    delete Object.prototype.post;
  }

  // Defensive: clear before each test in case another suite left pollution.
  beforeEach(clearPrototypePollution);

  afterEach(function () {
    if (server) {
      server.close();
      server = null;
    }
    if (proxy) {
      proxy.close();
      proxy = null;
    }
    delete process.env.http_proxy;
    delete process.env.HTTP_PROXY;
    delete process.env.https_proxy;
    delete process.env.no_proxy;
    delete process.env.NO_PROXY;
    clearPrototypePollution();
  });

  it('should sanitize request headers containing invalid characters', function (done) {
    server = http.createServer(function (req, res) {
      res.setHeader('Content-Type', 'text/plain');
      res.end(req.headers['x-test']);
    }).listen(4444, function () {
      axios.get('http://localhost:4444/', {
        headers: {
          'x-test': ' ok\r\nInjected: yes\t'
        }
      }).then(function (response) {
        assert.equal(response.data, 'okInjected: yes');
        done();
      }).catch(done);
    });
  });

  it('should preserve request error for unavailable host with invalid characters', function (done) {
    axios.get('http://localhost:1/', {
      headers: {
        'x-test': 'ok\r\nInjected: yes'
      }
    }).then(function () {
      done(new Error('request should not succeed'));
    }).catch(function (error) {
      assert.notEqual(error.message, 'Invalid character in header content ["x-test"]');
      done();
    });
  });

  it('should throw an error if the timeout property is not parsable as a number', function (done) {

    server = http.createServer(function (req, res) {
      setTimeout(function () {
        res.end();
      }, 1000);
    }).listen(4444, function () {
      var success = false, failure = false;
      var error;

      axios.get('http://localhost:4444/', {
        timeout: { strangeTimeout: 250 }
      }).then(function (res) {
        success = true;
      }).catch(function (err) {
        error = err;
        failure = true;
      });

      setTimeout(function () {
        assert.equal(success, false, 'request should not succeed');
        assert.equal(failure, true, 'request should fail');
        assert.equal(error.code, AxiosError.ERR_BAD_OPTION_VALUE);
        assert.equal(error.message, 'error trying to parse `config.timeout` to int');
        done();
      }, 300);
    });
  });

  it('should parse the timeout property', function (done) {

    server = http.createServer(function (req, res) {
      setTimeout(function () {
        res.end();
      }, 1000);
    }).listen(4444, function () {
      var success = false, failure = false;
      var error;

      axios.get('http://localhost:4444/', {
        timeout: '250'
      }).then(function (res) {
        success = true;
      }).catch(function (err) {
        error = err;
        failure = true;
      });

      setTimeout(function () {
        assert.equal(success, false, 'request should not succeed');
        assert.equal(failure, true, 'request should fail');
        assert.equal(error.code, 'ECONNABORTED');
        assert.equal(error.message, 'timeout of 250ms exceeded');
        done();
      }, 300);
    });
  });

  it('should respect the timeout property', function (done) {

    server = http.createServer(function (req, res) {
      setTimeout(function () {
        res.end();
      }, 1000);
    }).listen(4444, function () {
      var success = false, failure = false;
      var error;

      axios.get('http://localhost:4444/', {
        timeout: 250
      }).then(function (res) {
        success = true;
      }).catch(function (err) {
        error = err;
        failure = true;
      });

      setTimeout(function () {
        assert.equal(success, false, 'request should not succeed');
        assert.equal(failure, true, 'request should fail');
        assert.equal(error.code, 'ECONNABORTED');
        assert.equal(error.message, 'timeout of 250ms exceeded');
        done();
      }, 300);
    });
  });

  it('should respect the timeoutErrorMessage property', function (done) {

    server = http.createServer(function (req, res) {
      setTimeout(function () {
        res.end();
      }, 1000);
    }).listen(4444, function () {
      var success = false, failure = false;
      var error;

      axios.get('http://localhost:4444/', {
        timeout: 250,
        timeoutErrorMessage: 'oops, timeout',
      }).then(function (res) {
        success = true;
      }).catch(function (err) {
        error = err;
        failure = true;
      });

      setTimeout(function () {
        assert.strictEqual(success, false, 'request should not succeed');
        assert.strictEqual(failure, true, 'request should fail');
        assert.strictEqual(error.code, 'ECONNABORTED');
        assert.strictEqual(error.message, 'timeout of 250ms exceeded');
        done();
      }, 300);
    });
  });

  it('should allow passing JSON', function (done) {
    var data = {
      firstName: 'Fred',
      lastName: 'Flintstone',
      emailAddr: 'fred@example.com'
    };

    server = http.createServer(function (req, res) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    }).listen(4444, function () {
      axios.get('http://localhost:4444/').then(function (res) {
        assert.deepEqual(res.data, data);
        done();
      });
    });
  });

  it('should allow passing JSON with BOM', function (done) {
    var data = {
      firstName: 'Fred',
      lastName: 'Flintstone',
      emailAddr: 'fred@example.com'
    };

    server = http.createServer(function (req, res) {
      res.setHeader('Content-Type', 'application/json');
      var bomBuffer = Buffer.from([0xEF, 0xBB, 0xBF])
      var jsonBuffer = Buffer.from(JSON.stringify(data));
      res.end(Buffer.concat([bomBuffer, jsonBuffer]));
    }).listen(4444, function () {
      axios.get('http://localhost:4444/').then(function (res) {
        assert.deepEqual(res.data, data);
        done();
      });
    });
  });

  it('should redirect', function (done) {
    var str = 'test response';

    server = http.createServer(function (req, res) {
      var parsed = url.parse(req.url);

      if (parsed.pathname === '/one') {
        res.setHeader('Location', '/two');
        res.statusCode = 302;
        res.end();
      } else {
        res.end(str);
      }
    }).listen(4444, function () {
      axios.get('http://localhost:4444/one').then(function (res) {
        assert.equal(res.data, str);
        assert.equal(res.request.path, '/two');
        done();
      });
    });
  });

  it('should not redirect', function (done) {
    server = http.createServer(function (req, res) {
      res.setHeader('Location', '/foo');
      res.statusCode = 302;
      res.end();
    }).listen(4444, function () {
      axios.get('http://localhost:4444/', {
        maxRedirects: 0,
        validateStatus: function () {
          return true;
        }
      }).then(function (res) {
        assert.equal(res.status, 302);
        assert.equal(res.headers['location'], '/foo');
        done();
      });
    });
  });

  it('should support max redirects', function (done) {
    var i = 1;
    server = http.createServer(function (req, res) {
      res.setHeader('Location', '/' + i);
      res.statusCode = 302;
      res.end();
      i++;
    }).listen(4444, function () {
      axios.get('http://localhost:4444/', {
        maxRedirects: 3
      }).catch(function (error) {
        assert.equal(error.code, AxiosError.ERR_FR_TOO_MANY_REDIRECTS);
        assert.equal(error.message, 'Maximum number of redirects exceeded');
        done();
      });
    });
  });

  it('should support beforeRedirect', function (done) {
    server = http.createServer(function (req, res) {
      res.setHeader('Location', '/foo');
      res.statusCode = 302;
      res.end();
    }).listen(4444, function () {
      axios.get('http://localhost:4444/', {
        maxRedirects: 3,
        beforeRedirect: function (options) {
          if (options.path === '/foo') {
            throw new Error(
              'Provided path is not allowed'
            );
          }
        }
      }).catch(function (error) {
        assert.equal(error.message, 'Provided path is not allowed');
        done();
      });
    });
  });

  it('should remove proxy authorization case-insensitively when no proxy applies', function (done) {
    server = http.createServer(function (req, res) {
      assert.equal(req.headers['proxy-authorization'], undefined);
      res.end('ok');
    }).listen(4444, function () {
      process.env.HTTP_PROXY = 'http://localhost:4000/';
      process.env.NO_PROXY = 'localhost';

      axios.get('http://localhost:4444/', {
        headers: {
          'pRoXy-AuThOrIzAtIoN': 'Basic stale'
        }
      }).then(function (res) {
        assert.equal(res.data, 'ok');
        done();
      }).catch(done);
    });
  });

  it('should keep proxy authorization when redirected request still uses authenticated proxy', function (done) {
    var requestCount = 0;
    var proxyAuth = 'Basic ' + Buffer.from('user:pass', 'utf8').toString('base64');

    server = http.createServer(function (req, res) {
      requestCount += 1;
      if (requestCount === 1) {
        res.setHeader('Location', 'http://localhost:4444/final');
        res.statusCode = 302;
      }
      res.end('ok');
    }).listen(4444, function () {
      var proxyUseCount = 0;

      proxy = http.createServer(function (request, response) {
        proxyUseCount += 1;
        assert.equal(request.headers['proxy-authorization'], proxyAuth);

        var parsed = url.parse(request.url);
        var opts = {
          host: parsed.hostname,
          port: parsed.port,
          path: parsed.path
        };

        http.get(opts, function (res) {
          response.writeHead(res.statusCode, res.headers);
          res.on('data', function (data) {
            response.write(data);
          });
          res.on('end', function () {
            response.end();
          });
        });
      }).listen(4000, function () {
        axios.get('http://localhost:4444/', {
          proxy: {
            host: 'localhost',
            port: 4000,
            auth: 'user:pass'
          },
          maxRedirects: 1
        }).then(function (res) {
          assert.equal(res.data, 'ok');
          assert.equal(proxyUseCount, 2);
          done();
        }).catch(done);
      });
    });
  });

  it('should preserve the HTTP verb on redirect', function (done) {
    server = http.createServer(function (req, res) {
      if (req.method.toLowerCase() !== "head") {
        res.statusCode = 400;
        res.end();
        return;
      }

      var parsed = url.parse(req.url);
      if (parsed.pathname === '/one') {
        res.setHeader('Location', '/two');
        res.statusCode = 302;
        res.end();
      } else {
        res.end();
      }
    }).listen(4444, function () {
      axios.head('http://localhost:4444/one').then(function (res) {
        assert.equal(res.status, 200);
        done();
      }).catch(function (err) {
        done(err);
      });
    });
  });

  it('should support transparent gunzip', function (done) {
    var data = {
      firstName: 'Fred',
      lastName: 'Flintstone',
      emailAddr: 'fred@example.com'
    };

    zlib.gzip(JSON.stringify(data), function (err, zipped) {

      server = http.createServer(function (req, res) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Encoding', 'gzip');
        res.end(zipped);
      }).listen(4444, function () {
        axios.get('http://localhost:4444/').then(function (res) {
          assert.deepEqual(res.data, data);
          done();
        });
      });

    });
  });

  it('should support gunzip error handling', function (done) {
    server = http.createServer(function (req, res) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Encoding', 'gzip');
      res.end('invalid response');
    }).listen(4444, function () {
      axios.get('http://localhost:4444/').catch(function (error) {
        done();
      });
    });
  });

  it('should support disabling automatic decompression of response data', function(done) {
    var data = 'Test data';

    zlib.gzip(data, function(err, zipped) {
      server = http.createServer(function(req, res) {
        res.setHeader('Content-Type', 'text/html;charset=utf-8');
        res.setHeader('Content-Encoding', 'gzip');
        res.end(zipped);
      }).listen(4444, function() {
        axios.get('http://localhost:4444/', {
          decompress: false,
          responseType: 'arraybuffer'

        }).then(function(res) {
          assert.equal(res.data.toString('base64'), zipped.toString('base64'));
          done();
        });
      });
    });
  });

  it('should support UTF8', function (done) {
    var str = Array(100000).join('ж');

    server = http.createServer(function (req, res) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.end(str);
    }).listen(4444, function () {
      axios.get('http://localhost:4444/').then(function (res) {
        assert.equal(res.data, str);
        done();
      });
    });
  });

  it('should support basic auth', function (done) {
    server = http.createServer(function (req, res) {
      res.end(req.headers.authorization);
    }).listen(4444, function () {
      var user = 'foo';
      var headers = { Authorization: 'Bearer 1234' };
      axios.get('http://' + user + '@localhost:4444/', { headers: headers }).then(function (res) {
        var base64 = Buffer.from(user + ':', 'utf8').toString('base64');
        assert.equal(res.data, 'Basic ' + base64);
        done();
      });
    });
  });

  it('should support basic auth with a header', function (done) {
    server = http.createServer(function (req, res) {
      res.end(req.headers.authorization);
    }).listen(4444, function () {
      var auth = { username: 'foo', password: 'bar' };
      var headers = { AuThOrIzAtIoN: 'Bearer 1234' }; // wonky casing to ensure caseless comparison
      axios.get('http://localhost:4444/', { auth: auth, headers: headers }).then(function (res) {
        var base64 = Buffer.from('foo:bar', 'utf8').toString('base64');
        assert.equal(res.data, 'Basic ' + base64);
        done();
      });
    });
  });

  it('should provides a default User-Agent header', function (done) {
    server = http.createServer(function (req, res) {
      res.end(req.headers['user-agent']);
    }).listen(4444, function () {
      axios.get('http://localhost:4444/').then(function (res) {
        assert.ok(/^axios\/[\d.]+(-sp\d+)?$/.test(res.data), `User-Agent header does not match: ${res.data}`);
        done();
      });
    });
  });

  it('should allow the User-Agent header to be overridden', function (done) {
    server = http.createServer(function (req, res) {
      res.end(req.headers['user-agent']);
    }).listen(4444, function () {
      var headers = { 'UsEr-AgEnT': 'foo bar' }; // wonky casing to ensure caseless comparison
      axios.get('http://localhost:4444/', { headers }).then(function (res) {
        assert.equal(res.data, 'foo bar');
        done();
      });
    });
  });

  it('should allow the Content-Length header to be overridden', function (done) {
    server = http.createServer(function (req, res) {
      assert.strictEqual(req.headers['content-length'], '42');
      res.end();
    }).listen(4444, function () {
      var headers = { 'CoNtEnT-lEnGtH': '42' }; // wonky casing to ensure caseless comparison
      axios.post('http://localhost:4444/', 'foo', { headers }).then(function () {
        done();
      });
    });
  });

  it('should support max content length', function (done) {
    var str = Array(100000).join('ж');

    server = http.createServer(function (req, res) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.end(str);
    }).listen(4444, function () {
      var success = false, failure = false, error;

      axios.get('http://localhost:4444/', {
        maxContentLength: 2000
      }).then(function (res) {
        success = true;
      }).catch(function (err) {
        error = err;
        failure = true;
      });

      setTimeout(function () {
        assert.equal(success, false, 'request should not succeed');
        assert.equal(failure, true, 'request should fail');
        assert.equal(error.message, 'maxContentLength size of 2000 exceeded');
        done();
      }, 100);
    });
  });

  it('should support max content length for redirected', function (done) {
    var str = Array(100000).join('ж');

    server = http.createServer(function (req, res) {
      var parsed = url.parse(req.url);

      if (parsed.pathname === '/two') {
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        res.end(str);
      } else {
        res.setHeader('Location', '/two');
        res.statusCode = 302;
        res.end();
      }
    }).listen(4444, function () {
      var success = false, failure = false, error;

      axios.get('http://localhost:4444/one', {
        maxContentLength: 2000
      }).then(function (res) {
        success = true;
      }).catch(function (err) {
        error = err;
        failure = true;
      });

      setTimeout(function () {
        assert.equal(success, false, 'request should not succeed');
        assert.equal(failure, true, 'request should fail');
        assert.equal(error.message, 'maxContentLength size of 2000 exceeded');
        done();
      }, 100);
    });
  });

  it('should support max body length', function (done) {
    var data = Array(100000).join('ж');

    server = http.createServer(function (req, res) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.end();
    }).listen(4444, function () {
      var success = false, failure = false, error;

      axios.post('http://localhost:4444/', {
        data: data
      }, {
        maxBodyLength: 2000
      }).then(function (res) {
        success = true;
      }).catch(function (err) {
        error = err;
        failure = true;
      });


      setTimeout(function () {
        assert.equal(success, false, 'request should not succeed');
        assert.equal(failure, true, 'request should fail');
        assert.equal(error.message, 'Request body larger than maxBodyLength limit');
        done();
      }, 100);
    });
  });

  it('should display error while parsing params', function (done) {
    server = http.createServer(function () {

    }).listen(4444, function () {
      axios.get('http://localhost:4444/', {
        params: {
          errorParam: new Date(undefined),
        },
      }).catch(function (err) {
        assert.deepEqual(err.exists, true)
        done();
      });
    });
  });

  it('should support sockets', function (done) {
    // Different sockets for win32 vs darwin/linux
    var socketName = './test.sock';

    if (process.platform === 'win32') {
      socketName = '\\\\.\\pipe\\libuv-test';
    }

    server = net.createServer(function (socket) {
      socket.on('data', function () {
        socket.end('HTTP/1.1 200 OK\r\n\r\n');
      });
    }).listen(socketName, function () {
      axios({
        socketPath: socketName,
        allowedSocketPaths: socketName,
        url: '/'
      })
        .then(function (resp) {
          assert.equal(resp.status, 200);
          assert.equal(resp.statusText, 'OK');
          done();
        })
        .catch(done);
    });
  });

  it('should support sockets without an allowlist', function (done) {
    // Different sockets for win32 vs darwin/linux
    var socketName = './test.sock';

    if (process.platform === 'win32') {
      socketName = '\\\\.\\pipe\\libuv-test';
    }

    server = net.createServer(function (socket) {
      socket.on('data', function () {
        socket.end('HTTP/1.1 200 OK\r\n\r\n');
      });
    }).listen(socketName, function () {
      axios({
        socketPath: socketName,
        url: '/'
      })
        .then(function (resp) {
          assert.equal(resp.status, 200);
          assert.equal(resp.statusText, 'OK');
          done();
        })
        .catch(function (error) {
          assert.ifError(error);
          done();
        });
    });
  });

  it('should reject disallowed socket paths before opening the socket', function (done) {
    var socketName = './test.sock';
    var openedSocket = false;

    if (process.platform === 'win32') {
      socketName = '\\\\.\\pipe\\libuv-test';
    }

    server = net.createServer(function (socket) {
      openedSocket = true;
      socket.end('HTTP/1.1 200 OK\r\n\r\n');
    }).listen(socketName, function () {
      axios({
        socketPath: socketName,
        allowedSocketPaths: './other.sock',
        url: '/'
      })
        .then(function () {
          done(new Error('request should not succeed'));
        })
        .catch(function (err) {
          assert.equal(err.code, AxiosError.ERR_BAD_OPTION_VALUE);
          assert.equal(openedSocket, false);
          done();
        });
    });
  });

  it('should reject socket paths when allowlist is empty', function (done) {
    var socketName = './test.sock';
    var openedSocket = false;

    if (process.platform === 'win32') {
      socketName = '\\\\.\\pipe\\libuv-test';
    }

    server = net.createServer(function (socket) {
      openedSocket = true;
      socket.end('HTTP/1.1 200 OK\r\n\r\n');
    }).listen(socketName, function () {
      axios({
        socketPath: socketName,
        allowedSocketPaths: [],
        url: '/'
      })
        .then(function () {
          done(new Error('request should not succeed'));
        })
        .catch(function (err) {
          assert.equal(err.code, AxiosError.ERR_BAD_OPTION_VALUE);
          assert.equal(openedSocket, false);
          done();
        });
    });
  });

  it('should inherit and clear socket path allowlists', function (done) {
    var socketName = './test.sock';
    var instance;

    if (process.platform === 'win32') {
      socketName = '\\\\.\\pipe\\libuv-test';
    }

    server = net.createServer(function (socket) {
      socket.on('data', function () {
        socket.end('HTTP/1.1 200 OK\r\n\r\n');
      });
    }).listen(socketName, function () {
      instance = axios.create({
        allowedSocketPaths: socketName
      });

      instance({
        socketPath: socketName,
        url: '/'
      })
        .then(function (resp) {
          assert.equal(resp.status, 200);

          return axios.create({
            allowedSocketPaths: []
          })({
            socketPath: socketName,
            allowedSocketPaths: null,
            url: '/'
          });
        })
        .then(function (resp) {
          assert.equal(resp.status, 200);
          done();
        })
        .catch(done);
    });
  });

  it('should reject invalid socket path options', function (done) {
    axios({
      socketPath: {},
      url: '/'
    })
      .then(function () {
        done(new Error('request should not succeed'));
      })
      .catch(function (err) {
        assert.equal(err.code, AxiosError.ERR_BAD_OPTION_VALUE);

        return axios({
          socketPath: './test.sock',
          allowedSocketPaths: {},
          url: '/'
        });
      })
      .then(function () {
        done(new Error('request should not succeed'));
      })
      .catch(function (err) {
        assert.equal(err.code, AxiosError.ERR_BAD_OPTION_VALUE);

        return axios({
          socketPath: './test.sock',
          allowedSocketPaths: ['./test.sock', {}],
          url: '/'
        });
      })
      .then(function () {
        done(new Error('request should not succeed'));
      })
      .catch(function (err) {
        assert.equal(err.code, AxiosError.ERR_BAD_OPTION_VALUE);
        done();
      });
  });

  it('should support streams', function (done) {
    server = http.createServer(function (req, res) {
      req.pipe(res);
    }).listen(4444, function () {
      axios.post('http://localhost:4444/',
        fs.createReadStream(__filename), {
          responseType: 'stream'
        }).then(function (res) {
          var stream = res.data;
          var string = '';
          stream.on('data', function (chunk) {
            string += chunk.toString('utf8');
          });
          stream.on('end', function () {
            assert.equal(string, fs.readFileSync(__filename, 'utf8'));
            done();
          });
        });
    });
  });

  it('should pass errors for a failed stream', function (done) {
    var notExitPath = path.join(__dirname, 'does_not_exist');

    server = http.createServer(function (req, res) {
      req.pipe(res);
    }).listen(4444, function () {
      axios.post('http://localhost:4444/',
        fs.createReadStream(notExitPath)
      ).then(function (res) {
        assert.fail();
      }).catch(function (err) {
        assert.equal(err.message, `ENOENT: no such file or directory, open \'${notExitPath}\'`);
        done();
      });
    });
  });

  it('should support buffers', function (done) {
    var buf = Buffer.alloc(1024, 'x'); // Unsafe buffer < Buffer.poolSize (8192 bytes)
    server = http.createServer(function (req, res) {
      assert.equal(req.headers['content-length'], buf.length.toString());
      req.pipe(res);
    }).listen(4444, function () {
      axios.post('http://localhost:4444/',
        buf, {
          responseType: 'stream'
        }).then(function (res) {
          var stream = res.data;
          var string = '';
          stream.on('data', function (chunk) {
            string += chunk.toString('utf8');
          });
          stream.on('end', function () {
            assert.equal(string, buf.toString());
            done();
          });
        });
    });
  });

  it('should support HTTP proxies', function (done) {
    server = http.createServer(function (req, res) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.end('12345');
    }).listen(4444, function () {
      proxy = http.createServer(function (request, response) {
        var parsed = url.parse(request.url);
        var opts = {
          host: parsed.hostname,
          port: parsed.port,
          path: parsed.path
        };

        http.get(opts, function (res) {
          var body = '';
          res.on('data', function (data) {
            body += data;
          });
          res.on('end', function () {
            response.setHeader('Content-Type', 'text/html; charset=UTF-8');
            response.end(body + '6789');
          });
        });

      }).listen(4000, function () {
        axios.get('http://localhost:4444/', {
          proxy: {
            host: 'localhost',
            port: 4000
          }
        }).then(function (res) {
          assert.equal(res.data, '123456789', 'should pass through proxy');
          done();
        });
      });
    });
  });

  it('should support HTTPS proxies', function (done) {
    var options = {
      key: fs.readFileSync(path.join(__dirname, 'key.pem')),
      cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
    };

    server = https.createServer(options, function (req, res) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.end('12345');
    }).listen(4444, function () {
      proxy = https.createServer(options, function (request, response) {
        var parsed = url.parse(request.url);
        var opts = {
          host: parsed.hostname,
          port: parsed.port,
          path: parsed.path,
          protocol: parsed.protocol,
          rejectUnauthorized: false
        };

        https.get(opts, function (res) {
          var body = '';
          res.on('data', function (data) {
            body += data;
          });
          res.on('end', function () {
            response.setHeader('Content-Type', 'text/html; charset=UTF-8');
            response.end(body + '6789');
          });
        });
      }).listen(4000, function () {
        axios.get('https://localhost:4444/', {
          proxy: {
            host: 'localhost',
            port: 4000,
            protocol: 'https'
          },
          httpsAgent: new https.Agent({
            rejectUnauthorized: false
          })
        }).then(function (res) {
          assert.equal(res.data, '123456789', 'should pass through proxy');
          done();
        }).catch(function (err) {
          assert.fail(err);
          done()
        });
      });
    });
  });

  it('should not pass through disabled proxy', function (done) {
    // set the env variable
    process.env.http_proxy = 'http://does-not-exists.example.com:4242/';

    server = http.createServer(function (req, res) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.end('123456789');
    }).listen(4444, function () {
      axios.get('http://localhost:4444/', {
        proxy: false
      }).then(function (res) {
        assert.equal(res.data, '123456789', 'should not pass through proxy');
        done();
      });
    });
  });

  it('should support proxy set via env var', function (done) {
    server = http.createServer(function (req, res) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.end('4567');
    }).listen(4444, function () {
      proxy = http.createServer(function (request, response) {
        var parsed = url.parse(request.url);
        var opts = {
          host: parsed.hostname,
          port: parsed.port,
          path: parsed.path
        };

        http.get(opts, function (res) {
          var body = '';
          res.on('data', function (data) {
            body += data;
          });
          res.on('end', function () {
            response.setHeader('Content-Type', 'text/html; charset=UTF-8');
            response.end(body + '1234');
          });
        });

      }).listen(4000, function () {
        // set the env variable
        process.env.http_proxy = 'http://localhost:4000/';

        axios.get('http://localhost:4444/').then(function (res) {
          assert.equal(res.data, '45671234', 'should use proxy set by process.env.http_proxy');
          done();
        });
      });
    });
  });

  it('should support HTTPS proxy set via env var', function (done) {
    var options = {
      key: fs.readFileSync(path.join(__dirname, 'key.pem')),
      cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
    };

    server = https.createServer(options, function (req, res) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.end('12345');
    }).listen(4444, function () {
      proxy = https.createServer(options, function (request, response) {
        var parsed = url.parse(request.url);
        var opts = {
          host: parsed.hostname,
          port: parsed.port,
          path: parsed.path,
          protocol: parsed.protocol,
          rejectUnauthorized: false
        };

        https.get(opts, function (res) {
          var body = '';
          res.on('data', function (data) {
            body += data;
          });
          res.on('end', function () {
            response.setHeader('Content-Type', 'text/html; charset=UTF-8');
            response.end(body + '6789');
          });
        });
      }).listen(4000, function () {
        process.env.https_proxy = 'https://localhost:4000/';

        axios.get('https://localhost:4444/', {
          httpsAgent: new https.Agent({
            rejectUnauthorized: false
          })
        }).then(function (res) {
          assert.equal(res.data, '123456789', 'should pass through proxy');
          done();
        }).catch(function (err) {
          assert.fail(err);
          done()
        }).finally(function () {
          process.env.https_proxy = ''
        });
      });
    });
  });

  it('should not use proxy for domains in no_proxy', function (done) {
    server = http.createServer(function (req, res) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.end('4567');
    }).listen(4444, function () {
      proxy = http.createServer(function (request, response) {
        var parsed = url.parse(request.url);
        var opts = {
          host: parsed.hostname,
          port: parsed.port,
          path: parsed.path
        };

        http.get(opts, function (res) {
          var body = '';
          res.on('data', function (data) {
            body += data;
          });
          res.on('end', function () {
            response.setHeader('Content-Type', 'text/html; charset=UTF-8');
            response.end(body + '1234');
          });
        });

      }).listen(4000, function () {
        // set the env variable
        process.env.http_proxy = 'http://localhost:4000/';
        process.env.no_proxy = 'foo.com, localhost,bar.net , , quix.co';

        axios.get('http://localhost:4444/').then(function (res) {
          assert.equal(res.data, '4567', 'should not use proxy for domains in no_proxy');
          done();
        });
      });
    });
  });

  it('should not use proxy for localhost with trailing dot when listed in no_proxy', function (done) {
    var proxyRequests = 0;

    proxy = http.createServer(function (request, response) {
      proxyRequests += 1;
      response.end('proxied');
    }).listen(4000, function () {
      process.env.http_proxy = 'http://localhost:4000/';
      process.env.HTTP_PROXY = 'http://localhost:4000/';
      process.env.no_proxy = 'localhost,127.0.0.1,::1';
      process.env.NO_PROXY = 'localhost,127.0.0.1,::1';

      axios.get('http://localhost.:1/', {
        timeout: 100
      }).then(function () {
        done(new Error('request should not succeed'));
      }).catch(function () {
        assert.equal(proxyRequests, 0, 'should not use proxy for localhost with trailing dot');
        done();
      });
    });
  });

  it('should not use proxy for bracketed IPv6 loopback when listed in no_proxy', function (done) {
    var proxyRequests = 0;

    proxy = http.createServer(function (request, response) {
      proxyRequests += 1;
      response.end('proxied');
    }).listen(4000, function () {
      process.env.http_proxy = 'http://localhost:4000/';
      process.env.HTTP_PROXY = 'http://localhost:4000/';
      process.env.no_proxy = 'localhost,127.0.0.1,::1';
      process.env.NO_PROXY = 'localhost,127.0.0.1,::1';

      axios.get('http://[::1]:1/', {
        timeout: 100
      }).then(function () {
        done(new Error('request should not succeed'));
      }).catch(function () {
        assert.equal(proxyRequests, 0, 'should not use proxy for IPv6 loopback');
        done();
      });
    });
  });

  it('should not use proxy for 127.0.0.1 when no_proxy is localhost', function (done) {
    var proxyRequests = 0;

    proxy = http.createServer(function (request, response) {
      proxyRequests += 1;
      response.end('proxied');
    }).listen(4000, function () {
      process.env.http_proxy = 'http://localhost:4000/';
      process.env.HTTP_PROXY = 'http://localhost:4000/';
      process.env.no_proxy = 'localhost';
      process.env.NO_PROXY = 'localhost';

      axios.get('http://127.0.0.1:1/', {
        timeout: 100
      }).then(function () {
        done(new Error('request should not succeed'));
      }).catch(function () {
        assert.equal(proxyRequests, 0, 'should not use proxy for IPv4 loopback alias');
        done();
      });
    });
  });

  it('should not use proxy for 127.0.0.0/8 addresses other than 127.0.0.1', function (done) {
    var proxyRequests = 0;

    proxy = http.createServer(function (request, response) {
      proxyRequests += 1;
      response.end('proxied');
    }).listen(4000, function () {
      process.env.http_proxy = 'http://localhost:4000/';
      process.env.HTTP_PROXY = 'http://localhost:4000/';
      process.env.no_proxy = 'localhost';
      process.env.NO_PROXY = 'localhost';

      axios.get('http://127.0.0.2:1/', {
        timeout: 100
      }).then(function () {
        done(new Error('request should not succeed'));
      }).catch(function () {
        assert.equal(proxyRequests, 0, 'should not use proxy for the whole loopback range');
        done();
      });
    });
  });

  it('should not use proxy for [::1] when no_proxy is localhost', function (done) {
    var proxyRequests = 0;

    proxy = http.createServer(function (request, response) {
      proxyRequests += 1;
      response.end('proxied');
    }).listen(4000, function () {
      process.env.http_proxy = 'http://localhost:4000/';
      process.env.HTTP_PROXY = 'http://localhost:4000/';
      process.env.no_proxy = 'localhost';
      process.env.NO_PROXY = 'localhost';

      axios.get('http://[::1]:1/', {
        timeout: 100
      }).then(function () {
        done(new Error('request should not succeed'));
      }).catch(function () {
        assert.equal(proxyRequests, 0, 'should not use proxy for IPv6 loopback alias');
        done();
      });
    });
  });

  it('should use proxy for domains not in no_proxy', function (done) {
    server = http.createServer(function (req, res) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.end('4567');
    }).listen(4444, function () {
      proxy = http.createServer(function (request, response) {
        var parsed = url.parse(request.url);
        var opts = {
          host: parsed.hostname,
          port: parsed.port,
          path: parsed.path
        };

        http.get(opts, function (res) {
          var body = '';
          res.on('data', function (data) {
            body += data;
          });
          res.on('end', function () {
            response.setHeader('Content-Type', 'text/html; charset=UTF-8');
            response.end(body + '1234');
          });
        });

      }).listen(4000, function () {
        // set the env variable
        process.env.http_proxy = 'http://localhost:4000/';
        process.env.no_proxy = 'foo.com, ,bar.net , quix.co';

        axios.get('http://localhost:4444/').then(function (res) {
          assert.equal(res.data, '45671234', 'should use proxy for domains not in no_proxy');
          done();
        });
      });
    });
  });

  it('should support HTTP proxy auth', function (done) {
    server = http.createServer(function (req, res) {
      res.end();
    }).listen(4444, function () {
      proxy = http.createServer(function (request, response) {
        var parsed = url.parse(request.url);
        var opts = {
          host: parsed.hostname,
          port: parsed.port,
          path: parsed.path
        };
        var proxyAuth = request.headers['proxy-authorization'];

        http.get(opts, function (res) {
          var body = '';
          res.on('data', function (data) {
            body += data;
          });
          res.on('end', function () {
            response.setHeader('Content-Type', 'text/html; charset=UTF-8');
            response.end(proxyAuth);
          });
        });

      }).listen(4000, function () {
        axios.get('http://localhost:4444/', {
          proxy: {
            host: 'localhost',
            port: 4000,
            auth: {
              username: 'user',
              password: 'pass'
            }
          }
        }).then(function (res) {
          var base64 = Buffer.from('user:pass', 'utf8').toString('base64');
          assert.equal(res.data, 'Basic ' + base64, 'should authenticate to the proxy');
          done();
        });
      });
    });
  });

  it('should support proxy auth from env', function (done) {
    server = http.createServer(function (req, res) {
      res.end();
    }).listen(4444, function () {
      proxy = http.createServer(function (request, response) {
        var parsed = url.parse(request.url);
        var opts = {
          host: parsed.hostname,
          port: parsed.port,
          path: parsed.path
        };
        var proxyAuth = request.headers['proxy-authorization'];

        http.get(opts, function (res) {
          var body = '';
          res.on('data', function (data) {
            body += data;
          });
          res.on('end', function () {
            response.setHeader('Content-Type', 'text/html; charset=UTF-8');
            response.end(proxyAuth);
          });
        });

      }).listen(4000, function () {
        process.env.http_proxy = 'http://user:pass@localhost:4000/';

        axios.get('http://localhost:4444/').then(function (res) {
          var base64 = Buffer.from('user:pass', 'utf8').toString('base64');
          assert.equal(res.data, 'Basic ' + base64, 'should authenticate to the proxy set by process.env.http_proxy');
          done();
        });
      });
    });
  });

  it('should not use inherited proxy auth credentials', function (done) {
    Object.prototype.auth = {};
    Object.prototype.username = 'polluted-user';
    Object.prototype.password = 'polluted-pass';

    server = http.createServer(function (req, res) {
      res.end();
    }).listen(4444, function () {
      proxy = http.createServer(function (request, response) {
        var parsed = url.parse(request.url);
        // Null-prototype options: the polluted `auth` must not leak into the
        // proxy's own onward request either.
        var opts = Object.create(null);
        opts.host = parsed.hostname;
        opts.port = parsed.port;
        opts.path = parsed.path;
        opts.auth = undefined;
        var proxyAuth = request.headers['proxy-authorization'];

        http.get(opts, function (res) {
          res.on('data', function () {});
          res.on('end', function () {
            response.setHeader('Content-Type', 'text/html; charset=UTF-8');
            response.end(proxyAuth || '');
          });
        });
      }).listen(4000, function () {
        axios.get('http://localhost:4444/', {
          proxy: {
            host: 'localhost',
            port: 4000
          }
        }).then(function (res) {
          assert.equal(res.data, '');
          done();
        }).catch(done);
      });
    });
  });

  it('should not send inherited header buckets on GET requests', function (done) {
    var inheritedHeaderBuckets = Object.create(null);
    inheritedHeaderBuckets.common = { 'x-polluted-common': 'yes' };
    inheritedHeaderBuckets.get = { 'x-polluted-get': 'yes' };

    server = http.createServer(function (req, res) {
      assert.strictEqual(req.headers['x-polluted-common'], undefined);
      assert.strictEqual(req.headers['x-polluted-get'], undefined);
      assert.strictEqual(req.headers['x-request'], 'request');
      res.end('ok');
    }).listen(4444, function () {
      var requestHeaders = Object.create(inheritedHeaderBuckets);
      requestHeaders['x-request'] = 'request';

      axios.get('http://localhost:4444/', {
        headers: requestHeaders
      }).then(function () {
        done();
      }).catch(done);
    });
  });

  it('should not send inherited header buckets on requests with a body', function (done) {
    server = http.createServer(function (req, res) {
      assert.strictEqual(req.headers['x-polluted-common'], undefined);
      assert.strictEqual(req.headers['x-polluted-post'], undefined);
      assert.strictEqual(req.headers['x-own-common'], 'default');
      assert.strictEqual(req.headers['x-own-post'], 'method');
      assert.strictEqual(req.headers['x-request'], 'request');
      req.on('data', function () {});
      req.on('end', function () {
        res.end('ok');
      });
    }).listen(4444, function () {
      Object.prototype.common = { 'x-polluted-common': 'yes' };
      Object.prototype.post = { 'x-polluted-post': 'yes' };

      var instance = axios.create({
        headers: {
          common: {
            'x-own-common': 'default'
          },
          post: {
            'x-own-post': 'method'
          }
        }
      });

      instance.post('http://localhost:4444/', 'body', {
        headers: {
          'x-request': 'request'
        }
      }).then(function () {
        done();
      }).catch(done);
    });
  });

  it('should support proxy auth with header', function (done) {
    server = http.createServer(function (req, res) {
      res.end();
    }).listen(4444, function () {
      proxy = http.createServer(function (request, response) {
        var parsed = url.parse(request.url);
        var opts = {
          host: parsed.hostname,
          port: parsed.port,
          path: parsed.path
        };
        var proxyAuth = request.headers['proxy-authorization'];

        http.get(opts, function (res) {
          var body = '';
          res.on('data', function (data) {
            body += data;
          });
          res.on('end', function () {
            response.setHeader('Content-Type', 'text/html; charset=UTF-8');
            response.end(proxyAuth);
          });
        });

      }).listen(4000, function () {
        axios.get('http://localhost:4444/', {
          proxy: {
            host: 'localhost',
            port: 4000,
            auth: {
              username: 'user',
              password: 'pass'
            }
          },
          headers: {
            'Proxy-Authorization': 'Basic abc123'
          }
        }).then(function (res) {
          var base64 = Buffer.from('user:pass', 'utf8').toString('base64');
          assert.equal(res.data, 'Basic ' + base64, 'should authenticate to the proxy');
          done();
        });
      });
    });
  });

  it('should support cancel', function (done) {
    var source = axios.CancelToken.source();
    server = http.createServer(function (req, res) {
      // call cancel() when the request has been sent, but a response has not been received
      source.cancel('Operation has been canceled.');
    }).listen(4444, function () {
      axios.get('http://localhost:4444/', {
        cancelToken: source.token
      }).catch(function (thrown) {
        assert.ok(thrown instanceof axios.Cancel, 'Promise must be rejected with a CanceledError object');
        assert.equal(thrown.message, 'Operation has been canceled.');
        done();
      });
    });
  });

  it('should combine baseURL and url', function (done) {
    server = http.createServer(function (req, res) {
      res.end();
    }).listen(4444, function () {
      axios.get('/foo', {
        baseURL: 'http://localhost:4444/',
      }).then(function (res) {
        assert.equal(res.config.baseURL, 'http://localhost:4444/');
        assert.equal(res.config.url, '/foo');
        done();
      });
    });
  });

  it('should support HTTP protocol', function (done) {
    server = http.createServer(function (req, res) {
      setTimeout(function () {
        res.end();
      }, 1000);
    }).listen(4444, function () {
      axios.get('http://localhost:4444')
        .then(function (res) {
          assert.equal(res.request.agent.protocol, 'http:');
          done();
        })
    })
  });

  it('should support HTTPS protocol', function (done) {
    server = http.createServer(function (req, res) {
      setTimeout(function () {
        res.end();
      }, 1000);
    }).listen(4444, function () {
      axios.get('https://www.google.com')
        .then(function (res) {
          assert.equal(res.request.agent.protocol, 'https:');
          done();
        })
    })
  });

  it('should return malformed URL', function (done) {
    var success = false, failure = false;
    var error;

    server = http.createServer(function (req, res) {
      setTimeout(function () {
        res.end();
      }, 1000);
    }).listen(4444, function () {
      axios.get('tel:484-695-3408')
        .then(function (res) {
          success = true;
        }).catch(function (err) {
          error = err;
          failure = true;
        })

      setTimeout(function () {
        assert.equal(success, false, 'request should not succeed');
        assert.equal(failure, true, 'request should fail');
        assert.equal(error.message, 'Unsupported protocol tel:');
        done();
      }, 300);
    })
  });

  it('should return unsupported protocol', function (done) {
    var success = false, failure = false;
    var error;

    server = http.createServer(function (req, res) {
      setTimeout(function () {
        res.end();
      }, 1000);
    }).listen(4444, function () {
      axios.get('ftp:google.com')
        .then(function (res) {
          success = true;
        }).catch(function (err) {
          error = err;
          failure = true;
        })

      setTimeout(function () {
        assert.equal(success, false, 'request should not succeed');
        assert.equal(failure, true, 'request should fail');
        assert.equal(error.message, 'Unsupported protocol ftp:');
        done();
      }, 300);
    })
  });

  it('should supply a user-agent if one is not specified', function (done) {
    server = http.createServer(function (req, res) {
      assert.equal(req.headers["user-agent"], 'axios/' + pkg.version);
      res.end();
    }).listen(4444, function () {
      axios.get('http://localhost:4444/'
      ).then(function (res) {
        done();
      });
    });
  });

  it('should omit a user-agent if one is explicitly disclaimed', function (done) {
    server = http.createServer(function (req, res) {
      assert.equal("user-agent" in req.headers, false);
      assert.equal("User-Agent" in req.headers, false);
      res.end();
    }).listen(4444, function () {
      axios.get('http://localhost:4444/', {
        headers: {
          "User-Agent": null
        }
      }
      ).then(function (res) {
        done();
      });
    });
  });

  it('should throw an error if http server that aborts a chunked request', function (done) {
    server = http.createServer(function (req, res) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('chunk 1');
      setTimeout(function () {
        res.write('chunk 2');
      }, 100);
      setTimeout(function() {
        res.destroy();
      }, 200);
    }).listen(4444, function () {
      var success = false, failure = false;
      var error;

      axios.get('http://localhost:4444/aborted', {
        timeout: 500
      }).then(function (res) {
        success = true;
      }).catch(function (err) {
        error = err;
        failure = true;
      }).finally(function () {
        assert.strictEqual(success, false, 'request should not succeed');
        assert.strictEqual(failure, true, 'request should fail');
        assert.strictEqual(error.code, 'ERR_BAD_RESPONSE');
        assert.strictEqual(error.message, 'maxContentLength size of -1 exceeded');
        done();
      });
    });
  });

  describe('FormData header policy', function () {
    function createFormDataLikeStream(headers) {
      var Readable = require('stream').Readable;
      var form = Readable.from(['abc']);

      form.append = function () {};
      form.getHeaders = function () {
        return headers;
      };
      form.toString = function () {
        return '[object FormData]';
      };

      return form;
    }

    function postFormDataLike(headers, config) {
      config = config || {};
      config.maxRedirects = 0;

      return axios.post('http://localhost:4444/', createFormDataLikeStream(headers), config);
    }

    it('should preserve FormData getHeaders headers by default', function (done) {
      server = http.createServer(function (req, res) {
        res.end(JSON.stringify(req.headers));
      }).listen(4444, function () {
        postFormDataLike({
          'content-type': 'multipart/form-data; boundary=test',
          'content-length': '3',
          host: 'evil.example',
          authorization: 'Bearer ATTACKER_TOKEN',
          'x-forwarded-for': '127.0.0.2',
          'x-injected': 'yes'
        }).then(function (res) {
          assert.strictEqual(res.data['content-type'], 'multipart/form-data; boundary=test');
          assert.strictEqual(res.data['content-length'], '3');
          assert.strictEqual(res.data.host, 'evil.example');
          assert.strictEqual(res.data.authorization, 'Bearer ATTACKER_TOKEN');
          assert.strictEqual(res.data['x-forwarded-for'], '127.0.0.2');
          assert.strictEqual(res.data['x-injected'], 'yes');
          done();
        }).catch(done);
      });
    });

    it('should preserve FormData getHeaders headers for legacy policy', function (done) {
      server = http.createServer(function (req, res) {
        res.end(JSON.stringify(req.headers));
      }).listen(4444, function () {
        postFormDataLike({
          'content-type': 'multipart/form-data; boundary=test',
          'content-length': '3',
          host: 'evil.example',
          authorization: 'Bearer ATTACKER_TOKEN',
          'x-forwarded-for': '127.0.0.2',
          'x-injected': 'yes'
        }, { formDataHeaderPolicy: 'legacy' }).then(function (res) {
          assert.strictEqual(res.data.host, 'evil.example');
          assert.strictEqual(res.data.authorization, 'Bearer ATTACKER_TOKEN');
          assert.strictEqual(res.data['x-forwarded-for'], '127.0.0.2');
          assert.strictEqual(res.data['x-injected'], 'yes');
          done();
        }).catch(done);
      });
    });

    it('should constrain FormData getHeaders headers for content-only policy', function (done) {
      server = http.createServer(function (req, res) {
        res.end(JSON.stringify(req.headers));
      }).listen(4444, function () {
        postFormDataLike({
          'Content-Type': 'multipart/form-data; boundary=test',
          'Content-Length': '3',
          host: 'evil.example',
          authorization: 'Bearer ATTACKER_TOKEN',
          'x-forwarded-for': '127.0.0.2',
          'x-injected': 'yes'
        }, { formDataHeaderPolicy: 'content-only' }).then(function (res) {
          assert.strictEqual(res.data['content-type'], 'multipart/form-data; boundary=test');
          assert.strictEqual(res.data['content-length'], '3');
          assert.notStrictEqual(res.data.host, 'evil.example');
          assert.notStrictEqual(res.data.authorization, 'Bearer ATTACKER_TOKEN');
          assert.strictEqual(res.data['x-forwarded-for'], undefined);
          assert.strictEqual(res.data['x-injected'], undefined);
          done();
        }).catch(done);
      });
    });

    it('should keep explicit request headers with content-only policy', function (done) {
      server = http.createServer(function (req, res) {
        res.end(JSON.stringify(req.headers));
      }).listen(4444, function () {
        postFormDataLike({
          'content-type': 'multipart/form-data; boundary=test',
          'content-length': '3',
          'x-injected': 'yes'
        }, {
          formDataHeaderPolicy: 'content-only',
          headers: {
            'x-caller-header': 'allowed'
          }
        }).then(function (res) {
          assert.strictEqual(res.data['x-caller-header'], 'allowed');
          assert.strictEqual(res.data['x-injected'], undefined);
          done();
        }).catch(done);
      });
    });
  });

  it('should allow passing FormData', function (done) {
    var form = new FormData();
    var file1= Buffer.from('foo', 'utf8');

    form.append('foo', "bar");
    form.append('file1', file1, {
      filename: 'bar.jpg',
      filepath: 'temp/bar.jpg',
      contentType: 'image/jpeg'
    });

    server = http.createServer(function (req, res) {
      var receivedForm = new formidable.IncomingForm();

      receivedForm.parse(req, function (err, fields, files) {
        if (err) {
          return done(err);
        }

        res.end(JSON.stringify({
          fields: fields,
          files: files
        }));
      });
    }).listen(4444, function () {
      axios.post('http://localhost:4444/', form, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      }).then(function (res) {
        assert.deepStrictEqual(res.data.fields,{foo: 'bar'});

        assert.strictEqual(res.data.files.file1.mimetype,'image/jpeg');
        assert.strictEqual(res.data.files.file1.originalFilename,'temp/bar.jpg');
        assert.strictEqual(res.data.files.file1.size,3);

        done();
      }).catch(done);
    });
  });

  describe('prototype pollution (GHSA-6chq-wfr3-2hj9)', function () {
    var pollutedKeys = ['getHeaders', 'append', 'pipe', 'on', 'once'];
    var toStringTagSym = Symbol.toStringTag;

    function pollute() {
      Object.prototype[toStringTagSym] = 'FormData';
      Object.prototype.append = function () {};
      Object.prototype.getHeaders = function () {
        return {
          'x-injected': 'attacker',
          'authorization': 'Bearer ATTACKER_TOKEN'
        };
      };
      Object.prototype.pipe = function (d) { if (d && d.end) d.end(); return d; };
      Object.prototype.on = function () { return this; };
      Object.prototype.once = function () { return this; };
    }

    function cleanup() {
      for (var i = 0; i < pollutedKeys.length; i++) delete Object.prototype[pollutedKeys[i]];
      delete Object.prototype[toStringTagSym];
    }

    it('should not merge prototype-polluted getHeaders into outgoing request', function (done) {
      var receivedHeaders;
      server = http.createServer(function (req, res) {
        receivedHeaders = req.headers;
        res.end('{}');
      }).listen(4444, function () {
        pollute();
        var finish = function (requestError) {
          cleanup();
          try {
            assert.ok(
              receivedHeaders,
              'request must reach server to prove polluted headers were not merged' +
                (requestError ? ' (request errored: ' + requestError.message + ')' : '')
            );
            assert.strictEqual(receivedHeaders['x-injected'], undefined);
            assert.notStrictEqual(receivedHeaders['authorization'], 'Bearer ATTACKER_TOKEN');
            done();
          } catch (e) {
            done(e);
          }
        };
        axios.post('http://localhost:4444/', { userId: 42 }, {
          headers: { 'Authorization': 'Bearer VALID_USER_TOKEN' }
        }).then(function () {
          finish();
        }).catch(function (err) {
          finish(err);
        });
      });
    });

    it('should not merge an inherited getHeaders for a genuine form-data-like body', function (done) {
      // The body itself is form-data-like (own `append`, own `toString`, non-plain prototype),
      // so `isFormData` legitimately accepts it — but `getHeaders` comes only from the polluted
      // Object.prototype, so the adapter must not call it.
      var Readable = require('stream').Readable;
      var form = new Readable({
        read: function () {
          this.push('abc');
          this.push(null);
        }
      });

      form.append = function () {};
      form.toString = function () {
        return '[object FormData]';
      };

      var receivedHeaders;
      server = http.createServer(function (req, res) {
        receivedHeaders = req.headers;
        res.end('{}');
      }).listen(4444, function () {
        Object.prototype.getHeaders = function () {
          return {
            'x-injected': 'attacker',
            'authorization': 'Bearer ATTACKER_TOKEN'
          };
        };
        var finish = function (requestError) {
          delete Object.prototype.getHeaders;
          try {
            assert.ok(
              receivedHeaders,
              'request must reach server to prove polluted headers were not merged' +
                (requestError ? ' (request errored: ' + requestError.message + ')' : '')
            );
            assert.strictEqual(receivedHeaders['x-injected'], undefined);
            assert.notStrictEqual(receivedHeaders['authorization'], 'Bearer ATTACKER_TOKEN');
            done();
          } catch (e) {
            done(e);
          }
        };
        axios.post('http://localhost:4444/', form, {
          maxRedirects: 0,
          headers: { 'Authorization': 'Bearer VALID_USER_TOKEN' }
        }).then(function () {
          finish();
        }).catch(function (err) {
          finish(err);
        });
      });
    });
  });

  describe('maxContentLength with responseType stream (GHSA-vf2m-468p-8v99)', function () {
    it('should reject when streamed response exceeds maxContentLength', function (done) {
      var payload = Buffer.alloc(2048, 'a');
      server = http.createServer(function (req, res) {
        res.end(payload);
      }).listen(4444, function () {
        axios.get('http://localhost:4444/', {
          responseType: 'stream',
          maxContentLength: 1024
        }).then(function (response) {
          var received = 0;
          var errored = false;
          response.data.on('data', function (chunk) {
            received += chunk.length;
          });
          response.data.on('error', function (err) {
            errored = true;
            assert.ok(
              /maxContentLength/.test(err.message),
              'expected maxContentLength error, got ' + err.message
            );
            done();
          });
          response.data.on('end', function () {
            if (!errored) {
              done(new Error('stream ended without error; received ' + received + ' bytes'));
            }
          });
        }).catch(done);
      });
    });

    it('should allow streamed responses under maxContentLength', function (done) {
      var payload = Buffer.alloc(512, 'b');
      server = http.createServer(function (req, res) {
        res.end(payload);
      }).listen(4444, function () {
        axios.get('http://localhost:4444/', {
          responseType: 'stream',
          maxContentLength: 1024
        }).then(function (response) {
          var chunks = [];
          response.data.on('data', function (chunk) {
            chunks.push(chunk);
          });
          response.data.on('end', function () {
            var body = Buffer.concat(chunks);
            assert.strictEqual(body.length, 512);
            done();
          });
          response.data.on('error', done);
        }).catch(done);
      });
    });
  });

  describe('maxBodyLength with streamed upload and maxRedirects=0 (GHSA-5c9x-8gcm-mpgx)', function () {
    it('should reject streamed upload exceeding maxBodyLength with native transport', function (done) {
      var received = 0;
      server = http.createServer(function (req, res) {
        req.on('data', function (chunk) {
          received += chunk.length;
        });
        req.on('end', function () {
          res.end(JSON.stringify({received: received}));
        });
      }).listen(4444, function () {
        var chunks = [];
        for (var i = 0; i < 20; i++) {
          chunks.push(Buffer.alloc(1024, 'c'));
        }
        // Explicit Readable rather than Readable.from — the latter needs node >= 12.3
        // and this suite also runs on node 10/12.
        var Readable = require('stream').Readable;
        var next = 0;
        var body = new Readable({
          read: function read() {
            this.push(next < chunks.length ? chunks[next++] : null);
          }
        });
        axios.post('http://localhost:4444/', body, {
          maxBodyLength: 1024,
          maxRedirects: 0
        }).then(function () {
          done(new Error('expected maxBodyLength rejection, got success (received ' + received + ')'));
        }).catch(function (err) {
          try {
            assert.ok(err instanceof AxiosError, 'expected AxiosError, got ' + err);
            assert.ok(
              /maxBodyLength/.test(err.message),
              'expected maxBodyLength error, got ' + err.message
            );
            done();
          } catch (e) {
            done(e);
          }
        });
      });
    });
  });

});

