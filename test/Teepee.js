/*global describe, it, __dirname, JSON, clearTimeout, setTimeout, setImmediate*/
var Teepee = require('../lib/Teepee'),
    httpErrors = require('httperrors'),
    socketErrors = require('socketerrors'),
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

    it('should accept a custom agent', function () {
        var agent;
        return expect(function (cb) {
            agent = new http.Agent();

            var teepee = new Teepee({
                url: 'http://localhost:5984/hey/',
                agent: agent
            });

            expect(teepee.agent, 'to be', agent);

            sinon.spy(agent, 'addRequest');

            teepee.request({ path: 'quux' }, cb);
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

            teepee.request({ path: 'quux' }, cb);
        }, 'with http mocked out', {
            request: 'http://localhost:5984/hey/quux',
            response: 200
        },
        'to call the callback').then(function () {
            expect(teepee.agent, 'to be an', Agent);
            expect(teepee.agent.addRequest, 'was called once');
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
            new Teepee('http://localhost:5984').request({ path: 'bar/quux' }, cb);
        }, 'with http mocked out', {
            request: 'GET http://localhost:5984/bar/quux',
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
            new Teepee('http://localhost:5984/hey/there').request({ path: '../quux' }, cb);
        }, 'with http mocked out', {
            request: 'GET http://localhost:5984/hey/quux',
            response: 200
        }, 'to call the callback without error');
    });

    it('should default to port 443 on https', function () {
        return expect(function (cb) {
            new Teepee('https://localhost/').request({ path: 'bar/quux' }, cb);
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
            new Teepee('http://localhost:5984/').request({ path: 'foo' }, cb);
        }, 'with http mocked out', {
            response: new socketErrors.ECONNREFUSED('connect ECONNREFUSED')
        }, 'to call the callback with error', new socketErrors.ECONNREFUSED('connect ECONNREFUSED'));
    });

    it('should handle unknown errors', function () {
        var error = new Error('something else');

        return expect(function (cb) {
            new Teepee('http://localhost:5984/').request({ path: 'foo' }, cb);
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
                new Teepee('http://localhost:5984/').request({ method: 'GET', path: 'foo' }, cb);
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
                new Teepee('http://localhost:5984/').request({ method: 'GET', path: 'foo' }, cb);
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
                new Teepee('http://localhost:5984/').request({ method: 'GET', path: 'foo' }, cb);
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
                    teepee.request({path: 'foo'}, cb);
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
                    teepee.request({path: 'foo'}, cb);
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

                    teepee.request({path: 'foo'}, done);
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
                    teepee.request({path: 'foo'}).on('error', run(function () {}));
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
});
