/*global JSON*/
var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    urlModule = require('url'),
    _ = require('underscore'),
    lines = require('lines'),
    fs = require('fs'),
    httpErrors = require('httperrors'),
    socketErrors = require('socketerrors'),
    os = require('os'),
    passError = require('passerror'),
    http = require('http'),
    https = require('https');

function isContentTypeJson(contentType) {
    return /^application\/json\b|\+json\b/i.test(contentType);
}

function resolveCertKeyOrCa(value) {
    if (typeof value === 'string') {
        return fs.readFileSync(value.replace(/\{hostname\}/g, os.hostname()));
    } else if (Array.isArray(value)) {
        // An array of ca file names
        return value.map(resolveCertKeyOrCa);
    } else {
        return value;
    }
}

/*
 * config.url            {String}             The base url for all requests
 * config.trustViewETags {Boolean} (optional) Whether to support conditional GET on views. Defaults to true.
 *                                            This can be problematic in some development settings where database are deleted
 *                                            and recreated, see https://issues.apache.org/jira/browse/COUCHDB-909
 * config.numRetries     {Number}  (optional) The number of times to retry an operation if it fails due to a non-HTTP error such
 *                                           as a socket timeout. Defaults to 0.
 * config.agent          {Object}  (optional) The HTTP/HTTPS agent to use. Defaults to creating a new one with the below options.
 * config.maxSockets     {Number}  (optional) The maximum number of simultaneous connections to support. Only used if config.agent isn't provided.
 * config.keepAlive      {Number}  (optional) Passed to the Agent constructor. Only used if config.agent isn't provided.
 * config.keepAliveMsecs {Number}  (optional) Passed to the Agent constructor. Only used if config.agent isn't provided.
 * config.maxSockets     {Number}  (optional) Passed to the Agent constructor. Only used if config.agent isn't provided.
 * config.maxFreeSockets {Number}  (optional) Passed to the Agent constructor. Only used if config.agent isn't provided.
 * config.cert           {Buffer}  (optional) The certificate to use. Only used if config.agent isn't provided.
 * config.key            {Buffer}  (optional) The certificate key to use. Only used if config.agent isn't provided.
 * config.ca             {Buffer}  (optional) The certificate authority (CA) to use. Only used if config.agent isn't provided.
 */
function Teepee(config) {
    EventEmitter.call(this);

    this._userSuppliedConfigOptionNames = [];
    if (config) {
        Object.keys(config).forEach(function (key) {
            if (key === 'cert' || key === 'key' || key === 'ca') {
                this[key] = resolveCertKeyOrCa(config[key]);
                this._userSuppliedConfigOptionNames.push(key);
            } else if (typeof this[key] === 'undefined') {
                this[key] = config[key];
                this._userSuppliedConfigOptionNames.push(key);
            } else {
                // Ignore unsupported property that would overwrite or shadow for a built-in property or method
            }
        }, this);
    }

    // Ensure no trailing slash:
    if (Array.isArray(this.url)) {
        this.url = this.url.map(function (url) {
            return url.replace(/\/$/, '');
        });
    } else if (typeof this.url === 'string') {
        this.url = this.url.replace(/\/$/, '');
    } else {
        throw new Error('config.url is required');
    }

    this.numRetries = this.numRetries || 0;
}

util.inherits(Teepee, EventEmitter);

