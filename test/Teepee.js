/* global describe, it, __dirname, JSON, clearTimeout, setTimeout, setImmediate, beforeEach, afterEach, window, global */
const Teepee = require('../lib/Teepee');
const teepee = Teepee; // Alias so that jshint doesn't complain when invoking without new
const zlib = require('zlib');
const HttpError = require('httperrors');
const SocketError = require('socketerrors');
const DnsError = require('dnserrors');
const passError = require('passerror');
const unexpected = require('unexpected');
const sinon = require('sinon');
const util = require('util');
const fs = require('fs');
const http = require('http');
const https = require('https');
const stream = require('stream');
const pathModule = require('path');
const httpception = require('httpception');

describe('Teepee', () => {
  const expect = unexpected.clone().use(require('unexpected-sinon'));

  let sandbox;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });
  afterEach(() => {
    sandbox.restore();
  });

  describe('request shorthands named after the method', () => {
    it('should allow making a POST request via Teepee.post(<string>)', () => {
      httpception({
        request: 'POST http://www.example.com/',
        response: 200
      });

      return Teepee.post('http://www.example.com/');
    });

    it('should allow making a POST request via Teepee.post({ url: <string> })', () => {
      httpception({
        request: 'POST http://www.example.com/',
        response: 200
      });

      return Teepee.post({ url: 'http://www.example.com/' });
    });

    it('should allow making a POST request via Teepee.post(<url>, { options })', () => {
      httpception({
        request: 'POST http://www.example.com/?abc=123',
        response: 200
      });

      return Teepee.post('http://www.example.com/', { query: { abc: 123 } });
    });

    it('should alias Teepee.delete as Teepee.del', () => {
      httpception({
        request: 'DELETE http://www.example.com/',
        response: 200
      });

      return Teepee.del('http://www.example.com/');
    });

    it('should throw if attempting to pass non-string, non-object to Teepee.post()', () => {
      httpception([]);

      return expect(
        () => Teepee.post(1234),
        'to throw',
        'Teepee.post: First argument must be either an object or a string'
      );
    });

    it('should allow making a POST request via new Teepee().post(<string>)', () => {
      httpception({
        request: 'POST http://www.example.com/',
        response: 200
      });

      return new Teepee().post('http://www.example.com/');
    });

    it('should allow making a POST request via new Teepee().post({ url: <string> })', () => {
      httpception({
        request: 'POST http://www.example.com/',
        response: 200
      });

      return new Teepee().post({ url: 'http://www.example.com/' });
    });

    it('should allow making a POST request via new Teepee().post(<url>, { options })', () => {
      httpception({
        request: 'POST http://www.example.com/?foo=123',
        response: 200
      });

      return new Teepee().post('http://www.example.com/', {
        query: { foo: 123 }
      });
    });

    it('should allow making a POST request via new Teepee(<url>).post()', () => {
      httpception({
        request: 'POST http://www.example.com/',
        response: 200
      });

      return new Teepee('http://www.example.com/').post();
    });

    it('should allow making a POST request via new Teepee(<url>).post(<function>)', () => {
      httpception({
        request: 'POST http://www.example.com/',
        response: 200
      });

      return expect(cb => {
        new Teepee('http://www.example.com/').post(cb);
      }, 'to call the callback without error');
    });

    it('should alias Teepee.prototype.delete as Teepee.prototype.del', () => {
      httpception({
        request: 'DELETE http://www.example.com/',
        response: 200
      });
      return new Teepee().del('http://www.example.com/');
    });

    it('should throw if attempting to pass non-string, non-object to Teepee.prototype.post()', () => {
      httpception([]);

      return expect(
        () => new Teepee('http://www.example.com/').post(1234),
        'to throw',
        'Teepee.post: First argument must be either an object or a string'
      );
    });
  });

  it('should allow specifying a default query to the constructor', () => {
    httpception({
      request: 'GET http://www.google.com/?foo=123',
      response: 200
    });

    return new Teepee({ query: { foo: 123 } }).get('http://www.google.com/');
  });

  it('should override the default query when passing a conflicting option to request', () => {
    httpception({
      request: 'GET http://www.google.com/?foo=456',
      response: 200
    });

    return new Teepee({ query: { foo: 123 } }).get({
      url: 'http://www.google.com/',
      query: { foo: 456 }
    });
  });

  it('should mix into the default query when creating a subsidiary', () => {
    httpception({
      request: 'GET http://www.google.com/?bar=789&foo=123',
      response: 200
    });

    return new Teepee({ query: { foo: 123 } })
      .subsidiary({ query: { bar: 789 } })
      .get('http://www.google.com/');
  });

  it('should inherit the _userSuppliedConfigOptionNames of the parent (so Agents will be created correctly)', () => {
    expect(
      new Teepee({ foo: 12, bar: 34 }).subsidiary({ bar: 56, baz: 78 })
        ._userSuppliedConfigOptionNames,
      'when sorted to equal',
      ['bar', 'baz', 'foo']
    );
  });

  it('should not overwrite a built-in method with a config object property', () => {
    expect(
      new Teepee({
        url: 'http://localhost',
        request: 1
      }).request,
      'to be a function'
    );
  });

  it('should assume http:// if no protocol is provided in the base url', () => {
    httpception({
      request: 'GET http://localhost:1234/foobar',
      response: 200
    });

    return new Teepee('localhost:1234').request('foobar');
  });

  it('should accept a url without a hostname (will default to localhost via http.request)', () => {
    httpception({
      request: {
        url: 'GET http://localhost:1234/foobar',
        headers: {
          Host: ':1234'
        }
      },
      response: 200
    });

    return new Teepee('http://:1234').request('foobar');
  });

  it('should provide the response body as response.body and as the second parameter to the callback', () => {
    httpception({
      request: 'GET http://localhost:1234/foobar',
      response: { statusCode: 200, body: Buffer.from('foo') }
    });

    return expect(cb => {
      new Teepee('localhost:1234').request('foobar', cb);
    }, 'to call the callback without error').spread((response, body) => {
      expect(response, 'to have property', 'body', Buffer.from('foo'));
      expect(body, 'to equal', Buffer.from('foo'));
    });
  });

  it('should provide an empty buffer if the the response body is empty', () => {
    httpception({
      request: 'GET http://localhost:1234/foobar',
      response: { statusCode: 200 }
    });

    return expect(cb => {
      new Teepee('localhost:1234').request('foobar', cb);
    }, 'to call the callback without error').spread((response, body) => {
      expect(response, 'to have property', 'body', Buffer.from([]));
      expect(body, 'to equal', Buffer.from([]));
    });
  });

  it('should accept default headers as constructor options', () => {
    httpception({
      request: {
        headers: {
          foo: 'blah',
          quux: 'baz'
        }
      }
    });

    return expect(cb => {
      new Teepee({
        url: 'http://localhost:1234/',
        headers: {
          foo: 'bar',
          quux: 'baz'
        }
      }).request(
        {
          headers: {
            foo: 'blah'
          }
        },
        cb
      );
    }, 'to call the callback without error');
  });

  it('should ignore headers values of undefined', () => {
    httpception({
      request: {
        headers: expect.it('not to have property', 'content-type')
      }
    });

    let undefinedVariable;
    return expect(cb => {
      new Teepee({
        url: 'http://localhost:1234/',
        headers: {
          'content-type': undefinedVariable
        }
      }).request(cb);
    }, 'to call the callback without error');
  });

  it('should emit a successfulRequest event on 200 OK response', () => {
    httpception({
      response: 200
    });

    const teepee = new Teepee('http://localhost:1234/');
    const successfulRequestListener = sinon
      .spy()
      .named('successfulRequestListener');
    const failedRequestListener = sinon.spy().named('failedRequestListener');
    teepee
      .on('successfulRequest', successfulRequestListener)
      .on('failedRequest', failedRequestListener);
    return expect(cb => {
      teepee.request(cb);
    }, 'to call the callback without error').then(() => {
      expect(
        [failedRequestListener, successfulRequestListener],
        'to have calls satisfying',
        () => {
          successfulRequestListener({
            url: 'http://localhost:1234/',
            requestOptions: {
              // ...
              host: 'localhost',
              port: 1234
            },
            response: expect.it('to be an object')
          });
        }
      );
    });
  });

  it('should emit a successfulRequest event on 304 Not Modified response', () => {
    httpception({
      response: 304,
      body: 'barbar'
    });

    return expect(cb => {
      const teepee = new Teepee('http://localhost:1234/');
      const successfulRequestListener = sinon
        .spy(() => {
          cb();
        })
        .named('successfulRequestListener');
      teepee.on('successfulRequest', successfulRequestListener);
      teepee.request('/foo.jpg');
    }, 'to call the callback without error');
  });

  it('should emit a successfulRequest event on 200 Ok response without callback but with responseBody event handler', () => {
    httpception({
      response: 200,
      body: 'barbar'
    });

    return expect(cb => {
      const teepee = new Teepee('http://localhost:1234/');
      const successfulRequestListener = sinon.spy(() => {
        cb();
      });
      teepee.on('successfulRequest', successfulRequestListener);

      const request = teepee.request('/foo.jpg');

      request.once('responseBody', () => {});
    }, 'to call the callback without error');
  });

  it('should emit a successfulRequest event on 200 Ok response without callback and without responseBody event handler', () => {
    httpception({
      response: 200,
      body: 'barbar'
    });

    return expect(cb => {
      const teepee = new Teepee('http://localhost:1234/');
      const successfulRequestListener = sinon.spy(() => {
        cb();
      });
      teepee.on('successfulRequest', successfulRequestListener);

      teepee.request('/foo.jpg');
    }, 'to call the callback without error');
  });

  it('should emit a request event', () => {
    httpception([
      { response: new SocketError.ECONNRESET() },
      { response: 200 }
    ]);

    const teepee = new Teepee('http://localhost:1234/');
    const requestListener = sinon.spy().named('requestListener');
    teepee.on('request', requestListener);
    return expect(cb => {
      teepee.request({ numRetries: 1 }, cb);
    }, 'to call the callback without error').then(() => {
      expect(requestListener, 'was called twice').and(
        'to have all calls satisfying',
        () => {
          requestListener({
            url: 'http://localhost:1234/',
            requestOptions: {
              // ...
              host: 'localhost',
              port: 1234,
              method: 'GET'
            }
          });
        }
      );
    });
  });

  it('should emit a failedRequest event', () => {
    httpception({
      response: 404
    });

    const teepee = new Teepee('http://localhost:1234/');
    const successfulRequestListener = sinon
      .spy()
      .named('successfulRequestListner');
    const failedRequestListener = sinon.spy().named('failedRequestListener');
    teepee.on('failedRequest', failedRequestListener);
    teepee.on('successfulRequest', successfulRequestListener);
    return expect(
      cb => {
        teepee.request(cb);
      },
      'to call the callback with error',
      new HttpError.NotFound()
    ).then(() => {
      expect(
        [successfulRequestListener, failedRequestListener],
        'to have calls satisfying',
        () => {
          failedRequestListener({
            numRetriesLeft: 0,
            url: 'http://localhost:1234/',
            err: new HttpError.NotFound(),
            requestOptions: {
              // ...
              host: 'localhost',
              port: 1234
            },
            response: expect.it('to be an object')
          });
        }
      );
    });
  });

  describe('with a rejectUnauthorized option', () => {
    describe('passed to the constructor', () => {
      // Teepee does pass the option, but it seems like there's a mitm problem that causes this test to fail?
      it.skip('should pass option to https.request', () => {
        httpception({
          request: {
            rejectUnauthorized: false
          },
          response: 200
        });

        return expect(cb => {
          new Teepee({
            rejectUnauthorized: false,
            url: 'https://localhost:1234/'
          }).request(cb);
        }, 'to call the callback without error');
      });
    });

    describe('passed to the request method', () => {
      // Teepee does pass the option, but it seems like there's a mitm problem that causes this test to fail?
      it.skip('should pass the option to https.request', () => {
        httpception({
          request: {
            rejectUnauthorized: false
          },
          response: 200
        });

        return expect(cb => {
          new Teepee('https://localhost:1234/').request(
            { rejectUnauthorized: false },
            cb
          );
        }, 'to call the callback without error');
      });
    });
  });

  describe('without a rejectUnauthorized option', () => {
    it('should not send a value to https.request, thus triggering whatever is the default behavior', () => {
      httpception({
        request: {
          rejectUnauthorized: undefined
        },
        response: 200
      });

      return expect(cb => {
        new Teepee('https://localhost:1234/').request(cb);
      }, 'to call the callback without error');
    });
  });

  it('should accept a custom agent', () => {
    httpception({
      request: 'http://localhost:5984/hey/quux',
      response: 200
    });

    let agent;
    return expect(cb => {
      agent = new http.Agent();

      const teepee = new Teepee({
        url: 'http://localhost:5984/hey/',
        agent
      });

      expect(teepee.agentByProtocol.http, 'to be', agent);

      sinon.spy(agent, 'addRequest');

      teepee.request('quux', cb);
    }, 'to call the callback').then(() => {
      expect(agent.addRequest, 'was called once');
    });
  });

  it('should accept a custom agent constructor', () => {
    httpception({
      request: 'http://localhost:5984/hey/quux',
      response: 200
    });

    const Agent = function(options) {
      http.Agent.call(this, options);
      sinon.spy(this, 'addRequest');
    };
    util.inherits(Agent, http.Agent);
    let teepee;
    return expect(cb => {
      teepee = new Teepee({
        url: 'http://localhost:5984/hey/',
        Agent
      });

      teepee.request('quux', cb);
    }, 'to call the callback').then(() => {
      expect(teepee.agentByProtocol.http, 'to be an', Agent);
      expect(teepee.agentByProtocol.http.addRequest, 'was called once');
    });
  });

  it('should accept a custom AgentByProtocol object', () => {
    httpception([
      {
        request: 'http://localhost:5984/hey/quux',
        response: 200
      },
      {
        request: 'https://example.com/',
        response: 200
      }
    ]);

    const CustomHttpAgent = function(options) {
      http.Agent.call(this, options);
      sinon.spy(this, 'addRequest');
    };
    util.inherits(CustomHttpAgent, http.Agent);

    const CustomHttpsAgent = function(options) {
      https.Agent.call(this, options);
      sinon.spy(this, 'addRequest');
    };
    util.inherits(CustomHttpsAgent, https.Agent);

    let teepee;
    return expect(() => {
      teepee = new Teepee({
        url: 'http://localhost:5984/hey/',
        AgentByProtocol: { http: CustomHttpAgent, https: CustomHttpsAgent }
      });

      return teepee
        .request('quux')
        .then(() => teepee.request('https://example.com/'));
    }, 'not to error').then(() => {
      expect(teepee.agentByProtocol.http, 'to be a', CustomHttpAgent);
      expect(teepee.agentByProtocol.http.addRequest, 'was called once');
      expect(teepee.agentByProtocol.https, 'to be a', CustomHttpsAgent);
      expect(teepee.agentByProtocol.https.addRequest, 'was called once');
    });
  });

  it('should pass other config options to the agent', () => {
    const Agent = sinon.spy(http.Agent);

    const teepee = new Teepee({
      url: 'http://localhost:5984/hey/',
      foobarquux: 123,
      Agent
    });

    expect(teepee.getAgent(), 'to be an', http.Agent);

    expect(
      Agent,
      'to have a call satisfying',
      () => new Agent({ foobarquux: 123 })
    );
  });

  it('should use the global agent if no agent config is provided', () => {
    expect(
      new Teepee('http://localhost:5984/hey/').getAgent('http'),
      'to be undefined'
    );
  });

  it('should create its own agents if agent:true is provided', () => {
    expect(new Teepee({ agent: true }).getAgent('http'), 'to be defined');
  });

  it('should perform a simple request', () => {
    httpception({
      request: 'GET http://localhost:5984/bar/quux',
      response: 200
    });

    return expect(cb => {
      new Teepee('http://localhost:5984').request('bar/quux', cb);
    }, 'to call the callback without error');
  });

  it('should allow the options object to be omitted', () => {
    httpception({
      request: 'GET http://localhost:5984/',
      response: 200
    });

    return expect(cb => {
      new Teepee('http://localhost:5984').request(cb);
    }, 'to call the callback without error');
  });

  it('should allow the options object to follow the url', () => {
    httpception({
      request: 'GET http://localhost:5984/?foo=123',
      response: 200
    });

    return expect(cb => {
      new Teepee().request(
        'http://localhost:5984',
        { query: { foo: 123 } },
        cb
      );
    }, 'to call the callback without error');
  });

  it('should accept the method before the url', () => {
    httpception({
      request: 'POST http://localhost:5984/bar/quux',
      response: 200
    });

    return expect(cb => {
      new Teepee('http://localhost:5984').request('POST bar/quux', cb);
    }, 'to call the callback without error');
  });

  it('should allow specifying custom headers', () => {
    httpception({
      request: {
        url: 'GET http://localhost:5984/bar/quux',
        headers: { Foo: 'bar' }
      },
      response: 200
    });

    return expect(cb => {
      new Teepee('http://localhost:5984').request(
        { path: 'bar/quux', headers: { Foo: 'bar' } },
        cb
      );
    }, 'to call the callback without error');
  });

  it('should resolve the path from the base url', () => {
    httpception({
      request: 'GET http://localhost:5984/hey/quux',
      response: 200
    });

    return expect(cb => {
      new Teepee('http://localhost:5984/hey/there/').request(
        { path: '../quux' },
        cb
      );
    }, 'to call the callback without error');
  });

  it('should default to port 443 on https', () => {
    httpception({
      request: {
        url: 'GET https://localhost:443/bar/quux',
        port: 443,
        headers: {
          // As port 443 is the default for https, it doesn't need to be in the Host header
          // http://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.23
          Host: 'localhost'
        }
      },
      response: 200
    });

    return expect(cb => {
      new Teepee('https://localhost/').request('bar/quux', cb);
    }, 'to call the callback without error');
  });

  it('should prefer an overridden host header to the default when it is not provided as all lowercase', () => {
    httpception({
      request: {
        url: 'GET http://localhost/',
        headers: {
          host: 'baz.com'
        }
      },
      response: 200
    });

    return expect(
      () => teepee({ url: 'http://localhost/', headers: { Host: 'baz.com' } }),
      'not to error'
    );
  });

  it('should allow specifying the request body as a Buffer', () => {
    httpception({
      request: {
        url: 'POST http://localhost:5984/foo',
        headers: {
          'Content-Type': undefined
        },
        body: Buffer.from([1, 2, 3])
      },
      response: 200
    });

    return expect(cb => {
      new Teepee('http://localhost:5984/').request(
        { method: 'POST', path: 'foo', body: Buffer.from([1, 2, 3]) },
        cb
      );
    }, 'to call the callback without error');
  });

  it('should allow specifying the request body as a string', () => {
    httpception({
      request: {
        url: 'POST http://localhost:5984/foo',
        headers: {
          'Content-Type': undefined
        },
        body: Buffer.from('foobar', 'utf-8')
      },
      response: 200
    });

    return expect(cb => {
      new Teepee('http://localhost:5984/').request(
        { method: 'POST', path: 'foo', body: 'foobar' },
        cb
      );
    }, 'to call the callback without error');
  });

  describe('when specifying the request body as an object', () => {
    it('should send a JSON request', () => {
      httpception({
        request: {
          url: 'POST http://localhost:5984/foo',
          headers: {
            'Content-Type': 'application/json'
          },
          body: { what: 'gives' }
        },
        response: 200
      });

      return expect(
        () =>
          new Teepee('http://localhost:5984/').request({
            method: 'POST',
            path: 'foo',
            body: { what: 'gives' }
          }),
        'not to error'
      );
    });

    it('should not overwrite an existing Content-Type header', () => {
      httpception({
        request: {
          url: 'POST http://localhost:5984/',
          headers: {
            'Content-Type': 'application/vnd.api+json'
          },
          body: { what: 'gives' }
        },
        response: 200
      });

      return expect(
        () =>
          new Teepee('http://localhost:5984/').request({
            method: 'POST',
            headers: { 'content-type': 'application/vnd.api+json' },
            body: { what: 'gives' }
          }),
        'not to error'
      );
    });
  });

  it('should return an object with an abort method', () => {
    httpception({
      response: 200
    });

    return expect(cb => {
      expect(
        new Teepee('http://localhost:5984/').request(
          { method: 'POST', path: 'foo' },
          cb
        ),
        'to satisfy',
        {
          abort: expect.it('to be a function')
        }
      );
    }, 'to call the callback without error');
  });

  it('should emit a responseBody event when the response body is available', () => {
    httpception({
      response: {
        statusCode: 200,
        body: 'yaddayaddayadda'
      }
    });

    return expect(cb => {
      teepee('http://localhost/')
        .on('responseBody', response => {
          expect(response.body, 'to equal', Buffer.from('yaddayaddayadda'));
          cb();
        })
        .on('error', cb);
    }, 'to call the callback without error');
  });

  describe('#request', () => {
    it('should return an EventEmitter that emits a request event', () => {
      httpception({
        response: 200
      });

      return expect(cb => {
        teepee('http://localhost/').on('request', function(
          request,
          requestProperties,
          url
        ) {
          expect(request, 'to satisfy', {
            write: expect.it('to be a function')
          });
          expect(requestProperties, 'to satisfy', {
            host: 'localhost'
          });
          this.on('success', () => {
            cb();
          }).on('error', cb);
        });
      }, 'to call the callback without error');
    });

    it('should return an EventEmitter that does not emit the responseBody event unless there are listeners for it', () => {
      httpception({
        response: {
          statusCode: 200,
          body: 'yaddayaddayadda'
        }
      });

      let eventEmitter;
      return expect(cb => {
        eventEmitter = teepee('http://localhost/');
        eventEmitter.on('response', response => {
          response.on('data', () => {}).on('end', cb);
        });
        sinon.spy(eventEmitter, 'emit');
      }, 'to call the callback without error').then(() => {
        expect(eventEmitter.emit, 'was never called with', 'responseBody');
      });
    });

    it('should return an EventEmitter that emits an error when an unsuccessful response is received, just in time for a responseBody listener to be attached', () => {
      httpception({
        response: {
          statusCode: 404,
          body: 'yaddayaddayadda'
        }
      });

      let eventEmitter;
      return expect(cb => {
        eventEmitter = teepee('http://localhost/');
        eventEmitter.on('error', function(err) {
          expect(err, 'to equal', new Teepee.httpErrors.NotFound());
          this.on('responseBody', response => {
            expect(response.body, 'to equal', Buffer.from('yaddayaddayadda'));
            cb();
          });
        });
        sinon.spy(eventEmitter, 'emit');
      }, 'to call the callback without error').then(() => {
        expect(eventEmitter.emit, 'to have calls satisfying', () => {
          eventEmitter.emit(
            'response',
            expect.it('to be an object'),
            new Teepee.httpErrors.NotFound()
          );
          eventEmitter.emit('error', new Teepee.httpErrors.NotFound());
          eventEmitter.emit('responseBody', expect.it('to be an object'));
        });
      });
    });

    it('should return an EventEmitter that emits a success event (and no error event) when a successful response is received', () => {
      httpception({
        response: 200
      });

      let eventEmitter;
      return expect(cb => {
        eventEmitter = teepee('http://localhost/', cb);
        sinon.spy(eventEmitter, 'emit');
      }, 'to call the callback without error').then(() => {
        expect(eventEmitter.emit, 'to have calls satisfying', () => {
          eventEmitter.emit(
            'response',
            expect.it('to be an object'),
            undefined
          );
          eventEmitter.emit('success', expect.it('to be an object'));
          eventEmitter.emit('responseBody', expect.it('to be an object'));
          eventEmitter.emit('end');
        });
      });
    });

    it('should discard a document fragment in the url', () => {
      httpception({
        request: 'http://foo.com/',
        response: 200
      });

      return expect(() => teepee('http://foo.com/#blah'), 'not to error');
    });

    describe('when the body is passed as a function', () => {
      it('should support a Buffer being returned', () => {
        httpception({
          request: {
            url: 'PUT http://localhost/',
            body: Buffer.from('hello')
          }
        });

        return expect(
          () =>
            teepee({
              url: 'PUT http://localhost/',
              body() {
                return Buffer.from('hello');
              }
            }),
          'not to error'
        );
      });

      describe('when a stream is returned', () => {
        it('should send a single request', () => {
          httpception({
            request: {
              url: 'PUT http://localhost/',
              body: /^Copyright/
            }
          });

          return expect(
            () =>
              teepee({
                url: 'PUT http://localhost/',
                headers: {
                  'Content-Type': 'text/plain; charset=UTF-8'
                },
                body() {
                  return fs.createReadStream(
                    pathModule.resolve(__dirname, '..', 'LICENSE')
                  );
                }
              }),
            'not to error'
          );
        });

        it('should support retrying', () => {
          httpception([
            {
              request: {
                url: 'PUT http://localhost/',
                body: /^Copyright/
              },
              response: 504
            },
            {
              request: {
                url: 'PUT http://localhost/',
                body: /^Copyright/
              },
              response: 200
            }
          ]);

          return teepee({
            url: 'PUT http://localhost/',
            headers: {
              'Content-Type': 'text/plain; charset=UTF-8'
            },
            numRetries: 1,
            retry: '504',
            body() {
              return fs.createReadStream(
                pathModule.resolve(__dirname, '..', 'LICENSE')
              );
            }
          });
        });
      });
    });

    describe('when the return value is used as a thenable', () => {
      it('should succeed', () => {
        httpception({
          request: 'GET http://localhost/',
          response: 200
        });

        return teepee('http://localhost/');
      });

      it('should fail', () => {
        httpception({
          request: 'GET http://localhost/',
          response: 404
        });

        return expect(
          () => teepee('http://localhost/'),
          'to error',
          new HttpError.NotFound()
        );
      });
    });

    it('should instantiate an HttpError error if an unmapped status code is returned from the server', () => {
      httpception({
        response: 598
      });

      return expect(
        () => teepee('http://foo.com/'),
        'to error',
        new HttpError(598)
      );
    });
  });

  describe('with a request timeout', () => {
    describe('passed to the request method', () => {
      it('should abort the request and emit an error if no response has been received before the timeout', () =>
        expect(cb => {
          new Teepee('http://www.gofish.dk/')
            .request({ timeout: 1 })
            .on('error', err => {
              expect(err, 'to equal', new SocketError.ETIMEDOUT());
              cb();
            });
        }, 'to call the callback without error'));
    });

    describe('passed to the constructor method', () => {
      it('should abort the request and emit an error if no response has been received before the timeout', () =>
        expect(cb => {
          new Teepee({ url: 'http://www.gofish.dk/', timeout: 1 })
            .request()
            .on('error', err => {
              expect(err, 'to equal', new SocketError.ETIMEDOUT());
              cb();
            });
        }, 'to call the callback without error'));
    });
  });

  describe('retrying on failure', () => {
    it('should return a successful response when a failed GET is retried `numRetries` times with a successful last attempt', () => {
      httpception([
        { response: new SocketError.ETIMEDOUT() },
        { response: new SocketError.ETIMEDOUT() },
        { response: 200 }
      ]);

      return expect(cb => {
        new Teepee('http://localhost:5984/').request(
          { path: 'foo', numRetries: 2 },
          cb
        );
      }, 'to call the callback without error');
    });

    it('should return the response associated with the eventually successful request', () => {
      httpception([
        {
          response: {
            statusCode: 504,
            headers: { Foo: 'bar' },
            body: Buffer.from('foo')
          }
        },
        {
          response: {
            statusCode: 200,
            headers: { Foo: 'quux' },
            body: Buffer.from('quux')
          }
        }
      ]);

      return expect(cb => {
        new Teepee('http://localhost:5984/').request(
          { numRetries: 2, retry: 504 },
          cb
        );
      }, 'to call the callback without error').spread((response, body) => {
        expect(response.body, 'to equal', Buffer.from('quux'));
        expect(response.headers.foo, 'to equal', 'quux');
        expect(body, 'to equal', Buffer.from('quux'));
      });
    });

    it('should not retry a request that receives a response if the specific status code is not listed in the retry array', () => {
      httpception({ response: 503 });

      return expect(
        cb => {
          new Teepee('http://localhost:5984/').request(
            { path: 'foo', numRetries: 2 },
            cb
          );
        },
        'to call the callback with error',
        new HttpError.ServiceUnavailable()
      );
    });

    it('should retry a request that times out while buffering up the response', () => {
      const requestHandler = sinon.spy((req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=UTF-8'
        });
        res.write('Foo');
        if (requestHandler.callCount > 1) {
          res.end('Bar');
        }
      });
      const server = http.createServer(requestHandler).listen(0);
      const serverAddress = server.address();
      const serverHostname =
        serverAddress.address === '::' ? 'localhost' : serverAddress.address;
      const url = `http://${serverHostname}:${serverAddress.port}/`;

      return expect(cb => {
        teepee({ url, numRetries: 1, timeout: 20 }, cb);
      }, 'to call the callback without error')
        .spread((response, body) => {
          expect(body, 'to equal', Buffer.from('FooBar'));
          expect(requestHandler, 'was called twice');
        })
        .finally(() => {
          server.close();
        });
    });

    it('should emit a retriedRequest every time a request is retried', () => {
      httpception([
        { response: new SocketError.ETIMEDOUT() },
        { response: 501 },
        { response: 200 }
      ]);

      const teepee = new Teepee('http://localhost:1234/');
      const successfulRequestListener = sinon
        .spy()
        .named('successfulRequestListener');
      const failedRequestListener = sinon.spy().named('failedRequestListener');
      const retriedRequestListener = sinon
        .spy()
        .named('retriedRequestListener');
      teepee
        .on('failedRequest', failedRequestListener)
        .on('successfulRequest', successfulRequestListener)
        .on('retriedRequest', retriedRequestListener);
      return expect(cb => {
        teepee.request({ path: 'foo', numRetries: 2, retry: [501] }, cb);
      }, 'to call the callback without error').then(() => {
        expect(
          [
            failedRequestListener,
            successfulRequestListener,
            retriedRequestListener
          ],
          'to have calls satisfying',
          () => {
            retriedRequestListener({
              numRetriesLeft: 1,
              err: new SocketError.ETIMEDOUT(),
              requestOptions: { host: 'localhost' } // ...
            });
            retriedRequestListener({
              numRetriesLeft: 0,
              err: new HttpError.NotImplemented(),
              requestOptions: { host: 'localhost' } // ...
            });
            successfulRequestListener(expect.it('to be an object'));
          }
        );
      });
    });

    it('should give up if the request fails 1 + `numRetries` times', () => {
      httpception([
        { response: new SocketError.ETIMEDOUT() },
        { response: new SocketError.ETIMEDOUT() },
        { response: new SocketError.ETIMEDOUT() }
      ]);

      return expect(
        cb => {
          new Teepee('http://localhost:5984/').request(
            { path: 'foo', numRetries: 2 },
            cb
          );
        },
        'to call the callback with error',
        new SocketError.ETIMEDOUT()
      );
    });

    it('should not attempt to retry a request with the body given as a stream, despite a `numRetries` setting', () => {
      httpception({
        response: new SocketError.ETIMEDOUT()
      });

      return expect(
        cb => {
          new Teepee('http://localhost:5984/').request(
            {
              method: 'POST',
              body: fs.createReadStream(
                pathModule.resolve(__dirname, '..', 'testdata', '0byte')
              ),
              path: 'foo',
              numRetries: 2
            },
            cb
          );
        },
        'to call the callback with error',
        new SocketError.ETIMEDOUT()
      );
    });

    describe('with the retryDelayMilliseconds option', () => {
      beforeEach(() => {
        sandbox.spy(
          typeof window !== 'undefined' ? window : global,
          'setTimeout'
        );
      });

      describe('when passed to the constructor', () => {
        it('waits that many milliseconds before retrying', () => {
          httpception([
            { response: new SocketError.ETIMEDOUT() },
            { response: 200 }
          ]);

          return expect(
            () =>
              new Teepee({
                url: 'http://localhost:5984/',
                retryDelayMilliseconds: 3,
                numRetries: 1
              }).request(),
            'not to error'
          ).then(() => {
            expect(sandbox, 'to have a call satisfying', () => {
              setTimeout(expect.it('to be a function'), 3);
            });
          });
        });
      });

      describe('when passed to the request function', () => {
        it('waits that many milliseconds before retrying', () => {
          httpception([
            { response: new SocketError.ETIMEDOUT() },
            { response: 200 }
          ]);

          return expect(
            cb =>
              new Teepee('http://localhost:5984/').request({
                path: 'foo',
                numRetries: 1,
                retryDelayMilliseconds: 3
              }),
            'not to error'
          ).then(() => {
            expect(setTimeout, 'to have a call satisfying', () => {
              setTimeout(expect.it('to be a function'), 3);
            });
          });
        });
      });
    });

    describe('with the retry option', () => {
      describe('with an array', () => {
        it('should retry a non-successful request if the HTTP status code is in the array', () => {
          httpception([
            { response: 504 },
            { response: 504 },
            { response: 200 }
          ]);

          return expect(cb => {
            new Teepee('http://localhost:5984/').request(
              { path: 'foo', numRetries: 2, retry: [504] },
              cb
            );
          }, 'to call the callback without error');
        });

        it('should not retry an unsuccessful request if the HTTP status code is in the array, but there is a request event listener', () => {
          httpception({ response: 504 });

          return expect(
            cb => {
              new Teepee({
                url: 'http://localhost:5984/',
                // The mitm module emits events synchronously, which means that we don't get to add the request listener
                // before the mock response has already been received. This hack ensures that the response is delayed
                // until the next tick as it will be when we're using the http module. I'd rather do this here than in
                // the code itself to avoid waiting an extra tick for all requests:
                preprocessRequestOptions(requestOptions, options, cb) {
                  setImmediate(cb);
                }
              })
                .request({ path: 'foo', numRetries: 2, retry: [504] }, cb)
                .on('request', request => {});
            },
            'to call the callback with error',
            new HttpError.GatewayTimeout()
          );
        });

        it('should not retry an unsuccessful request if the HTTP status code is not in the array', () => {
          httpception({ response: 503 });

          return expect(
            cb => {
              new Teepee('http://localhost:5984/').request(
                { path: 'foo', numRetries: 2, retry: [504] },
                cb
              );
            },
            'to call the callback with error',
            new HttpError.ServiceUnavailable()
          );
        });

        it('should retry a non-successful request if the HTTP status code is covered by a "wildcard"', () => {
          httpception([
            { response: 404 },
            { response: 504 },
            { response: 520 },
            { response: 412 }
          ]);

          return expect(
            cb => {
              new Teepee('http://localhost:5984/').request(
                { path: 'foo', numRetries: 4, retry: ['5xx', '40x'] },
                cb
              );
            },
            'to call the callback with error',
            new HttpError.PreconditionFailed()
          );
        });

        it('should retry an unsuccessful request if "httpError" is in the retry array', () => {
          httpception([{ response: 503 }, { response: 200 }]);

          return expect(cb => {
            new Teepee('http://localhost:5984/').request(
              { path: 'foo', numRetries: 2, retry: ['httpError'] },
              cb
            );
          }, 'to call the callback without error');
        });

        it('should retry an unsuccessful request if retry has a value of "httpError"', () => {
          httpception([{ response: 503 }, { response: 200 }]);

          return expect(cb => {
            new Teepee('http://localhost:5984/').request(
              { path: 'foo', numRetries: 2, retry: ['httpError'] },
              cb
            );
          }, 'to call the callback without error');
        });

        describe('when retrying on self-redirect is enabled', () => {
          it('should retry a 301 self-redirect', () => {
            httpception([
              {
                response: {
                  statusCode: 301,
                  headers: { Location: 'http://localhost:5984/' },
                  body: Buffer.from('hey')
                }
              },
              {
                response: {
                  statusCode: 200,
                  headers: { Foo: 'quux' },
                  body: Buffer.from('there')
                }
              }
            ]);

            return expect(cb => {
              new Teepee('http://localhost:5984/').request(
                { numRetries: 1, retry: 'selfRedirect' },
                cb
              );
            }, 'to call the callback without error').spread(
              (response, body) => {
                expect(body, 'to equal', Buffer.from('there'));
                expect(
                  response,
                  'to have property',
                  'body',
                  Buffer.from('there')
                );
              }
            );
          });

          it('should emit a retry event with a SelfRedirectError', () => {
            httpception([
              {
                response: {
                  statusCode: 301,
                  headers: { Location: 'http://localhost:5984/#foo' }
                }
              },
              { response: 200 }
            ]);

            const retriedRequestListener = sinon
              .spy()
              .named('retriedRequestListener');
            return expect(cb => {
              const teepee = new Teepee('http://localhost:5984/');
              teepee.on('retriedRequest', retriedRequestListener);
              teepee.request({ numRetries: 1, retry: 'selfRedirect' }, cb);
            }, 'to call the callback without error').then(() => {
              expect(retriedRequestListener, 'to have calls satisfying', () => {
                retriedRequestListener({
                  url: 'http://localhost:5984/',
                  requestOptions: {
                    // ...
                    host: 'localhost',
                    port: 5984,
                    method: 'GET'
                  },
                  err: {
                    name: 'SelfRedirect',
                    data: {
                      location: 'http://localhost:5984/#foo'
                    }
                  }
                });
              });
            });
          });

          it('should retry a 302 self-redirect', () => {
            httpception([
              {
                response: {
                  statusCode: 302,
                  headers: { Location: 'http://localhost:5984/' }
                }
              },
              { response: 200 }
            ]);

            return expect(cb => {
              new Teepee('http://localhost:5984/').request(
                { numRetries: 1, retry: 'selfRedirect' },
                cb
              );
            }, 'to call the callback without error');
          });

          it('should not retry a 303 self-redirect', () => {
            httpception({
              response: {
                statusCode: 303,
                headers: { Location: 'http://localhost:5984/' }
              }
            });

            return expect(cb => {
              new Teepee('http://localhost:5984/').request(
                { numRetries: 1, retry: 'selfRedirect' },
                cb
              );
            }, 'to call the callback without error');
          });

          it('should retry a 301 self-redirect when the urls are the same', () => {
            httpception([
              {
                response: {
                  statusCode: 301,
                  headers: { Location: 'http://localhost:5984/' }
                }
              },
              { response: 200 }
            ]);

            return expect(cb => {
              new Teepee('http://localhost:5984/').request(
                { numRetries: 1, retry: 'selfRedirect' },
                cb
              );
            }, 'to call the callback without error');
          });

          it('should retry a 301 self-redirect even when the urls differ by document fragment', () => {
            httpception([
              {
                response: {
                  statusCode: 301,
                  headers: { Location: 'http://localhost:5984/#bar' }
                }
              },
              { response: 200 }
            ]);

            return expect(cb => {
              new Teepee('http://localhost:5984/#foo').request(
                { numRetries: 1, retry: 'selfRedirect' },
                cb
              );
            }, 'to call the callback without error');
          });

          it('should not fail if an invalid url is received in the Location header', () => {
            httpception({
              response: { statusCode: 301, headers: { Location: 'vqwe' } }
            });

            return expect(cb => {
              new Teepee('http://localhost:5984/').request(
                { numRetries: 1, retry: 'selfRedirect' },
                cb
              );
            }, 'to call the callback without error');
          });
        });
      });
    });
  });

  it('should handle ECONNREFUSED', () => {
    httpception({
      response: new SocketError.ECONNREFUSED('connect ECONNREFUSED')
    });

    return expect(
      cb => {
        new Teepee('http://localhost:5984/').request('foo', cb);
      },
      'to call the callback with error',
      new SocketError.ECONNREFUSED('connect ECONNREFUSED')
    );
  });

  it('should handle unknown errors', () => {
    const error = new Error('something else');

    httpception({
      response: error
    });

    return expect(
      cb => {
        new Teepee('http://localhost:5984/').request('foo', cb);
      },
      'to call the callback with error',
      new HttpError[500](error.message)
    );
  });

  describe('with a streamed response', () => {
    it('should handle simple response stream', () => {
      const responseStream = new stream.Readable();
      responseStream._read = () => {
        responseStream.push(Buffer.from(JSON.stringify({ a: 1, b: 2 })));
        responseStream.push(null);
      };

      httpception({
        request: {
          url: 'GET http://localhost:5984/foo'
        },
        response: {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json'
          },
          body: responseStream
        }
      });

      return expect(cb => {
        new Teepee('http://localhost:5984/').request('foo', cb);
      }, 'to call the callback without error');
    });

    it('should allow any valid formulation of application/json', () => {
      const responseObject = {
        foo: 'bar'
      };
      const responseStream = new stream.Readable();
      responseStream._read = () => {
        responseStream.push(Buffer.from(JSON.stringify(responseObject)));
        responseStream.push(null);
      };

      httpception({
        request: {
          url: 'GET http://localhost:5984/foo'
        },
        response: {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf8'
          },
          body: responseStream
        }
      });

      return expect(cb => {
        new Teepee('http://localhost:5984/').request('foo', cb);
      }, 'to call the callback without error').spread((response, body) =>
        expect(body, 'to equal', responseObject)
      );
    });

    it('should not attempt to parse an application/json response body when the request method is HEAD', () => {
      httpception({
        response: {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf8'
          }
        }
      });

      return teepee('HEAD http://localhost:5984/');
    });

    it('should not attempt to parse an application/json response body when json: false is passed', () => {
      httpception({
        response: {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf8'
          },
          body: {
            foo: 123
          }
        }
      });

      return teepee({ url: 'http://localhost:5984/', json: false }).then(
        response => {
          expect(response.body, 'to equal', Buffer.from('{"foo":123}'));
        }
      );
    });

    it('should throw an error on invalid JSON', () => {
      const responseStream = new stream.Readable();
      responseStream._read = () => {
        responseStream.push(Buffer.from('{]'));
        responseStream.push(null);
      };

      httpception({
        request: {
          url: 'GET http://localhost:5984/foo'
        },
        response: {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json'
          },
          body: responseStream
        }
      });

      return expect(
        cb => {
          new Teepee('http://localhost:5984/').request('foo', cb);
        },
        'to call the callback with error',
        new HttpError.BadGateway('Error parsing JSON response body')
      );
    });
  });

  describe('with a query', () => {
    it('should allow specifying the query string as a string', () => {
      httpception({
        request: 'GET http://localhost:5984/bar/quux?blabla',
        response: 200
      });

      return expect(cb => {
        new Teepee('http://localhost:5984/').request(
          { path: 'bar/quux', query: 'blabla' },
          cb
        );
      }, 'to call the callback without error');
    });

    it('should treat an empty string as a no-op', () => {
      httpception({
        request: 'GET http://localhost:5984/bar/quux',
        response: 200
      });

      return expect(cb => {
        new Teepee('http://localhost:5984/').request(
          { path: 'bar/quux', query: '' },
          cb
        );
      }, 'to call the callback without error');
    });

    describe('when specifying the query string as an object', () => {
      it('should url encode the parameter names and values and omit parameters with undefined values', () => {
        httpception({
          request:
            'GET http://localhost:5984/bar/quux' +
            '?ascii=blabla' +
            '&n%C3%B8nasc%C3%AF%C3%AE=n%C3%B8nasc%C3%AF%C3%AE' +
            '&multiple=foo' +
            '&multiple=n%C3%B8nasc%C3%AF%C3%AE',
          response: 200
        });

        return expect(cb => {
          new Teepee('http://localhost:5984/').request(
            {
              path: 'bar/quux',
              query: {
                ascii: 'blabla',
                nønascïî: 'nønascïî',
                multiple: ['foo', 'nønascïî'],
                iAmUndefined: undefined
              }
            },
            cb
          );
        }, 'to call the callback without error');
      });

      it('should not add a ? or & to the url when every parameter has an undefined value', () => {
        httpception({
          request: 'GET http://localhost:5984/',
          response: 200
        });

        return new Teepee('http://localhost:5984/').request({
          query: { iAmUndefined: undefined }
        });
      });
    });
  });

  describe('with a url containing placeholders', () => {
    it('should substitute a placeholder with a value found in the options object passed to request (and prefer it over an identically named one passed to the constructor)', () => {
      httpception({
        request: 'http://example.com.contacts/foo/hey'
      });

      const teepee = new Teepee({
        domainName: 'the.wrong.one',
        url: 'http://{domainName}.contacts/foo/'
      });

      return expect(cb => {
        teepee.request(
          {
            domainName: 'example.com',
            path: 'hey'
          },
          cb
        );
      }, 'to call the callback without error');
    });

    it('should substitute a complex expression in a placeholder', () => {
      httpception([
        { request: 'http://couchdb3.example.com/contacts0/hey' },
        { request: 'http://couchdb4.example.com/contacts1/there' }
      ]);

      const teepee = new Teepee({
        url:
          'http://couchdb{{partitionNumber} === 0 ? 3 : 4}.example.com/contacts{partitionNumber}',
        partitionPoints: ['info']
      });

      teepee.partitionNumber = function(requestOptions) {
        const key = requestOptions.domainName
          .split('.')
          .reverse()
          .join('.');
        let databaseNumber = 0;
        for (let i = 0; i < this.partitionPoints.length; i += 1) {
          if (key >= this.partitionPoints[i]) {
            databaseNumber += 1;
          } else {
            break;
          }
        }
        return databaseNumber;
      };

      return expect(cb => {
        teepee.request(
          {
            domainName: 'example.com',
            path: 'hey'
          },
          err => {
            if (err) {
              throw err;
            }
            teepee.request(
              {
                domainName: 'example.info',
                path: 'there'
              },
              cb
            );
          }
        );
      }, 'to call the callback without error');
    });

    it('should support passing a falsy value in request options', () => {
      httpception({
        request: 'http://couchdb3.example.com/contacts0/hey'
      });

      const teepee = new Teepee({
        url:
          'http://couchdb{{partitionNumber} === 0 ? 3 : 4}.example.com/contacts{partitionNumber}',
        partitionPoints: ['info']
      });
      return expect(cb => {
        teepee.request(
          {
            partitionNumber: 0,
            path: 'hey'
          },
          cb
        );
      }, 'to call the callback without error');
    });

    it('should substitute a placeholder with a value found in the options object passed to the constructor', () => {
      httpception({
        request: 'http://example.com.contacts/foo/hey'
      });

      const teepee = new Teepee({
        domainName: 'example.com',
        url: 'http://{domainName}.contacts/foo/'
      });

      return expect(cb => {
        teepee.request({ path: 'hey' }, cb);
      }, 'to call the callback without error');
    });

    it('should substitute a placeholder with the result of calling a function of that name passed to the request method', () => {
      httpception({
        request: 'http://example.com.contacts/foo/hey'
      });

      const teepee = new Teepee({
        domainName(requestOptions, placeholderName) {
          return requestOptions.owner.replace(/^.*@/, '');
        },
        url: 'http://{domainName}.contacts/foo/'
      });

      return expect(cb => {
        teepee.request({ path: 'hey', owner: 'andreas@example.com' }, cb);
      }, 'to call the callback without error');
    });
  });

  describe('with a client certificate and related properties', () => {
    const zero = Buffer.from([0]);
    const one = Buffer.from([1]);
    const two = Buffer.from([2]);
    const three = Buffer.from([3]);

    describe('specified as Buffer instances', () => {
      const teepee = new Teepee({
        cert: zero,
        key: one,
        ca: two,
        url: 'https://example.com:5984/'
      });
      it('should expose the cert, key, and ca options on the instance', () => {
        expect(teepee, 'to satisfy', {
          cert: zero,
          key: one,
          ca: two
        });
      });

      it('should make connections using the client certificate', () => {
        httpception({
          request: {
            encrypted: true,
            url: 'GET /foo',
            cert: zero,
            key: one,
            ca: two
          }
        });

        return expect(cb => {
          teepee.request('foo', cb);
        }, 'to call the callback without error');
      });
    });

    describe('specified as strings and arrays', () => {
      const teepee = new Teepee({
        cert: pathModule.resolve(__dirname, '..', 'testdata', '0byte'),
        key: pathModule.resolve(__dirname, '..', 'testdata', '1byte'),
        ca: [
          pathModule.resolve(__dirname, '..', 'testdata', '2byte'),
          pathModule.resolve(__dirname, '..', 'testdata', '3byte')
        ],
        url: 'https://example.com:5984/'
      });

      it('should interpret the options as file names and expose the loaded cert, key, and ca options on the instance', () => {
        expect(teepee, 'to satisfy', {
          cert: zero,
          key: one,
          ca: [two, three]
        });
      });

      it('should make connections using the client certificate', () => {
        httpception({
          request: {
            encrypted: true,
            url: 'GET /foo',
            cert: zero,
            key: one,
            ca: [two, three]
          }
        });

        return expect(cb => {
          teepee.request('foo', cb);
        }, 'to call the callback without error');
      });
    });
  });

  describe('with a connection pool', () => {
    it('should not exhaust the pool on HTTP error status', function() {
      const server = require('http').createServer((req, res) => {
        res.statusCode = 404;
        res.end();
      });
      const timeoutLimit = this.timeout() - 200;
      server.listen();

      const teepee = new Teepee({
        url: `http://localhost:${server.address().port}/`,
        agent: true,
        maxSockets: 1
      });

      function cleanUp() {
        server.close();
      }

      function makeRequest() {
        return expect.promise(run => {
          const done = run(() => {});

          teepee.request('foo', done);
        });
      }

      return expect
        .promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('connection pool exhausted'));
          }, timeoutLimit);

          // make more parallel teepee requests than we set maxSockets
          expect.promise
            .settle([makeRequest(), makeRequest(), makeRequest()])
            .then(() => {
              clearTimeout(timeout);
              resolve();
            });
        })
        .then(cleanUp);
    });

    it('should not exhaust the pool on HTTP 304 and a response handler is attached', function() {
      const server = require('http').createServer((req, res) => {
        res.statusCode = 304;
        res.end();
      });
      const timeoutLimit = this.timeout() - 200;
      server.listen();

      const teepee = new Teepee({
        url: `http://localhost:${server.address().port}/`,
        agent: true,
        maxSockets: 1
      });

      function cleanUp() {
        server.close();
      }

      function makeRequest() {
        return expect.promise(run => {
          const done = run(() => {});

          teepee.request('foo').on('response', response => {
            done();
          });
        });
      }

      return expect
        .promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('connection pool exhausted'));
          }, timeoutLimit);

          // make more parallel teepee requests than we set maxSockets
          expect.promise.settle([makeRequest(), makeRequest()]).then(() => {
            clearTimeout(timeout);
            resolve();
          });
        })
        .then(cleanUp);
    });

    it('should not resume a 304 response if it is piped', () => {
      httpception({
        request: 'GET /',
        response: {
          statusCode: 304,
          body: Buffer.from([0, 1, 2])
        }
      });

      let resumeSpy;
      return expect(cb => {
        teepee('http://example.com/').on('response', response => {
          response.pipe(new zlib.Gzip());
          resumeSpy = sinon.spy(response, 'resume');
          setImmediate(cb);
        });
      }, 'to call the callback without error').then(() => {
        expect(resumeSpy, 'was not called');
      });
    });

    it('should not exhaust the pool on HTTP error status when the EventEmitter-based interface is used', function() {
      const server = require('http').createServer((req, res) => {
        res.statusCode = 404;
        res.end();
      });
      const timeoutLimit = this.timeout() - 200;
      server.listen();

      const teepee = new Teepee({
        url: `http://localhost:${server.address().port}/`,
        agent: true,
        maxSockets: 1
      });

      function cleanUp() {
        server.close();
      }

      function makeRequest() {
        return expect.promise(run => {
          teepee.request('foo').on('error', run(() => {}));
        });
      }

      return expect
        .promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('connection pool exhausted'));
          }, timeoutLimit);

          // make more parallel teepee requests than we set maxSockets
          expect.promise
            .settle([makeRequest(), makeRequest(), makeRequest()])
            .then(() => {
              clearTimeout(timeout);
              resolve();
            });
        })
        .then(cleanUp);
    });
  });

  describe('with a username and password passed to the constructor', () => {
    it('should use them as basic auth credentials', () => {
      httpception({
        request: {
          url: 'https://localhost:4232/',
          headers: {
            Authorization: 'Basic Zm9vYmFyOnF1dXg=' // foobar:quux
          }
        },
        response: 200
      });

      return expect(
        cb =>
          new Teepee({
            username: 'foobar',
            password: 'quux',
            url: 'https://localhost:4232/'
          }).request(cb),
        'to call the callback without error'
      );
    });
  });

  describe('with a username and password passed to the request method', () => {
    it('should use them as basic auth credentials', () => {
      httpception({
        request: {
          url: 'https://localhost:4232/',
          headers: {
            Authorization: 'Basic Zm9vYmFyOnF1dXg=' // foobar:quux
          }
        },
        response: 200
      });

      return expect(
        cb =>
          new Teepee('https://localhost:4232/').request(
            { username: 'foobar', password: 'quux' },
            cb
          ),
        'to call the callback without error'
      );
    });
  });

  describe('with a username and password in the url', () => {
    it('should use them as basic auth credentials', () => {
      httpception({
        request: {
          url: 'https://localhost:4232/',
          headers: {
            Authorization: 'Basic Zm9vYmFyOnF1dXg='
          }
        },
        response: 200
      });

      return expect(cb => {
        teepee('https://foobar:quux@localhost:4232/', cb);
      }, 'to call the callback without error');
    });

    it('should support percent-encoded octets, including colons, and a non-encoded colon in the password', () => {
      httpception({
        request: {
          url: 'http://localhost:4232/',
          headers: {
            Authorization: 'Basic Zm/Dpm8lYmFyOmJheiVxdXV4OnlhZGRh'
          }
        },
        response: 200
      });

      return expect(cb => {
        teepee('http://fo%C3%A6o%25bar:baz%25quux:yadda@localhost:4232/', cb);
      }, 'to call the callback without error');
    });

    it('should leave all percent encoded octets in the username if one of them does not decode as UTF-8', () => {
      httpception({
        request: {
          url: 'http://localhost:4232/',
          headers: {
            Authorization:
              'Basic Zm8lQzMlQTZvJTI1YmFyJUMzOmJhesOmcXV1eDp5YWRkYQ=='
          }
        },
        response: 200
      });

      return expect(cb => {
        teepee(
          'http://fo%C3%A6o%25bar%C3:baz%C3%A6quux:yadda@localhost:4232/',
          cb
        );
      }, 'to call the callback without error');
    });
  });

  describe('when invoked without new', () => {
    it('should perform a request directly', () => {
      httpception({
        request: 'GET http://localhost:8000/',
        response: 200
      });

      return expect(cb => {
        teepee('https://localhost:8000/', cb);
      }, 'to call the callback without error');
    });

    it('should assume http:// if no protocol is provided', () => {
      httpception({
        request: 'GET http://localhost:1234/',
        response: 200
      });

      return teepee('localhost:1234/');
    });

    it('should accept the method before the url', () => {
      httpception({
        request: 'POST http://localhost:8000/',
        response: 200
      });

      return expect(cb => {
        teepee('POST https://localhost:8000/', cb);
      }, 'to call the callback without error');
    });

    // Regression test
    it('should allow specifying a request body', () => {
      httpception({
        request: {
          url: 'POST http://localhost:5984/',
          headers: {
            'Content-Type': 'application/json'
          },
          body: { what: 'gives' }
        },
        response: 200
      });

      return expect(cb => {
        teepee(
          {
            url: 'http://localhost:5984/',
            method: 'POST',
            body: { what: 'gives' }
          },
          cb
        );
      }, 'to call the callback without error');
    });
  });

  expect.addAssertion(
    '<array> to result in request <string|object>',
    (expect, subject, value) => {
      httpception({
        request: value,
        response: 200
      });

      return expect(
        cb => new Teepee(subject[0]).request(subject[1], cb),
        'to call the callback without error'
      );
    }
  );

  describe('url resolution', () => {
    describe('when the base url has a trailing slash', () => {
      it('should resolve a request url without a leading slash', () =>
        expect(
          ['http://localhost/foo/', 'bar'],
          'to result in request',
          'http://localhost/foo/bar'
        ));

      it('should resolve a request url with a leading slash', () =>
        expect(
          ['http://localhost/foo/', '/bar'],
          'to result in request',
          'http://localhost/foo/bar'
        ));
    });

    describe('when the base url has no trailing slash', () => {
      it('should resolve a request url without a leading slash', () =>
        expect(
          ['http://localhost/foo', 'bar'],
          'to result in request',
          'http://localhost/foo/bar'
        ));

      it('should resolve a request url with a leading slash', () =>
        expect(
          ['http://localhost/foo', '/bar'],
          'to result in request',
          'http://localhost/foo/bar'
        ));
    });

    describe('with a protocol-relative request url', () => {
      it('should keep the protocol from the base url, but take everything else from the request url', () =>
        expect(
          ['https://localhost/foo', '//example.com/baz'],
          'to result in request',
          'https://example.com/baz'
        ));

      it('should not use basic auth credentials from the base url', () =>
        expect(
          ['https://foo@bar:localhost/foo', '//example.com/baz'],
          'to result in request',
          {
            headers: {
              Authorization: undefined
            }
          }
        ));
    });

    describe('with an absolute request url', () => {
      it('should ignore the base url', () =>
        expect(
          ['https://foo@bar:localhost/foo', 'http://example.com/baz'],
          'to result in request',
          {
            url: 'http://example.com/baz',
            headers: {
              Authorization: undefined
            }
          }
        ));
    });

    describe('without a base url', () => {
      it('should not accept a non-absolute request url', () =>
        expect(
          () => {
            new Teepee().request('foo');
          },
          'to error',
          new Error(
            'An absolute request url must be given when no base url is available'
          )
        ));
    });

    it('#request should accept a url option as an alias for path', () => {
      httpception({
        request: 'http://localhost:8000/bar',
        response: 200
      });

      return expect(cb => {
        new Teepee('https://localhost:8000/').request({ url: 'bar' }, cb);
      }, 'to call the callback without error');
    });
  });

  describe('#subsidiary()', () => {
    it('should use the same agent instance as the parent', () => {
      const teepee = new Teepee('http://www.foo.com/');
      const subsidiary = teepee.subsidiary('http://www.example.com/');
      expect(teepee.getAgent('http'), 'to be', subsidiary.getAgent('http'));
    });

    it('should accept a string which will override the url', () => {
      const teepee = new Teepee('http://quux.com:123/');
      const subsidiary = teepee.subsidiary('http://foo:bar@baz.com:123/');
      expect(teepee.url, 'to equal', 'http://quux.com:123/');
      expect(subsidiary.url, 'to equal', 'http://foo:bar@baz.com:123/');
    });

    it('should accept an options object, which will override the options from the main instance', () => {
      const teepee = new Teepee({ foo: 123, url: 'http://quux.com:123/' });
      const subsidiary = teepee.subsidiary({
        foo: 456,
        url: 'http://foo:bar@baz.com:123/'
      });
      expect(subsidiary, 'to satisfy', {
        url: 'http://foo:bar@baz.com:123/',
        foo: 456
      });
    });

    it('should clone the default headers from the parent', () => {
      const teepee = new Teepee({ headers: { foo: 'bar' } });
      const subsidiary = teepee.subsidiary();
      expect(subsidiary.headers, 'to equal', { foo: 'bar' });
      expect(subsidiary.headers, 'not to be', teepee.headers);
    });

    it('should merge the headers with those of the parent instance, preferring the ones passed to .subsidiary()', () => {
      const teepee = new Teepee({ headers: { foo: 'bar', baz: 'quux' } });
      const subsidiary = teepee.subsidiary({ headers: { foo: 'blah' } });
      expect(subsidiary.headers, 'to equal', { foo: 'blah', baz: 'quux' });
      expect(teepee.headers, 'to equal', { foo: 'bar', baz: 'quux' });
      expect(subsidiary.headers, 'not to be', teepee.headers);
    });

    it('should inherit numRetries from the parent', () => {
      const teepee = new Teepee({ numRetries: 99 });
      const subsidiary = teepee.subsidiary();
      expect(subsidiary.numRetries, 'to equal', 99);
    });

    it('should produce an instance that echoes events to the parent', () => {
      httpception([{ response: 200 }, { response: 200 }]);

      const teepee = new Teepee('http://localhost:1234/');
      const subsidiary = teepee.subsidiary('http://localhost:4567/');
      const subsidiaryRequestListener = sinon
        .spy()
        .named('subsidiaryRequestListener');
      const requestListener = sinon.spy().named('requestListener');

      teepee.on('request', requestListener);
      subsidiary.on('request', subsidiaryRequestListener);

      return expect(cb => {
        subsidiary.request(
          passError(cb, () => {
            teepee.request(cb);
          })
        );
      }, 'to call the callback without error').then(() => {
        expect(
          [subsidiaryRequestListener, requestListener],
          'to have calls satisfying',
          () => {
            subsidiaryRequestListener(expect.it('to be an object'));
            requestListener({ requestOptions: { port: 4567 } });
            requestListener({ requestOptions: { port: 1234 } });
          }
        );
      });
    });

    describe('with a Teepee subclass', () => {
      function Wigwam(config) {
        Teepee.call(this, config);
      }
      util.inherits(Wigwam, Teepee);

      it('should produce an instance of the subclass', () => {
        expect(new Wigwam().subsidiary(), 'to be a', Wigwam);
      });
    });
  });

  describe('with a custom preprocessQueryStringParameterValue', () => {
    it('should use the value returned by the function', () => {
      httpception({
        request: 'http://www.google.com/?foo=bogus'
      });

      sandbox
        .stub(Teepee.prototype, 'preprocessQueryStringParameterValue')
        .returns('bogus');
      return teepee({
        url: 'http://www.google.com/',
        query: { foo: 'bar' }
      }).then(() => {
        expect(
          Teepee.prototype.preprocessQueryStringParameterValue,
          'to have calls satisfying',
          () => {
            Teepee.prototype.preprocessQueryStringParameterValue('bar', 'foo');
          }
        );
      });
    });
  });

  describe('with preprocessRequestOptions', () => {
    it('should allow overriding the protocol, host, port, path, and headers', () => {
      httpception({
        request: {
          url: 'https://someotherexample.com:1234/alternativePath',
          headers: {
            Host: 'example.com' // This might be a bit unintutive
          }
        },
        response: 200
      });

      const teepee = new Teepee('http://example.com/foo', {
        headers: { Foo: 'bar' }
      });
      teepee.preprocessRequestOptions = (requestOptions, options, cb) => {
        requestOptions.protocol = 'https';
        requestOptions.port = 1234;
        requestOptions.host = 'someotherexample.com';
        requestOptions.path = '/alternativePath';
        setImmediate(cb);
      };
      return expect(cb => {
        teepee.request(cb);
      }, 'to call the callback without error');
    });
  });

  it('should support passing the response stream as the request body for a subsequent request', () => {
    httpception([
      {
        request: 'GET http://example.com/',
        response: { body: Buffer.from('abcdef') }
      },
      {
        request: {
          url: 'PUT http://somewhereelse.com/',
          body: Buffer.from('abcdef')
        },
        response: 200
      }
    ]);

    return expect(cb => {
      teepee('http://example.com/').on('success', response => {
        teepee(
          { url: 'http://somewhereelse.com/', method: 'PUT', body: response },
          cb
        );
      });
    }, 'to call the callback without error');
  });

  it('should map DNS errors to DnsError instances', () =>
    expect(
      teepee('http://qwcoviejqocejqkwoiecjkqwoiejckqowiejckqoiwejckqowec.com/'),
      'when rejected to be a',
      DnsError
    ));

  it('should allow calling .then() more than once', () => {
    httpception({ require: 'http://foo.com/' });

    return expect(cb => {
      const request = teepee('http://foo.com/');
      request.then(() => {});
      request.then(() => {});
    }, 'not to throw');
  });

  it('should map socket errors to SocketError instances', () =>
    expect(
      teepee({ url: 'http://gofish.dk/', timeout: 1 }),
      'when rejected',
      expect
        .it('to be a', SocketError.ETIMEDOUT)
        .and('to be a', SocketError.SocketError)
    ));

  it('should accept a password-less url', () => {
    httpception({
      request: {
        url: 'GET http://example.com/',
        headers: { authorization: 'Basic Zm9v' }
      },
      response: 200
    });

    return teepee('http://foo:@example.com/');
  });

  it('should accept a url with a pipe in the query string', () => {
    httpception({
      response: 200
    });

    return teepee(
      'https://fonts.googleapis.com/css?family=Just+Another+Hand|Inconsolata:700'
    );
  });

  it('should decode a gzipped response body', () => {
    httpception({
      request: 'GET http://example.com/',
      response: {
        headers: {
          'Content-Type': 'text/plain',
          'Content-Encoding': 'gzip'
        },
        // zlib.gzipSync('foobarquux') (not supported with node.js 0.10)
        unchunkedBody: Buffer.from([
          0x1f,
          0x8b,
          0x08,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x03,
          0x4b,
          0xcb,
          0xcf,
          0x4f,
          0x4a,
          0x2c,
          0x2a,
          0x2c,
          0x2d,
          0xad,
          0x00,
          0x00,
          0x40,
          0xcb,
          0xde,
          0x64,
          0x0a,
          0x00,
          0x00,
          0x00
        ])
      }
    });

    return teepee('http://example.com/').then(response => {
      expect(response.body, 'to equal', Buffer.from('foobarquux', 'utf-8'));
    });
  });

  it('should decode a deflated response body', () => {
    httpception({
      request: 'GET http://example.com/',
      response: {
        headers: {
          'Content-Type': 'text/plain',
          'Content-Encoding': 'deflate'
        },
        // zlib.deflateSync('foobarquux') (not supported with node.js 0.10)
        unchunkedBody: Buffer.from([
          0x78,
          0x9c,
          0x4b,
          0xcb,
          0xcf,
          0x4f,
          0x4a,
          0x2c,
          0x2a,
          0x2c,
          0x2d,
          0xad,
          0x00,
          0x00,
          0x17,
          0x18,
          0x04,
          0x4d
        ])
      }
    });

    return teepee('http://example.com/').then(response => {
      expect(response.body, 'to equal', Buffer.from('foobarquux', 'utf-8'));
    });
  });

  it('should provide the response body even when getting an error status code', () => {
    httpception({
      request: 'GET http://example.com/',
      response: {
        statusCode: 500,
        body: {
          sorry: {
            no: 'worky'
          }
        }
      }
    });

    return expect(teepee('http://example.com/'), 'to be rejected with', {
      message: 'HTTP 500 Internal Server Error',
      statusCode: 500,
      data: {
        sorry: {
          no: 'worky'
        }
      }
    });
  });

  it('should support sending a multipart/form-data request', () => {
    httpception({
      request: {
        url: 'POST http://example.com/',
        headers: {
          'Content-Type': expect.it(
            'to begin with',
            'multipart/form-data; boundary='
          )
        },
        parts: [
          {
            headers: {
              'Content-Disposition': 'form-data; name="abc"'
            },
            body: 'def'
          },
          {
            headers: {
              'Content-Type': 'text/plain'
            },
            body: 'foobar'
          }
        ]
      },
      response: 200
    });

    return teepee.post('http://example.com/', {
      formData: {
        abc: 'def',
        attachment: {
          contentType: 'text/plain',
          value: 'foobar'
        }
      }
    });
  });
});
