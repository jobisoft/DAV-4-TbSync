/*
 * This file is part of DAV-4-TbSync.
 *
 * TbSync is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * TbSync is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with DAV-4-TbSync. If not, see <https://www.gnu.org/licenses/>.
 */

"use strict";

dav.tools = {

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
            throw dav.sync.failed("invalid-carddav-uri");
        }

        let calManager = cal.getCalendarManager();
        let cals = calManager.getCalendars({});
        if (cals.some(calendar => calendar.uri.spec == uri.spec)) {
            throw dav.sync.failed("caldav-calendar-already-exists");
        }

        return uri;
    },
    
    hashMD5: function (str) {
        var converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].createInstance(Components.interfaces.nsIScriptableUnicodeConverter);

        // we use UTF-8 here, you can choose other encodings.
        converter.charset = "UTF-8";
        // result is an out parameter,
        // result.value will contain the array length
        var result = {};
        // data is an array of bytes
        var data = converter.convertToByteArray(str, result);
        var ch = Components.classes["@mozilla.org/security/hash;1"].createInstance(Components.interfaces.nsICryptoHash);
        ch.init(ch.MD5);
        ch.update(data, data.length);
        var hash = ch.finish(false);

        // return the two-digit hexadecimal code for a byte
        function toHexString(charCode)
        {
          return ("0" + charCode.toString(16)).slice(-2);
        }

        // convert the binary hash data to a hex string.
        var s = Array.from(hash, (c, i) => toHexString(hash.charCodeAt(i))).join("");
        // s now contains your hash in hex: should be
        // 5eb63bbbe01eeed093cb22bb8f5acdc3    
        return s;
    },
    
    /*
     * Part of digest-header - index.js : https://github.com/node-modules/digest-header
     *
     * Copyright(c) fengmk2 and other contributors.
     * MIT Licensed
     *
     * Authors:
     *   fengmk2 <fengmk2@gmail.com> (http://fengmk2.github.com)
     */
    getAuthOptions: function (str) {
        let parts = str.split(',');
        let opts = {};
        let AUTH_KEY_VALUE_RE = /(\w+)=["']?([^'"]+)["']?/;
        for (let i = 0; i < parts.length; i++) {
            let m = parts[i].match(AUTH_KEY_VALUE_RE);
            if (m) {
                opts[m[1]] = m[2].replace(/["']/g, '');
            }
        }
        return opts;
    },

    /*
     * Part of digest-header - index.js : https://github.com/node-modules/digest-header
     *
     * Copyright(c) fengmk2 and other contributors.
     * MIT Licensed
     *
     * Authors:
     *   fengmk2 <fengmk2@gmail.com> (http://fengmk2.github.com)
     */
    getDigestAuthHeader: function (method, uri, user, password, options, account) {
        let opts = dav.tools.getAuthOptions(options);
        if (!opts.realm || !opts.nonce) {
            return "";
        }
        let qop = opts.qop || "";
  
        let userpass = [user,password];

        let NC_PAD = '00000000';
        let nc = parseInt(tbSync.db.getAccountSetting(account, "authDigestNC"));
        tbSync.db.setAccountSetting(account, "authDigestNC", String(++nc))

        nc = NC_PAD.substring(nc.length) + nc;
  
        let randomarray = new Uint8Array(8);
        tbSync.window.crypto.getRandomValues(randomarray);
        let cnonce = randomarray.toString('hex');

        var ha1 = dav.tools.hashMD5(userpass[0] + ':' + opts.realm + ':' + userpass[1]);
        var ha2 = dav.tools.hashMD5(method.toUpperCase() + ':' + uri);
        var s = ha1 + ':' + opts.nonce;
        if (qop) {
            qop = qop.split(',')[0];
            s += ':' + nc + ':' + cnonce + ':' + qop;
        }
        s += ':' + ha2;
        
        var response = dav.tools.hashMD5(s);
        var authstring = 'Digest username="' + userpass[0] + '", realm="' + opts.realm + '", nonce="' + opts.nonce + '", uri="' + uri + '", response="' + response + '"';
        if (opts.opaque) {
            authstring += ', opaque="' + opts.opaque + '"';
        }
        if (qop) {
            authstring +=', qop=' + qop + ', nc=' + nc + ', cnonce="' + cnonce + '"';
        }
        return authstring;        
    },
    

    convertToXML: function(text) {
        //try to convert response body to xml
        let xml = null;
        let oParser = (Services.vc.compare(Services.appinfo.platformVersion, "61.*") >= 0) ? new DOMParser() : Components.classes["@mozilla.org/xmlextras/domparser;1"].createInstance(Components.interfaces.nsIDOMParser);
        try {
            xml = oParser.parseFromString(text, "application/xml");
        } catch (e) {
            //however, domparser does not throw an error, it returns an error document
            //https://developer.mozilla.org/de/docs/Web/API/DOMParser
            xml = null;
        }
        //check if xml is error document
        if (xml.documentElement.nodeName == "parsererror") {
            xml = null;
        }

        return xml;
    },
    
    sendRequest: Task.async (function* (request, _url, method, syncdata, headers) {
        let account = tbSync.db.getAccount(syncdata.account);
        let password = tbSync.getPassword(account);

        let url = "http" + (account.https ? "s" : "") + "://" + account.host + _url;
        tbSync.dump("URL", url);

        let useAbortSignal = (Services.vc.compare(Services.appinfo.platformVersion, "57.*") >= 0);

        let options = {};
        options.method = method;
        options.body = request;
        options.cache = "no-cache";
        //do not include credentials, so we do not end up in a session, see https://github.com/owncloud/core/issues/27093
        options.credentials = "omit"; 
        options.redirect = "follow";// manual, *follow, error
        options.headers = headers;
        options.headers["Content-Length"] = request.length;
        options.headers["Content-Type"] = "application/xml; charset=utf-8";            

            
        //add abort/timeout signal
        let controller = null;
        if (useAbortSignal) {
            controller = new  tbSync.window.AbortController();
            options.signal = controller.signal;
        }
        
        let numberOfAuthLoops = 0;
        do {
            numberOfAuthLoops++;
            
            switch(tbSync.db.getAccountSetting(syncdata.account, "authMethod")) {
                case "":
                    //not set yet, send unauthenticated request
                    break;
                
                case "Basic":
                    options.headers["Authorization"] = "Basic " + btoa(account.user + ':' + password);
                    break;

                case "Digest":
                    //try to re-use the known server nounce (stored in account.authOptions)
                    options.headers["Authorization"] = dav.tools.getDigestAuthHeader(method, _url, account.user, password, account.authOptions, syncdata.account);
                    break;
            
                default:
                    throw dav.sync.failed("unsupported_auth_method:" + account.authMethod);
            }

            //try to fetch
            let response = null;
            let timeoutId = null;
            try {
                if (useAbortSignal) timeoutId = tbSync.window.setTimeout(() => controller.abort(), tbSync.prefSettings.getIntPref("timeout"));
                response = yield tbSync.window.fetch(url, options);
                if (useAbortSignal) tbSync.window.clearTimeout(timeoutId);
            } catch (e) {
                //fetch throws on network errors or timeout errors
                if (useAbortSignal && e instanceof AbortError) {
                    throw dav.sync.failed("timeout");
                } else {
                    throw dav.sync.failed("networkerror");
                }        
            }

            //TODO: Handle cert errors ??? formaly done by
            //let error = tbSync.createTCPErrorFromFailedXHR(syncdata.req);

            let text = yield response.text();            
            tbSync.dump("RESPONSE", response.status + " : " + text);
            switch(response.status) {
                case 401: // AuthError
                    {
                        let authHeader = response.headers.get("WWW-Authenticate")
                        //update authMethod and authOptions    
                        if (authHeader) {
                            let m = null;
                            let o = null;
                            [m, o] = authHeader.split(/ (.*)/);
                            tbSync.dump("AUTH_HEADER_METHOD", m);
                            tbSync.dump("AUTH_HEADER_OPTIONS", o);

                            //check if nonce changed, if so, reset nc
                            let opt_old = dav.tools.getAuthOptions(tbSync.db.getAccountSetting(syncdata.account, "authOptions"));
                            let opt_new = dav.tools.getAuthOptions(o);
                            if (opt_old.nonce != opt_new.nonce) {
                                tbSync.db.setAccountSetting(syncdata.account, "authDigestNC", "0");
                            }
                            
                            tbSync.db.setAccountSetting(syncdata.account, "authMethod", m);
                            tbSync.db.setAccountSetting(syncdata.account, "authOptions", o);
                            //is this the first fail? Retry with new settings.
                            if (numberOfAuthLoops == 1) continue;
                        }
                        throw dav.sync.failed("401");
                    }
                    break;
        
                case 207: //preprocess multiresponse
                    {
                        let xml = dav.tools.convertToXML(text);
                        if (xml === null) throw dav.sync.failed("mailformed-xml");
                        
                        let response = {};
                        response.node = xml.documentElement;

                        let multi = xml.documentElement.getElementsByTagNameNS(dav.ns.d, "response");
                        response.multi = [];
                        for (let i=0; i < multi.length; i++) {
                            let statusNode = dav.tools.evaluateNode(multi[i], [["d","propstat"], ["d", "status"]]);
                            let hrefNode = dav.tools.evaluateNode(multi[i], [["d","href"]]);

                            let resp = {};
                            resp.node = multi[i];
                            resp.status = statusNode === null ? null : statusNode.textContent.split(" ")[1];
                            resp.href = hrefNode === null ? null : hrefNode.textContent;
                            response.multi.push(resp);
                        }
            
                        return response;
                    }
                    break;
                    
                case 204: //is returned by DELETE - no data
                case 201: //is returned by CREATE - no data
                    return null;
                    break;

                case 403:
                case 404:
                    {
                        let xml = dav.tools.convertToXML(text);
                        if (xml !== null) {
                            let exceptionNode = dav.tools.evaluateNode(xml.documentElement, [["s","exception"]]);
                            if (exceptionNode !== null) {
                                let response = {};
                                response.exception = exceptionNode.textContent;
                                return response;
                            }
                        }
                    }
                                  
                default:
                    throw dav.sync.failed(response.status);
                    
            }
        }
        while (true);
    }),
    
    
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
            if (node !== null && (href === null || response.multi[i].href == href) && response.multi[i].status == status) 
                return node.textContent;
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
    




    deleteContacts: function(addressBook, vCardsDeletedOnServer, syncdata) {
        if (vCardsDeletedOnServer.length > 0) {
            syncdata.todo = vCardsDeletedOnServer.length;
            syncdata.done = 0;
            tbSync.setSyncState("eval.response.remotechanges", syncdata.account, syncdata.folderID);
            addressBook.deleteCards(vCardsDeletedOnServer);           
        }
    },
    
    addContact: function(addressBook, id, data, etag, syncdata) {        
        //prepare new card
        let card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
        card.setProperty("TBSYNCID", id);

        dav.tools.setThunderbirdCardFromVCard(addressBook, card, data.textContent.trim(), etag.textContent);
        
        tbSync.db.addItemToChangeLog(syncdata.targetId, id, "added_by_server");
        addressBook.addCard(card);
    },
    
    modifyContact: function(addressBook, id, data, etag, syncdata) {
        let card = addressBook.getCardFromProperty("TBSYNCID", id, true);                    

        dav.tools.setThunderbirdCardFromVCard(addressBook, card, data.textContent.trim(), etag.textContent, card.getProperty("X-DAV-VCARD", ""));        

        tbSync.db.addItemToChangeLog(syncdata.targetId, id, "modified_by_server");
        addressBook.modifyCard(card);
    },

    //update send from server to client
    setThunderbirdCardFromVCard: function(addressBook, card, vCard, etag, oCard = null) {
        let vCardData = tbSync.dav.vCard.parse(vCard);
        let oCardData = oCard ? tbSync.dav.vCard.parse(oCard) : null;

        tbSync.dump("JSON from vCard", JSON.stringify(vCardData));
        if (oCard) tbSync.dump("JSON from oCard", JSON.stringify(oCardData));

        card.setProperty("X-DAV-ETAG", etag);
        card.setProperty("X-DAV-VCARD", vCard);
        
        for (let f=0; f < dav.tools.allowedProperties.length; f++) {

            //For a given Thunderbird property, identify the vCard field
            // -> which main item
            // -> which array element (based on meta)

            let property = dav.tools.allowedProperties[f];
            let vCardField = dav.tools.getVCardField(property);

            let newServerValue = (vCardData && vCardData[vCardField.item] && vCardData[vCardField.item].length > vCardField.entry) ? 
                                                dav.tools.prepareValueForThunderbird(property, vCardData[vCardField.item][vCardField.entry].value) :
                                                null;

            let oldServerValue = (oCardData && oCardData[vCardField.item] && oCardData[vCardField.item].length > vCardField.entry) ? 
                                                dav.tools.prepareValueForThunderbird(property, oCardData[vCardField.item][vCardField.entry].value) :
                                                null;

            //smart merge: only update the property, if it has changed on the server (keep local modifications)
            if (newServerValue !== oldServerValue) {
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

        }
    },
    
    //return the stored vcard of the card (or empty vcard if none stored) and merge local changes
    getVCardFromThunderbirdCard: function(addressBook, id, generateUID = false) {        
        let card = addressBook.getCardFromProperty("TBSYNCID", id, true);                    
        let vCardData = tbSync.dav.vCard.parse(card.getProperty("X-DAV-VCARD", ""));
        
        if (generateUID) {
            let uuid = new dav.UUID();
            //the UID of the vCard is never used by TbSync, it differs from the href of this card (following the specs)
            vCardData["uid"] = [{"value": uuid.toString()}];
        }

        for (let f=0; f < dav.tools.allowedProperties.length; f++) {

            //For a given Thunderbird property, identify the vCard field
            // -> which main item
            // -> which array element (based on meta)
            let property = dav.tools.allowedProperties[f];
            let vCardField = dav.tools.getVCardField(property);

            let value = card.getProperty(property, "");
            if (value) {
                //store value 
                if (!vCardData[vCardField.item]) vCardData[vCardField.item] = [{"value": dav.tools.prepareValueForVCard(property, value)}];
                else vCardData[vCardField.item][vCardField.entry].value = value;
            } else {
                //remove value
                if (vCardData[vCardField.item]) vCardData[vCardField.item].splice(vCardField.entry,1);
            }

        }    
        return tbSync.dav.vCard.generate(vCardData).trim(); 
    },





    //* * * * * * * * * * * * * * * * *
    //* ACTUAL SYNC MAGIC *
    //* * * * * * * * * * * * * * * * *
    
    allowedProperties: ["DisplayName", "PrimaryEmail"],

    //For a given Thunderbird property, identify the vCard field
    // -> which main item
    // -> which array element (based on meta)
    getVCardField: function (property) {
        switch (property) {
            case "DisplayName": 
                return {item: "fn", entry: 0}
                break;
            case "PrimaryEmail": 
                return {item: "email", entry: 0}
                break;
            default:
                throw "Unknown TB property <"+property+">";
        }
    },        

    //turn the given vCardValue into a string to be stored as a Thunderbird property
    prepareValueForThunderbird: function (property, vCardValue) {
        switch (property) {
            case "Category": 
            default:
                if (Array.isArray(vCardValue)) return vCardValue[0];//.join(" ");
                else return vCardValue;
        }
    },

    //turn the given Thunderbird propetyValue into a vCardValue to be stored in the vCard
    prepareValueForVCard: function (property, propetyValue) {
        switch (property) {
            case "Category": 
            default:
                return propetyValue;//.split(" ");
        }
    },     
    
}
