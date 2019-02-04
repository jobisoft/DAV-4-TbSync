/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

dav.tools = {
    
    /**
     * Convert a byte array to a string - copied from lightning
     *
     * @param {octet[]} aResult         The bytes to convert
     * @param {Number} aResultLength    The number of bytes
     * @param {String} aCharset         The character set of the bytes, defaults to utf-8
     * @param {Boolean} aThrow          If true, the function will raise an exception on error
     * @return {?String}                The string result, or null on error
     */
    convertByteArray: function(aResult, aResultLength, aCharset, aThrow) {
        try {
            let resultConverter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
                                            .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
            resultConverter.charset = aCharset || "UTF-8";
            return resultConverter.convertFromByteArray(aResult, aResultLength);
        } catch (e) {
            Components.utils.reportError(e);
            if (aThrow) {
                throw e;
            }
        }
        return null;
    },
    
    /**
     * Removes XML-invalid characters from a string.
     * @param {string} string - a string potentially containing XML-invalid characters, such as non-UTF8 characters, STX, EOX and so on.
     * @param {boolean} removeDiscouragedChars - a string potentially containing XML-invalid characters, such as non-UTF8 characters, STX, EOX and so on.
     * @return : a sanitized string without all the XML-invalid characters.
     *
     * Source: https://www.ryadel.com/en/javascript-remove-xml-invalid-chars-characters-string-utf8-unicode-regex/
     */
    removeXMLInvalidChars: function (string, removeDiscouragedChars = true)
    {
        // remove everything forbidden by XML 1.0 specifications, plus the unicode replacement character U+FFFD
        var regex = /((?:[\0-\x08\x0B\f\x0E-\x1F\uFFFD\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]))/g;
        string = string.replace(regex, "");
     
        if (removeDiscouragedChars) {
            // remove everything not suggested by XML 1.0 specifications
            regex = new RegExp(
                "([\\x7F-\\x84]|[\\x86-\\x9F]|[\\uFDD0-\\uFDEF]|(?:\\uD83F[\\uDFFE\\uDFFF])|(?:\\uD87F[\\uDF"+
                "FE\\uDFFF])|(?:\\uD8BF[\\uDFFE\\uDFFF])|(?:\\uD8FF[\\uDFFE\\uDFFF])|(?:\\uD93F[\\uDFFE\\uD"+
                "FFF])|(?:\\uD97F[\\uDFFE\\uDFFF])|(?:\\uD9BF[\\uDFFE\\uDFFF])|(?:\\uD9FF[\\uDFFE\\uDFFF])"+
                "|(?:\\uDA3F[\\uDFFE\\uDFFF])|(?:\\uDA7F[\\uDFFE\\uDFFF])|(?:\\uDABF[\\uDFFE\\uDFFF])|(?:\\"+
                "uDAFF[\\uDFFE\\uDFFF])|(?:\\uDB3F[\\uDFFE\\uDFFF])|(?:\\uDB7F[\\uDFFE\\uDFFF])|(?:\\uDBBF"+
                "[\\uDFFE\\uDFFF])|(?:\\uDBFF[\\uDFFE\\uDFFF])(?:[\\0-\\t\\x0B\\f\\x0E-\\u2027\\u202A-\\uD7FF\\"+
                "uE000-\\uFFFF]|[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|"+
                "(?:[^\\uD800-\\uDBFF]|^)[\\uDC00-\\uDFFF]))", "g");
            string = string.replace(regex, "");
        }
     
        return string;
    },

    xmlns: function (ns) {
        let _xmlns = [];
        for (let i=0; i < ns.length; i++) {
            _xmlns.push('xmlns:'+ns[i]+'="'+dav.ns[ns[i]]+'"');
        }
        return _xmlns.join(" ");
    },

    parseUri: function (aUri) {
        let uri;
        try {
            // Test if the entered uri can be parsed.
            uri = Services.io.newURI(aUri, null, null);
        } catch (ex) {
            throw dav.sync.failed("invalid-uri");
        }

        let calManager = cal.getCalendarManager();
        let cals = calManager.getCalendars({});
        if (cals.some(calendar => calendar.uri.spec == uri.spec)) {
            throw dav.sync.succeeded("caldav-calendar-already-exists");
        }

        return uri;
    },

    getDomainFromHost: function (host) {
        return  host.split(".").slice(-2).join(".");
    },
    
    generateUUID: function (aItem, folder) {
        const uuidGenerator  = Cc["@mozilla.org/uuid-generator;1"].getService(Ci.nsIUUIDGenerator);
        return uuidGenerator.generateUUID().toString().replace(/[{}]/g, '');
    },

    parseVcardDateTime: function ( newServerValue, metadata ) {
        if (!newServerValue) {
            return false;
        }

        /*
        ** This accepts RFC2426 BDAY values (with/without hyphens),
        ** though TB doesn't handle the time part of date-times, so we discard it.
        */
        let bday = newServerValue.match( /^(\d{4})-?(\d{2})-?(\d{2})/ );
        if (!bday) {
            return false;
        }

        /*
        ** Apple Contacts shoehorns date with missing year into vcard3 thus:  BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-15
        ** Later in vcard4, it will be represented as BDAY:--0315
        */
        if (metadata
         && metadata['x-apple-omit-year']
         && metadata['x-apple-omit-year'] == bday[1]) {
            bday[1] = '';
        } 
        return bday;
    },



    //* * * * * * * * * * * * *
    //* SERVER COMMUNICATIONS *
    //* * * * * * * * * * * * *
    
    addAccountDataToConnectionData: function (connection) {
        let account = tbSync.db.getAccount(connection.account);
        connection.https = account.https;
        connection.user = account.user;    
        connection.password = tbSync.dav.getPassword(account);    
    },
    
    Prompt: class {
        constructor(aConnection) {
            this.mCounts = 0;
            this.mConnection = aConnection;
        }

        // boolean promptAuth(in nsIChannel aChannel,
        //                    in uint32_t level,
        //                    in nsIAuthInformation authInfo)
        promptAuth (aChannel, aLevel, aAuthInfo) {
            //store aAuthInfo.realm, needed later to setup lightning passwords
            if (this.mConnection.type == "cal") {
                tbSync.dump("Found CalDAV authRealm for <"+aChannel.URI.host+">", aAuthInfo.realm);
                dav.listOfRealms[aChannel.URI.host] = aAuthInfo.realm;
            }
            
            if (this.mConnection.password !== null) {
                aAuthInfo.username = this.mConnection.user;
                aAuthInfo.password = this.mConnection.password;
            } else {
                //we have no password, request one by throwing a 401
                return false;
            }
            
            //even if we have a password, it could be wrong, in which case we would be here more than once
            this.mCounts++
            return (this.mCounts < 2);
        }
    },

    Redirect: class {
        constructor(aHeaders) {
            this.mHeaders = aHeaders;
        }

        asyncOnChannelRedirect (aOldChannel, aNewChannel, aFlags, aCallback) {
            // Make sure we can get/set headers on both channels.
            aNewChannel.QueryInterface(Components.interfaces.nsIHttpChannel);
            aOldChannel.QueryInterface(Components.interfaces.nsIHttpChannel);
            
            //re-add all headers
            for (let header in this.mHeaders) {
                if (this.mHeaders.hasOwnProperty(header)) {
                    aNewChannel.setRequestHeader(header, this.mHeaders[header], false);
                }
            }

            //if a user:pass info has been lost, re-add and redirect
            if (aOldChannel.URI.userPass != "" && aNewChannel.URI.userPass == "") {
                let uri = Services.io.newURI(aNewChannel.URI.spec.replace("://","://" + aOldChannel.URI.userPass + "@"));
                aNewChannel.redirectTo(uri);
            }
                
            aCallback.onRedirectVerifyCallback(Components.results.NS_OK);
        }
    },
       
    prepHttpChannel: function(aUploadData, aHeaders, aMethod, aConnection, aNotificationCallbacks=null, aExisting=null) {
        let channel = aExisting || Services.io.newChannelFromURI2(
                                                                aConnection.uri,
                                                                null,
                                                                Services.scriptSecurityManager.getSystemPrincipal(),        
                                                                //Services.scriptSecurityManager.createCodebasePrincipal(aConnection.uri, {user: aConnection.user}),
                                                                null,
                                                                Components.interfaces.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_DATA_IS_NULL,
                                                                Components.interfaces.nsIContentPolicy.TYPE_OTHER);
        let httpchannel = channel.QueryInterface(Components.interfaces.nsIHttpChannel);

        
        //httpchannel.loadFlags |= Components.interfaces.nsIRequest.LOAD_EXPLICIT_CREDENTIALS; //does not help with the cookie cache problem
        httpchannel.loadFlags |= Components.interfaces.nsIRequest.LOAD_BYPASS_CACHE;
        httpchannel.notificationCallbacks = aNotificationCallbacks;

        if (aUploadData) {
            httpchannel = httpchannel.QueryInterface(Components.interfaces.nsIUploadChannel);
            let stream;
            if (aUploadData instanceof Components.interfaces.nsIInputStream) {
                // Make sure the stream is reset
                stream = aUploadData.QueryInterface(Components.interfaces.nsISeekableStream);
                stream.seek(Components.interfaces.nsISeekableStream.NS_SEEK_SET, 0);
            } else {
                // Otherwise its something that should be a string, convert it.
                let converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
                converter.charset = "UTF-8";
                stream = converter.convertToInputStream(aUploadData.toString());
            }

            httpchannel.setUploadStream(stream, "application/xml; charset=utf-8", -1);
        /*
            If aContentType is empty, the protocol will assume that no content headers are to be added to the uploaded stream and 
            that any required headers are already encoded in the stream. In the case of HTTP, if this parameter is non-empty, 
            then its value will replace any existing Content-Type header on the HTTP request. In the case of FTP and FILE, 
            this parameter is ignored.
            */
        }

        //must be set after setUploadStream
        //https://developer.mozilla.org/en-US/docs/Mozilla/Creating_sandboxed_HTTP_connections
        httpchannel.requestMethod = aMethod;
        
        for (let header in aHeaders) {
            if (aHeaders.hasOwnProperty(header)) {
                httpchannel.setRequestHeader(header, aHeaders[header], false);
            }
        }
      
        //default content type
        if (!aHeaders.hasOwnProperty("Content-Type"))
            httpchannel.setRequestHeader("Content-Type", "application/xml; charset=utf-8", false);

        //default accept value
        if (!aHeaders.hasOwnProperty("Accept"))
            httpchannel.setRequestHeader("Accept", "*/*", false);

        //httpchannel.setRequestHeader("Accept-Charset", "utf-8,*;q=0.1", false);
        return httpchannel;
    },
 
    /* connection data:
        connection.type
        connection.fqdn
        connection.https
        connection.user    
        connection.password
        [connection.timeout]
    */
    sendRequest: Task.async (function* (requestData, path, method, connection, headers = {}, options = {softfail: []}, aUseStreamLoader = true) {            
        //path could be absolute or relative, we may need to rebuild the full url
        let url = (path.startsWith("http://") || path.startsWith("https://")) ? path : "http" + (connection.https == "1" ? "s" : "") + "://" + connection.fqdn + path;

        //a few bugs in TB and in client implementations require to retry a connection on certain failures
        for (let i=1; i < 5; i++) { //max number of retries
            tbSync.dump("URL Request #" + i, url);
            
            //inject user + password if requested
            if (tbSync.dav.prefSettings.getBoolPref("addCredentialsToUrl")) {
                url = url.replace("://","://" + encodeURIComponent(connection.user) + ":" + encodeURIComponent(connection.password) + "@");
            }

            connection.uri = Services.io.newURI(url);

            //https://bugzilla.mozilla.org/show_bug.cgi?id=669675
            if (dav.problematicHosts.includes(connection.uri.host)) {
                headers["Authorization"] = "Basic " + tbSync.b64encode(connection.user + ":" + connection.password);
            }
            
            let r = yield dav.tools.sendRequestCore(requestData, method, connection, headers, options, aUseStreamLoader);
        
            //connection.uri.host may no longer be the correct value, as there might have been redirects, use connection.fqdn 
            if (r && r.retry && r.retry === true) {
                if (r.addBasicAuthHeaderOnce) {
                    tbSync.dump("DAV:unauthenticated", "Manually adding basic auth header for <" + connection.user + "@" + connection.fqdn + ">");
                    headers["Authorization"] = "Basic " + tbSync.b64encode(connection.user + ":" + connection.password);
                } else if (!dav.problematicHosts.includes(connection.fqdn) ) {
                    tbSync.dump("BUG 669675", "Adding <" + connection.fqdn + "> to list of problematic hosts.");
                    dav.problematicHosts.push(connection.fqdn)
                }

                //there might have been a redirect, rebuild url
                url = "http" + (connection.https == "1" ? "s" : "") + "://" + connection.fqdn + r.path;
            } else {
                return r;
            }
        }
    }),
    
    // Promisified implementation of Components.interfaces.nsIHttpChannel
    sendRequestCore: Task.async (function* (requestData, method, connection, headers, options, aUseStreamLoader) {
        let responseData = "";
        
        //do not log HEADERS, as it could contain an Authorization header
        //tbSync.dump("HEADERS", JSON.stringify(headers));
        if (tbSync.prefSettings.getIntPref("log.userdatalevel")>1) tbSync.dump("REQUEST", method + " : " + requestData);
        
        return new Promise(function(resolve, reject) {                  
            let listener = {
                _data: "",
                _stream: null,

                //nsIStreamListener (aUseStreamLoader = false)
                onStopRequest: function(aRequest, aContext, aStatusCode) {
                    Services.console.logStringMessage("[onStopRequest] " + aStatusCode);
                    tbSync.dump("STREAM DONE", this._data);
                },
                onStartRequest: function(aRequest, aContext) {
                    Services.console.logStringMessage("[onStartRequest] ");
                    this.data = "";
                },
                onDataAvailable: function (aRequest, aContext, aInputStream, aOffset, aCount) {
                    Services.console.logStringMessage("[onDataAvailable] " + aCount);
                    if (this._stream == null) {
                        this._stream = Components.classes["@mozilla.org/scriptableinputstream;1"].createInstance(Components.interfaces.nsIScriptableInputStream);
                        this._stream.init(aInputStream);
                    }
                    let d = this._stream.read(aCount);
                    tbSync.dump("STREAM", d);
                    this._data += d;
                },        
            
                //nsIStreamLoaderObserve (aUseStreamLoader = true)
                onStreamComplete: function(aLoader, aContext, aStatus, aResultLength, aResult) {
                    let request = aLoader.request.QueryInterface(Components.interfaces.nsIHttpChannel);
                    let responseStatus = 0;
                    try {
                        responseStatus = request.responseStatus;
                    } catch (ex) {
                        let error = tbSync.createTCPErrorFromFailedChannel(aLoader.request);
                        if (!error) {
                            return reject(dav.sync.failed("networkerror", "URL:\n" + connection.uri.spec + " ("+method+")")); //reject/resolve do not terminate control flow
                        } else {
                            return reject(dav.sync.failed(error, "URL:\n" + connection.uri.spec + " ("+method+")"));
                        }
                    }
                    
                    let text = dav.tools.convertByteArray(aResult, aResultLength);                    
                    if (tbSync.prefSettings.getIntPref("log.userdatalevel")>1) tbSync.dump("RESPONSE", responseStatus + " : " + text);
                    responseData = text.split("><").join(">\n<");
                    
                    //Redirected? Update connection settings from current URL
                    let newHttps = (request.URI.scheme == "https") ? "1" : "0";
                    if (connection.https != newHttps) {
                        tbSync.dump("Updating HTTPS", connection.https + " -> " + newHttps);
                        connection.https = newHttps;
                    }
                    if (connection.fqdn != request.URI.hostPort) {
                        tbSync.dump("Updating FQDN", connection.fqdn + " -> " + request.URI.hostPort);
                        connection.fqdn = request.URI.hostPort;
                    }

                    switch(responseStatus) {
                        case 301:
                        case 302:
                        case 303:
                        case 305:
                        case 307:
                        case 308:
                            {
                                //Since we now use the nsIChannelEventSink to handle the redirects, this should never be called.
                                //Just in case, do a retry with the updated connection settings.
                                let response = {};
                                response.retry = true;
                                response.path = request.URI.pathQueryRef;
                                return resolve(response);
                            }
                            break;

                        case 401: //AuthError
                            {                               
                                //handle nsIHttpChannel bug (https://bugzilla.mozilla.org/show_bug.cgi?id=669675)
                                
                                //these problematic hosts send a VALID Auth header, but TB is not able to parse it, we need to manually add a BASIC auth header
                                //since the header cannot be parsed, TB will also not get the realm for this
                                //currently there is no known CALDAV server, which is problematic (where we need the realm to pre-add the password so lightning does not prompt)
                                //if this changes, we need a hardcoded list of problematic servers and their realm
                                //I hope this bug gets fixed soon

                                //should the channel have been able to authenticate (password is stored)?
                                if (connection.password !== null) {                                    
                                    //did the channel try to authenticate?
                                    let triedToAuthenticate;
                                    try {
                                        let header = request.getRequestHeader("Authorization");
                                        triedToAuthenticate = true;
                                    } catch (e) {
                                        triedToAuthenticate = false;
                                    }
                                    
                                    if (!triedToAuthenticate) {
                                        let response = {};
                                        response.retry = true;
                                        response.path = request.URI.pathQueryRef;
                                        return resolve(response);
                                    }
                                }
                                
                                return reject(dav.sync.failed(responseStatus, "URL:\n" + connection.uri.spec + " ("+method+")" + "\n\nRequest:\n" + requestData + "\n\nResponse:\n" + responseData)); 
                            }
                            break;
                            
                        case 207: //preprocess multiresponse
                            {
                                let xml = dav.tools.convertToXML(text);
                                if (xml === null) return reject(dav.sync.failed("maiformed-xml", "URL:\n" + connection.uri.spec + " ("+method+")" + "\n\nRequest:\n" + requestData + "\n\nResponse:\n" + responseData));

                                //the specs allow to  return a 207 with DAV:unauthenticated if not authenticated 
                                if (xml.documentElement.getElementsByTagNameNS(dav.ns.d, "unauthenticated").length != 0) {
                                    let response = {};
                                    response.retry = true;
                                    response.path = request.URI.pathQueryRef;
                                    //we have no information at all about allowed auth methods, try basic auth
                                    response.addBasicAuthHeaderOnce = true;
                                    return resolve(response);
                                } else {
                                    let response = {};
                                    response.node = xml.documentElement;

                                    let multi = xml.documentElement.getElementsByTagNameNS(dav.ns.d, "response");
                                    response.multi = [];
                                    for (let i=0; i < multi.length; i++) {
                                        let hrefNode = dav.tools.evaluateNode(multi[i], [["d","href"]]);
                                        let propstats = multi[i].getElementsByTagNameNS(dav.ns.d, "propstat");
                                        if (propstats.length > 0) {
                                            //response contains propstats, push each as single entry
                                            for (let p=0; p < propstats.length; p++) {
                                                let statusNode = dav.tools.evaluateNode(propstats[p], [["d", "status"]]);

                                                let resp = {};
                                                resp.node = propstats[p];
                                                resp.status = statusNode === null ? null : statusNode.textContent.split(" ")[1];
                                                resp.href = hrefNode === null ? null : hrefNode.textContent;
                                                response.multi.push(resp);
                                            }
                                        } else {
                                            //response does not contain any propstats, push raw response
                                            let statusNode = dav.tools.evaluateNode(multi[i], [["d", "status"]]);

                                            let resp = {};
                                            resp.node = multi[i];
                                            resp.status = statusNode === null ? null : statusNode.textContent.split(" ")[1];
                                            resp.href = hrefNode === null ? null : hrefNode.textContent;
                                            response.multi.push(resp);
                                        }
                                    }

                                    return resolve(response);
                                }
                            }


                        case 200: //returned by DELETE by radicale - watch this !!!
                        case 204: //is returned by DELETE - no data
                        case 201: //is returned by CREATE - no data
                            return resolve(null);
                            break;

                        default:
                            if (options.softfail.includes(responseStatus)) {
                                let noresponse = {};
                                noresponse.softerror = responseStatus;
                                let xml = dav.tools.convertToXML(text);
                                if (xml !== null) {
                                    let exceptionNode = dav.tools.evaluateNode(xml.documentElement, [["s","exception"]]);
                                    if (exceptionNode !== null) {
                                        noresponse.exception = exceptionNode.textContent;
                                    }
                                }
                                //manually log this non-fatal error
                                tbSync.errorlog("info", connection, "softerror::"+responseStatus, "URL:\n" + connection.uri.spec + " ("+method+")" + "\n\nRequest:\n" + requestData + "\n\nResponse:\n" + responseData);
                                return resolve(noresponse);
                            } else {
                                return reject(dav.sync.failed(responseStatus, "URL:\n" + connection.uri.spec + " ("+method+")" + "\n\nRequest:\n" + requestData + "\n\nResponse:\n" + responseData)); 
                            }                                
                            break;

                    }
                }
            }

            let notificationCallbacks = {
                // nsIInterfaceRequestor
                getInterface : function(aIID) {
                    if (aIID.equals(Components.interfaces.nsIAuthPrompt2)) {
                        tbSync.dump("GET","nsIAuthPrompt2");
                        if (!this.authPrompt) {
                            this.authPrompt = new dav.tools.Prompt(connection);
                        }
                        return this.authPrompt;
                    } else if (aIID.equals(Components.interfaces.nsIAuthPrompt)) {
                        //tbSync.dump("GET","nsIAuthPrompt");
                    } else if (aIID.equals(Components.interfaces.nsIAuthPromptProvider)) {
                        //tbSync.dump("GET","nsIAuthPromptProvider");
                    } else if (aIID.equals(Components.interfaces.nsIPrompt)) {
                        //tbSync.dump("GET","nsIPrompt");
                    } else if (aIID.equals(Components.interfaces.nsIProgressEventSink)) {
                        //tbSync.dump("GET","nsIProgressEventSink");
                    } else if (aIID.equals(Components.interfaces.nsIChannelEventSink)) {
                        if (!this.redirectSink) {
                            this.redirectSink = new dav.tools.Redirect(headers);
                        }
                        return this.redirectSink;
                    }

                    throw Components.results.NS_ERROR_NO_INTERFACE;
                },
            }

            let channel = dav.tools.prepHttpChannel(requestData, headers, method, connection, notificationCallbacks);    
            if (aUseStreamLoader) {
                let loader =  Components.classes["@mozilla.org/network/stream-loader;1"].createInstance(Components.interfaces.nsIStreamLoader);
                loader.init(listener);
                listener = loader;
            }        
        
            //manually set timout
            connection.timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
            let timeout = connection.hasOwnProperty("timeout") ? connection.timeout : tbSync.prefSettings.getIntPref("timeout");
            let rv = Components.results.NS_ERROR_NET_TIMEOUT;
            let event = {
                notify: function(timer) {
                    if (channel) channel.cancel(rv);
                }
            }
            connection.timer.initWithCallback(event, timeout, Components.interfaces.nsITimer.TYPE_ONE_SHOT);

            channel.asyncOpen(listener, channel);

        });
    }),





    //* * * * * * * * * * * * * *
    //* EVALUATE XML RESPONSES  *
    //* * * * * * * * * * * * * *

    convertToXML: function(text) {
        //try to convert response body to xml
        let xml = null;
        let oParser = (Services.vc.compare(Services.appinfo.platformVersion, "61.*") >= 0) ? new DOMParser() : Components.classes["@mozilla.org/xmlextras/domparser;1"].createInstance(Components.interfaces.nsIDOMParser);
        try {
            xml = oParser.parseFromString(dav.tools.removeXMLInvalidChars(text), "application/xml");
        } catch (e) {
            //however, domparser does not throw an error, it returns an error document
            //https://developer.mozilla.org/de/docs/Web/API/DOMParser
            xml = null;
        }
        //check if xml is error document
        if (xml && xml.documentElement.nodeName == "parsererror") {
            xml = null;
        }

        return xml;
    },

    evaluateNode: function (_node, path) {
        let node = _node;
        let valid = false;

        for (let i=0; i < path.length; i++) {

            let children = node.children;
            valid = false;

            for (let c=0; c < children.length; c++) {
                if (children[c].localName == path[i][1] && children[c].namespaceURI == dav.ns[path[i][0]]) {
                    node = children[c];
                    valid = true;
                    break;
                }
            }

            if (!valid) {
                //none of the children matched the path abort
                return null;
            }
        }

        if (valid) return node;
        return null;
    },

    getNodeTextContentFromMultiResponse: function (response, path, href = null, status = "200") {
        for (let i=0; i < response.multi.length; i++) {
            let node = dav.tools.evaluateNode(response.multi[i].node, path);
            if (node !== null && (href === null || response.multi[i].href == href || decodeURIComponent(response.multi[i].href) == href || response.multi[i].href == decodeURIComponent(href)) && response.multi[i].status == status) {
                return node.textContent;
            }
        }
        return null;
    },

    getNodesTextContentFromMultiResponse: function (response, path, href = null, status = "200") {
        //remove last element from path
        let lastPathElement = path.pop();
        let rv = [];
        
        for (let i=0; i < response.multi.length; i++) {
            let node = dav.tools.evaluateNode(response.multi[i].node, path);
            if (node !== null && (href === null || response.multi[i].href == href || decodeURIComponent(response.multi[i].href) == href || response.multi[i].href == decodeURIComponent(href)) && response.multi[i].status == status) {
                //get all children
                let children = node.getElementsByTagNameNS(dav.ns[lastPathElement[0]], lastPathElement[1]);
                for (let c=0; c < children.length; c++) {
                    if (children[c].textContent) rv.push(children[c].textContent);
                }
            }
        }
        return rv;
    },
    
    getMultiGetRequest: function(hrefs) {
        let request = "<card:addressbook-multiget "+dav.tools.xmlns(["d", "card"])+"><d:prop><d:getetag /><card:address-data /></d:prop>";
        let counts = 0;
        for (let i=0; i < hrefs.length; i++) {
            request += "<d:href>"+hrefs[i]+"</d:href>";
            counts++;
        }
        request += "</card:addressbook-multiget>";

        if (counts > 0) return request;
        else return null;
    },





    //* * * * * * * * * * *
    //* CARDS OPERATIONS  *
    //* * * * * * * * * * *

    deleteCardsContainer: function (maxitems) {
        this.maxitems = maxitems;
        this.data = [];
        this.data.push(Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray));
        this.appendElement = function(element, weak) {            
            if (!(this.data[this.data.length-1].length<this.maxitems)) {
                this.data.push(Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray));
            }
            this.data[this.data.length-1].appendElement(element, weak);
        };
    },
    
    addContact: function(addressBook, id, data, etag, syncdata) {
        let vCard = data.textContent.trim();
        let vCardData = tbSync.dav.vCard.parse(vCard);

        //check if contact or mailinglist
        if (!dav.tools.vCardIsMailingList (id, null, addressBook, vCard, vCardData, etag, syncdata)) {
            //prepare new contact card
            let card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
            card.setProperty("TBSYNCID", id);
            card.setProperty("X-DAV-ETAG", etag.textContent);
            card.setProperty("X-DAV-VCARD", vCard);

            dav.tools.setThunderbirdCardFromVCard(syncdata, addressBook, card, vCardData);

            tbSync.db.addItemToChangeLog(syncdata.targetId, id, "added_by_server");
            addressBook.addCard(card);
        }
    },

    modifyContact: function(addressBook, id, data, etag, syncdata) {
        let vCard = data.textContent.trim();
        let vCardData = tbSync.dav.vCard.parse(vCard);

        //get card
        let card = tbSync.getCardFromProperty(addressBook, "TBSYNCID", id);
        if (card) {
            //check if contact or mailinglist to update card
            if (!dav.tools.vCardIsMailingList (id, card, addressBook, vCard, vCardData, etag, syncdata)) {          
                //get original vCard data as stored by last update from server
                let oCard = tbSync.getPropertyOfCard(card, "X-DAV-VCARD");
                let oCardData = oCard ? tbSync.dav.vCard.parse(oCard) : null;

                card.setProperty("X-DAV-ETAG", etag.textContent);
                card.setProperty("X-DAV-VCARD", vCard);
                
                dav.tools.setThunderbirdCardFromVCard(syncdata, addressBook, card, vCardData, oCardData);

                if (syncdata.revert || tbSync.db.getItemStatusFromChangeLog(syncdata.targetId, id) != "modified_by_user") {
                    tbSync.db.addItemToChangeLog(syncdata.targetId, id, "modified_by_server");
                }
                addressBook.modifyCard(card);
            }        

        } else {
            //card does not exists, create it?
        }
    },

    
    getGroupInfoFromCardData: function (vCardData, addressBook, getMembers = true) {
        let members = [];
        let name = vCardData.hasOwnProperty("fn") ? vCardData["fn"][0].value : "Unlabled Group";

        if (getMembers && vCardData.hasOwnProperty("X-ADDRESSBOOKSERVER-MEMBER")) {
            for (let i=0; i < vCardData["X-ADDRESSBOOKSERVER-MEMBER"].length; i++) {
                let member = vCardData["X-ADDRESSBOOKSERVER-MEMBER"][i].value.replace(/^(urn:uuid:)/,"");
                //this is the only place where we have to look up a card based on its UID
                let memberCard = tbSync.getCardFromProperty(addressBook, "X-DAV-UID", member);
                if (memberCard) members.push(memberCard.getProperty("TBSYNCID", ""));
            }
        }
        return {members, name};
    },
    
    //check if vCard is a mailinglist and handle it
    vCardIsMailingList: function (id, _card, addressBook, vCard, vCardData, etag, syncdata) {
        if (vCardData.hasOwnProperty("X-ADDRESSBOOKSERVER-KIND") && vCardData["X-ADDRESSBOOKSERVER-KIND"][0].value == "group") { 
            if (tbSync.db.getAccountSetting(syncdata.account, "syncGroups") != "1") {
                //user did not enable group sync, so do nothing, but return true so this card does not get added as a real card
                return true;
            }

            let vCardInfo = dav.tools.getGroupInfoFromCardData(vCardData, addressBook, false); //just get the name, not the members

            //if no card provided, create a new one
            let card = _card ? _card : tbSync.createMailingListCard(addressBook, vCardInfo.name, id);
            
            //if this card was created with an older version of TbSync, which did not have groups support, handle as normal card
            if (!card.isMailList) {
                tbSync.errorlog("info", syncdata, "ignoredgroup::" + vCardInfo.name, "dav");
                return false;
            }
                
            //get original vCardData from last server contact, needed for "smart merge" on changes on both sides
            let oCardData = tbSync.dav.vCard.parse(tbSync.getPropertyOfCard(card, "X-DAV-VCARD"));
            //store all old and new vCards for later processing (cannot do it here, because it is not guaranteed, that all members exists already)
            syncdata.foundMailingListsDuringDownSync[id] = {oCardData, vCardData};

            //update properties
            tbSync.setPropertyOfCard(card, "X-DAV-ETAG", etag.textContent);
            tbSync.setPropertyOfCard(card, "X-DAV-VCARD", vCard);            
            return true;

        } else {
            return false;
        }
    },






    //* * * * * * * * * * *
    //* ACTUAL SYNC MAGIC *
    //* * * * * * * * * * *

    //helper function: check vCardData object if it has a meta.type associated
    itemHasMetaType: function (vCardData, item, entry, typefield) {
        return (vCardData[item][entry].meta &&
                vCardData[item][entry].meta[typefield] &&
                vCardData[item][entry].meta[typefield].length > 0);
    },

    //helper function: for each entry for the given item, extract the associated meta.type
    getMetaTypeData: function (vCardData, item, typefield) {
        let metaTypeData = [];
        for (let i=0; i < vCardData[item].length; i++) {
            if (dav.tools.itemHasMetaType(vCardData, item, i, typefield)) {
                //bug in vCard parser? type is always array of length 1, all values joined by ,
                metaTypeData.push( vCardData[item][i].meta[typefield][0].split(",").map(function(x){ return x.toUpperCase().trim() }) );
            } else {
                metaTypeData.push([]);
            }
        }
        return metaTypeData;
    },

    fixArrayValue: function (vCardData, vCardField, index) {
        if (!Array.isArray(vCardData[vCardField.item][vCardField.entry].value)) {
            let v = vCardData[vCardField.item][vCardField.entry].value;
            vCardData[vCardField.item][vCardField.entry].value = [v];
        }
        while (vCardData[vCardField.item][vCardField.entry].value.length < index) vCardData[vCardField.item][vCardField.entry].value.push("");
    },

    getSaveArrayValue: function (vCardValue, index) {
        if (Array.isArray(vCardValue)) {
            if(vCardValue.length > index) return vCardValue[index];
            else return "";
        } else if (index == 0) return vCardValue;
        else return "";
    },

    supportedProperties: [
        {name: "DisplayName", minversion: "0.4"},
        {name: "FirstName", minversion: "0.4"},
        {name: "X-DAV-MiddleName", minversion: "0.8.8"},
        {name: "X-DAV-MainPhone", minversion: "0.8.8"},
        {name: "X-DAV-UID", minversion: "0.10.36"},
        {name: "LastName", minversion: "0.4"},
        {name: "PrimaryEmail", minversion: "0.4"},
        {name: "SecondEmail", minversion: "0.4"},
        {name: "NickName", minversion: "0.4"},
        {name: "Birthday", minversion: "0.4"}, //fake, will trigger special handling
        {name: "Photo", minversion: "0.4"}, //fake, will trigger special handling
        {name: "HomeCity", minversion: "0.4"},
        {name: "HomeCountry", minversion: "0.4"},
        {name: "HomeZipCode", minversion: "0.4"},
        {name: "HomeState", minversion: "0.4"},
        {name: "HomeAddress", minversion: "0.4"},
        {name: "HomePhone", minversion: "0.4"},
        {name: "WorkCity", minversion: "0.4"},
        {name: "WorkCountry", minversion: "0.4"},
        {name: "WorkZipCode", minversion: "0.4"},
        {name: "WorkState", minversion: "0.4"},
        {name: "WorkAddress", minversion: "0.4"},
        {name: "WorkPhone", minversion: "0.4"},
        {name: "Categories", minversion: "0.4"},
        {name: "JobTitle", minversion: "0.4"},
        {name: "Department", minversion: "0.4"},
        {name: "Company", minversion: "0.4"},
        {name: "WebPage1", minversion: "0.4"},
        {name: "WebPage2", minversion: "0.4"},
        {name: "CellularNumber", minversion: "0.4"},
        {name: "PagerNumber", minversion: "0.4"},
        {name: "FaxNumber", minversion: "0.4"},
        {name: "Notes", minversion: "0.4"},
        {name: "PreferMailFormat", minversion: "0.4"},
        {name: "Custom1", minversion: "0.4"},
        {name: "Custom2", minversion: "0.4"},
        {name: "Custom3", minversion: "0.4"},
        {name: "Custom4", minversion: "0.4"},
        {name: "_GoogleTalk", minversion: "0.4"},
        {name: "_JabberId", minversion: "0.4"},
        {name: "_Yahoo", minversion: "0.4"},
        {name: "_QQ", minversion: "0.4"},
        {name: "_AimScreenName", minversion: "0.4"},
        {name: "_MSN", minversion: "0.4"},
        {name: "_Skype", minversion: "0.4"},
        {name: "_ICQ", minversion: "0.4"},
        {name: "_IRC", minversion: "0.4"},
    ],

    //map thunderbird fields to simple vcard fields without additional types
    simpleMap : {
        "X-DAV-UID" : "uid",
        "Birthday" : "bday", //fake
        "Photo" : "photo", //fake
        "JobTitle" : "title",
        "Department" : "org",
        "Company" : "org",
        "DisplayName" : "fn",
        "NickName" : "nickname",
        "Categories" : "categories",
        "Notes" : "note",
        "FirstName" : "n",
        "X-DAV-MiddleName" : "n",
        "LastName" : "n",
        "PreferMailFormat" : "X-MOZILLA-HTML",
        "Custom1" : "X-MOZILLA-CUSTOM1",
        "Custom2" : "X-MOZILLA-CUSTOM2",
        "Custom3" : "X-MOZILLA-CUSTOM3",
        "Custom4" : "X-MOZILLA-CUSTOM4",
    },

    //map thunderbird fields to vcard fields with additional types
    complexMap : {
        "WebPage1" : {item: "url", type: "WORK"},
        "WebPage2" : {item: "url", type: "HOME"},
        "CellularNumber" : {item: "tel", type: "CELL"},
        "PagerNumber" : {item: "tel", type: "PAGER"},
        "FaxNumber" : {item: "tel", type: "FAX"},

        "HomeCity" : {item: "adr", type: "HOME"},
        "HomeCountry" : {item: "adr", type: "HOME"},
        "HomeZipCode" : {item: "adr", type: "HOME"},
        "HomeState" : {item: "adr", type: "HOME"},
        "HomeAddress" : {item: "adr", type: "HOME"},
        "HomePhone" : {item: "tel", type: "HOME", invalidTypes: ["FAX", "PAGER", "CELL"]},

        "WorkCity" : {item: "adr", type: "WORK"},
        "WorkCountry" : {item: "adr", type: "WORK"},
        "WorkZipCode" : {item: "adr", type: "WORK"},
        "WorkState" : {item: "adr", type: "WORK"},
        "WorkAddress" : {item: "adr", type: "WORK"},
        "WorkPhone" : {item: "tel", type: "WORK", invalidTypes: ["FAX", "PAGER", "CELL"]},
    },

    //map thunderbird fields to impp vcard fields with additional x-service-types
    imppMap : {
        "_GoogleTalk" : {item: "impp" , prefix: "xmpp:", type: "GOOGLETALK"}, //actually x-service-type
        "_JabberId" : {item: "impp", prefix: "xmpp:", type: "JABBER"},
        "_Yahoo" : {item: "impp", prefix: "ymsgr:", type: "YAHOO"},
        "_QQ" : {item: "impp", prefix: "x-apple:", type: "QQ"},
        "_AimScreenName" : {item: "impp", prefix: "aim:", type: "AIM"},
        "_MSN" : {item: "impp", prefix: "msnim:", type: "MSN"},
        "_Skype" : {item: "impp", prefix: "skype:", type: "SKYPE"},
        "_ICQ" : {item: "impp", prefix: "aim:", type: "ICQ"},
        "_IRC" : {item: "impp", prefix: "irc:", type: "IRC"},
    },





    //For a given Thunderbird property, identify the vCard field
    // -> which main item
    // -> which array element (based on metatype, if needed)
    //https://tools.ietf.org/html/rfc2426#section-3.6.1
    getVCardField: function (syncdata, property, vCardData) {
        let data = {item: "", metatype: [], metatypefield: "type", entry: -1, prefix: ""};

        if (vCardData) {
            //handle special cases independently, those from *Map will be handled by default
            switch (property) {
                case "PrimaryEmail":
                case "SecondEmail":
                    {
                        //assign email types based on emailSwapInvert
                        let emailMap = {"PrimaryEmail.0": "PrimaryEmail", "SecondEmail.0": "SecondEmail", "PrimaryEmail.1": "SecondEmail", "SecondEmail.1": "PrimaryEmail"};
                        let emailSwap = syncdata.emailSwapInvert == "1" ? "1" : "0";
                        let emailType = emailMap[property + "." + emailSwap];
                        
                        let metamap = (tbSync.db.getAccountSetting(syncdata.account, "useHomeAsPrimary") == "0") ? {"PrimaryEmail": "WORK", "SecondEmail": "HOME"} : {"PrimaryEmail": "HOME", "SecondEmail": "WORK"};
                        data.metatype.push(metamap[emailType]);
                        data.item = "email";

                        //search the first valid entry
                        if (vCardData[data.item]) {
                            let metaTypeData = dav.tools.getMetaTypeData(vCardData, data.item, data.metatypefield);

                            //check metaTypeData to find correct entry
                            if (emailType == "PrimaryEmail") {

                                let prev = [];
                                let primary = [];
                                let primaryPrev = [];
                                let otherButNotSecondary = [];
                                for (let i=0; i < metaTypeData.length; i++) {
                                    if (metaTypeData[i].includes(metamap.PrimaryEmail) && metaTypeData[i].includes("PREV")) primaryPrev.push(i);
                                    if (metaTypeData[i].includes("PREV") && !metaTypeData[i].includes(metamap.SecondEmail)) prev.push(i);
                                    if (metaTypeData[i].includes(metamap.PrimaryEmail)) primary.push(i);
                                    if (!metaTypeData[i].includes(metamap.SecondEmail) && !metaTypeData[i].includes("INTERNET")) otherButNotSecondary.push(i);
                                }
                                if (primaryPrev.length > 0) data.entry = primaryPrev[0];
                                else if (prev.length > 0) data.entry = prev[0];
                                else if (primary.length > 0) data.entry = primary[0];
                                else if (otherButNotSecondary.length > 0) data.entry = otherButNotSecondary[0];

                            } else {

                                let secondaryPrev = [];
                                let secondary = [];
                                let internet = [];
                                for (let i=0; i < metaTypeData.length; i++) {
                                    if (metaTypeData[i].includes(metamap.SecondEmail) && metaTypeData[i].includes("PREV")) secondaryPrev.push(i);
                                    if (metaTypeData[i].includes(metamap.SecondEmail)) secondary.push(i);
                                    if (metaTypeData[i].includes("INTERNET")) internet.push(i);
                                }
                                if (secondaryPrev.length > 0) data.entry = secondaryPrev[0];
                                else if (secondary.length > 0) data.entry = secondary[0];
                                else if (internet.length > 0) data.entry = internet[0];

                            }
                        }
                    }
                    break;

                case "X-DAV-MainPhone":
                    {
                        data.metatype.push("PREV");
                        data.item = "tel";

                        //search the first valid entry
                        if (vCardData[data.item]) {
                            let metaTypeData = dav.tools.getMetaTypeData(vCardData, data.item, data.metatypefield);

                            //we take everything that is not HOME, WORK, CELL, PAGER or FAX
                            //we take PREV over MAIN (fruux) over VOICE over ?
                            let tel = {};
                            tel.prev =[];
                            tel.main =[];
                            tel.voice =[];
                            tel.other =[];
                            for (let i=0; i < metaTypeData.length; i++) {
                                if (!metaTypeData[i].includes("HOME") && !metaTypeData[i].includes("WORK") && !metaTypeData[i].includes("CELL") && !metaTypeData[i].includes("PAGER") && !metaTypeData[i].includes("FAX")) {
                                    if (metaTypeData[i].includes("PREV")) tel.prev.push(i);
                                    else if (metaTypeData[i].includes("MAIN")) tel.main.push(i);
                                    else if (metaTypeData[i].includes("VOICE")) tel.voice.push(i);
                                    else tel.other.push(i);
                                }
                            }

                            if (tel.prev.length > 0) data.entry = tel.prev[0];
                            else if (tel.main.length > 0) data.entry = tel.main[0];
                            else if (tel.voice.length > 0) data.entry = tel.voice[0];
                            else if (tel.other.length > 0) data.entry = tel.other[0];

                        }
                    }
                    break;

                default:
                    //Check *Maps
                    if (dav.tools.simpleMap.hasOwnProperty(property)) {

                        data.item = dav.tools.simpleMap[property];
                        if (vCardData[data.item] && vCardData[data.item].length > 0) data.entry = 0;

                    } else if (dav.tools.imppMap.hasOwnProperty(property)) {

                        let type = dav.tools.imppMap[property].type;
                        data.metatype.push(type);
                        data.item = dav.tools.imppMap[property].item;
                        data.prefix = dav.tools.imppMap[property].prefix;
                        data.metatypefield = "x-service-type";

                        if (vCardData[data.item]) {
                            let metaTypeData = dav.tools.getMetaTypeData(vCardData, data.item, data.metatypefield);

                            let valids = [];
                            for (let i=0; i < metaTypeData.length; i++) {
                                if (metaTypeData[i].includes(type)) valids.push(i);
                            }
                            if (valids.length > 0) data.entry = valids[0];
                        }

                    } else if (dav.tools.complexMap.hasOwnProperty(property)) {

                        let type = dav.tools.complexMap[property].type;
                        let invalidTypes = (dav.tools.complexMap[property].invalidTypes) ? dav.tools.complexMap[property].invalidTypes : [];
                        data.metatype.push(type);
                        data.item = dav.tools.complexMap[property].item;

                        if (vCardData[data.item]) {
                            let metaTypeData = dav.tools.getMetaTypeData(vCardData, data.item, data.metatypefield);
                            let valids = [];
                            for (let i=0; i < metaTypeData.length; i++) {
                                //check if this includes the requested type and also none of the invalid types
                                if (metaTypeData[i].includes(type) && metaTypeData[i].filter(value => -1 !== invalidTypes.indexOf(value)).length == 0) valids.push(i);
                            }
                            if (valids.length > 0) data.entry = valids[0];
                        }

                    } else throw "Unknown TB property <"+property+">";
            }
        }

        return data;
    },





    //turn the given vCardValue into a string to be stored as a Thunderbird property
    getThunderbirdPropertyValueFromVCard: function (syncdata, property, vCardData, vCardField) {
        let vCardValue = (vCardData &&
                                    vCardField &&
                                    vCardField.entry != -1 &&
                                    vCardData[vCardField.item] &&
                                    vCardData[vCardField.item][vCardField.entry]  &&
                                    vCardData[vCardField.item][vCardField.entry].value) ? vCardData[vCardField.item][vCardField.entry].value : null;

        if (vCardValue === null) {
            return null;
        }

        //handle all special fields, which are not plain strings
        switch (property) {
            case "HomeCity":
            case "HomeCountry":
            case "HomeZipCode":
            case "HomeState":
            case "HomeAddress":
            case "WorkCity":
            case "WorkCountry":
            case "WorkZipCode":
            case "WorkState":
            case "WorkAddress":
                {
                    let field = property.substring(4);
                    let adr = (Services.vc.compare("0.8.11", syncdata.folderCreatedWithProviderVersion) > 0)
                                    ?  ["OfficeBox","ExtAddr","Address","City","Country","ZipCode", "State"] //WRONG
                                    : ["OfficeBox","ExtAddr","Address","City","State","ZipCode", "Country"]; //RIGHT, fixed in 0.8.11

                    let index = adr.indexOf(field);
                    return dav.tools.getSaveArrayValue(vCardValue, index);
                }
                break;

            case "FirstName":
            case "LastName":
            case "X-DAV-MiddleName":
                {
                    let index = ["LastName","FirstName","X-DAV-MiddleName","Prefix","Suffix"].indexOf(property);
                    return dav.tools.getSaveArrayValue(vCardValue, index);
                }
                break;

            case "Department":
            case "Company":
                {
                    let index = ["Company","Department"].indexOf(property);
                    return dav.tools.getSaveArrayValue(vCardValue, index);
                }
                break;

            case "Categories":
                return (Array.isArray(vCardValue) ? vCardValue.join("\u001A") : vCardValue);
                break;

            case "PreferMailFormat":
                if (vCardValue.toLowerCase() == "true") return 2;
                if (vCardValue.toLowerCase() == "false") return 1;
                return 0;
                break;

            default: //should be a single string
                let v = (Array.isArray(vCardValue)) ? vCardValue.join(" ") : vCardValue;
                if (vCardField.prefix.length > 0 && v.startsWith(vCardField.prefix)) return v.substring(vCardField.prefix.length);
                else return v;
        }
    },





    //add/update the given Thunderbird propeties value in vCardData obj
    updateValueOfVCard: function (syncdata, property, vCardData, vCardField, value) {
        let add = false;
        let store = value ? true : false;
        let remove = (!store && vCardData[vCardField.item] && vCardField.entry != -1);

        //preperations if this item does not exist
        if (store && vCardField.entry == -1) {
            //entry does not exists, does the item exists?
            if (!vCardData[vCardField.item]) vCardData[vCardField.item] = [];
            let newItem = {};
            if (vCardField.metatype.length > 0) {
                newItem["meta"] = {};
                newItem["meta"][vCardField.metatypefield] = vCardField.metatype;
            }
            vCardField.entry = vCardData[vCardField.item].push(newItem) - 1;
            add = true;
        }

        //handle all special fields, which are not plain strings
        switch (property) {
            case "HomeCity":
            case "HomeCountry":
            case "HomeZipCode":
            case "HomeState":
            case "HomeAddress":
            case "WorkCity":
            case "WorkCountry":
            case "WorkZipCode":
            case "WorkState":
            case "WorkAddress":
                {
                    let field = property.substring(4);
                    let adr = (Services.vc.compare("0.8.11", syncdata.folderCreatedWithProviderVersion) > 0)
                                    ?  ["OfficeBox","ExtAddr","Address","City","Country","ZipCode", "State"] //WRONG
                                    : ["OfficeBox","ExtAddr","Address","City","State","ZipCode", "Country"]; //RIGHT, fixed in 0.8.11

                    let index = adr.indexOf(field);
                    if (store) {
                        if (add) vCardData[vCardField.item][vCardField.entry].value = ["","","","","","",""];

                        dav.tools.fixArrayValue(vCardData, vCardField, index);
                        vCardData[vCardField.item][vCardField.entry].value[index] = value;
                    } else if (remove) {
                        dav.tools.fixArrayValue(vCardData, vCardField, index);
                        vCardData[vCardField.item][vCardField.entry].value[index] = "";  //Will be completly removed by the parser, if all fields are empty!
                    }
                }
                break;

            case "FirstName":
            case "X-DAV-MiddleName":
            case "LastName":
                {
                    let index = ["LastName","FirstName","X-DAV-MiddleName","Prefix","Suffix"].indexOf(property);
                    if (store) {
                        if (add) vCardData[vCardField.item][vCardField.entry].value = ["","","","",""];

                        dav.tools.fixArrayValue(vCardData, vCardField, index);
                        vCardData[vCardField.item][vCardField.entry].value[index] = value;
                    } else if (remove) {
                        dav.tools.fixArrayValue(vCardData, vCardField, index);
                        vCardData[vCardField.item][vCardField.entry].value[index] = "";  //Will be completly removed by the parser, if all fields are empty!
                    }
                }
                break;

            case "Department":
            case "Company":
                {
                    let index = ["Company","Department"].indexOf(property);
                    if (store) {
                        if (add) vCardData[vCardField.item][vCardField.entry].value = ["",""];

                        dav.tools.fixArrayValue(vCardData, vCardField, index);
                        vCardData[vCardField.item][vCardField.entry].value[index] = value;
                    } else if (remove && vCardData[vCardField.item][vCardField.entry].value.length > index) {
                        dav.tools.fixArrayValue(vCardData, vCardField, index);
                        vCardData[vCardField.item][vCardField.entry].value[index] = "";  //Will be completly removed by the parser, if all fields are empty!
                    }
                }
                break;

            case "Categories":
                if (store) vCardData[vCardField.item][vCardField.entry].value = value.split("\u001A");
                else if (remove) vCardData[vCardField.item][vCardField.entry].value = [];
                break;

            case "PreferMailFormat":
                {
                    if (store) {
                        let v = (value == 2) ? "TRUE" : (value == 1) ? "FALSE" : "";
                        vCardData[vCardField.item][vCardField.entry].value = v;
                    } else if (remove) vCardData[vCardField.item][vCardField.entry].value = "";
                }
                break;

            default: //should be a string
                if (store) vCardData[vCardField.item][vCardField.entry].value = vCardField.prefix + value;
                else if (remove) vCardData[vCardField.item][vCardField.entry].value = "";
        }
    },




    //MAIN FUNCTIONS FOR UP/DOWN SYNC

    //update send from server to client
    setThunderbirdCardFromVCard: function(syncdata, addressBook, card, vCardData, oCardData = null) {
        if (tbSync.prefSettings.getIntPref("log.userdatalevel")>1) tbSync.dump("JSON from vCard", JSON.stringify(vCardData));
        //if (oCardData) tbSync.dump("JSON from oCard", JSON.stringify(oCardData));
        
        //keep track of emails
        syncdata.emailSwapInvert = card.getProperty("X-DAV-SWAP","0");
        let emails = {PrimaryEmail: "", SecondEmail: ""};
        
        for (let f=0; f < dav.tools.supportedProperties.length; f++) {
            //Skip sync fields that have been added after this folder was created (otherwise we would delete them)
            if (Services.vc.compare(dav.tools.supportedProperties[f].minversion, syncdata.folderCreatedWithProviderVersion)> 0) continue;

            let property = dav.tools.supportedProperties[f].name;
            let vCardField = dav.tools.getVCardField(syncdata, property, vCardData);
            let newServerValue = dav.tools.getThunderbirdPropertyValueFromVCard(syncdata, property, vCardData, vCardField);

            let oCardField = dav.tools.getVCardField(syncdata, property, oCardData);
            let oldServerValue = dav.tools.getThunderbirdPropertyValueFromVCard(syncdata, property, oCardData, oCardField);

            //keep track of emails
            if (emails.hasOwnProperty(property)) emails[property] = newServerValue;
            
            //smart merge: only update the property, if it has changed on the server (keep local modifications)
            if (newServerValue !== oldServerValue) {
                //some "properties" need special handling
                switch (property) {
                    case "Photo":
                        {
                            if (newServerValue) {
                                //set if supported
                                if (vCardData[vCardField.item][0].meta && vCardData[vCardField.item][0].meta.encoding) {
                                    tbSync.addphoto(dav.tools.generateUUID() + '.jpg', addressBook.URI, card, vCardData["photo"][0].value);
                                }
                            } else {
                                //clear
                                card.deleteProperty("PhotoName");
                                card.deleteProperty("PhotoType");
                                card.deleteProperty("PhotoURI");
                            }
                        }
                        break;

                    case "Birthday":
                        {
                            if ( newServerValue ) {
                                let bday = dav.tools.parseVcardDateTime( newServerValue, vCardData[vCardField.item][0].meta );
                                card.setProperty("BirthYear", bday[1]);
                                card.setProperty("BirthMonth", bday[2]);
                                card.setProperty("BirthDay", bday[3]);
                            } else {
                                card.deleteProperty("BirthYear");
                                card.deleteProperty("BirthMonth");
                                card.deleteProperty("BirthDay");
                            }
                        }
                        break;

                    default:
                        {
                            if (newServerValue) {
                                //set
                                card.setProperty(property, newServerValue);
                            } else {
                                //clear (del if possible)
                                card.setProperty(property, "");
                                try {
                                    card.deleteProperty(property);
                                } catch (e) {}
                            }
                        }
                        break;
                 }
            }
        }
        
        //Special handling of PrimaryEmail
        if (!emails["PrimaryEmail"] && emails["SecondEmail"]) {
            //adjust swap setting
            card.setProperty("X-DAV-SWAP", syncdata.emailSwapInvert == "0" ? "1" : "0");
            //swap
            card.setProperty("PrimaryEmail", emails["SecondEmail"]);
            card.setProperty("SecondEmail", "");
            try {
                card.deleteProperty("SecondEmail");
            } catch (e) {} 
        }                
    },

    invalidateThunderbirdCard: function(syncdata, addressBook, id) {
        let card = tbSync.getCardFromProperty(addressBook, "TBSYNCID", id);
        tbSync.setPropertyOfCard(card, "X-DAV-ETAG", "");
        tbSync.setPropertyOfCard(card, "X-DAV-VCARD", "");
        tbSync.db.addItemToChangeLog(syncdata.targetId, id, "modified_by_server");
        addressBook.modifyCard(card);
    },

    getGroupInfoFromList: function (listUri) {
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        let listDir = abManager.getDirectory(listUri);
        let name = listDir.dirName;
        let members = [];
        
        let memberCards = listDir.addressLists;
        for (let i=0; i < memberCards.length; i++) {
            let memberCard = memberCards.queryElementAt(i, Components.interfaces.nsIAbCard);
            let memberUID = memberCard.getProperty("TBSYNCID", ""); 
            members.push(memberUID);
        }
        return {members, name};
    },
    
    //build group card
    getVCardFromThunderbirdListCard: function(syncdata, addressBook, card, generateUID = false) {
        let cardID  = tbSync.getPropertyOfCard(card, "TBSYNCID");
        let currentCard = tbSync.getPropertyOfCard(card, "X-DAV-VCARD").trim();
        let vCardData = tbSync.dav.vCard.parse(currentCard);
        
        if (!vCardData.hasOwnProperty("version")) vCardData["version"] = [{"value": "3.0"}];

        vCardData["fn"] = [{"value": syncdata.foundMailingListsDuringUpSync[cardID].name}];
        vCardData["n"] = [{"value": syncdata.foundMailingListsDuringUpSync[cardID].name}];
        vCardData["X-ADDRESSBOOKSERVER-KIND"] = [{"value": "group"}];

        if (generateUID) {
            //add required UID, it is not used for maillist 
            vCardData["uid"] = [{"value": dav.tools.generateUUID()}];
        }
        
        //build memberlist from scratch  
        vCardData["X-ADDRESSBOOKSERVER-MEMBER"]=[];
        for (let i=0; i < syncdata.foundMailingListsDuringUpSync[cardID].members.length; i++) {
            //the UID differs from the href/TBSYNCID (following the specs)
            let memberCard = tbSync.getCardFromProperty(addressBook, "TBSYNCID", syncdata.foundMailingListsDuringUpSync[cardID].members[i]);
            let uid = memberCard.getProperty("X-DAV-UID", "");
            if (!uid) {
                uid = dav.tools.generateUUID();
                memberCard.setProperty("X-DAV-UID", uid);
                //this card has added_by_user status and thus this mod will not trigger a UI notification
                addressBook.modifyCard(memberCard);
            }
            vCardData["X-ADDRESSBOOKSERVER-MEMBER"].push({"value": "urn:uuid:" + uid});
        }
        
        let newCard = tbSync.dav.vCard.generate(vCardData).trim();
        return {data: newCard, etag: tbSync.getPropertyOfCard(card, "X-DAV-ETAG"), modified: (currentCard != newCard)};
    },

    //return the stored vcard of the card (or empty vcard if none stored) and merge local changes
    getVCardFromThunderbirdContactCard: function(syncdata, addressBook, card, generateUID = false) {
        let currentCard = tbSync.getPropertyOfCard(card, "X-DAV-VCARD").trim();
        let vCardData = tbSync.dav.vCard.parse(currentCard);
        
        syncdata.emailSwapInvert = card.getProperty("X-DAV-SWAP","0");

        for (let f=0; f < dav.tools.supportedProperties.length; f++) {
            //Skip sync fields that have been added after this folder was created (otherwise we would delete them)
            if (Services.vc.compare(dav.tools.supportedProperties[f].minversion, syncdata.folderCreatedWithProviderVersion)> 0) continue;

            let property = dav.tools.supportedProperties[f].name;
            let vCardField = dav.tools.getVCardField(syncdata, property, vCardData);

            //some "properties" need special handling
            switch (property) {
                case "Photo":
                    {
                        if (card.getProperty("PhotoType", "") == "file") {
                            dav.tools.updateValueOfVCard(syncdata, property, vCardData, vCardField, tbSync.getphoto(card));
                            vCardData[vCardField.item][0].meta = {"encoding": ["b"], "type": ["JPEG"]};
                        }
                    }
                    break;

                case "Birthday":
                    {
                        // Support missing year in vcard3, as done by Apple Contacts.
                        const APPLE_MISSING_YEAR_MARK = "1604";

                        let birthYear = parseInt(card.getProperty("BirthYear", 0));
                        let birthMonth = parseInt(card.getProperty("BirthMonth", 0));
                        let birthDay = parseInt(card.getProperty("BirthDay", 0));

                        if (!birthYear) {
                            birthYear = APPLE_MISSING_YEAR_MARK;
                        }

                        let value = "";
                        if (birthYear && birthMonth && birthDay) {
                            // TODO: for vcard4, we'll need to get rid of the hyphens and support missing date elements
                            value = birthYear + "-" + ("00"+birthMonth).slice(-2) + "-" + ("00"+birthDay).slice(-2);
                        }
                        dav.tools.updateValueOfVCard(syncdata, property, vCardData, vCardField, value);

                        if (birthYear == APPLE_MISSING_YEAR_MARK && Array.isArray(vCardData[vCardField.item]) && vCardData[vCardField.item].length > 0) {
                            vCardData[vCardField.item][0].meta = {"x-apple-omit-year": [APPLE_MISSING_YEAR_MARK]};
                        }
                    }
                    break;

                default:
                    {
                        let value = card.getProperty(property, "");
                        //fix for bug 1522453
                        if ((property == "PrimaryEmail" || property == "SecondEmail") && value.endsWith("@bug1522453")) {
                            value = "";
                        }
                        dav.tools.updateValueOfVCard(syncdata, property, vCardData, vCardField, value);
                    }
                    break;
            }
        }

        if (generateUID) {
            //the UID differs from the href/TBSYNCID (following the specs)
            let uid = card.getProperty("X-DAV-UID", "");
            if (!uid) {
                uid = dav.tools.generateUUID();
                card.setProperty("X-DAV-UID", uid);
                //this card has added_by_user status and thus this mod will not trigger a UI notification
                addressBook.modifyCard(card);
            }
            vCardData["uid"] = [{"value": uid}];
        }

        //add required fields
        if (!vCardData.hasOwnProperty("version")) vCardData["version"] = [{"value": "3.0"}];
        if (!vCardData.hasOwnProperty("fn")) vCardData["fn"] = [{"value": " "}];
        if (!vCardData.hasOwnProperty("n")) vCardData["n"] = [{"value": [" ","","","",""]}];

        //get new vCard
        let newCard = tbSync.dav.vCard.generate(vCardData).trim();
        return {data: newCard, etag: tbSync.getPropertyOfCard(card, "X-DAV-ETAG"), modified: (currentCard != newCard)};
    },

}
