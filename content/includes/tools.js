/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

var tools = {

    //* * * * * * * * * * * * *
    //* UTILS
    //* * * * * * * * * * * * *
    
    /**
     * Removes XML-invalid characters from a string.
     * @param {string} string - a string potentially containing XML-invalid characters, such as non-UTF8 characters, STX, EOX and so on.
     * @param {boolean} removeDiscouragedChars - a string potentially containing XML-invalid characters, such as non-UTF8 characters, STX, EOX and so on.
     * @returns : a sanitized string without all the XML-invalid characters.
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
            _xmlns.push('xmlns:'+ns[i]+'="'+dav.sync.ns[ns[i]]+'"');
        }
        return _xmlns.join(" ");
    },

    parseUri: function (aUri) {
        let uri;
        try {
            // Test if the entered uri can be parsed.
            uri = Services.io.newURI(aUri, null, null);
        } catch (ex) {
            throw new Error("invalid-calendar-url");
        }
        return uri;
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

    //* * * * * * * * * * * * * *
    //* EVALUATE XML RESPONSES  *
    //* * * * * * * * * * * * * *

    convertToXML: function(text) {
        //try to convert response body to xml
        let xml = null;
        let oParser = new DOMParser();
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
                if (children[c].localName == path[i][1] && children[c].namespaceURI == dav.sync.ns[path[i][0]]) {
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

    hrefMatch:function (_requestHref, _responseHref) {
        if (_requestHref === null)
            return true;
        
        let requestHref = _requestHref;
        let responseHref = _responseHref;
        while (requestHref.endsWith("/")) { requestHref = requestHref.slice(0,-1); }        
        while (responseHref.endsWith("/")) { responseHref = responseHref.slice(0,-1); }        
        if (requestHref.endsWith(responseHref) || decodeURIComponent(requestHref).endsWith(responseHref) || requestHref.endsWith(decodeURIComponent(responseHref))) 
            return true;
        
        return false;
    },
    
    getNodeTextContentFromMultiResponse: function (response, path, href = null, status = ["200"]) {
        for (let i=0; i < response.multi.length; i++) {
            let node = dav.tools.evaluateNode(response.multi[i].node, path);
            if (node !== null && dav.tools.hrefMatch(href, response.multi[i].href) && status.includes(response.multi[i].status)) {
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
            if (node !== null && dav.tools.hrefMatch(href, response.multi[i].href) && response.multi[i].status == status) {
                
                //get all children
                let children = node.getElementsByTagNameNS(dav.sync.ns[lastPathElement[0]], lastPathElement[1]);
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
}
