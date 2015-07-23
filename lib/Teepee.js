/*global JSON, btoa, setTimeout, clearTimeout, setImmediate*/
var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    urlModule = require('url'),
    _ = require('underscore'),
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

function safeDecodeURIComponent(str) {
    try {
        return decodeURIComponent(str);
    } catch (e) {
        // Assume URIError: URI malformed (percent encoded octets that don't decode as UTF-8)
        return str;
    }
}

/*
 * config.url                {String}             The base url for all requests
 * config.headers            {Object}  (optional) Default headers to send for every request (headers passed to request take precedence).
 * config.numRetries         {Number}  (optional) The number of times to retry an operation if it fails due to a non-HTTP error such
 *                                                  as a socket timeout. Defaults to 0.
 * config.timeout            {Number}  (optional) The maximum number of milliseconds to wait for the request to complete. If combined with retry,
 *                                                  the timeout will apply to the individual request, not the sequence of requests.
 * config.rejectUnauthorized {Boolean} (optional) Whether to consider an HTTPS request failed if the remote cert doesn't validate.
 * config.agent              {Object}  (optional) The HTTP/HTTPS agent to use. Defaults to creating a new one with the below options.
 * config.maxSockets         {Number}  (optional) The maximum number of simultaneous connections to support. Only used if config.agent isn't provided.
 * config.keepAlive          {Number}  (optional) Passed to the Agent constructor. Only used if config.agent isn't provided.
 * config.keepAliveMsecs     {Number}  (optional) Passed to the Agent constructor. Only used if config.agent isn't provided.
 * config.maxSockets         {Number}  (optional) Passed to the Agent constructor. Only used if config.agent isn't provided.
 * config.maxFreeSockets     {Number}  (optional) Passed to the Agent constructor. Only used if config.agent isn't provided.
 * config.cert               {Buffer}  (optional) The certificate to use. Only used if config.agent isn't provided.
 * config.key                {Buffer}  (optional) The certificate key to use. Only used if config.agent isn't provided.
 * config.ca                 {Buffer}  (optional) The certificate authority (CA) to use. Only used if config.agent isn't provided.
 */
