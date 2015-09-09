/*global JSON, setTimeout, setImmediate*/
var EventEmitter = require('events').EventEmitter,
    Promise = require('bluebird'),
    util = require('util'),
    urlModule = require('url'),
    _ = require('underscore'),
    fs = require('fs'),
    httpErrors = require('httperrors'),
    socketErrors = require('socketerrors'),
    createError = require('createerror'),
    os = require('os'),
    passError = require('passerror'),
    http = require('http'),
    https = require('https'),
    SelfRedirectError = createError({name: 'SelfRedirect'});

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
 * config.agent              {Object}  (optional) The HTTP/HTTPS agent to use. Defaults to use the global agent for the given protocol.
 *                                                  Pass true to create a new agent for the Teepee instance using the default constructors.
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
            var value = config[key];
            if (typeof value !== 'undefined') {
                if (key === 'agent' && typeof value !== 'boolean') {
                    var protocol = config.url && /^https:/.test(config.url) ? 'https' : 'http';
                    this.agentByProtocol = this.agentByProtocol || {};
                    this.agentByProtocol[protocol] = value;
                } else if (key === 'cert' || key === 'key' || key === 'ca') {
                    this[key] = resolveCertKeyOrCa(value);
                    this._userSuppliedConfigOptionNames.push(key);
                } else if (typeof this[key] === 'undefined') {
                    this[key] = value;
                    this._userSuppliedConfigOptionNames.push(key);
                } else {
                    // Ignore unsupported property that would overwrite or shadow for a built-in property or method
                }
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
    var subsidiary = new this.constructor(config);

    if (this.headers) {
        if (subsidiary.headers) {
            _.defaults(subsidiary.headers, this.headers);
        } else {
            subsidiary.headers = _.clone(this.headers);
        }
    }

    // Make sure that the subsidiary will get the same object so all agents are shared:
    this.agentByProtocol = this.agentByProtocol || {};

    var that = this,
        subsidiaryEmit = subsidiary.emit;
    subsidiary.emit = function () {
        subsidiaryEmit.apply(this, arguments);
        that.emit.apply(that, arguments);
    };

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
    var expandedUrl = url.replace(/\{((?:[^\{\}]+|\{\w+\})*)\}/g, function ($0, placeholderName) {
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
    if (!/^[a-z+]+:\/\//i.test(expandedUrl)) {
        expandedUrl = 'http://' + expandedUrl;
    }
    return expandedUrl;
};

Teepee.prototype.getAgent = function (protocol) {
    if (!this.agentByProtocol) {
        this.agentByProtocol = {};
    }
    if (this.agent || this.Agent || this.AgentByProtocol || (this.agentByProtocol && this.agentByProtocol[protocol])) {
        if (!this.agentByProtocol[protocol]) {
            var agentOptions = {};
            // Pass all instance variables that originate from the user-supplied config object to the Agent constructor:
            this._userSuppliedConfigOptionNames.forEach(function setAgentOptions(userSuppliedConfigOptionName) {
                var value = this[userSuppliedConfigOptionName];
                if (typeof value !== 'undefined') {
                    agentOptions[userSuppliedConfigOptionName] = value;
                }
            }, this);
            var Agent = this.Agent || (this.AgentByProtocol && this.AgentByProtocol[protocol]) || (protocol === 'https' ? https : http).Agent;
            this.agentByProtocol[protocol] = new Agent(agentOptions);
        }
        return this.agentByProtocol[protocol];
    }
};

Teepee.prototype.resolveUrl = function (baseUrl, url, options) {
    if (url && /^https?:\/\//.test(url)) {
        return this.expandUrl(url, options);
    } else if (baseUrl) {
        baseUrl = this.expandUrl(baseUrl, options);
        if (typeof url === 'string') {
            if (/^\/\//.test(url) || /^\.\.?(?:$|\/)/.test(url)) {
                // Protocol-relative or relative starting with a . or .. fragment, resolve it:
                return urlModule.resolve(baseUrl, url);
            } else {
                // Borrowed from request: Handle all cases to make sure that there's only one slash between the baseUrl and url:
                var baseUrlEndsWithSlash = baseUrl.lastIndexOf('/') === baseUrl.length - 1,
                    urlStartsWithSlash = url.indexOf('/') === 0;

                if (baseUrlEndsWithSlash && urlStartsWithSlash) {
                    return baseUrl + url.slice(1);
                } else if (baseUrlEndsWithSlash || urlStartsWithSlash) {
                    return baseUrl + url;
                } else if (url === '') {
                    return baseUrl;
                } else {
                    return baseUrl + '/' + url;
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
        retryDelayMilliseconds = typeof options.retryDelayMilliseconds !== 'undefined' ? options.retryDelayMilliseconds : this.retryDelayMilliseconds || 0,
        timeout = typeof options.timeout !== 'undefined' ? options.timeout : this.timeout,
        username = typeof options.username !== 'undefined' ? options.username : this.username,
        password = typeof options.password !== 'undefined' ? options.password : this.password,
        body = typeof options.body !== 'undefined' ? options.body : this.body,
        retry = typeof options.retry !== 'undefined' ? options.retry : this.retry || [],
        rejectUnauthorized = typeof options.rejectUnauthorized !== 'undefined' ? options.rejectUnauthorized : this.rejectUnauthorized,
        headers = _.extend({}, this.headers, options.headers),
        method = options.method,
        requestUrl = typeof options.path === 'string' ? options.path : options.url;

    if (typeof retry !== 'undefined' && !Array.isArray(retry)) {
        retry = [ retry ];
    }

    if (typeof requestUrl === 'string') {
        if (/^[A-Z]+ /.test(requestUrl)) {
            var requestPathFragments = requestUrl.split(' ');
            // Error out if they conflict?
            method = method || requestPathFragments.shift();
            requestUrl = requestPathFragments.join(' ');
        }
    }

    method = method || this.method || 'GET';

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

    var url = this._addQueryStringToUrl(this.resolveUrl(this.url, requestUrl, options), options.query);

    // https://github.com/joyent/node/issues/25353 url.parse() fails if auth contain a colon
    var matchUrl = url.match(
        /^(https?):\/\/(?:([^:@/]+(?::[^@/]+?))@)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z][a-z-]*[a-z]|(?:(?:[0-9]|1?[0-9][0-9]|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|1?[0-9][0-9]|2[0-4][0-9]|25[0-5]))?(:\d{1,5})?(\/[\w\-.~%!$&'()*+,;=:@/]*)?(\?[\w\-.~%!$&'()*+,;=:@/?]*)?(?:#[\w.~%!$&'()*+,;=:@/?#-]*)?$/
    );
    if (!matchUrl) {
        throw new Error('Invalid url: ' + url);
    }

    var protocol = matchUrl[1],
        auth = matchUrl[2], // either undefined or '<username>:<password>' or undefined
        host = matchUrl[3], // either undefined or the host name
        port = matchUrl[4], // either undefined or ':<portNumber>'
        path = matchUrl[5] || '/',
        queryString = matchUrl[6] || '';
    if (!('host' in headers) && (host || port)) {
        headers.host = (host || '') + (port || '');
    }
    if (typeof port !== 'undefined') {
        port = parseInt(port.substr(1), 10);
    } else if (protocol === 'https') {
        port = 443;
    } else {
        port = 80;
    }
    if (typeof auth === 'string' && auth.length > 0 && !('authorization' in headers)) {
        var authFragments = auth.split(':');
        username = username || safeDecodeURIComponent(authFragments.shift());
        if (authFragments.length > 0) {
            password = safeDecodeURIComponent(authFragments.join(':'));
        }
    }

    if (username) {
        headers.authorization = 'Basic ' + new Buffer(username + (password ? ':' + password : ''), 'utf-8').toString('base64');
    }

    var requestOptions = {
        protocol: protocol,
        host: host,
        port: port,
        method: method,
        path: path + queryString,
        headers: headers,
        rejectUnauthorized: rejectUnauthorized
    };

    var agent = this.getAgent(protocol);
    if (agent) {
        requestOptions.agent = agent;
    } else {
        ['cert', 'key', 'ca'].forEach(function setRequestOptions(key) {
            if (this[key]) {
                requestOptions[key] = this[key];
            }
        }, this);
    }

    var that = this,
        currentRequest,
        currentResponse,
        responseBodyChunks;

    var eventEmitter = new EventEmitter();

    function disposeRequestOrResponse(obj) {
        if (obj) {
            obj.removeAllListeners();
            obj.on('error', function () {});
        }
    }

    function cleanUp() {
        responseBodyChunks = null;
        disposeRequestOrResponse(currentRequest);
        currentRequest = null;
        disposeRequestOrResponse(currentResponse);
        currentResponse = null;
    }

    eventEmitter.then = function () {
        if (cb) {
            throw new Error('You cannot use .then() and a callback at the same time');
        } else {
            var promise = new Promise(function (resolve, reject) {
                if (currentRequest) {
                    throw new Error('.then() must be called in the same tick as the request is initiated');
                }
                cb = function (err, response, body) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(response);
                    }
                };
            });
            return promise.then.apply(promise, arguments);
        }
    };

    eventEmitter.done = false;

    eventEmitter.abort = function () {
        eventEmitter.done = true;
        if (currentRequest) {
            currentRequest.abort();
            cleanUp();
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
                cb(err, currentResponse, currentResponse && currentResponse.body);
            } else if (eventEmitter.listeners('error').length > 0 || eventEmitter.listeners('response').length === 0) {
                eventEmitter.emit('error', err);
            }
            setImmediate(function () {
                cleanUp();
                eventEmitter.removeAllListeners();
            });
        }
    };

    eventEmitter.success = function (response) {
        if (!eventEmitter.done) {
            eventEmitter.done = true;
            that.emit('successfulRequest', { url: url, requestOptions: requestOptions, response: response });
            eventEmitter.emit('end');
            if (cb) {
                cb(null, response, response && response.body);
            }
            setImmediate(function () {
                cleanUp();
                eventEmitter.removeAllListeners();
            });
        }
    };

    if (this.preprocessRequestOptions) {
        this.preprocessRequestOptions(requestOptions, options, passError(eventEmitter.error, dispatchRequest));
    } else {
        setImmediate(dispatchRequest);
    }

    function dispatchRequest() {
        disposeRequestOrResponse(currentRequest);
        currentRequest = (requestOptions.protocol === 'https' ? https : http).request(_.omit(requestOptions, 'protocol'));
        that.emit('request', { requestOptions: requestOptions, url: url });
        disposeRequestOrResponse(currentResponse);
        currentResponse = null;
        if (eventEmitter.listeners('request').length > 0) {
            numRetriesLeft = 0;
            eventEmitter.emit('request', currentRequest, requestOptions, url);
        }
        if (body && typeof body.pipe === 'function') {
            numRetriesLeft = 0;
            body.pipe(currentRequest);
        } else {
            currentRequest.end(body);
        }

        if (typeof timeout === 'number') {
            currentRequest.setTimeout(timeout, function () {
                // This callback will be added as a one time listener for the 'timeout' event.
                currentRequest.destroy();
                cleanUp();
                handleRequestError(new socketErrors.ETIMEDOUT());
            });
        }

        function retryUponError(err) {
            cleanUp();
            numRetriesLeft -= 1;
            setTimeout(function () {
                that.emit('retriedRequest', { requestOptions: requestOptions, err: err, numRetriesLeft: numRetriesLeft, url: url });
                dispatchRequest();
            }, retryDelayMilliseconds);
        }

        function handleRequestError(err) {
            disposeRequestOrResponse(currentRequest);
            if (eventEmitter.done) {
                return;
            }
            // Non-HTTP error (ECONNRESET, ETIMEDOUT, etc.)
            // Try again (up to numRetriesLeft times). Warning: This doesn't work when piping into the returned request,
            // so please specify numRetriesLeft:0 if you intend to do that.
            if (numRetriesLeft > 0) {
                return retryUponError(err);
            } else {
                eventEmitter.error(err);
            }
        }

        currentRequest.once('error', handleRequestError).once('response', function handleResponse(response) {
            currentResponse = response;
            var hasEnded = false,
                responseError;

            response.once('end', function () {
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
                        response.once('end', function () {
                            eventEmitter.success(response);
                        }).resume();
                    }
                }
            }

            function shouldRetryOnErrorStatusCode(statusCode) {
                return retry.some(function (retryEntry) {
                    if (retryEntry === 'httpError' || retryEntry === statusCode) {
                        return true;
                    } else if (typeof retryEntry === 'string' && retryEntry.length === 3 && /\d/.test(retryEntry.charAt(0))) {
                        var statusCodeString = String(statusCode);
                        if (retryEntry.replace(/x/g, function ($0, index) { return statusCodeString[index]; }) === statusCodeString) {
                            return true;
                        }
                    }
                });
            }

            response.requestOptions = requestOptions;
            response.url = url;
            response.cacheInfo = { headers: {} };

            var responseBodyMustBeDisposedUnlessPiped = false;

            if (response.statusCode === 301 || response.statusCode === 302) {
                if (numRetriesLeft > 0 && retry.indexOf('selfRedirect') !== -1) {
                    var redirectTargetUrl = urlModule.resolve(url, response.headers.location);
                    if (redirectTargetUrl.replace(/#.*$/, '') === url.replace(/#.*$/, '')) {
                        response.once('error', function () {});
                        response.resume();
                        return retryUponError(new SelfRedirectError({ data: { location: response.headers.location }}));
                    } else {
                        responseBodyMustBeDisposedUnlessPiped = true;
                    }
                }
            } else if (response.statusCode >= 400) {
                responseError = httpErrors(response.statusCode);
                if (numRetriesLeft > 0 && shouldRetryOnErrorStatusCode(response.statusCode)) {
                    response.once('error', function () {});
                    response.resume();
                    return retryUponError(responseError);
                } else {
                    responseBodyMustBeDisposedUnlessPiped = true;
                }
            } else if (response.statusCode === 304) {
                response.cacheInfo.notModified = true;
                body = null;
                responseBodyMustBeDisposedUnlessPiped = true;
            }
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
                eventEmitter.once('responseBody', function () {
                    returnSuccessOrError();
                });

                // Under these specific circumstances we can retry when the request times out while we're streaming the response:
                if (typeof timeout === 'number' && numRetriesLeft > 0) {
                    currentRequest.removeAllListeners('timeout');
                    currentRequest.once('timeout', function () {
                        // Emitted if the socket times out from inactivity. This is only to notify that the socket has been idle. The user must manually close the connection.
                        eventEmitter.removeAllListeners('responseBody');
                        currentRequest.destroy();
                        numRetriesLeft -= 1;
                        retryUponError(new socketErrors.ETIMEDOUT());
                    });
                }
            } else {
                numRetriesLeft = 0;
                if (responseError) {
                    if (responseBodyMustBeBuffered) {
                        eventEmitter.once('responseBody', function () {
                            setImmediate(function () {
                                returnSuccessOrError();
                            });
                        });
                    } else {
                        response.once('end', returnSuccessOrError);
                        // Avoid "Cannot switch to old mode now" error when a pipe has been added:
                        if ((typeof response._readableState.pipesCount !== 'number' || response._readableState.pipesCount === 0) && !response._readableState.pipes) {
                            response.resume();
                        }
                    }
                }
            }

            if (responseBodyMustBeBuffered) {
                responseBodyChunks = [];
                response.on('data', function handleBodyChunk(responseBodyChunk) {
                    responseBodyChunks.push(responseBodyChunk);
                }).once('error', returnSuccessOrError).once('end', function handleEnd() {
                    disposeRequestOrResponse(currentRequest);
                    currentRequest = null;
                    response.body = Buffer.concat(responseBodyChunks);
                    if (isContentTypeJson(response.headers['content-type'])) {
                        try {
                            response.body = JSON.parse(response.body.toString('utf-8'));
                        } catch (e) {
                            return eventEmitter.error(new httpErrors.BadGateway('Error parsing JSON response body'), response);
                        }
                    }
                    eventEmitter.emit('responseBody', response);
                    responseBodyChunks = null;
                });
            } else if (responseBodyMustBeDisposedUnlessPiped && (!response._readableState || ((typeof response._readableState.pipesCount !== 'number' || response._readableState.pipesCount === 0) && !response._readableState.pipes))) {
                response.resume();
                response.once('error', function () {});
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
