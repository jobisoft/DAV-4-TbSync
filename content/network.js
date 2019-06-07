/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

var network = {

    ConnectionData: class {
        constructor(syncData) {            
            this._password = "";
            this._user = "";
            this._https = "";
            this._type = "";
            this._fqdn = "";
            this._timeout = tbSync.prefs.getIntPref("timeout");
            this._timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);

            //for error logging
            this._errorOwnerData = null;
            
            if (syncData) {
                let auth = new tbSync.PasswordAuthData(syncData.accountData);
                this._password = auth.getPassword();
                this._user = auth.getUsername();

                this._https = syncData.accountData.getAccountSetting("https");
                this._accountname = syncData.accountData.getAccountSetting("accountname");
                if (syncData.currentFolderData) {
                    this._type = syncData.currentFolderData.getFolderSetting("type");
                    this._fqdn = syncData.currentFolderData.getFolderSetting("fqdn");
                }
                this._errorOwnerData = syncData.errorOwnerData;
            }            
        }
        
        startTimeout(aChannel) {
            let rv = Components.results.NS_ERROR_NET_TIMEOUT;
            let event = {
                notify: function(timer) {
                    if (aChannel) aChannel.cancel(rv);
                }
            }
            this._timer.initWithCallback(event, this._timeout, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
        }
                
        set password(v) {this._password = v;}
        set user(v) {this._user = v;}
        set timeout(v) {this._timeout = v;}
        set https(v) {this._https = v;}
        set type(v) {this._type = v;}
        set fqdn(v) {this._fqdn = v;}
        set errorOwnerData(v) {this._errorOwnerData = v;}

        get password() {return this._password;}
        get user() {return this._user;}
        get timeout() {return this._timeout;}
        get https() {return this._https;}
        get type() {return this._type;}
        get fqdn() {return this._fqdn;}
        get errorOwnerData() {return this._errorOwnerData;}
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
            tbSync.dump("PROMPTING", (this.mConnection.type));

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

    prepHttpChannel: function(aUploadData, aHeaders, aMethod, aConnection, aNotificationCallbacks=null, aExisting=null) {
        let userContextId = tbSync.network.getContainerIdForUser(aConnection.user);
        let channel = aExisting || Services.io.newChannelFromURI2(
                                                                aConnection.uri,
                                                                null,
                                                                Services.scriptSecurityManager.createCodebasePrincipal(aConnection.uri, { userContextId }),
                                                                null,
                                                                Components.interfaces.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_DATA_IS_NULL,
                                                                Components.interfaces.nsIContentPolicy.TYPE_OTHER);
        let httpchannel = channel.QueryInterface(Components.interfaces.nsIHttpChannel);

        
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
 
    sendRequest: async function (requestData, path, method, connectionData, headers = {}, options = {softfail: []}, aUseStreamLoader = true) {            
        //path could be absolute or relative, we may need to rebuild the full url
        let url = (path.startsWith("http://") || path.startsWith("https://")) ? path : "http" + (connectionData.https ? "s" : "") + "://" + connectionData.fqdn + path;

        //a few bugs in TB and in client implementations require to retry a connection on certain failures
        for (let i=1; i < 5; i++) { //max number of retries
            tbSync.dump("URL Request #" + i, url);

            connectionData.uri = Services.io.newURI(url);

            //https://bugzilla.mozilla.org/show_bug.cgi?id=669675
            if (dav.problematicHosts.includes(connectionData.uri.host)) {
                headers["Authorization"] = "Basic " + tbSync.tools.b64encode(connectionData.user + ":" + connectionData.password);
            }
            
            let r = await dav.network.useHttpChannel(requestData, method, connectionData, headers, options, aUseStreamLoader);
        
            //connectionData.uri.host may no longer be the correct value, as there might have been redirects, use connectionData.fqdn 
            if (r && r.retry && r.retry === true) {
                if (r.addBasicAuthHeaderOnce) {
                    tbSync.dump("DAV:unauthenticated", "Manually adding basic auth header for <" + connectionData.user + "@" + connectionData.fqdn + ">");
                    headers["Authorization"] = "Basic " + tbSync.tools.b64encode(connectionData.user + ":" + connectionData.password);
                } else if (!dav.problematicHosts.includes(connectionData.fqdn) ) {
                    tbSync.dump("BUG 669675", "Adding <" + connectionData.fqdn + "> to list of problematic hosts.");
                    dav.problematicHosts.push(connectionData.fqdn)
                }

                //there might have been a redirect, rebuild url
                url = "http" + (connectionData.https ? "s" : "") + "://" + connectionData.fqdn + r.path;
            } else {
                return r;
            }
        }
    },
    
    // Promisified implementation of Components.interfaces.nsIHttpChannel
    useHttpChannel: async function (requestData, method, connectionData, headers, options, aUseStreamLoader) {
        let responseData = "";
        
        //do not log HEADERS, as it could contain an Authorization header
        //tbSync.dump("HEADERS", JSON.stringify(headers));
        if (tbSync.prefs.getIntPref("log.userdatalevel")>1) tbSync.dump("REQUEST", method + " : " + requestData);
        
        //testing with fetch()
/*        if (!aUseStreamLoader) {
            let fetchoptions = {};
            fetchoptions.method = method;
            fetchoptions.body = requestData;
            fetchoptions.cache = "no-cache";
            //do not include credentials, so we do not end up in a session, see https://github.com/owncloud/core/issues/27093
            fetchoptions.credentials = "omit";
            fetchoptions.redirect = "follow";// manual, *follow, error
            fetchoptions.headers = headers;
            fetchoptions.headers["Content-Length"] = requestData.length;

            if (!fetchoptions.headers.hasOwnProperty("Content-Type"))
                fetchoptions.headers["Content-Type"] = "application/xml; charset=utf-8";
            
            fetchoptions.headers["Authorization"] = "Basic " + btoa(connectionData.user + ':' + connectionData.password);
            tbSync.dump("FETCH URL", connectionData.uri.spec);
            tbSync.dump("FETCH OPTIONS", JSON.stringify(fetchoptions));

            try {
                let response = await tbSync.window.fetch(connectionData.uri.spec, fetchoptions);
                tbSync.dump("FETCH STATUS", response.status);
                let text = await response.text();
                tbSync.dump("FETCH RESPONSE", response.status + " : " + text);
            } catch (e) {
                Components.utils.reportError(e);
                tbSync.dump("FETCH FAILED", "");
            }
            return null;
        }*/
    
        return new Promise(function(resolve, reject) {                  
            let listener = {
                _data: "",
                _stream: null,

                //nsIStreamListener (aUseStreamLoader = false)
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
                    //tbSync.dump("STREAM", d);
                    this._data += d;
                },        
                onStopRequest: function(aRequest, aContext, aStatusCode) {
                    Services.console.logStringMessage("[onStopRequest] " + aStatusCode);
                    this.processResponse(aRequest.QueryInterface(Components.interfaces.nsIHttpChannel), aContext, aStatusCode,  this._data);
                },
            
                //nsIStreamLoaderObserver (aUseStreamLoader = true)
                onStreamComplete: function(aLoader, aContext, aStatus, aResultLength, aResult) {
                    let result = dav.tools.convertByteArray(aResult, aResultLength);  
                    this.processResponse(aLoader.request.QueryInterface(Components.interfaces.nsIHttpChannel), aContext, aStatus, result);
                },
                
                processResponse: function(aChannel, aContext, aStatus, aResult) {
                    let responseStatus = 0;
                    try {
                        responseStatus = aChannel.responseStatus;
                    } catch (ex) {
                        let error = tbSync.network.createTCPErrorFromFailedRequest(aChannel);
                        if (!error) {
                            return reject(dav.sync.failed("networkerror", "URL:\n" + connectionData.uri.spec + " ("+method+")")); //reject/resolve do not terminate control flow
                        } else {
                            return reject(dav.sync.failed(error, "URL:\n" + connectionData.uri.spec + " ("+method+")"));
                        }
                    }
                    
                    if (tbSync.prefs.getIntPref("log.userdatalevel")>1) tbSync.dump("RESPONSE", responseStatus + " ("+aChannel.responseStatusText+")" + " : " + aResult);
                    responseData = aResult.split("><").join(">\n<");
                    
                    //Redirected? Update connection settings from current URL
                    if (aChannel.URI) {
                        let newHttps = (aChannel.URI.scheme == "https");
                        if (connectionData.https != newHttps) {
                            tbSync.dump("Updating HTTPS", connectionData.https + " -> " + newHttps);
                            connectionData.https = newHttps;
                        }
                        if (connectionData.fqdn != aChannel.URI.hostPort) {
                            tbSync.dump("Updating FQDN", connectionData.fqdn + " -> " + aChannel.URI.hostPort);
                            connectionData.fqdn = aChannel.URI.hostPort;
                        }
                    }

                    switch(responseStatus) {
                        case 301:
                        case 302:
                        case 303:
                        case 305:
                        case 307:
                        case 308:
                            {
                                //Since the default nsIChannelEventSink handles the redirects, this should never be called.
                                //Just in case, do a retry with the updated connection settings.
                                let response = {};
                                response.retry = true;
                                response.path = aChannel.URI.pathQueryRef;
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
                                if (connectionData.password !== null) {                                    
                                    //did the channel try to authenticate?
                                    let triedToAuthenticate;
                                    try {
                                        let header = aChannel.getRequestHeader("Authorization");
                                        triedToAuthenticate = true;
                                    } catch (e) {
                                        triedToAuthenticate = false;
                                    }
                                    
                                    if (!triedToAuthenticate) {
                                        let response = {};
                                        response.retry = true;
                                        response.path = aChannel.URI.pathQueryRef;
                                        return resolve(response);
                                    }
                                }
                                
                                return reject(dav.sync.failed(responseStatus, "URL:\n" + connectionData.uri.spec + " ("+method+")" + "\n\nRequest:\n" + requestData + "\n\nResponse:\n" + responseData)); 
                            }
                            break;
                            
                        case 207: //preprocess multiresponse
                            {
                                let xml = dav.tools.convertToXML(aResult);
                                if (xml === null) return reject(dav.sync.failed("maiformed-xml", "URL:\n" + connectionData.uri.spec + " ("+method+")" + "\n\nRequest:\n" + requestData + "\n\nResponse:\n" + responseData));

                                //the specs allow to  return a 207 with DAV:unauthenticated if not authenticated 
                                if (xml.documentElement.getElementsByTagNameNS(dav.ns.d, "unauthenticated").length != 0) {
                                    let response = {};
                                    response.retry = true;
                                    response.path = aChannel.URI.pathQueryRef;
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
                                        let responseStatusNode = dav.tools.evaluateNode(multi[i], [["d", "status"]]);
                                        let propstats = multi[i].getElementsByTagNameNS(dav.ns.d, "propstat");
                                        if (propstats.length > 0) {
                                            //response contains propstats, push each as single entry
                                            for (let p=0; p < propstats.length; p++) {
                                                let statusNode = dav.tools.evaluateNode(propstats[p], [["d", "status"]]);

                                                let resp = {};
                                                resp.node = propstats[p];
                                                resp.status = statusNode === null ? null : statusNode.textContent.split(" ")[1];
                                                resp.responsestatus = responseStatusNode === null ? null : responseStatusNode.textContent.split(" ")[1];
                                                resp.href = hrefNode === null ? null : hrefNode.textContent;
                                                response.multi.push(resp);
                                            }
                                        } else {
                                            //response does not contain any propstats, push raw response
                                            let resp = {};
                                            resp.node = multi[i];
                                            resp.status = responseStatusNode === null ? null : responseStatusNode.textContent.split(" ")[1];
                                            resp.responsestatus = responseStatusNode === null ? null : responseStatusNode.textContent.split(" ")[1];
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
                                let xml = dav.tools.convertToXML(aResult);
                                if (xml !== null) {
                                    let exceptionNode = dav.tools.evaluateNode(xml.documentElement, [["s","exception"]]);
                                    if (exceptionNode !== null) {
                                        noresponse.exception = exceptionNode.textContent;
                                    }
                                }
                                //manually log this non-fatal error
                                tbSync.errorlog.add("info", connectionData.errorOwnerData, "softerror::"+responseStatus, "URL:\n" + connectionData.uri.spec + " ("+method+")" + "\n\nRequest:\n" + requestData + "\n\nResponse:\n" + responseData);
                                return resolve(noresponse);
                            } else {
                                return reject(dav.sync.failed(responseStatus, "URL:\n" + connectionData.uri.spec + " ("+method+")" + "\n\nRequest:\n" + requestData + "\n\nResponse:\n" + responseData)); 
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
                            this.authPrompt = new dav.network.Prompt(connectionData);
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
                        //tbSync.dump("GET","nsIChannelEventSink");
                    }

                    throw Components.results.NS_ERROR_NO_INTERFACE;
                },
            }

            let channel = dav.network.prepHttpChannel(requestData, headers, method, connectionData, notificationCallbacks);    
            if (aUseStreamLoader) {
                let loader =  Components.classes["@mozilla.org/network/stream-loader;1"].createInstance(Components.interfaces.nsIStreamLoader);
                loader.init(listener);
                listener = loader;
            }        
        
            connectionData.startTimeout(channel);
            channel.asyncOpen(listener, channel);
        });
    }
}
