/*global describe, it, __dirname, JSON, clearTimeout, setTimeout, setImmediate, beforeEach, afterEach, window, global*/
var Teepee = require('../lib/Teepee'),
    teepee = Teepee, // Alias so that jshint doesn't complain when invoking without new
    zlib = require('zlib'),
    HttpError = require('httperrors'),
    SocketError = require('socketerrors'),
    DnsError = require('dnserrors'),
    unexpected = require('unexpected'),
    sinon = require('sinon'),
    util = require('util'),
    fs = require('fs'),
    http = require('http'),
    https = require('https'),
    stream = require('stream'),
    pathModule = require('path');

describe('Teepee', function () {
    var expect = unexpected.clone()
        .use(require('unexpected-mitm'))
        .use(require('unexpected-sinon'));

    describe('request shorthands named after the method', function () {
        it('should allow making a POST request via Teepee.post(<string>)', function () {
            return expect(function () {
                return Teepee.post('http://www.example.com/');
            }, 'with http mocked out', {
                request: 'POST http://www.example.com/',
                response: 200
            }, 'not to error');
        });

        it('should allow making a POST request via Teepee.post({ url: <string> })', function () {
            return expect(function () {
                return Teepee.post({ url: 'http://www.example.com/' });
            }, 'with http mocked out', {
                request: 'POST http://www.example.com/',
                response: 200
            }, 'not to error');
        });

        it('should alias Teepee.delete as Teepee.del', function () {
            return expect(function () {
                return Teepee.del('http://www.example.com/');
            }, 'with http mocked out', {
                request: 'DELETE http://www.example.com/',
                response: 200
            }, 'not to error');
        });

        it('should throw if attempting to pass non-string, non-object to Teepee.post()', function () {
            return expect(function () {
                return Teepee.post(1234);
            }, 'with http mocked out', [], 'to throw', 'Teepee.post: First argument must be either an object or a string');
        });

        it('should allow making a POST request via new Teepee().post(<string>)', function () {
            return expect(function () {
                return new Teepee().post('http://www.example.com/');
            }, 'with http mocked out', {
                request: 'POST http://www.example.com/',
                response: 200
            }, 'not to error');
        });

        it('should allow making a POST request via new Teepee().post({ url: <string> })', function () {
            return expect(function () {
                return new Teepee().post({ url: 'http://www.example.com/' });
            }, 'with http mocked out', {
                request: 'POST http://www.example.com/',
                response: 200
            }, 'not to error');
        });

        it('should allow making a POST request via new Teepee(<url>).post()', function () {
            return expect(function () {
                return new Teepee('http://www.example.com/').post();
            }, 'with http mocked out', {
                request: 'POST http://www.example.com/',
                response: 200
            }, 'not to error');
        });

        it('should alias Teepee.prototype.delete as Teepee.prototype.del', function () {
            return expect(function () {
                return new Teepee().del('http://www.example.com/');
            }, 'with http mocked out', {
                request: 'DELETE http://www.example.com/',
                response: 200
            }, 'not to error');
        });

        it('should throw if attempting to pass non-string, non-object to Teepee.post()', function () {
            return expect(function () {
                return new Teepee('http://www.example.com/').post(1234);
            }, 'with http mocked out', [], 'to throw', 'Teepee.post: First argument must be either an object or a string');
        });
    });

    it('should not overwrite a built-in method with a config object property', function () {
        expect(new Teepee({
            url: 'http://localhost',
            request: 1
        }).request, 'to be a function');
    });

    it('should assume http:// if no protocol is provided in the base url', function () {
        return expect(function () {
            return new Teepee('localhost:1234').request('foobar');
        }, 'with http mocked out', {
            request: 'GET http://localhost:1234/foobar',
            response: 200
        }, 'not to error');
    });

    it('should accept a url without a hostname (will default to localhost via http.request)', function () {
        return expect(function () {
            return new Teepee('http://:1234').request('foobar');
        }, 'with http mocked out', {
            request: {
                url: 'GET http://localhost:1234/foobar',
                headers: {
                    Host: ':1234'
                }
            },
            response: 200
        }, 'not to error');
    });

    it('should provide the response body as response.body', function () {
        return expect(function () {
            return new Teepee('localhost:1234').request('foobar').then(function (response) {
                expect(response, 'to have property', 'body', new Buffer('foo'));
            });
        }, 'with http mocked out', {
            request: 'GET http://localhost:1234/foobar',
            response: { statusCode: 200, body: new Buffer('foo') }
        }, 'not to error');
    });

    it('should provide an empty buffer if the the response body is empty', function () {
        return expect(function () {
            return new Teepee('localhost:1234').request('foobar').then(function (response) {
                expect(response, 'to have property', 'body', new Buffer([]));
            });
        }, 'with http mocked out', {
            request: 'GET http://localhost:1234/foobar',
            response: { statusCode: 200 }
        }, 'not to error');
    });

    it('should accept default headers as constructor options', function () {
        return expect(function () {
            return new Teepee({
                url: 'http://localhost:1234/',
                headers: {
                    foo: 'bar',
                    quux: 'baz'
                }
            }).request({
                headers: {
                    foo: 'blah'
                }
            });
        }, 'with http mocked out', {
            request: {
                headers: {
                    foo: 'blah',
                    quux: 'baz'
                }
            }
        }, 'not to error');
    });

    it('should emit a successfulRequest event on 200 OK response', function () {
        var teepee = new Teepee('http://localhost:1234/'),
            successfulRequestListener = sinon.spy().named('successfulRequestListener'),
            failedRequestListener = sinon.spy().named('failedRequestListener');
        teepee.on('successfulRequest', successfulRequestListener)
            .on('failedRequest', failedRequestListener);
        return expect(function () {
            return teepee.request();
        }, 'with http mocked out', {
            response: 200
        }, 'not to error').then(function () {
            expect([ failedRequestListener, successfulRequestListener ], 'to have calls satisfying', function () {
                successfulRequestListener({
                    url: 'http://localhost:1234/',
                    requestOptions: {
                        // ...
                        host: 'localhost',
                        port: 1234
                    },
                    response: expect.it('to be an object')
                });
            });
        });
    });

    it('should emit a successfulRequest event on 304 Not Modified response', function () {
        var successfulRequestListener = sinon.spy().named('successfulRequestListener');
        return expect(function () {
            var teepee = new Teepee('http://localhost:1234/');
            teepee.on('successfulRequest', successfulRequestListener);
            return teepee.request('/foo.jpg');
        }, 'with http mocked out', {
            response: 304,
            body: 'barbar'
        }, 'not to error').then(function () {
            expect(successfulRequestListener, 'to have calls satisfying', function () {
                successfulRequestListener({ url: 'http://localhost:1234/foo.jpg' });
            });
        });
    });

    it('should emit a successfulRequest event on 200 Ok response without callback but with responseBody event handler', function () {
        var successfulRequestListener = sinon.spy().named('successfulRequestListener');
        return expect(function () {
            var teepee = new Teepee('http://localhost:1234/');
            teepee.on('successfulRequest', successfulRequestListener);

            var request = teepee.request('/foo.jpg');

            request.once('responseBody', function () {});
            return request;
        }, 'with http mocked out', {
            response: 200,
            body: 'barbar'
        }, 'not to error').then(function () {
            expect(successfulRequestListener, 'to have calls satisfying', function () {
                successfulRequestListener({ url: 'http://localhost:1234/foo.jpg' });
            });
        });
    });

    it('should emit a successfulRequest event on 200 Ok response without callback and without responseBody event handler', function () {
        var successfulRequestListener = sinon.spy().named('successfulRequestListener');
        return expect(function () {
            var teepee = new Teepee('http://localhost:1234/');
            teepee.on('successfulRequest', successfulRequestListener);

            return teepee.request('/foo.jpg');
        }, 'with http mocked out', {
            response: 200,
            body: 'barbar'
        }, 'not to error');
    });

    it('should emit a request event', function () {
        var teepee = new Teepee('http://localhost:1234/'),
            requestListener = sinon.spy().named('requestListener');
        teepee.on('request', requestListener);
        return expect(function () {
            return teepee.request({ numRetries: 1 });
        }, 'with http mocked out', [
            { response: new SocketError.ECONNRESET() },
            { response: 200 }
        ], 'not to error').then(function () {
            expect(requestListener, 'was called twice').and('was always called with exactly', {
                url: 'http://localhost:1234/',
                requestOptions: {
                    // ...
                    host: 'localhost',
                    port: 1234,
                    method: 'GET'
                }
            });
        });
    });

    it('should emit a failedRequest event', function () {
        var teepee = new Teepee('http://localhost:1234/'),
            successfulRequestListener = sinon.spy().named('successfulRequestListner'),
            failedRequestListener = sinon.spy().named('failedRequestListener');
        teepee.on('failedRequest', failedRequestListener);
        teepee.on('successfulRequest', successfulRequestListener);
        return expect(function () {
            return teepee.request();
        }, 'with http mocked out', {
            response: 404
        }, 'to error', new HttpError.NotFound()).then(function () {
            expect([ successfulRequestListener, failedRequestListener ], 'to have calls satisfying', function () {
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
            });
        });
    });

    describe('with a rejectUnauthorized option', function () {
        describe('passed to the constructor', function () {
            // Teepee does pass the option, but it seems like there's a mitm problem that causes this test to fail?
            it.skip('should pass option to https.request', function () {
                return expect(function () {
                    return new Teepee({ rejectUnauthorized: false, url: 'https://localhost:1234/' }).request();
                }, 'with http mocked out', {
                    request: {
                        rejectUnauthorized: false
                    },
                    response: 200
                }, 'not to error');
            });
        });

        describe('passed to the request method', function () {
            // Teepee does pass the option, but it seems like there's a mitm problem that causes this test to fail?
            it.skip('should pass the option to https.request', function () {
                return expect(function () {
                    return new Teepee('https://localhost:1234/').request({ rejectUnauthorized: false });
                }, 'with http mocked out', {
                    request: {
                        rejectUnauthorized: false
                    },
                    response: 200
                }, 'not to error');
            });
        });
    });

    describe('without a rejectUnauthorized option', function () {
        it('should not send a value to https.request, thus triggering whatever is the default behavior', function () {
            return expect(function () {
                return new Teepee('https://localhost:1234/').request();
            }, 'with http mocked out', {
                request: {
                    rejectUnauthorized: undefined
                },
                response: 200
            }, 'not to error');
        });
    });

    it('should accept a custom agent', function () {
        var agent;
        return expect(function () {
            agent = new http.Agent();

            var teepee = new Teepee({
                url: 'http://localhost:5984/hey/',
                agent: agent
            });

            expect(teepee.agentByProtocol.http, 'to be', agent);

            sinon.spy(agent, 'addRequest');

            return teepee.request('quux');
        }, 'with http mocked out', {
            request: 'http://localhost:5984/hey/quux',
            response: 200
        }, 'not to error').then(function () {
            expect(agent.addRequest, 'was called once');
        });
    });

    it('should accept a custom agent constructor', function () {
        var Agent = function (options) {
            http.Agent.call(this, options);
            sinon.spy(this, 'addRequest');
        };
        util.inherits(Agent, http.Agent);
        var teepee;
        return expect(function () {
            teepee = new Teepee({
                url: 'http://localhost:5984/hey/',
                Agent: Agent
            });

            return teepee.request('quux');
        }, 'with http mocked out', {
            request: 'http://localhost:5984/hey/quux',
            response: 200
        }, 'not to error').then(function () {
            expect(teepee.agentByProtocol.http, 'to be an', Agent);
            expect(teepee.agentByProtocol.http.addRequest, 'was called once');
        });
    });

    it('should accept a custom AgentByProtocol object', function () {
        var CustomHttpAgent = function (options) {
            http.Agent.call(this, options);
            sinon.spy(this, 'addRequest');
        };
        util.inherits(CustomHttpAgent, http.Agent);

        var CustomHttpsAgent = function (options) {
            https.Agent.call(this, options);
            sinon.spy(this, 'addRequest');
        };
        util.inherits(CustomHttpsAgent, https.Agent);

        var teepee;
        return expect(function () {
            teepee = new Teepee({
                url: 'http://localhost:5984/hey/',
                AgentByProtocol: { http: CustomHttpAgent, https: CustomHttpsAgent }
            });

            return teepee.request('quux').then(function () {
                return teepee.request('https://example.com/');
            });
        }, 'with http mocked out', [
            {
                request: 'http://localhost:5984/hey/quux',
                response: 200
            },
            {
                request: 'https://example.com/',
                response: 200
            }
        ], 'not to error').then(function () {
            expect(teepee.agentByProtocol.http, 'to be a', CustomHttpAgent);
            expect(teepee.agentByProtocol.http.addRequest, 'was called once');
            expect(teepee.agentByProtocol.https, 'to be a', CustomHttpsAgent);
            expect(teepee.agentByProtocol.https.addRequest, 'was called once');
        });
    });

    it('should pass other config options to the agent', function () {
        var Agent = sinon.spy(http.Agent);

        var teepee = new Teepee({
            url: 'http://localhost:5984/hey/',
            foobarquux: 123,
            Agent: Agent
        });

        expect(teepee.getAgent(), 'to be an', http.Agent);

        expect(Agent, 'was called with', { foobarquux: 123 });
    });

    it('should use the global agent if no agent config is provided', function () {
        expect(new Teepee('http://localhost:5984/hey/').getAgent('http'), 'to be undefined');
    });

    it('should create its own agents if agent:true is provided', function () {
        expect(new Teepee({ agent: true }).getAgent('http'), 'to be defined');
    });

    it('should perform a simple request', function () {
        return expect(function () {
            return new Teepee('http://localhost:5984').request('bar/quux');
        }, 'with http mocked out', {
            request: 'GET http://localhost:5984/bar/quux',
            response: 200
        }, 'not to error');
    });

    it('should allow the options object to be omitted', function () {
        return expect(function () {
            return new Teepee('http://localhost:5984').request();
        }, 'with http mocked out', {
            request: 'GET http://localhost:5984/',
            response: 200
        }, 'not to error');
    });

    it('should accept the method before the url', function () {
        return expect(function () {
            return new Teepee('http://localhost:5984').request('POST bar/quux');
        }, 'with http mocked out', {
            request: 'POST http://localhost:5984/bar/quux',
            response: 200
        }, 'not to error');
    });

    it('should allow specifying custom headers', function () {
        return expect(function () {
            return new Teepee('http://localhost:5984').request({ path: 'bar/quux', headers: { Foo: 'bar' } });
        }, 'with http mocked out', {
            request: {
                url: 'GET http://localhost:5984/bar/quux',
                headers: { Foo: 'bar' }
            },
            response: 200
        }, 'not to error');
    });

    it('should resolve the path from the base url', function () {
        return expect(function () {
            return new Teepee('http://localhost:5984/hey/there/').request({ path: '../quux' });
        }, 'with http mocked out', {
            request: 'GET http://localhost:5984/hey/quux',
            response: 200
        }, 'not to error');
    });

    it('should default to port 443 on https', function () {
        return expect(function () {
            return new Teepee('https://localhost/').request('bar/quux');
        }, 'with http mocked out', {
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
        }, 'not to error');
    });

    it('should allow specifying the request body as a Buffer', function () {
        return expect(function () {
            return new Teepee('http://localhost:5984/').request({ method: 'POST', path: 'foo', body: new Buffer([1, 2, 3]) });
        }, 'with http mocked out', {
            request: {
                url: 'POST http://localhost:5984/foo',
                headers: {
                    'Content-Type': undefined
                },
                body: new Buffer([1, 2, 3])
            },
            response: 200
        }, 'not to error');
    });

    it('should allow specifying the request body as a string', function () {
        return expect(function () {
            return new Teepee('http://localhost:5984/').request({ method: 'POST', path: 'foo', body: 'foobar' });
        }, 'with http mocked out', {
            request: {
                url: 'POST http://localhost:5984/foo',
                headers: {
                    'Content-Type': undefined
                },
                body: new Buffer('foobar', 'utf-8')
            },
            response: 200
        }, 'not to error');
    });

    it('should allow specifying the request body as an object, implying JSON', function () {
        return expect(function () {
            return new Teepee('http://localhost:5984/').request({ method: 'POST', path: 'foo', body: { what: 'gives' } });
        }, 'with http mocked out', {
            request: {
                url: 'POST http://localhost:5984/foo',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: { what: 'gives' }
            },
            response: 200
        }, 'not to error');
    });

    it('should return an object with an abort method', function () {
        return expect(function () {
            var req = new Teepee('http://localhost:5984/').request({ method: 'POST', path: 'foo' });
            expect(req, 'to satisfy', {
                abort: expect.it('to be a function')
            });
            return req;
        }, 'with http mocked out', {
            response: 200
        }, 'not to error');
    });

    // Not ready yet
    it.skip('should emit a responseBody event when the response body is available', function () {
        return expect(function () {
            return teepee('http://localhost/').response().then(function (response) {
                expect(response.body, 'to equal', new Buffer('yaddayaddayadda'));
            });
        }, 'with http mocked out', {
            response: {
                statusCode: 200,
                body: 'yaddayaddayadda'
            }
        }, 'not to error');
    });

    describe('#request', function () {
        // Should die:
        it.skip('should return an EventEmitter that emits a request event', function () {
            var requestListener = sinon.spy().named('requestListener');
            return expect(function () {
                return teepee('http://localhost/')
                    .on('request', requestListener);
            }, 'with http mocked out', {
                response: 200
            }, 'not to error').then(function () {
                expect(requestListener, 'to have calls satisfying', function () {
                    requestListener({ write: expect.it('to be a function') }, { host: 'localhost' });
                });
            });
        });

        it('should discard a document fragment in the url', function () {
            return expect(function () {
                return teepee('http://foo.com/#blah');
            }, 'with http mocked out', {
                request: 'http://foo.com/',
                response: 200
            }, 'not to error');
        });

        describe('when the body is passed as a function', function () {
            it('should support a Buffer being returned', function () {
                return expect(function () {
                    return teepee({
                        url: 'PUT http://localhost/',
                        body: function () {
                            return new Buffer('hello');
                        }
                    });
                }, 'with http mocked out', {
                    request: {
                        url: 'PUT http://localhost/',
                        body: new Buffer('hello')
                    }
                }, 'not to error');
            });

            describe('when a stream is returned', function () {
                it('should send a single request', function () {
                    return expect(function () {
                        return teepee({
                            url: 'PUT http://localhost/',
                            headers: {
                                'Content-Type': 'text/plain; charset=UTF-8'
                            },
                            body: function () {
                                return fs.createReadStream(pathModule.resolve(__dirname, '..', 'LICENSE'));
                            }
                        });
                    }, 'with http mocked out', {
                        request: {
                            url: 'PUT http://localhost/',
                            body: /^Copyright/
                        }
                    }, 'not to error');
                });

                it('should support retrying', function () {
                    return expect(function () {
                        return teepee({
                            url: 'PUT http://localhost/',
                            headers: {
                                'Content-Type': 'text/plain; charset=UTF-8'
                            },
                            numRetries: 1,
                            retry: '504',
                            body: function () {
                                return fs.createReadStream(pathModule.resolve(__dirname, '..', 'LICENSE'));
                            }
                        });
                    }, 'with http mocked out', [
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
                    ], 'not to error');
                });
            });
        });

        describe('when the return value is used as a thenable', function () {
            it('should succeed', function () {
                return expect(function () {
                    return teepee('http://localhost/');
                }, 'with http mocked out', {
                    request: 'GET http://localhost/',
                    response: 200
                }, 'not to error');
            });

            it('should fail', function () {
                return expect(function () {
                    return teepee('http://localhost/');
                }, 'with http mocked out', {
                    request: 'GET http://localhost/',
                    response: 404
                }, 'to error', new HttpError.NotFound());
            });
        });

        it('should instantiate an HttpError error if an unmapped status code is returned from the server', function () {
            return expect(function () {
                return teepee('http://foo.com/');
            }, 'with http mocked out', {
                response: 598
            }, 'to error', new HttpError(598));
        });
    });

    describe('with a request timeout', function () {
        describe('passed to the request method', function () {
            it('should abort the request and emit an error if no response has been received before the timeout', function () {
                return expect(function () {
                    return new Teepee('http://www.gofish.dk/').request({timeout: 1});
                }, 'to error', new SocketError.ETIMEDOUT());
            });
        });

        describe('passed to the constructor method', function () {
            it('should abort the request and emit an error if no response has been received before the timeout', function () {
                return expect(function () {
                    return new Teepee({url: 'http://www.gofish.dk/', timeout: 1}).request();
                }, 'to error', new SocketError.ETIMEDOUT());
            });
        });
    });

    describe('retrying on failure', function () {
        it('should return a successful response when a failed GET is retried `numRetries` times with a successful last attempt', function () {
            return expect(function () {
                return new Teepee('http://localhost:5984/').request({ path: 'foo', numRetries: 2 });
            }, 'with http mocked out', [
                { response: new SocketError.ETIMEDOUT() },
                { response: new SocketError.ETIMEDOUT() },
                { response: 200 }
            ], 'not to error');
        });

        it('should return the response associated with the eventually successful request', function () {
            return expect(function () {
                return new Teepee('http://localhost:5984/').request({ numRetries: 2, retry: 504 });
            }, 'with http mocked out', [
                { response: { statusCode: 504, headers: { Foo: 'bar' }, body: new Buffer('foo') } },
                { response: { statusCode: 200, headers: { Foo: 'quux' }, body: new Buffer('quux') } }
            ], 'not to error').then(function (response) {
                expect(response.body, 'to equal', new Buffer('quux'));
                expect(response.headers.foo, 'to equal', 'quux');
            });
        });

        it('should not retry a request that receives a response if the specific status code is not listed in the retry array', function () {
            return expect(function () {
                return new Teepee('http://localhost:5984/').request({ path: 'foo', numRetries: 2 });
            }, 'with http mocked out', [
                { response: 503 }
            ], 'to error', new HttpError.ServiceUnavailable());
        });

        it('should retry a request that times out while buffering up the response', function () {
            var requestHandler = sinon.spy(function (req, res) {
                    res.writeHead(200, {
                        'Content-Type': 'text/html; charset=UTF-8'
                    });
                    res.write('Foo');
                    if (requestHandler.callCount > 1) {
                        res.end('Bar');
                    }
                }),
                server = http.createServer(requestHandler).listen(0),
                serverAddress = server.address(),
                serverHostname = serverAddress.address === '::' ? 'localhost' : serverAddress.address,
                url = 'http://' + serverHostname + ':' + serverAddress.port + '/';

            return expect(function () {
                return teepee({ url: url, numRetries: 1, timeout: 20 });
            }, 'not to error').then(function (response) {
                expect(response.body, 'to equal', new Buffer('FooBar'));
                expect(requestHandler, 'was called twice');
            })['finally'](function () {
                server.close();
            });
        });

        it('should emit a retriedRequest every time a request is retried', function () {
            var teepee = new Teepee('http://localhost:1234/'),
                successfulRequestListener = sinon.spy().named('successfulRequestListener'),
                failedRequestListener = sinon.spy().named('failedRequestListener'),
                retriedRequestListener = sinon.spy().named('retriedRequestListener');
            teepee
                .on('failedRequest', failedRequestListener)
                .on('successfulRequest', successfulRequestListener)
                .on('retriedRequest', retriedRequestListener);
            return expect(function () {
                return teepee.request({ path: 'foo', numRetries: 2, retry: [ 501 ] });
            }, 'with http mocked out', [
                { response: new SocketError.ETIMEDOUT() },
                { response: 501 },
                { response: 200 }
            ], 'not to error').then(function () {
                expect([ failedRequestListener, successfulRequestListener, retriedRequestListener ], 'to have calls satisfying', function () {
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
                });
            });
        });

        it('should give up if the request fails 1 + `numRetries` times', function () {
            return expect(function () {
                return new Teepee('http://localhost:5984/').request({ path: 'foo', numRetries: 2 });
            }, 'with http mocked out', [
                { response: new SocketError.ETIMEDOUT() },
                { response: new SocketError.ETIMEDOUT() },
                { response: new SocketError.ETIMEDOUT() }
            ], 'to error', new SocketError.ETIMEDOUT());
        });

        it('should not attempt to retry a request with the body given as a stream, despite a `numRetries` setting', function () {
            return expect(function () {
                return new Teepee('http://localhost:5984/')
                    .request({ method: 'POST', body: fs.createReadStream(pathModule.resolve(__dirname, '..', 'testdata', '0byte')), path: 'foo', numRetries: 2 });
            }, 'with http mocked out', {
                response: new SocketError.ETIMEDOUT()
            }, 'to error', new SocketError.ETIMEDOUT());
        });

        describe('with the retryDelayMilliseconds option', function () {
            var setTimeoutSpy;
            beforeEach(function () {
                 setTimeoutSpy = sinon.spy(typeof window !== 'undefined' ? window : global, 'setTimeout');
            });
            afterEach(function () {
                setTimeoutSpy.restore();
            });
            describe('when passed to the constructor', function () {
                it('waits that many milliseconds before retrying', function () {
                    return expect(function () {
                        return new Teepee({ url: 'http://localhost:5984/', retryDelayMilliseconds: 3, numRetries: 1 }).request();
                    }, 'with http mocked out', [
                        { response: new SocketError.ETIMEDOUT() },
                        { response: 200 }
                    ], 'not to error').then(function () {
                        expect(setTimeoutSpy, 'was called with', expect.it('to be a function'), 3);
                    });
                });
            });

            describe('when passed to the request function', function () {
                it('waits that many milliseconds before retrying', function () {
                    return expect(function () {
                        return new Teepee('http://localhost:5984/').request({ path: 'foo', numRetries: 1, retryDelayMilliseconds: 3 });
                    }, 'with http mocked out', [
                        { response: new SocketError.ETIMEDOUT() },
                        { response: 200 }
                    ], 'not to error').then(function () {
                        expect(setTimeoutSpy, 'was called with', expect.it('to be a function'), 3);
                    });
                });
            });
        });

        describe('with the retry option', function () {
            describe('with an array', function () {
                it('should retry a non-successful request if the HTTP status code is in the array', function () {
                    return expect(function () {
                        return new Teepee('http://localhost:5984/').request({ path: 'foo', numRetries: 2, retry: [504] });
                    }, 'with http mocked out', [
                        { response: 504 },
                        { response: 504 },
                        { response: 200 }
                    ], 'not to error');
                });

                it('should not retry an unsuccessful request if the HTTP status code is not in the array', function () {
                    return expect(function () {
                        return new Teepee('http://localhost:5984/').request({ path: 'foo', numRetries: 2, retry: [504] });
                    }, 'with http mocked out', [
                        { response: 503 }
                    ], 'to error', new HttpError.ServiceUnavailable());
                });

                it('should retry a non-successful request if the HTTP status code is covered by a "wildcard"', function () {
                    return expect(function () {
                        return new Teepee('http://localhost:5984/').request({ path: 'foo', numRetries: 4, retry: [ '5xx', '40x' ] });
                    }, 'with http mocked out', [
                        { response: 404 },
                        { response: 504 },
                        { response: 520 },
                        { response: 412 }
                    ], 'to error', new HttpError.PreconditionFailed());
                });

                it('should retry an unsuccessful request if "httpError" is in the retry array', function () {
                    return expect(function () {
                        return new Teepee('http://localhost:5984/').request({ path: 'foo', numRetries: 2, retry: ['httpError'] });
                    }, 'with http mocked out', [
                        { response: 503 },
                        { response: 200 }
                    ], 'not to error');
                });

                it('should retry an unsuccessful request if retry has a value of "httpError"', function () {
                    return expect(function () {
                        return new Teepee('http://localhost:5984/').request({ path: 'foo', numRetries: 2, retry: ['httpError'] });
                    }, 'with http mocked out', [
                        { response: 503 },
                        { response: 200 }
                    ], 'not to error');
                });

                describe('when retrying on self-redirect is enabled', function () {
                    it('should retry a 301 self-redirect', function () {
                        return expect(function () {
                            return new Teepee('http://localhost:5984/').request({ numRetries: 1, retry: 'selfRedirect' });
                        }, 'with http mocked out', [
                            { response: { statusCode: 301, headers: { Location: 'http://localhost:5984/' }, body: new Buffer('hey') } },
                            { response: { statusCode: 200, headers: { Foo: 'quux' }, body: new Buffer('there') } }
                        ], 'not to error').then(function (response) {
                            expect(response, 'to have property', 'body', new Buffer('there'));
                        });
                    });

                    it('should emit a retry event with a SelfRedirectError', function () {
                        var retriedRequestListener = sinon.spy().named('retriedRequestListener');
                        return expect(function () {
                            var teepee = new Teepee('http://localhost:5984/');
                            teepee.on('retriedRequest', retriedRequestListener);
                            return teepee.request({ numRetries: 1, retry: 'selfRedirect' });
                        }, 'with http mocked out', [
                            { response: { statusCode: 301, headers: { Location: 'http://localhost:5984/#foo' } } },
                            { response: 200 }
                        ], 'not to error').then(function () {
                            expect(retriedRequestListener, 'to have calls satisfying', function () {
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

                    it('should retry a 302 self-redirect', function () {
                        return expect(function () {
                            return new Teepee('http://localhost:5984/').request({ numRetries: 1, retry: 'selfRedirect' });
                        }, 'with http mocked out', [
                            { response: { statusCode: 302, headers: { Location: 'http://localhost:5984/' } } },
                            { response: 200 }
                        ], 'not to error');
                    });

                    it('should not retry a 303 self-redirect', function () {
                        return expect(function () {
                            return new Teepee('http://localhost:5984/').request({ numRetries: 1, retry: 'selfRedirect' });
                        }, 'with http mocked out', [
                            { response: { statusCode: 303, headers: { Location: 'http://localhost:5984/' } } }
                        ], 'not to error');
                    });

                    it('should retry a 301 self-redirect when the urls are the same', function () {
                        return expect(function () {
                            return new Teepee('http://localhost:5984/').request({ numRetries: 1, retry: 'selfRedirect' });
                        }, 'with http mocked out', [
                            { response: { statusCode: 301, headers: { Location: 'http://localhost:5984/' } } },
                            { response: 200 }
                        ], 'not to error');
                    });

                    it('should retry a 301 self-redirect even when the urls differ by document fragment', function () {
                        return expect(function () {
                            return new Teepee('http://localhost:5984/#foo').request({ numRetries: 1, retry: 'selfRedirect' });
                        }, 'with http mocked out', [
                            { response: { statusCode: 301, headers: { Location: 'http://localhost:5984/#bar' } } },
                            { response: 200 }
                        ], 'not to error');
                    });

                    it('should not fail if an invalid url is received in the Location header', function () {
                        return expect(function () {
                            return new Teepee('http://localhost:5984/').request({ numRetries: 1, retry: 'selfRedirect' });
                        }, 'with http mocked out', [
                            { response: { statusCode: 301, headers: { Location: 'vqwe' } } }
                        ], 'not to error');
                    });
                });
            });
        });
    });

    it('should handle ECONNREFUSED', function () {
        return expect(function () {
            return new Teepee('http://localhost:5984/').request('foo');
        }, 'with http mocked out', {
            response: new SocketError.ECONNREFUSED('connect ECONNREFUSED')
        }, 'to error', new SocketError.ECONNREFUSED('connect ECONNREFUSED'));
    });

    it('should handle unknown errors', function () {
        var error = new Error('something else');

        return expect(function () {
            return new Teepee('http://localhost:5984/').request('foo');
        }, 'with http mocked out', {
            response: error
        }, 'to error', new HttpError.InternalServerError(error.message));
    });

    describe('with a streamed response', function () {
        it('should handle simple response stream', function () {
            var responseStream = new stream.Readable();
            responseStream._read = function () {
                responseStream.push(new Buffer(JSON.stringify({ a: 1, b: 2 })));
                responseStream.push(null);
            };

            return expect(function () {
                return new Teepee('http://localhost:5984/').request('foo');
            }, 'with http mocked out', {
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
            }, 'not to error');
        });

        it('should allow any valid formulation of application/json', function () {
            var responseObject = {
                foo: 'bar'
            };
            var responseStream = new stream.Readable();
            responseStream._read = function () {
                responseStream.push(new Buffer(JSON.stringify(responseObject)));
                responseStream.push(null);
            };

            return expect(function () {
                return new Teepee('http://localhost:5984/').request('foo');
            }, 'with http mocked out', {
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
            }, 'not to error').then(function (response) {
                return expect(response.body, 'to equal', responseObject);
            });
        });

        it('should not attempt to parse an application/json response body when the request method is HEAD', function () {
            return expect(function () {
                return teepee('HEAD http://localhost:5984/');
            }, 'with http mocked out', {
                response: {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'application/json; charset=utf8'
                    }
                }
            }, 'not to error');
        });

        it('should throw an error on invalid JSON', function () {
            var responseStream = new stream.Readable();
            responseStream._read = function () {
                responseStream.push(new Buffer('{]'));
                responseStream.push(null);
            };

            return expect(function () {
                return new Teepee('http://localhost:5984/').request('foo');
            }, 'with http mocked out', {
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
            }, 'to error', new HttpError.BadGateway('Error parsing JSON response body'));
        });
    });

    describe('with a query', function () {
        it('should allow specifying the query string as a string', function () {
            return expect(function () {
                return new Teepee('http://localhost:5984/').request({ path: 'bar/quux', query: 'blabla' });
            }, 'with http mocked out', {
                request: 'GET http://localhost:5984/bar/quux?blabla',
                response: 200
            }, 'not to error');
        });

        it('should allow specifying the query string as an object', function () {
            return expect(function () {
                return new Teepee('http://localhost:5984/').request({ path: 'bar/quux', query: {
                    ascii: 'blabla',
                    nønascïî: 'nønascïî',
                    multiple: [ 'foo', 'nønascïî' ],
                    iAmUndefined: undefined
                }});
            }, 'with http mocked out', {
                request: 'GET http://localhost:5984/bar/quux' +
                    '?ascii=blabla' +
                    '&n%C3%B8nasc%C3%AF%C3%AE=n%C3%B8nasc%C3%AF%C3%AE' +
                    '&multiple=foo' +
                    '&multiple=n%C3%B8nasc%C3%AF%C3%AE',
                response: 200
            }, 'not to error');
        });
    });

    describe('with a url containing placeholders', function () {
        it('should substitute a placeholder with a value found in the options object passed to request (and prefer it over an identically named one passed to the constructor)', function () {
            var teepee = new Teepee({
                domainName: 'the.wrong.one',
                url: 'http://{domainName}.contacts/foo/'
            });

            return expect(function () {
                return teepee.request({
                    domainName: 'example.com',
                    path: 'hey'
                });
            }, 'with http mocked out', {
                request: 'http://example.com.contacts/foo/hey'
            }, 'not to error');
        });

        it('should substitute a complex expression in a placeholder', function () {
            var teepee = new Teepee({
                url: 'http://couchdb{{partitionNumber} === 0 ? 3 : 4}.example.com/contacts{partitionNumber}',
                partitionPoints: ['info']
            });

            teepee.partitionNumber = function (requestOptions) {
                var key = requestOptions.domainName.split('.').reverse().join('.'),
                    databaseNumber = 0;
                for (var i = 0 ; i < this.partitionPoints.length ; i += 1) {
                    if (key >= this.partitionPoints[i]) {
                        databaseNumber += 1;
                    } else {
                        break;
                    }
                }
                return databaseNumber;
            };

            return expect(function () {
                return teepee.request({
                    domainName: 'example.com',
                    path: 'hey'
                }).then(function () {
                    return teepee.request({
                        domainName: 'example.info',
                        path: 'there'
                    });
                });
            }, 'with http mocked out', [
                { request: 'http://couchdb3.example.com/contacts0/hey' },
                { request: 'http://couchdb4.example.com/contacts1/there' }
            ], 'not to error');
        });

        it('should support passing a falsy value in request options', function () {
            var teepee = new Teepee({
                url: 'http://couchdb{{partitionNumber} === 0 ? 3 : 4}.example.com/contacts{partitionNumber}',
                partitionPoints: ['info']
            });
            return expect(function () {
                return teepee.request({
                    partitionNumber: 0,
                    path: 'hey'
                });
            }, 'with http mocked out', {
                request: 'http://couchdb3.example.com/contacts0/hey'
            }, 'not to error');
        });

        it('should substitute a placeholder with a value found in the options object passed to the constructor', function () {
            var teepee = new Teepee({
                domainName: 'example.com',
                url: 'http://{domainName}.contacts/foo/'
            });

            return expect(function () {
                return teepee.request({path: 'hey'});
            }, 'with http mocked out', {
                request: 'http://example.com.contacts/foo/hey'
            }, 'not to error');
        });

        it('should substitute a placeholder with the result of calling a function of that name passed to the request method', function () {
            var teepee = new Teepee({
                domainName: function (requestOptions, placeholderName) {
                    return requestOptions.owner.replace(/^.*@/, '');
                },
                url: 'http://{domainName}.contacts/foo/'
            });

            return expect(function () {
                return teepee.request({path: 'hey', owner: 'andreas@example.com'});
            }, 'with http mocked out', {
                request: 'http://example.com.contacts/foo/hey'
            }, 'not to error');
        });
    });

    describe('with a client certificate and related properties', function () {
        var zero = new Buffer([0]),
            one = new Buffer([1]),
            two = new Buffer([2]),
            three = new Buffer([3]);

        describe('specified as Buffer instances', function () {
            var teepee = new Teepee({cert: zero, key: one, ca: two, url: 'https://example.com:5984/'});
            it('should expose the cert, key, and ca options on the instance', function () {
                expect(teepee, 'to satisfy', {
                    cert: zero,
                    key: one,
                    ca: two
                });
            });

            it('should make connections using the client certificate', function () {
                return expect(function () {
                    return teepee.request('foo');
                }, 'with http mocked out', {
                    request: {
                        encrypted: true,
                        url: 'GET /foo',
                        cert: zero,
                        key: one,
                        ca: two
                    }
                }, 'not to error');
            });
        });

        describe('specified as strings and arrays', function () {
            var teepee = new Teepee({
                cert: pathModule.resolve(__dirname, '..', 'testdata', '0byte'),
                key: pathModule.resolve(__dirname, '..', 'testdata', '1byte'),
                ca: [
                    pathModule.resolve(__dirname, '..', 'testdata', '2byte'),
                    pathModule.resolve(__dirname, '..', 'testdata', '3byte')
                ],
                url: 'https://example.com:5984/'
            });

            it('should interpret the options as file names and expose the loaded cert, key, and ca options on the instance', function () {
                expect(teepee, 'to satisfy', {
                    cert: zero,
                    key: one,
                    ca: [two, three]
                });
            });

            it('should make connections using the client certificate', function () {
                return expect(function () {
                    return teepee.request('foo');
                }, 'with http mocked out', {
                    request: {
                        encrypted: true,
                        url: 'GET /foo',
                        cert: zero,
                        key: one,
                        ca: [two, three]
                    }
                }, 'not to error');
            });
        });
    });

    describe('with a connection pool', function () {
        it('should not exhaust the pool on HTTP error status', function () {
            var server = require('http').createServer(function (req, res) {
                res.statusCode = 404;
                res.end();
            });
            var timeoutLimit = this.timeout() - 200;
            server.listen();

            var teepee = new Teepee({
                url: 'http://localhost:' + server.address().port + '/',
                agent: true,
                maxSockets: 1
            });

            function cleanUp() {
                server.close();
            }

            function makeRequest() {
                return expect.promise(function (run) {
                    var done = run(function () {});

                    teepee.request('foo', done);
                });
            }

            return expect.promise(function (resolve, reject) {
                var timeout = setTimeout(function () {
                    reject(new Error('connection pool exhausted'));
                }, timeoutLimit);

                // make more parallel teepee requests than we set maxSockets
                expect.promise.settle([
                    makeRequest(),
                    makeRequest(),
                    makeRequest()
                ]).then(function () {
                    clearTimeout(timeout);
                    resolve();
                });
            }).then(cleanUp);
        });

        it('should not exhaust the pool on HTTP 304 and a response handler is attached', function () {
            var server = require('http').createServer(function (req, res) {
                res.statusCode = 304;
                res.end();
            });
            var timeoutLimit = this.timeout() - 200;
            server.listen();

            var teepee = new Teepee({
                url: 'http://localhost:' + server.address().port + '/',
                agent: true,
                maxSockets: 1
            });

            function cleanUp() {
                server.close();
            }

            function makeRequest() {
                return expect.promise(function (run) {
                    var done = run(function () {});

                    teepee.request('foo').on('response', function (response) {
                        done();
                    });
                });
            }

            return expect.promise(function (resolve, reject) {
                var timeout = setTimeout(function () {
                    reject(new Error('connection pool exhausted'));
                }, timeoutLimit);

                // make more parallel teepee requests than we set maxSockets
                expect.promise.settle([
                    makeRequest(),
                    makeRequest()
                ]).then(function () {
                    clearTimeout(timeout);
                    resolve();
                });
            }).then(cleanUp);
        });

        // This will be solved differently with a pure-promise implementation:
        it.skip('should not resume a 304 response if it is piped', function () {
            var resumeSpy;
            return expect(function () {
                return expect.promise(function (resolve, reject) {
                    teepee('http://example.com/').on('response', function (response) {
                        response.pipe(new zlib.Gzip());
                        resumeSpy = sinon.spy(response, 'resume');
                        setImmediate(resolve);
                    });
                });
            }, 'with http mocked out', {
                request: 'GET /',
                response: {
                    statusCode: 304,
                    body: new Buffer([0, 1, 2])
                }
            }, 'not to error').then(function () {
                expect(resumeSpy, 'was not called');
            });
        });

        it('should not exhaust the pool on HTTP error status when the EventEmitter-based interface is used', function () {
            var server = require('http').createServer(function (req, res) {
                res.statusCode = 404;
                res.end();
            });
            var timeoutLimit = this.timeout() - 200;
            server.listen();

            var teepee = new Teepee({
                url: 'http://localhost:' + server.address().port + '/',
                agent: true,
                maxSockets: 1
            });

            function cleanUp() {
                server.close();
            }

            function makeRequest() {
                return expect.promise(function (run) {
                    teepee.request('foo').on('error', run(function () {}));
                });
            }

            return expect.promise(function (resolve, reject) {
                var timeout = setTimeout(function () {
                    reject(new Error('connection pool exhausted'));
                }, timeoutLimit);

                // make more parallel teepee requests than we set maxSockets
                expect.promise.settle([
                    makeRequest(),
                    makeRequest(),
                    makeRequest()
                ]).then(function () {
                    clearTimeout(timeout);
                    resolve();
                });
            }).then(cleanUp);
        });
    });

    describe('with a username and password passed to the constructor', function () {
        it('should use them as basic auth credentials', function () {
            return expect(function () {
                return new Teepee({ username: 'foobar', password: 'quux', url: 'https://localhost:4232/'}).request();
            }, 'with http mocked out', {
                request: {
                    url: 'https://localhost:4232/',
                    headers: {
                        Authorization: 'Basic Zm9vYmFyOnF1dXg=' // foobar:quux
                    }
                },
                response: 200
            }, 'not to error');
        });
    });

    describe('with a username and password passed to the request method', function () {
        it('should use them as basic auth credentials', function () {
            return expect(function () {
                return new Teepee('https://localhost:4232/').request({ username: 'foobar', password: 'quux' });
            }, 'with http mocked out', {
                request: {
                    url: 'https://localhost:4232/',
                    headers: {
                        Authorization: 'Basic Zm9vYmFyOnF1dXg=' // foobar:quux
                    }
                },
                response: 200
            }, 'not to error');
        });
    });

    describe('with a username and password in the url', function () {
        it('should use them as basic auth credentials', function () {
            return expect(function () {
                return teepee('https://foobar:quux@localhost:4232/');
            }, 'with http mocked out', {
                request: {
                    url: 'https://localhost:4232/',
                    headers: {
                        Authorization: 'Basic Zm9vYmFyOnF1dXg='
                    }
                },
                response: 200
            }, 'not to error');
        });

        it('should support percent-encoded octets, including colons, and a non-encoded colon in the password', function () {
            return expect(function () {
                return teepee('http://fo%C3%A6o%25bar:baz%25quux:yadda@localhost:4232/');
            }, 'with http mocked out', {
                request: {
                    url: 'http://localhost:4232/',
                    headers: {
                        Authorization: 'Basic Zm/Dpm8lYmFyOmJheiVxdXV4OnlhZGRh'
                    }
                },
                response: 200
            }, 'not to error');
        });

        it('should leave all percent encoded octets in the username if one of them does not decode as UTF-8', function () {
            return expect(function () {
                return teepee('http://fo%C3%A6o%25bar%C3:baz%C3%A6quux:yadda@localhost:4232/');
            }, 'with http mocked out', {
                request: {
                    url: 'http://localhost:4232/',
                    headers: {
                        Authorization: 'Basic Zm8lQzMlQTZvJTI1YmFyJUMzOmJhesOmcXV1eDp5YWRkYQ=='
                    }
                },
                response: 200
            }, 'not to error');
        });
    });

    describe('when invoked without new', function () {
        it('should perform a request directly', function () {
            return expect(function () {
                return teepee('https://localhost:8000/');
            }, 'with http mocked out', {
                request: 'GET http://localhost:8000/',
                response: 200
            }, 'not to error');
        });

        it('should assume http:// if no protocol is provided', function () {
            return expect(function () {
                return teepee('localhost:1234/');
            }, 'with http mocked out', {
                request: 'GET http://localhost:1234/',
                response: 200
            }, 'not to error');
        });

        it('should accept the method before the url', function () {
            return expect(function () {
                return teepee('POST https://localhost:8000/');
            }, 'with http mocked out', {
                request: 'POST http://localhost:8000/',
                response: 200
            }, 'not to error');
        });

        // Regression test
        it('should allow specifying a request body', function () {
            return expect(function () {
                return teepee({ url: 'http://localhost:5984/', method: 'POST', body: { what: 'gives' } });
            }, 'with http mocked out', {
                request: {
                    url: 'POST http://localhost:5984/',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: { what: 'gives' }
                },
                response: 200
            }, 'not to error');
        });
    });

    expect.addAssertion('<array> to result in request <string|object>', function (expect, subject, value) {
        return expect(function () {
            return new Teepee(subject[0]).request(subject[1]);
        }, 'with http mocked out', {
            request: value,
            response: 200
        }, 'not to error');
    });

    describe('url resolution', function () {
        describe('when the base url has a trailing slash', function () {
            it('should resolve a request url without a leading slash', function () {
                return expect(['http://localhost/foo/', 'bar'], 'to result in request', 'http://localhost/foo/bar');
            });

            it('should resolve a request url with a leading slash', function () {
                return expect(['http://localhost/foo/', '/bar'], 'to result in request', 'http://localhost/foo/bar');
            });
        });

        describe('when the base url has no trailing slash', function () {
            it('should resolve a request url without a leading slash', function () {
                return expect(['http://localhost/foo', 'bar'], 'to result in request', 'http://localhost/foo/bar');
            });

            it('should resolve a request url with a leading slash', function () {
                return expect(['http://localhost/foo', '/bar'], 'to result in request', 'http://localhost/foo/bar');
            });
        });

        describe('with a protocol-relative request url', function () {
            it('should keep the protocol from the base url, but take everything else from the request url', function () {
                return expect(['https://localhost/foo', '//example.com/baz'], 'to result in request', 'https://example.com/baz');
            });

            it('should not use basic auth credentials from the base url', function () {
                return expect(['https://foo@bar:localhost/foo', '//example.com/baz'], 'to result in request', {
                    headers: {
                        Authorization: undefined
                    }
                });
            });
        });

        describe('with an absolute request url', function () {
            it('should ignore the base url', function () {
                return expect(['https://foo@bar:localhost/foo', 'http://example.com/baz'], 'to result in request', {
                    url: 'http://example.com/baz',
                    headers: {
                        Authorization: undefined
                    }
                });
            });
        });

        describe('without a base url', function () {
            it('should not accept a non-absolute request url', function () {
                return expect(function () {
                    new Teepee().request('foo');
                }, 'to error', new Error('An absolute request url must be given when no base url is available'));
            });
        });

        it('#request should accept a url option as an alias for path', function () {
            return expect(function () {
                return new Teepee('https://localhost:8000/').request({url: 'bar'});
            }, 'with http mocked out', {
                request: 'http://localhost:8000/bar',
                response: 200
            }, 'not to error');
        });
    });

    describe('#subsidiary()', function () {
        it('should use the same agent instance as the parent', function () {
            var teepee = new Teepee('http://www.foo.com/'),
                subsidiary = teepee.subsidiary('http://www.example.com/');
            expect(teepee.getAgent('http'), 'to be', subsidiary.getAgent('http'));
        });

        it('should accept a string which will override the url', function () {
            var teepee = new Teepee('http://quux.com:123/'),
                subsidiary = teepee.subsidiary('http://foo:bar@baz.com:123/');
            expect(teepee.url, 'to equal', 'http://quux.com:123/');
            expect(subsidiary.url, 'to equal', 'http://foo:bar@baz.com:123/');
        });

        it('should accept an options object, which will override the options from the main instance', function () {
            var teepee = new Teepee({ foo: 123, url: 'http://quux.com:123/' }),
                subsidiary = teepee.subsidiary({ foo: 456, url: 'http://foo:bar@baz.com:123/' });
            expect(subsidiary, 'to satisfy', {
                url: 'http://foo:bar@baz.com:123/',
                foo: 456
            });
        });

        it('should clone the default headers from the parent', function () {
            var teepee = new Teepee({ headers: { foo: 'bar' }}),
                subsidiary = teepee.subsidiary();
            expect(subsidiary.headers, 'to equal', { foo: 'bar' });
            expect(subsidiary.headers, 'not to be', teepee.headers);
        });

        it('should merge the headers with those of the parent instance, preferring the ones passed to .subsidiary()', function () {
            var teepee = new Teepee({ headers: { foo: 'bar', baz: 'quux' }}),
                subsidiary = teepee.subsidiary({ headers: { foo: 'blah' }});
            expect(subsidiary.headers, 'to equal', { foo: 'blah', baz: 'quux' });
            expect(teepee.headers, 'to equal', { foo: 'bar', baz: 'quux' });
            expect(subsidiary.headers, 'not to be', teepee.headers);
        });

        it('should inherit numRetries from the parent', function () {
            var teepee = new Teepee({ numRetries: 99 }),
                subsidiary = teepee.subsidiary();
            expect(subsidiary.numRetries, 'to equal', 99);
        });

        it('should produce an instance that echoes events to the parent', function () {
            var teepee = new Teepee('http://localhost:1234/'),
                subsidiary = teepee.subsidiary('http://localhost:4567/'),
                subsidiaryRequestListener = sinon.spy().named('subsidiaryRequestListener'),
                requestListener = sinon.spy().named('requestListener');

            teepee.on('request', requestListener);
            subsidiary.on('request', subsidiaryRequestListener);

            return expect(function () {
                return subsidiary.request().then(function () {
                    return teepee.request();
                });
            }, 'with http mocked out', [
                { response: 200 },
                { response: 200 }
            ], 'not to error').then(function () {
                expect([ subsidiaryRequestListener, requestListener ], 'to have calls satisfying', function () {
                    subsidiaryRequestListener(expect.it('to be an object'));
                    requestListener({ requestOptions: { port: 4567 } });
                    requestListener({ requestOptions: { port: 1234 } });
                });
            });
        });

        describe('with a Teepee subclass', function () {
            function Wigwam(config) {
                Teepee.call(this, config);
            }
            util.inherits(Wigwam, Teepee);

            it('should produce an instance of the subclass', function () {
                expect(new Wigwam().subsidiary(), 'to be a', Wigwam);
            });
        });
    });

    describe('with preprocessRequestOptions', function () {
        it('should allow overriding the protocol, host, port, path, and headers', function () {
            var teepee = new Teepee('http://example.com/foo', {headers: {Foo: 'bar'}});
            teepee.preprocessRequestOptions = function (requestOptions, options, cb) {
                requestOptions.protocol = 'https';
                requestOptions.port = 1234;
                requestOptions.host = 'someotherexample.com';
                requestOptions.path = '/alternativePath';
                setImmediate(cb);
            };
            return expect(function () {
                return teepee.request();
            }, 'with http mocked out', {
                request: {
                    url: 'https://someotherexample.com:1234/alternativePath',
                    headers: {
                        Host: 'example.com' // This might be a bit unintutive
                    }
                },
                response: 200
            }, 'not to error');
        });
    });

    // Not ready yet
    it.skip('should support passing the response stream as the request body for a subsequent request', function () {
        return expect(function () {
            return teepee('http://example.com/').response().then(function (response) {
                return teepee({ url: 'http://somewhereelse.com/', method: 'PUT', body: response });
            });
        }, 'with http mocked out', [
            { request: 'GET http://example.com/', response: { body: new Buffer('abcdef') } },
            { request: { url: 'PUT http://somewhereelse.com/', body: new Buffer('abcdef') }, response: 200 }
        ], 'not to error');
    });

    it('should map DNS errors to DnsError instances', function () {
        return expect(teepee('http://qwcoviejqocejqkwoiecjkqwoiejckqowiejckqoiwejckqowec.com/'), 'when rejected to be a', DnsError);
    });

    it('should allow calling .then() more than once', function () {
        return expect(function () {
            var request = teepee('http://foo.com/');
            request.then(function () {});
            request.then(function () {});
        }, 'with http mocked out', [], 'not to throw');
    });

    it('should map socket errors to SocketError instances', function () {
        return expect(teepee({ url: 'http://gofish.dk/', timeout: 1 }), 'when rejected',
            expect.it('to be a', SocketError.ETIMEDOUT).and('to be a', SocketError.SocketError));
    });

    it('should accept a password-less url', function () {
        return expect(function () {
            return teepee('http://foo:@example.com/');
        }, 'with http mocked out', {
            request: { url: 'GET http://example.com/', headers: { authorization: 'Basic Zm9v' } },
            response: 200
        }, 'not to error');
    });
});