function Teepee(config) {
    if (!(this instanceof Teepee)) {
        // Invoked without new, shorthand for issuing a request
        var teepee = new Teepee(config);
        return teepee.request.call(teepee, {}, arguments[1]);
    }

    EventEmitter.call(this);

    if (typeof config === 'string') {
        config = { url: config };
    }

    this._userSuppliedConfigOptionNames = [];
    if (config) {
        Object.keys(config).forEach(function (key) {
            if (key === 'agent') {
                var agent = config[key],
                    protocol = config.url && /^https:/.test(config.url) ? 'https' : 'http';
                this.agentByProtocol = this.agentByProtocol || {};
                this.agentByProtocol[protocol] = agent;
            } else if (key === 'cert' || key === 'key' || key === 'ca') {
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

    if (typeof this.url === 'string') {
        if (/^[A-Z]+ /.test(this.url)) {
            var urlFragments = this.url.split(' ');
            if (urlFragments.length > 1) {
                this.method = urlFragments.shift();
                this.url = urlFragments.join(' ');
            }
        }
    }
}

util.inherits(Teepee, EventEmitter);

Teepee.prototype.subsidiary = function (config) {
    var subsidiary = new Teepee(config);

    if (this.headers) {
        if (subsidiary.headers) {
            _.defaults(subsidiary.headers, this.headers);
        } else {
            subsidiary.headers = _.clone(this.headers);
        }
    }

    // Make sure that the subsidiary will get the same object so all agents are shared:
    this.agentByProtocol = this.agentByProtocol || {};

    _.defaults(subsidiary, this);

    return subsidiary;
};

Teepee.prototype.extractNonRequestOptions = function (obj) {
    var result = {};
    if (obj) {
        Object.keys(obj).forEach(function (key) {
            if (key !== 'method' && key !== 'headers' && key !== 'path' && key !== 'query' && key !== 'streamRows' && key !== 'eventEmitter' && key !== 'url' && key !== 'path') {
                result[key] = obj[key];
            }
        });
    }
    return result;
};

Teepee.prototype.preprocessQueryStringParameterValue = function (queryStringParameterValue) {
    return queryStringParameterValue;
};

Teepee.prototype.stringifyJsonRequestBody = JSON.stringify;

Teepee.prototype._addQueryStringToUrl = function (url, query) {
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
};

Teepee.prototype.getPlaceholderValue = function (placeholderName, requestOptions) {
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
};

Teepee.prototype.expandUrl = function (url, requestOptions) {
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
};

Teepee.prototype.getAgent = function (protocol) {
    if (!this.agentByProtocol) {
        this.agentByProtocol = {};
    }
    if (!this.agentByProtocol[protocol]) {
        var agentOptions = {};
        // Pass all instance variables that originate from the user-supplied config object to the Agent constructor:
        this._userSuppliedConfigOptionNames.forEach(function (userSuppliedConfigOptionName) {
            var value = this[userSuppliedConfigOptionName];
            if (typeof value !== 'undefined') {
                agentOptions[userSuppliedConfigOptionName] = value;
            }
        }, this);
        var Agent = this.Agent || (protocol === 'https' ? https : http).Agent;
        this.agentByProtocol[protocol] = new Agent(agentOptions);
    }
    return this.agentByProtocol[protocol];
};

Teepee.prototype.resolveUrl = function (requestUrl, options) {
    var baseUrl = this.url;
    if (requestUrl && /^https?:\/\//.test(requestUrl)) {
        return this.expandUrl(requestUrl, options);
    } else if (baseUrl) {
        baseUrl = this.expandUrl(baseUrl, options);
        if (typeof requestUrl === 'string') {
            if (/^\/\//.test(requestUrl) || /^\.\.?(?:$|\/)/.test(requestUrl)) {
                // Protocol-relative or relative starting with a . or .. fragment, resolve it:
                return urlModule.resolve(baseUrl, requestUrl);
            } else {
                // Borrowed from request: Handle all cases to make sure that there's only one slash between the baseUrl and requestUrl:
                var baseUrlEndsWithSlash = baseUrl.lastIndexOf('/') === baseUrl.length - 1,
                    requestUrlStartsWithSlash = requestUrl.indexOf('/') === 0;

                if (baseUrlEndsWithSlash && requestUrlStartsWithSlash) {
                    return baseUrl + requestUrl.slice(1);
                } else if (baseUrlEndsWithSlash || requestUrlStartsWithSlash) {
                    return baseUrl + requestUrl;
                } else if (requestUrl === '') {
                    return baseUrl;
                } else {
                    return baseUrl + '/' + requestUrl;
                }
            }
        } else {
            return baseUrl;
        }
    } else {
        throw new Error('An absolute request url must be given when no base url is available');
    }
};

/*
 * Perform a request
 *
 * options.headers    {Object} (optional) The HTTP headers for the request.
 * options.path       {String} (optional) The path relative to the database url.
 * options.query      {Object} (optional) Query parameters, will be run through encodeURIComponent, array values supported
 * options.body       {String|Object|Buffer|Stream} (optional) What to send. Streams are streamed, objects will be serialized as JSON,
 *                                                             and buffers are sent as-is.
 * options.numRetries {Number} (optional) The number of times to retry an operation if it fails due to a non-HTTP error such
 *                                        as a socket timeout. Defaults to the numRetries parameter given to the constructor
 *                                        (which defaults to 0). Has no effect with the onResponse and streamRows options.
 */
Teepee.prototype.request = function (options, cb) {
    if (typeof options === 'string') {
        options = { path: options };
    } else if (typeof options === 'function') {
        cb = options;
        options = {};
    } else {
        options = options || {};
    }

    var numRetriesLeft = options.streamRows ? 0 : typeof options.numRetries !== 'undefined' ? options.numRetries : this.numRetries || 0,
        timeout = typeof options.timeout !== 'undefined' ? options.timeout : this.timeout,
        retry = typeof options.retry !== 'undefined' ? options.retry : this.retry,
        rejectUnauthorized = typeof options.rejectUnauthorized !== 'undefined' ? options.rejectUnauthorized : this.rejectUnauthorized,
        headers = _.extend({}, this.headers, options.headers),
        method = options.method,
        requestUrl = typeof options.path === 'string' ? options.path : options.url;

    if (typeof requestUrl === 'string') {
        if (/^[A-Z]+ /.test(requestUrl)) {
            var requestPathFragments = requestUrl.split(' ');
            // Error out if they conflict?
            method = method || requestPathFragments.shift();
            requestUrl = requestPathFragments.join(' ');
        }
    }

    method = method || this.method || 'GET';

    var body = options.body;
    if (Buffer.isBuffer(body)) {
        headers['content-length'] = body.length; // Disables chunked encoding for buffered body or strings
    } else if (typeof body === 'string') {
        headers['content-length'] = Buffer.byteLength(body); // Disables chunked encoding for string body
    } else if (typeof body === 'object' && typeof body.pipe !== 'function') {
        body = this.stringifyJsonRequestBody(body);
        headers['content-type'] = 'application/json';
        headers['content-length'] = Buffer.byteLength(body); // Disables chunked encoding for json body
    } else if (!body) {
        headers['content-length'] = 0; // Disables chunked encoding if there is no body
    }

    if (!('accept' in headers)) {
        headers.accept = 'application/json';
    }

    var url = this._addQueryStringToUrl(this.resolveUrl(requestUrl, options), options.query);

    // https://github.com/joyent/node/issues/25353 url.parse() fails if auth contain a colon
    var matchUrl = url.match(
        /^(https?):\/\/(?:([^:@/]+(?::[^@/]+?))@)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z][a-z-]*[a-z]|(?:(?:[0-9]|1?[0-9][0-9]|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|1?[0-9][0-9]|2[0-4][0-9]|25[0-5]))(:\d{1,5})?(\/[\w\-.~%!$&'()*+,;=:@/]*(?:\?[\w\-.~%!$&'()*+,;=:@/?]*)?(?:#[\w.~%!$&'()*+,;=:@/?#-]*)?)?$/
    );
    if (!matchUrl) {
        throw new Error('Invalid url: ' + url);
    }

    var protocol = matchUrl[1],
        auth = matchUrl[2],
        host = matchUrl[3],
        port = matchUrl[4],
        path = matchUrl[5] || '/';
    if (!('host' in headers)) {
        headers.host = host + (port || '');
    }
    if (typeof port !== 'undefined') {
        port = parseInt(port.substr(1), 10);
    } else if (protocol === 'https') {
        port = 443;
    } else {
        port = 80;
    }
    if (typeof auth === 'string' && auth.length > 0 && !('authorization' in headers)) {
        var authFragments = auth.split(':'),
            username = safeDecodeURIComponent(authFragments.shift()),
            password = safeDecodeURIComponent(authFragments.join(':'));
        headers.authorization = 'Basic ' + (typeof Buffer !== 'undefined' ? new Buffer(username + ':' + password, 'utf-8').toString('base64') : btoa(auth));
    }

    var httpModule = (protocol === 'https' ? https : http),
        requestOptions = {
            host: host,
            port: port,
            method: method,
            path: path,
            headers: headers,
            rejectUnauthorized: rejectUnauthorized,
            agent: this.getAgent(protocol)
        },
        that = this,
        currentRequest,
        currentResponse;

    var eventEmitter = new EventEmitter();

    eventEmitter.done = false;

    eventEmitter.abort = function () {
        eventEmitter.done = true;
        if (currentRequest) {
            currentRequest.abort();
            currentRequest = null;
        }
    };

    eventEmitter.error = function (err) {
        var socketError;

        if (!eventEmitter.done) {
            eventEmitter.done = true;

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

            that.emit('failedRequest', { url: url, requestOptions: requestOptions, response: currentResponse, err: err, numRetriesLeft: numRetriesLeft });
            if (cb) {
                cb(err);
            } else if (eventEmitter.listeners('error').length > 0 || eventEmitter.listeners('response').length === 0) {
                eventEmitter.emit('error', err);
            }
        }
    };

    eventEmitter.success = function () {
        if (!eventEmitter.done) {
            eventEmitter.done = true;
            that.emit('successfulRequest', { url: url, requestOptions: requestOptions, response: currentResponse });
            eventEmitter.emit('end');
            if (cb) {
                cb(null, currentResponse, currentResponse && currentResponse.body);
            }
        }
    };

    if (this.preprocessRequestOptions) {
        this.preprocessRequestOptions(requestOptions, options, passError(eventEmitter.error, dispatchRequest));
    } else {
        dispatchRequest();
    }

    function dispatchRequest() {
        currentRequest = httpModule.request(requestOptions);
        currentResponse = null;
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

        var requestTimeoutId;
        if (typeof timeout === 'number') {
            currentRequest.setTimeout(timeout);
            requestTimeoutId = setTimeout(function () {
                handleRequestError(new socketErrors.ETIMEDOUT());
            }, timeout);
        }

        function handleRequestError(err) {
            if (requestTimeoutId) {
                clearTimeout(requestTimeoutId);
            }
            currentRequest = null;
            if (eventEmitter.done) {
                return;
            }
            // Non-HTTP error (ECONNRESET, ETIMEDOUT, etc.)
            // Try again (up to numRetriesLeft times). Warning: This doesn't work when piping into the returned request,
            // so please specify numRetriesLeft:0 if you intend to do that.
            if (numRetriesLeft > 0) {
                numRetriesLeft -= 1;
                dispatchRequest();
            } else {
                eventEmitter.error(err);
            }
        }

        currentRequest.on('error', handleRequestError).on('response', function (response) {
            if (requestTimeoutId) {
                clearTimeout(requestTimeoutId);
            }

            currentResponse = response;
            var hasEnded = false,
                responseError;

            response.on('end', function () {
                hasEnded = true;
            });

            if (eventEmitter.done) {
                return;
            }

            function returnSuccessOrError(err) {
                err = err || responseError;

                if (err) {
                    eventEmitter.error(err, response);
                } else {
                    if (hasEnded) {
                        eventEmitter.success(response);
                    } else {
                        response.on('data', function () {}).on('end', function () {
                            eventEmitter.success(response);
                        });
                    }
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

            eventEmitter.emit('response', response, responseError);

            if (responseError) {
                if (!cb) {
                    eventEmitter.error(responseError);
                }
            } else {
                eventEmitter.emit('success', response);
            }

            var responseBodyMustBeBuffered = eventEmitter.listeners('responseBody').length > 0;

            if (cb) {
                responseBodyMustBeBuffered = true;
                eventEmitter.on('responseBody', function () {
                    returnSuccessOrError();
                });
            } else if (responseError) {
                if (responseBodyMustBeBuffered) {
                    response.on('responseBody', function () {
                        setImmediate(function () {
                            returnSuccessOrError();
                        });
                    });
                } else {
                    response.on('data', function () {}).on('end', returnSuccessOrError);
                }
            }

            if (responseBodyMustBeBuffered) {
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
                                return eventEmitter.error(new httpErrors.BadGateway('Error parsing JSON response body'), response);
                            }
                        }
                    }
                    eventEmitter.emit('responseBody', response);
                });
            }
        });
    }

    return eventEmitter;
};

Teepee.prototype.quit = function () {
    // agent.destroy became available in node.js 0.12:
    if (this.agentByProtocol) {
        Object.keys(this.agentByProtocol).forEach(function (protocol) {
            var agent = this.agentByProtocol[protocol];
            if (agent.destroy) {
                agent.destroy();
            }
        }, this);
    }
};

// Expose the socketErrors and httpErrors modules so that test suites for modules using Teepee can use the correct constructors:
Teepee.httpErrors = httpErrors;
Teepee.socketErrors = socketErrors;

module.exports = Teepee;