_.extend(Teepee.prototype, {
    extractNonRequestOptions: function (obj) {
        var result = {};
        if (obj) {
            Object.keys(obj).forEach(function (key) {
                if (key !== 'method' && key !== 'headers' && key !== 'path' && key !== 'query' && key !== 'streamRows' && key !== 'eventEmitter' && key !== 'url' && key !== 'path') {
                    result[key] = obj[key];
                }
            });
        }
        return result;
    },

    preprocessQueryStringParameterValue: function (queryStringParameterValue) {
        return queryStringParameterValue;
    },

    stringifyJsonRequestBody: JSON.stringify,

    _addQueryStringToUrl: function (url, query) {
        if (typeof query !== 'undefined') {
            url += (url.indexOf('?') !== -1) ? '&' : '?';
            if (typeof query === 'string') {
                url += query;
            } else {
                // Assume object
                var params = [];
                Object.keys(query).forEach(function (key) {
                    var value = query[key];
                    if (Array.isArray(value)) {
                        // Turn query: {foo: ['a', 'b']} into ?foo=a&foo=b
                        value.forEach(function (valueArrayItem) {
                            params.push(encodeURIComponent(key) + '=' + encodeURIComponent(this.preprocessQueryStringParameterValue(valueArrayItem)));
                        }, this);
                    } else if (typeof value !== 'undefined') {
                        params.push(encodeURIComponent(key) + '=' + encodeURIComponent(this.preprocessQueryStringParameterValue(value)));
                    }
                }, this);
                url += params.join('&');
            }
        }
        return url;
    },

    getPlaceholderValue: function (placeholderName, requestOptions) {
        if (typeof requestOptions[placeholderName] !== 'undefined') {
            return requestOptions[placeholderName];
        } else {
            var type = typeof this[placeholderName];
            if (type === 'undefined') {
                return '{' + placeholderName + '}';
            } else {
                var value = this[placeholderName];
                if (typeof value === 'function') {
                    return value.call(this, requestOptions, placeholderName);
                } else {
                    return String(value);
                }
            }
        }
    },

    expandUrl: function (url, requestOptions) {
        requestOptions = requestOptions || {};
        var that = this;
        return url.replace(/\{((?:[^\{\}]+|\{\w+\})*)\}/g, function ($0, placeholderName) {
            if (/^\w+$/.test(placeholderName)) {
                return that.getPlaceholderValue(placeholderName, requestOptions, $0);
            } else {
                var methodName = '__placeholder_fn_' + placeholderName;
                if (!that[methodName]) {
                    /*jshint evil:true*/
                    that[methodName] = new Function('requestOptions', 'return ' + placeholderName.replace(/\{(\w+)\}/g, 'this.getPlaceholderValue("$1", requestOptions)') + ';');
                    /*jshint evil:false*/
                }
                return that[methodName](requestOptions);
            }
        });
    },

    getAgent: function () {
        if (!this.agent) {
            var agentOptions = {};
            // Pass all instance variables that originate from the user-supplied config object to the Agent constructor:
            this._userSuppliedConfigOptionNames.forEach(function (userSuppliedConfigOptionName) {
                var value = this[userSuppliedConfigOptionName];
                if (typeof value !== 'undefined') {
                    agentOptions[userSuppliedConfigOptionName] = value;
                }
            }, this);
            var Agent = this.Agent || require(urlModule.parse(this.url).protocol.replace(/:$/, '')).Agent;
            this.agent = new Agent(agentOptions);
        }
        return this.agent;
    },

    /*
     * Perform a request
     *
     * options.headers    {Object} (optional) The HTTP headers for the request.
     * options.path       {String} (optional) The path relative to the database url.
     * options.query      {Object} (optional) The query string (objects will be JSON.stringify'ed)
     * options.body       {String|Object|Buffer|Stream} (optional) What to send. Streams are streamed, objects will be serialized as JSON,
     *                                                             and buffers are sent as-is.
     * options.numRetries {Number} (optional) The number of times to retry an operation if it fails due to a non-HTTP error such
     *                                        as a socket timeout. Defaults to the numRetries parameter given to the constructor
     *                                        (which defaults to 0). Has no effect with the onResponse and streamRows options.
     * options.streamRows {Boolean} (optional) If specified, an event emitter will be returned that emits error/metadata/row/end events.
     *                                         This is useful for big responses that you don't want to parse in one go. Defaults to false.
     */
    request: function (options, cb) {
        var that = this,
            numRetriesLeft = options.streamRows ? 0 : typeof options.numRetries !== 'undefined' ? options.numRetries : this.numRetries,
            retry = typeof options.retry !== 'undefined' ? options.retry : this.retry,
            headers = _.extend({}, options.headers),
            url = this.expandUrl(this.url, options);
        if (options.path) {
            if (/^[\/\.]/.test(options.path)) {
                // options.path is root-relative or begins with a dot, treat it as a relative url that needs to be resolved:
                url = urlModule.resolve(url + '/', options.path);
            } else {
                url += '/' + options.path;
            }
        }
        url = this._addQueryStringToUrl(url, options.query);

        var body = options.body;
        if (typeof body === 'object' && !Buffer.isBuffer(body) && typeof body.pipe !== 'function') {
            body = this.stringifyJsonRequestBody(body);
            headers['content-type'] = 'application/json';
        }

        if (!('accept' in headers)) {
            headers.accept = 'application/json';
        }

        var eventEmitter = new EventEmitter(),
            urlObj = urlModule.parse(url),
            httpModule = (urlObj.protocol === 'https:' ? https : http),
            requestOptions = {
                host: urlObj.hostname,
                port: urlObj.port === null ? 80 : parseInt(urlObj.port, 10),
                method: options.method || 'GET',
                path: urlObj.path,
                headers: headers,
                agent: this.getAgent()
            },
            done = false,
            currentRequest;

        eventEmitter.abort = function () {
            done = true;
            if (currentRequest) {
                currentRequest.abort();
                currentRequest = null;
            }
        };

        function handleError(err, response) {
            var socketError;

            if (!done) {
                done = true;

                // if what came up was a plain error convert it to an httpError
                if (!err.statusCode) {
                    socketError = socketErrors(err);

                    if (!socketError.NotSocketError) {
                        err = socketError;
                    } else {
                        // convert to a 500 internal server error
                        err = new httpErrors[500](err.message);
                    }
                }

                that.emit('failedRequest', { url: url, requestOptions: requestOptions, response: response, err: err, numRetriesLeft: numRetriesLeft });
                if (cb) {
                    cb(err);
                } else {
                    eventEmitter.emit('error', err);
                }
            }
        }

        function handleSuccess(response) {
            if (!done) {
                done = true;
                that.emit('successfulRequest', { url: url, requestOptions: requestOptions, response: response });
                eventEmitter.emit('end');
                if (cb) {
                    cb(null, response, response && response.body);
                }
            }
        }

        if (this.preprocessRequestOptions) {
            this.preprocessRequestOptions(requestOptions, options, passError(handleError, dispatchRequest));
        } else {
            dispatchRequest();
        }

        function dispatchRequest() {
            currentRequest = httpModule.request(requestOptions);
            if (eventEmitter.listeners('request').length > 0) {
                numRetriesLeft = 0;
                eventEmitter.emit('request', currentRequest);
            }
            if (body && typeof body.pipe === 'function') {
                numRetriesLeft = 0;
                body.pipe(currentRequest);
            } else {
                currentRequest.end(body);
            }
            currentRequest.on('error', function (err) {
                currentRequest = null;
                if (done) {
                    return;
                }
                // Non-HTTP error (ECONNRESET, ETIMEDOUT, etc.)
                // Try again (up to numRetriesLeft times). Warning: This doesn't work when piping into the returned request,
                // so please specify numRetriesLeft:0 if you intend to do that.
                if (numRetriesLeft > 0) {
                    numRetriesLeft -= 1;
                    dispatchRequest();
                } else {
                    handleError(err);
                }
            }).on('response', function (response) {
                var responseError;

                if (done) {
                    return;
                }

                function returnSuccessOrError(err) {
                    err = err || responseError;

                    if (!err) {
                        handleSuccess(response);
                    } else {
                        handleError(err, response);
                    }
                }

                response.cacheInfo = { headers: {} };
                if (response.statusCode >= 400) {
                    if (numRetriesLeft > 0 && Array.isArray(retry) && retry.indexOf(response.statusCode) !== -1) {
                        response
                            .on('data', function () {})
                            .on('error', function () {});
                        numRetriesLeft -= 1;
                        dispatchRequest();
                        return;
                    }
                    responseError = new httpErrors[response.statusCode]();
                } else if (response.statusCode === 304) {
                    response.cacheInfo.notModified = true;
                    body = null;
                }
                numRetriesLeft = 0;
                ['last-modified', 'etag', 'expires', 'cache-control', 'content-type'].forEach(function (headerName) {
                    if (headerName in response.headers) {
                        response.cacheInfo.headers[headerName] = response.headers[headerName];
                    }
                });

                if (!responseError) {
                    eventEmitter.emit('response', response);
                }

                if (options.streamRows) {
                    response.setEncoding('utf-8');
                    lines(response);
                    response.on('line', function (str) {
                        if (done) {
                            return;
                        }

                        // use a regex to match the JSON metadata row and emit it
                        // both populated and empty result cases are handled
                        var matchFirstLine = str.match(/^\{(.*)"(?:rows|results)":\s*\[(?:\]\}|)$/);
                        if (matchFirstLine) {
                            if (matchFirstLine[1] !== "") {
                                eventEmitter.emit('metadata', JSON.parse('{' + matchFirstLine[1].replace(/\,\s*$/, '') + '}'));
                            }
                        } else {
                            var matchLastLine = str.match(/^(".*)\}$/);
                            if (matchLastLine) {
                                eventEmitter.emit('metadata', JSON.parse('{' + matchLastLine[1] + '}'));
                            } else if (str === ']}' || str === '' || str === '],') {
                                return;
                            } else {
                                str = str.replace(/,\r?$/, '');
                                var row;
                                try {
                                    row = JSON.parse(str);
                                } catch (e) {
                                    handleError(httpErrors.InternalServerError("Couldn't parse line: " + str), response);
                                }
                                eventEmitter.emit('row', row);
                            }
                        }
                    }).on('error', returnSuccessOrError).on('end', returnSuccessOrError);
                } else if (cb) {
                    var responseBodyChunks = [];
                    response.on('data', function (responseBodyChunk) {
                        responseBodyChunks.push(responseBodyChunk);
                    }).on('error', returnSuccessOrError).on('end', function () {
                        currentRequest = null;
                        if (responseBodyChunks.length > 0) {
                            response.body = Buffer.concat(responseBodyChunks);
                            if (isContentTypeJson(response.headers['content-type'])) {
                                try {
                                    response.body = JSON.parse(response.body.toString('utf-8'));
                                } catch (e) {
                                    return handleError(new httpErrors.BadGateway('Error parsing JSON response body'), response);
                                }
                            }
                        }
                        returnSuccessOrError();
                    });
                } else {
                    if (responseError) {
                        response.on('data', function () {});
                    }
                    returnSuccessOrError();
                }
            });
        }

        return eventEmitter;
    },

    quit: function () {
        // agent.destroy became available in node.js 0.12:
        if (this.agent && this.agent.destroy) {
            this.agent.destroy();
        }
    }
});

// Expose the httpErrors module so that test suites for modules using Teepee can use the correct constructors:
Teepee.httpErrors = httpErrors;

module.exports = Teepee;
