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
    
    Prompt: class {
        constructor(aAccount) {
            this.mCounts = 0;
            this.mAccount = aAccount;
        }

        // boolean promptAuth(in nsIChannel aChannel,
        //                    in uint32_t level,
        //                    in nsIAuthInformation authInfo)
        promptAuth (aChannel, aLevel, aAuthInfo) {
            //store aAuthInfo.realm, needed later to setup lightning passwords
            tbSync.dump("NSIBUG Found authRealm for <"+aChannel.URI.host+">", aAuthInfo.realm);
            dav.listOfRealms[aChannel.URI.host] = aAuthInfo.realm;

            //get the password for this account from password manager
            let password = tbSync.dav.getPassword(this.mAccount);
            if (password !== null) {
                tbSync.dump("SUCCEEDED to fetch password from password manager", this.mAccount.user + " @ " + this.mAccount.host);
                aAuthInfo.username = this.mAccount.user;
                aAuthInfo.password = password;
            } else {
                tbSync.dump("FAILED to fetch password from password manager", this.mAccount.user + " @ " + this.mAccount.host);
            }
            
            this.mCounts++
            if (this.mCounts < 2 && password !== null) {
                return true;
            } else {
                return false; //if the credentials in the password manager are wrong or not found, abort and pass on the 401 to the caller
            }
        }
    },

    Redirect: class {
        constructor() {
        }

        asyncOnChannelRedirect (aOldChannel, aNewChannel, aFlags, aCallback) {
            //disallow redirects, we catch the new url and re-initiate the request
            //aNewChannel.cancel(Components.results.NS_BINDING_ABORTED);
            //aOldChannel.cancel(Components.results.NS_BINDING_ABORTED);
            aCallback.onRedirectVerifyCallback(Components.results.NS_ERROR_FAILURE); 
        }
    },
       
    prepHttpChannel: function(aUri, aUploadData, aHeaders, aMethod, aAccount, aNotificationCallbacks=null, aExisting=null) {
        let channel = aExisting || Services.io.newChannelFromURI2(
                                                                aUri,
                                                                null,
                                                                Services.scriptSecurityManager.getSystemPrincipal(),        
                                                                //Services.scriptSecurityManager.createCodebasePrincipal(aUri, {user: aAccount.user}),
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
 
    sendRequest: Task.async (function* (requestData, _url, method, syncdata, headers, aUseStreamLoader = true) {
        let account = tbSync.db.getAccount(syncdata.account);
        
        //do not modify parameter
        let url = _url;

        //manually handling redirects by re-issuing the request to the new url
        for (let i=1; i < 10; i++) { //max number of redirects
            //if the new url is relative, add last known fqdn
            let uri = Services.io.newURI((url.startsWith("http://") || url.startsWith("https://")) ? url : "http" + (account.https == "1" ? "s" : "") + "://" + syncdata.fqdn + url);
            tbSync.dump("URL Request #" + i, uri.spec);

            //https://bugzilla.mozilla.org/show_bug.cgi?id=669675
            if (dav.problematicHosts.includes(uri.host)) {
                headers["Authorization"] = "Basic " + tbSync.b64encode(account.user + ":" + tbSync.dav.getPassword(account));
            }
            let r = yield dav.tools.sendRequestCore (requestData, uri.spec, method, syncdata, headers, aUseStreamLoader);
            
            if (r && r.redirect && r.url) {
                url = r.url;
                tbSync.dump("Redirect #" + i, r.url);
            } else if (r && r.retry && r.retry === true) {
                tbSync.dump("NSIBUG Retry on 401", "Manually adding basic auth header for <" + account.user + "@" + uri.host + ">");
                if (!dav.problematicHosts.includes(uri.host)) {
                    dav.problematicHosts.push(uri.host)
                }
            } else {
                return r;
            }
        }
    }),
    
    // Promisified implementation of Components.interfaces.nsIHttpChannel
    sendRequestCore: Task.async (function* (requestData, fullUrl, method, syncdata, headers, aUseStreamLoader) {
        let account = tbSync.db.getAccount(syncdata.account);
        
        //Note: 
        // - by specifying a user, the system falls back to user:<none>, which will trigger a 401 which will cause the authCallbacks and lets me set a new user/pass combination
        // - after it has recevied a new pass, it will use the cached version
        // - this allows to switch users but will cause a 401 on each user switch, and it probably breaks digest auth
        // - the username is lost during redirects...
        
        let finalUrl = fullUrl;
        if (tbSync.dav.prefSettings.getBoolPref("addCredentialsToUrl")) {
            //inject user + password to be used with LOAD_EXPLICIT_CREDENTIALS (does not help with cookie cache)
            finalUrl = fullUrl.replace("://","://" + encodeURIComponent(account.user) + ":" + encodeURIComponent(tbSync.dav.getPassword(account)) + "@");
        }
        let uri = Services.io.newURI(finalUrl);

        //no longer log HEADERS, as it could contain an Authorization header
        //tbSync.dump("HEADERS", JSON.stringify(headers));
        tbSync.dump("REQUEST", method + " : " + requestData);
        
        return new Promise(function(resolve, reject) {                  
            let listener = {
                onStreamComplete: function(aLoader, aContext, aStatus, aResultLength, aResult) {
                    let request = aLoader.request.QueryInterface(Components.interfaces.nsIHttpChannel);
                    let responseStatus = 0;
                    try {
                        responseStatus = request.responseStatus;
                    } catch (ex) {
                        let error = tbSync.createTCPErrorFromFailedChannel(aLoader.request);
                        if (!error) {
                            reject(dav.sync.failed("networkerror"));
                        } else {
                            reject(dav.sync.failed(error));
                        }
                    }
                    
                    let text = dav.tools.convertByteArray(aResult, aResultLength);                    
                    tbSync.dump("RESPONSE", responseStatus + " : " + text);
                    switch(responseStatus) {
                        case 301:
                        case 302:
                        case 303:
                        case 305:
                        case 307:
                        case 308:
                            {
                                let response = {};
                                response.redirect = responseStatus;
                                response.url = request.getResponseHeader("Location");
                                resolve(response);
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
                                if (tbSync.dav.getPassword(account) !== null) {                                    
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
                                        resolve(response);
                                    }
                                }
                                
                                reject(dav.sync.failed("401"));
                            }
                            break;

                        case 207: //preprocess multiresponse
                            {
                                let xml = dav.tools.convertToXML(text);
                                if (xml === null) reject(dav.sync.failed("mailformed-xml"));

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

                                resolve(response);
                            }
                            break;

                        case 200: //returned by DELETE by radicale - watch this !!!
                        case 204: //is returned by DELETE - no data
                        case 201: //is returned by CREATE - no data
                            resolve(null);
                            break;

                        case 400:
                        case 403:
                        case 404:
                        case 405: //Not allowed
                        case 415: //Sabre\DAV\Exception\ReportNotSupported - Unsupported media type - returned by fruux if synctoken is 0 (empty book)
                            {
                                let noresponse = {};
                                noresponse.error = responseStatus;
                                let xml = dav.tools.convertToXML(text);
                                if (xml !== null) {
                                    let exceptionNode = dav.tools.evaluateNode(xml.documentElement, [["s","exception"]]);
                                    if (exceptionNode !== null) {
                                        noresponse.exception = exceptionNode.textContent;
                                    }
                                }
                                resolve(noresponse);
                            }

                        default:
                            reject(dav.sync.failed(responseStatus));

                    }
                }
            }

            let notificationCallbacks = {
                // nsIInterfaceRequestor
                getInterface : function(aIID) {
                    if (aIID.equals(Components.interfaces.nsIAuthPrompt2)) {
                        tbSync.dump("GET","nsIAuthPrompt2");
                        if (!this.authPrompt) {
                            this.authPrompt = new dav.tools.Prompt(account);
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
                            this.redirectSink = new dav.tools.Redirect();
                        }
                        return this.redirectSink;
                    }

                    throw Components.results.NS_ERROR_NO_INTERFACE;
                },
            }

            let channel = dav.tools.prepHttpChannel(uri, requestData, headers, method, account, notificationCallbacks);    
            if (aUseStreamLoader) {
                let loader =  Components.classes["@mozilla.org/network/stream-loader;1"].createInstance(Components.interfaces.nsIStreamLoader);
                loader.init(listener);
                listener = loader;
            }        
        
            //manually set timout
            syncdata.timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
            let timeout = tbSync.prefSettings.getIntPref("timeout");
            let event = {
                notify: function(timer) {
                    if (channel) channel.cancel(Components.results.NS_ERROR_NET_TIMEOUT);
                }
            }
            syncdata.timer.initWithCallback(event, timeout, Components.interfaces.nsITimer.TYPE_ONE_SHOT);

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
        //prepare new card
        let card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
        card.setProperty("TBSYNCID", id);

        dav.tools.setThunderbirdCardFromVCard(syncdata, addressBook, card, data.textContent.trim(), etag.textContent);

        tbSync.db.addItemToChangeLog(syncdata.targetId, id, "added_by_server");
        addressBook.addCard(card);
    },

    modifyContact: function(addressBook, id, data, etag, syncdata) {
        let card = addressBook.getCardFromProperty("TBSYNCID", id, true);

        dav.tools.setThunderbirdCardFromVCard(syncdata, addressBook, card, data.textContent.trim(), etag.textContent, card.getProperty("X-DAV-VCARD", ""));

        if (syncdata.revert || tbSync.db.getItemStatusFromChangeLog(syncdata.targetId, id) != "modified_by_user") {
            tbSync.db.addItemToChangeLog(syncdata.targetId, id, "modified_by_server");
        }
        addressBook.modifyCard(card);
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
        "HomePhone" : {item: "tel", type: "HOME"},

        "WorkCity" : {item: "adr", type: "WORK"},
        "WorkCountry" : {item: "adr", type: "WORK"},
        "WorkZipCode" : {item: "adr", type: "WORK"},
        "WorkState" : {item: "adr", type: "WORK"},
        "WorkAddress" : {item: "adr", type: "WORK"},
        "WorkPhone" : {item: "tel", type: "WORK"},
    },

    //map thunderbird fields to impp vcard fields with additional x-service-types
    imppMap : {
        "_GoogleTalk" : {item: "impp" , prefix: "xmpp:", type: "GOOGLETALK"}, //actually x-service-type
        "_JabberId" : {item: "impp", prefix: "xmpp:", type: "JABBER"},
        "_Yahoo" : {item: "impp", prefix: "ymsgr:", type: "YAHOO"},
        "_QQ" : {item: "impp", prefix: "x-apple:", type: "QQ"},
        "_AimScreenName" : {item: "impp", prefix: "aim:", type: "AIM"},
        "_MSN" : {item: "impp", prefix: "msn:", type: "MSN"},
        "_Skype" : {item: "impp", prefix: "skype:", type: "SKYPE"},
        "_ICQ" : {item: "impp", prefix: "icq:", type: "ICQ"},
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
                        let metamap = (tbSync.db.getAccountSetting(syncdata.account, "useHomeAsPrimary") == "0") ? {"PrimaryEmail": "WORK", "SecondEmail": "HOME"} : {"PrimaryEmail": "HOME", "SecondEmail": "WORK"};
                        data.metatype.push(metamap[property]);
                        data.item = "email";

                        //search the first valid entry
                        if (vCardData[data.item]) {
                            let metaTypeData = dav.tools.getMetaTypeData(vCardData, data.item, data.metatypefield);

                            //check metaTypeData to find correct entry
                            if (property == "PrimaryEmail") {

                                let prev = [];
                                let work =[];
                                let workprev = [];
                                let nothome = [];
                                for (let i=0; i < metaTypeData.length; i++) {
                                    if (metaTypeData[i].includes(metamap.PrimaryEmail) && metaTypeData[i].includes("PREV")) workprev.push(i);
                                    if (metaTypeData[i].includes("PREV") && !metaTypeData[i].includes(metamap.SecondEmail)) prev.push(i);
                                    if (metaTypeData[i].includes(metamap.PrimaryEmail)) work.push(i);
                                    if (!metaTypeData[i].includes(metamap.SecondEmail)) nothome.push(i);
                                }
                                if (workprev.length > 0) data.entry = workprev[0];
                                else if (prev.length > 0) data.entry = prev[0];
                                else if (work.length > 0) data.entry = work[0];
                                else if (nothome.length > 0) data.entry = nothome[0];

                            } else {

                                let homeprev = [];
                                let home = [];
                                for (let i=0; i < metaTypeData.length; i++) {
                                    if (metaTypeData[i].includes(metamap.SecondEmail) && metaTypeData[i].includes("PREV")) homeprev.push(i);
                                    if (metaTypeData[i].includes(metamap.SecondEmail)) home.push(i);
                                }
                                if (homeprev.length > 0) data.entry = homeprev[0];
                                else if (home.length > 0) data.entry = home[0];

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
                        data.metatype.push(type);
                        data.item = dav.tools.complexMap[property].item;

                        if (vCardData[data.item]) {
                            let metaTypeData = dav.tools.getMetaTypeData(vCardData, data.item, data.metatypefield);
                            let valids = [];
                            for (let i=0; i < metaTypeData.length; i++) {
                                if (metaTypeData[i].includes(type)) valids.push(i);
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
    setThunderbirdCardFromVCard: function(syncdata, addressBook, card, vCard, etag, oCard = null) {
        let vCardData = tbSync.dav.vCard.parse(vCard);
        let oCardData = oCard ? tbSync.dav.vCard.parse(oCard) : null;

        tbSync.dump("JSON from vCard", JSON.stringify(vCardData));
        //if (oCardData) tbSync.dump("JSON from oCard", JSON.stringify(oCardData));

        card.setProperty("X-DAV-ETAG", etag);
        card.setProperty("X-DAV-VCARD", vCard);
        
        for (let f=0; f < dav.tools.supportedProperties.length; f++) {
            //Skip sync fields that have been added after this folder was created (otherwise we would delete them)
            if (Services.vc.compare(dav.tools.supportedProperties[f].minversion, syncdata.folderCreatedWithProviderVersion)> 0) continue;

            let property = dav.tools.supportedProperties[f].name;
            let vCardField = dav.tools.getVCardField(syncdata, property, vCardData);
            let newServerValue = dav.tools.getThunderbirdPropertyValueFromVCard(syncdata, property, vCardData, vCardField);

            let oCardField = dav.tools.getVCardField(syncdata, property, oCardData);
            let oldServerValue = dav.tools.getThunderbirdPropertyValueFromVCard(syncdata, property, oCardData, oCardField);

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

    },

    invalidateThunderbirdCard: function(syncdata, addressBook, id) {
        let card = addressBook.getCardFromProperty("TBSYNCID", id, true);
        card.setProperty("X-DAV-ETAG", "");
        card.setProperty("X-DAV-VCARD", "");
        tbSync.db.addItemToChangeLog(syncdata.targetId, id, "modified_by_server");
        addressBook.modifyCard(card);
    },

    //return the stored vcard of the card (or empty vcard if none stored) and merge local changes
    getVCardFromThunderbirdCard: function(syncdata, addressBook, id, generateUID = false) {
        let card = addressBook.getCardFromProperty("TBSYNCID", id, true);
        let vCardData = tbSync.dav.vCard.parse(card.getProperty("X-DAV-VCARD", ""));
        
        if (generateUID) {
            //the UID of the vCard is never used by TbSync, it differs from the href of this card (following the specs)
            vCardData["uid"] = [{"value": dav.tools.generateUUID()}];
        }

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
                        dav.tools.updateValueOfVCard(syncdata, property, vCardData, vCardField, value);
                    }
                    break;
            }
        }

        //add required fields
        if (!vCardData.hasOwnProperty("version")) vCardData["version"] = [{"value": "3.0"}];
        if (!vCardData.hasOwnProperty("fn")) vCardData["fn"] = [{"value": " "}];
        if (!vCardData.hasOwnProperty("n")) vCardData["n"] = [{"value": [" ","","","",""]}];

        return {data: tbSync.dav.vCard.generate(vCardData).trim(), etag: card.getProperty("X-DAV-ETAG", "")};
    },

}
