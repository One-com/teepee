/*global describe, it, __dirname, JSON, clearTimeout, setTimeout, setImmediate, beforeEach, afterEach, window, global*/
var Teepee = require('../lib/Teepee'),
    teepee = Teepee, // Alias so that jshint doesn't complain when invoking without new
    httpErrors = require('httperrors'),
    socketErrors = require('socketerrors'),
    passError = require('passerror'),
    unexpected = require('unexpected'),
    sinon = require('sinon'),
    util = require('util'),
    fs = require('fs'),
    http = require('http'),
    stream = require('stream'),
    pathModule = require('path');

describe('Teepee', function () {
    var expect = unexpected.clone()
        .installPlugin(require('unexpected-mitm'))
        .installPlugin(require('unexpected-sinon'));

    it('should not overwrite a built-in method with a config object property', function () {
        expect(new Teepee({
            url: 'http://localhost',
            request: 1
        }).request, 'to be a function');
    });

    it('should accept default headers as constructor options', function () {
        return expect(function (cb) {
            new Teepee({
                url: 'http://localhost:1234/',
                headers: {
                    foo: 'bar',
                    quux: 'baz'
                }
            }).request({
                headers: {
                    foo: 'blah'
                }
            }, cb);
        }, 'with http mocked out', {
            request: {
                headers: {
                    foo: 'blah',
                    quux: 'baz'
                }
            }
        }, 'to call the callback without error');
    });

    it('should emit a successfulRequest event', function () {
        var teepee = new Teepee('http://localhost:1234/'),
            successfulRequestListener = sinon.spy(),
            failedRequestListener = sinon.spy();
        teepee.on('successfulRequest', successfulRequestListener)
            .on('failedRequest', failedRequestListener);
        return expect(function (cb) {
            teepee.request(cb);
        }, 'with http mocked out', {
            response: 200
        }, 'to call the callback without error').then(function () {
            expect(failedRequestListener, 'was not called');

            return expect(successfulRequestListener, 'was called once')
                .and('was called with', {
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

    it('should emit a request event', function () {
        var teepee = new Teepee('http://localhost:1234/'),
            requestListener = sinon.spy();
        teepee.on('request', requestListener);
        return expect(function (cb) {
            teepee.request({ numRetries: 1 }, cb);
        }, 'with http mocked out', [
            { response: new socketErrors.ECONNRESET() },
            { response: 200 }
        ], 'to call the callback without error').then(function () {
            return expect(requestListener, 'was called twice').and('was always called with', {
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
            successfulRequestListener = sinon.spy(),
            failedRequestListener = sinon.spy();
        teepee.on('failedRequest', failedRequestListener);
        teepee.on('successfulRequest', successfulRequestListener);
        return expect(function (cb) {
            teepee.request(cb);
        }, 'with http mocked out', {
            response: 404
        }, 'to call the callback with error', new httpErrors.NotFound()).then(function () {
            expect(successfulRequestListener, 'was not called');

            return expect(failedRequestListener, 'was called once')
                .and('was called with', {
                    numRetriesLeft: 0,
                    url: 'http://localhost:1234/',
                    err: new httpErrors.NotFound(),
                    requestOptions: {
                        // ...
                        host: 'localhost',
                        port: 1234
                    },
                    response: expect.it('to be an object')
                });
        });
    });

    describe('with a rejectUnauthorized option', function () {
        describe('passed to the constructor', function () {
            // Teepee does pass the option, but it seems like there's a mitm problem that causes this test to fail?
            it.skip('should pass option to https.request', function () {
                return expect(function (cb) {
                    new Teepee({ rejectUnauthorized: false, url: 'https://localhost:1234/' }).request(cb);
                }, 'with http mocked out', {
                    request: {
                        rejectUnauthorized: false
                    },
                    response: 200
                }, 'to call the callback without error');
            });
        });

        describe('passed to the request method', function () {
            // Teepee does pass the option, but it seems like there's a mitm problem that causes this test to fail?
            it.skip('should pass the option to https.request', function () {
                return expect(function (cb) {
                    new Teepee('https://localhost:1234/').request({ rejectUnauthorized: false }, cb);
                }, 'with http mocked out', {
                    request: {
                        rejectUnauthorized: false
                    },
                    response: 200
                }, 'to call the callback without error');
            });
        });
    });

    describe('without a rejectUnauthorized option', function () {
        it('should not send a value to https.request, thus triggering whatever is the default behavior', function () {
            return expect(function (cb) {
                new Teepee('https://localhost:1234/').request(cb);
            }, 'with http mocked out', {
                request: {
                    rejectUnauthorized: undefined
                },
                response: 200
            }, 'to call the callback without error');
        });
    });

    it('should accept a custom agent', function () {
        var agent;
        return expect(function (cb) {
            agent = new http.Agent();

            var teepee = new Teepee({
                url: 'http://localhost:5984/hey/',
                agent: agent
            });

            expect(teepee.agentByProtocol.http, 'to be', agent);

            sinon.spy(agent, 'addRequest');

            teepee.request('quux', cb);
        }, 'with http mocked out', {
            request: 'http://localhost:5984/hey/quux',
            response: 200
        },
        'to call the callback').then(function () {
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
        return expect(function (cb) {
            teepee = new Teepee({
                url: 'http://localhost:5984/hey/',
                Agent: Agent
            });

            teepee.request('quux', cb);
        }, 'with http mocked out', {
            request: 'http://localhost:5984/hey/quux',
            response: 200
        },
        'to call the callback').then(function () {
            expect(teepee.agentByProtocol.http, 'to be an', Agent);
            expect(teepee.agentByProtocol.http.addRequest, 'was called once');
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

    it('should perform a simple request', function () {
        return expect(function (cb) {
            new Teepee('http://localhost:5984').request('bar/quux', cb);
        }, 'with http mocked out', {
            request: 'GET http://localhost:5984/bar/quux',
            response: 200
        }, 'to call the callback without error');
    });

    it('should allow the options object to be omitted', function () {
        return expect(function (cb) {
            new Teepee('http://localhost:5984').request(cb);
        }, 'with http mocked out', {
            request: 'GET http://localhost:5984/',
            response: 200
        }, 'to call the callback without error');
    });

    it('should accept the method before the url', function () {
        return expect(function (cb) {
            new Teepee('http://localhost:5984').request('POST bar/quux', cb);
        }, 'with http mocked out', {
            request: 'POST http://localhost:5984/bar/quux',
            response: 200
        }, 'to call the callback without error');
    });

    it('should allow specifying custom headers', function () {
        return expect(function (cb) {
            new Teepee('http://localhost:5984').request({ path: 'bar/quux', headers: { Foo: 'bar' } }, cb);
        }, 'with http mocked out', {
            request: {
                url: 'GET http://localhost:5984/bar/quux',
                headers: { Foo: 'bar' }
            },
            response: 200
        }, 'to call the callback without error');
    });

    it('should resolve the path from the base url', function () {
        return expect(function (cb) {
            new Teepee('http://localhost:5984/hey/there/').request({ path: '../quux' }, cb);
        }, 'with http mocked out', {
            request: 'GET http://localhost:5984/hey/quux',
            response: 200
        }, 'to call the callback without error');
    });

    it('should default to port 443 on https', function () {
        return expect(function (cb) {
            new Teepee('https://localhost/').request('bar/quux', cb);
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
        }, 'to call the callback without error');
    });

    it('should allow specifying the request body as a Buffer', function () {
        return expect(function (cb) {
            new Teepee('http://localhost:5984/').request({ method: 'POST', path: 'foo', body: new Buffer([1, 2, 3]) }, cb);
        }, 'with http mocked out', {
            request: {
                url: 'POST http://localhost:5984/foo',
                headers: {
                    'Content-Type': undefined
                },
                body: new Buffer([1, 2, 3])
            },
            response: 200
        }, 'to call the callback without error');
    });

    it('should allow specifying the request body as a string', function () {
        return expect(function (cb) {
            new Teepee('http://localhost:5984/').request({ method: 'POST', path: 'foo', body: 'foobar' }, cb);
        }, 'with http mocked out', {
            request: {
                url: 'POST http://localhost:5984/foo',
                headers: {
                    'Content-Type': undefined
                },
                body: new Buffer('foobar', 'utf-8')
            },
            response: 200
        }, 'to call the callback without error');
    });

    it('should allow specifying the request body as an object, implying JSON', function () {
        return expect(function (cb) {
            new Teepee('http://localhost:5984/').request({ method: 'POST', path: 'foo', body: { what: 'gives' } }, cb);
        }, 'with http mocked out', {
            request: {
                url: 'POST http://localhost:5984/foo',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: { what: 'gives' }
            },
            response: 200
        }, 'to call the callback without error');
    });

    it('should return an object with an abort method', function () {
        return expect(function (cb) {
            expect(new Teepee('http://localhost:5984/').request({ method: 'POST', path: 'foo' }, cb), 'to satisfy', {
                abort: expect.it('to be a function')
            });
        }, 'with http mocked out', {
            response: 200
        }, 'to call the callback without error');
    });

    it('should emit a responseBody event when the response body is available', function () {
        return expect(function (cb) {
            teepee('http://localhost/').on('responseBody', function (response) {
                expect(response.body, 'to equal', new Buffer('yaddayaddayadda'));
                cb();
            }).on('error', cb);
        }, 'with http mocked out', {
            response: {
                statusCode: 200,
                body: 'yaddayaddayadda'
            }
        }, 'to call the callback without error');
    });

    it('should not emit the responseBody event if there are no listeners for it', function () {
        var eventEmitter;
        return expect(function (cb) {
            eventEmitter = teepee('http://localhost/');
            eventEmitter.on('response', function (response) {
                response.on('data', function () {}).on('end', cb);
            });
            sinon.spy(eventEmitter, 'emit');
        }, 'with http mocked out', {
            response: {
                statusCode: 200,
                body: 'yaddayaddayadda'
            }
        }, 'to call the callback without error').then(function () {
            expect(eventEmitter.emit, 'was never called with', 'responseBody');
        });
    });

    it('should emit an error when an unsuccessful response is received, just in time for a responseBody listener to be attached', function () {
        var eventEmitter;
        return expect(function (cb) {
            eventEmitter = teepee('http://localhost/');
            eventEmitter.on('error', function (err, response) {
                expect(err, 'to equal', new Teepee.httpErrors.NotFound());
                this.on('responseBody', function (response) {
                    expect(response.body, 'to equal', new Buffer('yaddayaddayadda'));
                    cb();
                });
            });
            sinon.spy(eventEmitter, 'emit');
        }, 'with http mocked out', {
            response: {
                statusCode: 404,
                body: 'yaddayaddayadda'
            }
        }, 'to call the callback without error').then(function () {
            expect(eventEmitter.emit, 'was called with', 'response', expect.it('to be an object'), new Teepee.httpErrors.NotFound());
            expect(eventEmitter.emit, 'was called with', 'error', new Teepee.httpErrors.NotFound());
            expect(eventEmitter.emit, 'was never called with', 'success');
        });
    });

    it('should emit a success event (and no error event) when a successful response is received', function () {
        var eventEmitter;
        return expect(function (cb) {
            eventEmitter = teepee('http://localhost/', cb);
            sinon.spy(eventEmitter, 'emit');
        }, 'with http mocked out', {
            response: 200
        }, 'to call the callback without error').then(function () {
            expect(eventEmitter.emit, 'was called with', 'response', expect.it('to be an object'), undefined);
            expect(eventEmitter.emit, 'was called with', 'success');
            expect(eventEmitter.emit, 'was never called with', 'error');
        });
    });

    describe('with a request timeout', function () {
        describe('passed to the request method', function () {
            it('should abort the request and emit an error if no response has been received before the timeout', function () {
                return expect(function (cb) {
                    new Teepee('http://www.gofish.dk/').request({timeout: 1})
                        .on('error', function (err) {
                            expect(err, 'to equal', new socketErrors.ETIMEDOUT());
                            cb();
                        });
                }, 'to call the callback without error');
            });
        });

        describe('passed to the constructor method', function () {
            it('should abort the request and emit an error if no response has been received before the timeout', function () {
                return expect(function (cb) {
                    new Teepee({url: 'http://www.gofish.dk/', timeout: 1}).request()
                        .on('error', function (err) {
                            expect(err, 'to equal', new socketErrors.ETIMEDOUT());
                            cb();
                        });
                }, 'to call the callback without error');
            });
        });
    });

    describe('retrying on failure', function () {
        it('should return a successful response when a failed GET is retried `numRetries` times', function () {
            return expect(function (cb) {
                new Teepee('http://localhost:5984/').request({ path: 'foo', numRetries: 2 }, cb);
            }, 'with http mocked out', [
                { response: new socketErrors.ETIMEDOUT() },
                { response: new socketErrors.ETIMEDOUT() },
                { response: 200 }
            ], 'to call the callback without error');
        });

        it('should emit a retriedRequest every time a request is retried', function () {
            var teepee = new Teepee('http://localhost:1234/'),
                successfulRequestListener = sinon.spy(),
                failedRequestListener = sinon.spy(),
                retriedRequestListener = sinon.spy();
            teepee
                .on('failedRequest', failedRequestListener)
                .on('successfulRequest', successfulRequestListener)
                .on('retriedRequest', retriedRequestListener);
            return expect(function (cb) {
                teepee.request({ path: 'foo', numRetries: 2, retry: [ 501 ] }, cb);
            }, 'with http mocked out', [
                { response: new socketErrors.ETIMEDOUT() },
                { response: 501 },
                { response: 200 }
            ], 'to call the callback without error').then(function () {
                expect(failedRequestListener, 'was not called');
                expect(successfulRequestListener, 'was called once');
                expect(retriedRequestListener.args, 'to satisfy', [
                    [
                        {
                            numRetriesLeft: 1,
                            err: new socketErrors.ETIMEDOUT(),
                            requestOptions: { host: 'localhost' } // ...
                        }
                    ],
                    [
                        {
                            numRetriesLeft: 0,
                            err: new httpErrors.NotImplemented(),
                            requestOptions: { host: 'localhost' } // ...
                        }
                    ]
                ]);
            });
        });

        it('should give up if the request fails 1 + `numRetries` times', function () {
            return expect(function (cb) {
                new Teepee('http://localhost:5984/').request({ path: 'foo', numRetries: 2 }, cb);
            }, 'with http mocked out', [
                { response: new socketErrors.ETIMEDOUT() },
                { response: new socketErrors.ETIMEDOUT() },
                { response: new socketErrors.ETIMEDOUT() }
            ], 'to call the callback with error', new socketErrors.ETIMEDOUT());
        });

        it('should not attempt to retry a request with the body given as a stream, despite a `numRetries` setting', function () {
            return expect(function (cb) {
                new Teepee('http://localhost:5984/')
                    .request({ method: 'POST', body: fs.createReadStream(pathModule.resolve(__dirname, '..', 'testdata', '0byte')), path: 'foo', numRetries: 2 }, cb);
            }, 'with http mocked out', {
                response: new socketErrors.ETIMEDOUT()
            }, 'to call the callback with error', new socketErrors.ETIMEDOUT());
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
                    return expect(function (cb) {
                        new Teepee({ url: 'http://localhost:5984/', retryDelayMilliseconds: 3, numRetries: 1 }).request(cb);
                    }, 'with http mocked out', [
                        { response: new socketErrors.ETIMEDOUT() },
                        { response: 200 }
                    ], 'to call the callback without error').then(function () {
                        expect(setTimeoutSpy, 'was called with', expect.it('to be a function'), 3);
                    });
                });
            });

            describe('when passed to the request function', function () {
                it('waits that many milliseconds before retrying', function () {
                    return expect(function (cb) {
                        new Teepee('http://localhost:5984/').request({ path: 'foo', numRetries: 1, retryDelayMilliseconds: 3 }, cb);
                    }, 'with http mocked out', [
                        { response: new socketErrors.ETIMEDOUT() },
                        { response: 200 }
                    ], 'to call the callback without error').then(function () {
                        expect(setTimeoutSpy, 'was called with', expect.it('to be a function'), 3);
                    });
                });
            });
        });

        describe('with the retry option', function () {
            describe('with an array of numbers', function () {
                it('should retry a non-successful request if the HTTP status code is in the array', function () {
                    return expect(function (cb) {
                        new Teepee('http://localhost:5984/').request({ path: 'foo', numRetries: 2, retry: [504] }, cb);
                    }, 'with http mocked out', [
                        { response: 504 },
                        { response: 504 },
                        { response: 200 }
                    ], 'to call the callback without error');
                });

                it('should not retry a non-successful request if the HTTP status code is in the array, but there is a request event listener', function () {
                    return expect(function (cb) {
                        new Teepee({
                            url: 'http://localhost:5984/',
                            // The mitm module emits events synchronously, which means that we don't get to add the request listener
                            // before the mock response has already been received. This hack ensures that the response is delayed
                            // until the next tick as it will be when we're using the http module. I'd rather do this here than in
                            // the code itself to avoid waiting an extra tick for all requests:
                            preprocessRequestOptions: function (requestOptions, options, cb) {
                                setImmediate(cb);
                            }
                        })
                            .request({ path: 'foo', numRetries: 2, retry: [504] }, cb)
                            .on('request', function (request) {});
                    }, 'with http mocked out', [
                        { response: 504 }
                    ], 'to call the callback with error', new httpErrors.GatewayTimeout());
                });

                it('should not retry a non-successful request if the HTTP status code is not in the array', function () {
                    return expect(function (cb) {
                        new Teepee('http://localhost:5984/').request({ path: 'foo', numRetries: 2, retry: [504] }, cb);
                    }, 'with http mocked out', [
                        { response: 503 }
                    ], 'to call the callback with error', new httpErrors.ServiceUnavailable());
                });
            });
        });
    });

    it('should handle ECONNREFUSED', function () {
        return expect(function (cb) {
            new Teepee('http://localhost:5984/').request('foo', cb);
        }, 'with http mocked out', {
            response: new socketErrors.ECONNREFUSED('connect ECONNREFUSED')
        }, 'to call the callback with error', new socketErrors.ECONNREFUSED('connect ECONNREFUSED'));
    });

    it('should handle unknown errors', function () {
        var error = new Error('something else');

        return expect(function (cb) {
            new Teepee('http://localhost:5984/').request('foo', cb);
        }, 'with http mocked out', {
            response: error
        }, 'to call the callback with error', new httpErrors[500](error.message));
    });

    describe('with a streamed response', function () {
        it('should handle simple response stream', function () {
            var responseStream = new stream.Readable();
            responseStream._read = function () {
                responseStream.push(new Buffer(JSON.stringify({ a: 1, b: 2 })));
                responseStream.push(null);
            };

            return expect(function (cb) {
                new Teepee('http://localhost:5984/').request('foo', cb);
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
            }, 'to call the callback without error');
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

            return expect(function (cb) {
                new Teepee('http://localhost:5984/').request('foo', cb);
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
            }, 'to call the callback without error').spread(function (response, body) {
                return expect(body, 'to equal', responseObject);
            });
        });

        it('should throw an error on invalid JSON', function () {
            var responseStream = new stream.Readable();
            responseStream._read = function () {
                responseStream.push(new Buffer('{]'));
                responseStream.push(null);
            };

            return expect(function (cb) {
                new Teepee('http://localhost:5984/').request('foo', cb);
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
            }, 'to call the callback with error', new httpErrors.BadGateway('Error parsing JSON response body'));
        });
    });

    describe('with a query', function () {
        it('should allow specifying the query string as a string', function () {
            return expect(function (cb) {
                new Teepee('http://localhost:5984/').request({ path: 'bar/quux', query: 'blabla' }, cb);
            }, 'with http mocked out', {
                request: 'GET http://localhost:5984/bar/quux?blabla',
                response: 200
            }, 'to call the callback without error');
        });

        it('should allow specifying the query string as an object', function () {
            return expect(function (cb) {
                new Teepee('http://localhost:5984/').request({ path: 'bar/quux', query: {
                    ascii: 'blabla',
                    nønascïî: 'nønascïî',
                    multiple: [ 'foo', 'nønascïî' ],
                    iAmUndefined: undefined
                }}, cb);
            }, 'with http mocked out', {
                request: 'GET http://localhost:5984/bar/quux' +
                    '?ascii=blabla' +
                    '&n%C3%B8nasc%C3%AF%C3%AE=n%C3%B8nasc%C3%AF%C3%AE' +
                    '&multiple=foo' +
                    '&multiple=n%C3%B8nasc%C3%AF%C3%AE',
                response: 200
            }, 'to call the callback without error');
        });
    });

    describe('with a url containing placeholders', function () {
        it('should substitute a placeholder with a value found in the options object passed to request (and prefer it over an identically named one passed to the constructor)', function () {
            var teepee = new Teepee({
                domainName: 'the.wrong.one',
                url: 'http://{domainName}.contacts/foo/'
            });

            return expect(function (cb) {
                teepee.request({
                    domainName: 'example.com',
                    path: 'hey'
                }, cb);
            }, 'with http mocked out', {
                request: 'http://example.com.contacts/foo/hey'
            }, 'to call the callback without error');
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

            return expect(function (cb) {
                teepee.request({
                    domainName: 'example.com',
                    path: 'hey'
                }, function (err) {
                    if (err) {
                        throw err;
                    }
                    teepee.request({
                        domainName: 'example.info',
                        path: 'there'
                    }, cb);
                });
            }, 'with http mocked out', [
                { request: 'http://couchdb3.example.com/contacts0/hey' },
                { request: 'http://couchdb4.example.com/contacts1/there' }
            ], 'to call the callback without error');
        });

        it('should support passing a falsy value in request options', function () {
            var teepee = new Teepee({
                url: 'http://couchdb{{partitionNumber} === 0 ? 3 : 4}.example.com/contacts{partitionNumber}',
                partitionPoints: ['info']
            });
            return expect(function (cb) {
                teepee.request({
                    partitionNumber: 0,
                    path: 'hey'
                }, cb);
            }, 'with http mocked out', {
                request: 'http://couchdb3.example.com/contacts0/hey'
            }, 'to call the callback without error');
        });

        it('should substitute a placeholder with a value found in the options object passed to the constructor', function () {
            var teepee = new Teepee({
                domainName: 'example.com',
                url: 'http://{domainName}.contacts/foo/'
            });

            return expect(function (cb) {
                teepee.request({path: 'hey'}, cb);
            }, 'with http mocked out', {
                request: 'http://example.com.contacts/foo/hey'
            }, 'to call the callback without error');
        });

        it('should substitute a placeholder with the result of calling a function of that name passed to the request method', function () {
            var teepee = new Teepee({
                domainName: function (requestOptions, placeholderName) {
                    return requestOptions.owner.replace(/^.*@/, '');
                },
                url: 'http://{domainName}.contacts/foo/'
            });

            return expect(function (cb) {
                teepee.request({path: 'hey', owner: 'andreas@example.com'}, cb);
            }, 'with http mocked out', {
                request: 'http://example.com.contacts/foo/hey'
            }, 'to call the callback without error');
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
                return expect(function (cb) {
                    teepee.request('foo', cb);
                }, 'with http mocked out', {
                    request: {
                        encrypted: true,
                        url: 'GET /foo',
                        cert: zero,
                        key: one,
                        ca: two
                    }
                }, 'to call the callback without error');
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
                return expect(function (cb) {
                    teepee.request('foo', cb);
                }, 'with http mocked out', {
                    request: {
                        encrypted: true,
                        url: 'GET /foo',
                        cert: zero,
                        key: one,
                        ca: [two, three]
                    }
                }, 'to call the callback without error');
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
            server.listen(59891);

            var teepee = new Teepee({
                url: 'http://localhost:59891/',
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

        it('should not exhaust the pool on HTTP error status when the EventEmitter-based interface is used', function () {
            var server = require('http').createServer(function (req, res) {
                res.statusCode = 404;
                res.end();
            });
            var timeoutLimit = this.timeout() - 200;
            server.listen(59891);

            var teepee = new Teepee({
                url: 'http://localhost:59891/',
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
            return expect(function (cb) {
                return new Teepee({ username: 'foobar', password: 'quux', url: 'https://localhost:4232/'}).request(cb);
            }, 'with http mocked out', {
                request: {
                    url: 'https://localhost:4232/',
                    headers: {
                        Authorization: 'Basic Zm9vYmFyOnF1dXg=' // foobar:quux
                    }
                },
                response: 200
            }, 'to call the callback without error');
        });
    });

    describe('with a username and password passed to the request method', function () {
        it('should use them as basic auth credentials', function () {
            return expect(function (cb) {
                return new Teepee('https://localhost:4232/').request({ username: 'foobar', password: 'quux' }, cb);
            }, 'with http mocked out', {
                request: {
                    url: 'https://localhost:4232/',
                    headers: {
                        Authorization: 'Basic Zm9vYmFyOnF1dXg=' // foobar:quux
                    }
                },
                response: 200
            }, 'to call the callback without error');
        });
    });

    describe('with a username and password in the url', function () {
        it('should use them as basic auth credentials', function () {
            return expect(function (cb) {
                teepee('https://foobar:quux@localhost:4232/', cb);
            }, 'with http mocked out', {
                request: {
                    url: 'https://localhost:4232/',
                    headers: {
                        Authorization: 'Basic Zm9vYmFyOnF1dXg='
                    }
                },
                response: 200
            }, 'to call the callback without error');
        });

        it('should support percent-encoded octets, including colons, and a non-encoded colon in the password', function () {
            return expect(function (cb) {
                teepee('http://fo%C3%A6o%25bar:baz%25quux:yadda@localhost:4232/', cb);
            }, 'with http mocked out', {
                request: {
                    url: 'http://localhost:4232/',
                    headers: {
                        Authorization: 'Basic Zm/Dpm8lYmFyOmJheiVxdXV4OnlhZGRh'
                    }
                },
                response: 200
            }, 'to call the callback without error');
        });

        it('should leave all percent encoded octets in the username if one of them does not decode as UTF-8', function () {
            return expect(function (cb) {
                teepee('http://fo%C3%A6o%25bar%C3:baz%C3%A6quux:yadda@localhost:4232/', cb);
            }, 'with http mocked out', {
                request: {
                    url: 'http://localhost:4232/',
                    headers: {
                        Authorization: 'Basic Zm8lQzMlQTZvJTI1YmFyJUMzOmJhesOmcXV1eDp5YWRkYQ=='
                    }
                },
                response: 200
            }, 'to call the callback without error');
        });
    });

    describe('when invoked without new', function () {
        it('should perform a request directly', function () {
            return expect(function (cb) {
                teepee('https://localhost:8000/', cb);
            }, 'with http mocked out', {
                request: 'GET http://localhost:8000/',
                response: 200
            }, 'to call the callback without error');
        });

        it('should accept the method before the url', function () {
            return expect(function (cb) {
                teepee('POST https://localhost:8000/', cb);
            }, 'with http mocked out', {
                request: 'POST http://localhost:8000/',
                response: 200
            }, 'to call the callback without error');
        });

        // Regression test
        it('should allow specifying a request body', function () {
            return expect(function (cb) {
                teepee({ url: 'http://localhost:5984/', method: 'POST', body: { what: 'gives' } }, cb);
            }, 'with http mocked out', {
                request: {
                    url: 'POST http://localhost:5984/',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: { what: 'gives' }
                },
                response: 200
            }, 'to call the callback without error');
        });
    });

    expect.addAssertion('array', 'to result in request', function (expect, subject, value) {
        return expect(function (cb) {
            return new Teepee(subject[0]).request(subject[1], cb);
        }, 'with http mocked out', {
            request: value,
            response: 200
        }, 'to call the callback without error');
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

        describe('with an absolute relative request url', function () {
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
            return expect(function (cb) {
                new Teepee('https://localhost:8000/').request({url: 'bar'}, cb);
            }, 'with http mocked out', {
                request: 'http://localhost:8000/bar',
                response: 200
            }, 'to call the callback without error');
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
                subsidiaryRequestListener = sinon.spy(),
                requestListener = sinon.spy();

            teepee.on('request', requestListener);
            subsidiary.on('request', subsidiaryRequestListener);

            return expect(function (cb) {
                subsidiary.request(passError(cb, function () {
                    teepee.request(cb);
                }));
            }, 'with http mocked out', [
                { response: 200 },
                { response: 200 }
            ], 'to call the callback without error').then(function () {
                expect(subsidiaryRequestListener, 'was called once');
                expect(requestListener, 'was called twice');
                expect(requestListener.args, 'to satisfy', [
                    [ { requestOptions: { port: 4567 } } ],
                    [ { requestOptions: { port: 1234 } } ]
                ]);
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
});
