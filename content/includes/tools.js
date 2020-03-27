/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

var tools = {
    
    getEmailsFromCard: function (aCard) { //return array of objects {meta, value}
        let emailData = [];
        try {
            emailData = JSON.parse(aCard.getProperty("X-DAV-JSON-Emails","[]").trim());
        } catch (e) {
            //Components.utils.reportError(e);                
        }
        
        // always use the core email field values, they could have been mod outside by the user,
        // not knowing that we store our stuff in X-DAV-JSON-Emails
        let emailFields = ["PrimaryEmail", "SecondEmail"];
        for (let i = 0; i < emailFields.length; i++) {
            let email = aCard.getProperty(emailFields[i], "");
            if (email) {
                if (emailData.length > i) emailData[i].value = email.trim();
                else emailData.push({value: email.trim(), meta: []});
            }
        }    
           
        return emailData;
    },
    
    getPhoneNumbersFromCard: function (aCard) { //return array of objects {meta, value}
        let phones = [];
        try {
            phones = JSON.parse(aCard.getProperty("X-DAV-JSON-Phones","").trim());
            return phones;
        } catch (e) {
            //Components.utils.reportError(e);                
        }

        //So this card is not a "DAV" card: Get the phone numbers from current numbers stored in 
        //CellularNumber, FaxNumber, PagerNumber, WorkPhone, HomePhone"},
        let todo = [
            {field: "CellularNumber", meta: ["CELL"]},
            {field: "FaxNumber", meta: ["FAX"]}, 
            {field: "PagerNumber", meta: ["PAGER"]}, 
            {field: "WorkPhone", meta: ["WORK"]}, 
            {field: "HomePhone", meta: ["HOME"]}
        ];
            
        for (let data of todo) {
            let phone = aCard.getProperty(data.field, "");
            if (phone) {
                phones.push({value: phone.trim(), meta: data.meta});
            }
        }
        return phones;
    },





    //* * * * * * * * * * * * *
    //* UTILS
    //* * * * * * * * * * * * *

    /**
     * Convert a byte array to a string - copied from lightning
     *
     * @param {octet[]} aResult         The bytes to convert
     * @param {String} aCharset         The character set of the bytes, defaults to utf-8
     * @param {Boolean} aThrow          If true, the function will raise an exception on error
     * @returns {?String}                The string result, or null on error
     */
    convertByteArray: function(aResult, aCharset="utf-8", aThrow) {
        try {
            return new TextDecoder(aCharset).decode(Uint8Array.from(aResult));
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




    getEmailsFromJSON: function (emailDataJSON) {
        // prepare defaults
        let emailFields = {PrimaryEmail:[], SecondEmail:[]};

        if (emailDataJSON) {
            try {
                // We pack the first entry into PrimaryEmail and the second one into SecondEmail.
                // For compatibility with the Phones, we return arrays, even though we only return
                // one element per array.
                let emailData = JSON.parse(emailDataJSON);
                
                for (let d=0; d < emailData.length && d < 2; d++) {
                    let field = (d==0) ? "PrimaryEmail" : "SecondEmail";
                    emailFields[field].push(emailData[d].value);
                }
            } catch(e) {
                //something went wrong
                Components.utils.reportError(e);                
            }
        }
        
        //object with TB field names as keys and array of emails as values
        return emailFields; 
    },


    getPhoneNumbersFromJSON: function (phoneDataJSON) {
        let phoneMap = [
            {meta: "CELL", field: "CellularNumber"},
            {meta: "FAX", field: "FaxNumber"},
            {meta: "PAGER", field: "PagerNumber"},
            {meta: "WORK", field: "WorkPhone"},
            {meta: "", field: "HomePhone"},
            ];

        // prepare defaults
        let phoneFields = {};
        for (let m=0; m < phoneMap.length; m++) {
            phoneFields[phoneMap[m].field] = [];            
        }
                
        if (phoneDataJSON) {
            try {
                //we first search and remove CELL, FAX, PAGER and WORK from the list and put the remains into HOME
                let phoneData = JSON.parse(phoneDataJSON);

                for (let m=0; m < phoneMap.length; m++) {        
                    for (let d=phoneData.length-1; d >= 0; d--) {
                        if (phoneData[d].meta.includes(phoneMap[m].meta) || phoneMap[m].meta == "") {
                            phoneFields[phoneMap[m].field].unshift(phoneData[d].value);
                            phoneData.splice(d,1);
                        }
                    }
                }
            } catch(e) {
                //something went wrong
                Components.utils.reportError(e);                
            }
        }
        
        //object with TB field names as keys and array of numbers as values
        return phoneFields; 
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





    //* * * * * * * * * * *
    //* CARDS OPERATIONS  *
    //* * * * * * * * * * *

    addContact: async function(syncData, id, data, etag) {
        let vCard = data.textContent.trim();
        let vCardData = dav.vCard.parse(vCard);

        //check if contact or mailinglist
        if (!dav.tools.vCardIsMailingList (syncData, id, null, vCard, vCardData, etag)) {
            //prepare new contact card
            let card = syncData.target.createNewCard();
            card.setProperty("X-DAV-HREF", id);
            card.setProperty("X-DAV-ETAG", etag.textContent);
            card.setProperty("X-DAV-VCARD", vCard);

            await dav.tools.setThunderbirdCardFromVCard(syncData, card, vCardData);
            syncData.target.addItem(card);
        }
    },

    modifyContact: async function(syncData, id, data, etag) {
        let vCard = data.textContent.trim();
        let vCardData = dav.vCard.parse(vCard);

        //get card
        let card = syncData.target.getItemFromProperty("X-DAV-HREF", id);
        if (card) {
            //check if contact or mailinglist to update card
            if (!dav.tools.vCardIsMailingList (syncData, id, card, vCard, vCardData, etag)) {          
                //get original vCard data as stored by last update from server
                let oCard = card.getProperty("X-DAV-VCARD");
                let oCardData = oCard ? dav.vCard.parse(oCard) : null;

                card.setProperty("X-DAV-ETAG", etag.textContent);
                card.setProperty("X-DAV-VCARD", vCard);
                
                await dav.tools.setThunderbirdCardFromVCard(syncData, card, vCardData, oCardData);
                syncData.target.modifyItem(card);
            }        

        } else {
            //card does not exists, create it?
        }
    },

    
    
    
    //check if vCard is a mailinglist and handle it
    vCardIsMailingList: function (syncData, id, _list, vCard, vCardData, etag) {
        if (vCardData.hasOwnProperty("X-ADDRESSBOOKSERVER-KIND") && vCardData["X-ADDRESSBOOKSERVER-KIND"][0].value == "group") { 
            if (!syncData.accountData.getAccountProperty("syncGroups")) {
                //user did not enable group sync, so do nothing, but return true so this card does not get added as a real card
                return true;
            }

            let vCardInfo = dav.tools.getGroupInfoFromCardData(vCardData, syncData.target, false); //just get the name, not the members

            //if no card provided, create a new one
            let list = _list;
            if (!list) {
                list  = syncData.target.createNewList();
                list.setProperty("X-DAV-HREF", id);
                list.setProperty("X-DAV-UID", vCardInfo.uid);
                list.setProperty("ListName",  vCardInfo.name);
                syncData.target.addItem(list);
            } else {
                list.setProperty("ListName",  vCardInfo.name);
                syncData.target.modifyItem(list);
            }
            
            //get original vCardData from last server contact, needed for "smart merge" on changes on both sides
            let oCardData = dav.vCard.parse(list.getProperty("X-DAV-VCARD"));
            //store all old and new vCards for later processing (cannot do it here, because it is not guaranteed, that all members exists already)
            syncData.foundMailingListsDuringDownSync[id] = {oCardData, vCardData};

            //update properties
            list.setProperty("X-DAV-ETAG", etag.textContent);
            list.setProperty("X-DAV-VCARD", vCard);      
            
            // AbItem implementation: Custom properties of lists are updated instantly, no need to call target.modifyItem(list);
            return true;

        } else {
            return false;
        }
    },






    //* * * * * * * * * * *
    //* ACTUAL SYNC MAGIC *
    //* * * * * * * * * * *

    //helper function: extract the associated meta.type of an entry
    getItemMetaType: function (vCardData, item, i, typefield) {
        if (vCardData[item][i].meta && vCardData[item][i].meta[typefield] && vCardData[item][i].meta[typefield].length > 0) {
            //vCard parser now spilts up meta types into single array values 
            //TYPE="home,cell" and TYPE=home;Type=cell will be received as ["home", "cell"]
            return vCardData[item][i].meta[typefield];
        }
        return [];
    },

    //helper function: for each entry for the given item, extract the associated meta.type
    getMetaTypeData: function (vCardData, item, typefield) {
        let metaTypeData = [];
        for (let i=0; i < vCardData[item].length; i++) {
            metaTypeData.push( dav.tools.getItemMetaType(vCardData, item, i, typefield) );
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
        {name: "X-DAV-PrefixName", minversion: "0.12.13"},
        {name: "X-DAV-MiddleName", minversion: "0.8.8"},
        {name: "X-DAV-SuffixName", minversion: "0.12.13"},
        {name: "X-DAV-UID", minversion: "0.10.36"},
        {name: "X-DAV-JSON-Phones", minversion: "0.4"},
        {name: "X-DAV-JSON-Emails", minversion: "0.4"},
        {name: "LastName", minversion: "0.4"},
        {name: "NickName", minversion: "0.4"},
        {name: "Birthday", minversion: "0.4"}, //fake, will trigger special handling
        {name: "Photo", minversion: "0.4"}, //fake, will trigger special handling
        {name: "HomeCity", minversion: "0.4"},
        {name: "HomeCountry", minversion: "0.4"},
        {name: "HomeZipCode", minversion: "0.4"},
        {name: "HomeState", minversion: "0.4"},
        {name: "HomeAddress", minversion: "0.4"},
        {name: "HomeAddress2", minversion: "1.4.1"},
        {name: "WorkCity", minversion: "0.4"},
        {name: "WorkCountry", minversion: "0.4"},
        {name: "WorkZipCode", minversion: "0.4"},
        {name: "WorkState", minversion: "0.4"},
        {name: "WorkAddress", minversion: "0.4"},
        {name: "WorkAddress2", minversion: "1.4.1"},
        {name: "Categories", minversion: "0.4"},
        {name: "JobTitle", minversion: "0.4"},
        {name: "Department", minversion: "0.4"},
        {name: "Company", minversion: "0.4"},
        {name: "WebPage1", minversion: "0.4"},
        {name: "WebPage2", minversion: "0.4"},
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
        "X-DAV-PrefixName" : "n",
        "X-DAV-MiddleName" : "n",
        "X-DAV-SuffixName" : "n",
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

        "HomeCity" : {item: "adr", type: "HOME"},
        "HomeCountry" : {item: "adr", type: "HOME"},
        "HomeZipCode" : {item: "adr", type: "HOME"},
        "HomeState" : {item: "adr", type: "HOME"},
        "HomeAddress" : {item: "adr", type: "HOME"},
        "HomeAddress2" : {item: "adr", type: "HOME"},

        "WorkCity" : {item: "adr", type: "WORK"},
        "WorkCountry" : {item: "adr", type: "WORK"},
        "WorkZipCode" : {item: "adr", type: "WORK"},
        "WorkState" : {item: "adr", type: "WORK"},
        "WorkAddress" : {item: "adr", type: "WORK"},
        "WorkAddress2" : {item: "adr", type: "WORK"},	
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
    getVCardField: function (syncData, property, vCardData) {
        let data = {item: "", metatype: [], metatypefield: "type", entry: -1, prefix: ""};

        if (vCardData) {

            //handle special cases independently, those from *Map will be handled by default
            switch (property) {
                case "X-DAV-JSON-Emails":
                {
                    data.metatype.push("OTHER"); //default for new entries
                    data.item = "email";
                    
                    if (vCardData[data.item] && vCardData[data.item].length > 0) {
                        //NOOP, just return something, if present
                        data.entry = 0;
                    }
                }
                break;

                case "X-DAV-JSON-Phones":
                {
                    data.metatype.push("VOICE"); //default for new entries
                    data.item = "tel";
                    
                    if (vCardData[data.item] && vCardData[data.item].length > 0) {
                        //NOOP, just return something, if present
                        data.entry = 0;
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
    getThunderbirdPropertyValueFromVCard: function (syncData, property, vCardData, vCardField) {
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
            case "HomeAddress2":
            case "WorkCity":
            case "WorkCountry":
            case "WorkZipCode":
            case "WorkState":
            case "WorkAddress":
            case "WorkAddress2":
                {
                    let field = property.substring(4);
                    let adr = (Services.vc.compare("0.8.11", syncData.currentFolderData.getFolderProperty("createdWithProviderVersion")) > 0)
                                    ?  ["OfficeBox","Address2","Address","City","Country","ZipCode", "State"] //WRONG
                                    : ["OfficeBox","Address2","Address","City","State","ZipCode", "Country"]; //RIGHT, fixed in 0.8.11

                    let index = adr.indexOf(field);
                    return dav.tools.getSaveArrayValue(vCardValue, index);
                }
                break;

            case "FirstName":
            case "LastName":
            case "X-DAV-PrefixName":
            case "X-DAV-MiddleName":
            case "X-DAV-SuffixName":
                {
                    let index = ["LastName","FirstName","X-DAV-MiddleName","X-DAV-PrefixName","X-DAV-SuffixName"].indexOf(property);
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

            case "X-DAV-JSON-Phones": 
            case "X-DAV-JSON-Emails": 
                {
                    //this is special, we need to return the full JSON object
                    let entries = [];
                    let metaTypeData = dav.tools.getMetaTypeData(vCardData, vCardField.item, vCardField.metatypefield);
                    for (let i=0; i < metaTypeData.length; i++) {
                        let entry = {};
                        entry.meta = metaTypeData[i];
                        entry.value = vCardData[vCardField.item][i].value;
                        entries.push(entry);
                    }
                    return JSON.stringify(entries);
                }
                break;

            default: 
                {
                    //should be a single string
                    let v = (Array.isArray(vCardValue)) ? vCardValue.join(" ") : vCardValue;
                    if (vCardField.prefix.length > 0 && v.startsWith(vCardField.prefix)) return v.substring(vCardField.prefix.length);
                    else return v;
                }
        }
    },





    //add/update the given Thunderbird propeties value in vCardData obj
    updateValueOfVCard: function (syncData, property, vCardData, vCardField, value) {
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
            case "HomeAddress2":
            case "WorkCity":
            case "WorkCountry":
            case "WorkZipCode":
            case "WorkState":
            case "WorkAddress":
            case "WorkAddress2":
                {
                    let field = property.substring(4);
                    let adr = (Services.vc.compare("0.8.11", syncData.currentFolderData.getFolderProperty("createdWithProviderVersion")) > 0)
                                    ?  ["OfficeBox","Address2","Address","City","Country","ZipCode", "State"] //WRONG
                                    : ["OfficeBox","Address2","Address","City","State","ZipCode", "Country"]; //RIGHT, fixed in 0.8.11

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
            case "X-DAV-PrefixName":
            case "X-DAV-MiddleName":
            case "X-DAV-SuffixName":
            case "LastName":
                {
                    let index = ["LastName","FirstName","X-DAV-MiddleName","X-DAV-PrefixName","X-DAV-SuffixName"].indexOf(property);
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

            case "Emails": //also update meta
            case "Phones": //also update meta
                if (store) {
                    vCardData[vCardField.item][vCardField.entry].value = vCardField.prefix + value;
                    if (!vCardData[vCardField.item][vCardField.entry].hasOwnProperty("meta")) {
                        vCardData[vCardField.item][vCardField.entry].meta = {};
                    }
                    vCardData[vCardField.item][vCardField.entry].meta[vCardField.metatypefield] = vCardField.metatype;
                } else if (remove) vCardData[vCardField.item][vCardField.entry].value = "";
                break;

            default: //should be a string
                if (store) vCardData[vCardField.item][vCardField.entry].value = vCardField.prefix + value;
                else if (remove) vCardData[vCardField.item][vCardField.entry].value = "";
        }
    },




    //MAIN FUNCTIONS FOR UP/DOWN SYNC

    //update send from server to client
    setThunderbirdCardFromVCard: async function(syncData, card, vCardData, oCardData = null) {
        if (TbSync.prefs.getIntPref("log.userdatalevel") > 2) {
            TbSync.dump("JSON from vCard", JSON.stringify(vCardData));
            TbSync.dump("JSON from oCard", oCardData ? JSON.stringify(oCardData) : "");
        }

        for (let f=0; f < dav.tools.supportedProperties.length; f++) {
            //Skip sync fields that have been added after this folder was created (otherwise we would delete them)
            if (Services.vc.compare(dav.tools.supportedProperties[f].minversion, syncData.currentFolderData.getFolderProperty("createdWithProviderVersion"))> 0) continue;

            let property = dav.tools.supportedProperties[f].name;
            let vCardField = dav.tools.getVCardField(syncData, property, vCardData);
            let newServerValue = dav.tools.getThunderbirdPropertyValueFromVCard(syncData, property, vCardData, vCardField);

            let oCardField = dav.tools.getVCardField(syncData, property, oCardData);
            let oldServerValue = dav.tools.getThunderbirdPropertyValueFromVCard(syncData, property, oCardData, oCardField);
            
            //smart merge: only update the property, if it has changed on the server (keep local modifications)
            if (newServerValue !== oldServerValue) {
                //some "properties" need special handling
                switch (property) {
                    case "Photo":
                        {
                            if (newServerValue) {
                                let type = "";
                                try {
                                    // Try to get the type from the the meta field but only use a given subtype (cut of leading "image/").
                                    // See draft: https://tools.ietf.org/id/draft-ietf-vcarddav-vcardrev-02.html#PHOTO
                                    // However, no mentioning of this in final RFC2426 for vCard 3.0.
                                    // Also make sure, that the final type does not include any non alphanumeric chars.
                                    type = vCardData[vCardField.item][0].meta.type[0].toLowerCase().split("/").pop().replace(/\W/g, "");
                                } catch (e) {
                                    Components.utils.reportError(e);
                                }

                                // check for inline data or linked data
                                if (vCardData[vCardField.item][0].meta && vCardData[vCardField.item][0].meta.encoding) {
                                    
                                    let ext = type || "jpg";
                                    let data = vCardData[vCardField.item][0].value;
                                    card.addPhoto(TbSync.generateUUID(), data, ext);
                                } else  if (vCardData[vCardField.item][0].meta && Array.isArray(vCardData[vCardField.item][0].meta.value) && vCardData[vCardField.item][0].meta.value[0].toString().toLowerCase() == "uri") {
                                    let connectionData = new dav.network.ConnectionData();
                                    connectionData.eventLogInfo = syncData.connectionData.eventLogInfo;
                                    // add credentials, if image is on the account server, go anonymous otherwise
                                    try {
                                        if (vCardData[vCardField.item][0].value.split("://").pop().startsWith(syncData.connectionData.fqdn)) {
                                            connectionData.password = syncData.connectionData.password;
                                            connectionData.username = syncData.connectionData.username;
                                        }
                                        
                                        let ext = type || this.getImageExtension(vCardData[vCardField.item][0].value);
                                        let data = await dav.network.sendRequest("", vCardData[vCardField.item][0].value , "GET", connectionData, {}, {responseType: "base64"});
                                        card.addPhoto(TbSync.generateUUID(), data, ext, vCardData[vCardField.item][0].value);
                                    } catch(e) {
                                        Components.utils.reportError(e);
                                        TbSync.eventlog.add("warning", syncData.eventLogInfo,"Could not extract externally linked photo from vCard", JSON.stringify(vCardData));
                                    }
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

                    case "X-DAV-JSON-Emails":
                    case "X-DAV-JSON-Phones":
                        {
                            //This field contains all the JSON encoded values and TbSync has its own UI to display them.
                            //However, we also want to fill the standard TB fields.
                            let tbData;
                            switch (property) {
                                case "X-DAV-JSON-Emails" : 
                                    tbData = dav.tools.getEmailsFromJSON(newServerValue);
                                    break;
                                case "X-DAV-JSON-Phones" : 
                                    tbData = dav.tools.getPhoneNumbersFromJSON(newServerValue);
                                    break;
                            }
                                
                            for (let field in tbData) {
                                if (tbData.hasOwnProperty(field)) {
                                    //set or delete TB Property
                                    if (  tbData[field].length > 0 ) {
                                        card.setProperty(field, tbData[field].join(", "));
                                    } else {
                                        card.deleteProperty(field);
                                    }                            
                                }
                            }
                        }

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

   
    getGroupInfoFromCardData: function (vCardData, addressBook, getMembers = true) {
        let members = [];
        let name = "Unlabled Group"; try { name = vCardData["fn"][0].value; } catch (e) {}
        let uid = ""; try { uid = vCardData["uid"][0].value; } catch (e) {}
        
        if (getMembers && vCardData.hasOwnProperty("X-ADDRESSBOOKSERVER-MEMBER")) {
            for (let i=0; i < vCardData["X-ADDRESSBOOKSERVER-MEMBER"].length; i++) {
                let member = vCardData["X-ADDRESSBOOKSERVER-MEMBER"][i].value.replace(/^(urn:uuid:)/,"");
                // "member" is the X-DAV-UID property of the member vCard
                members.push(member);
            }
        }
        return {members, name, uid};
    },

    
    
    //build group card
    getVCardFromThunderbirdListCard: function(syncData, list, generateUID = false) {        
        let currentCard = list.getProperty("X-DAV-VCARD").trim();
        let cCardData = dav.vCard.parse(currentCard);
        let vCardData = dav.vCard.parse(currentCard);
        let members = list.getMembersPropertyList("X-DAV-UID");

        if (!vCardData.hasOwnProperty("version")) vCardData["version"] = [{"value": "3.0"}];

        let listName = list.getProperty("ListName", "Unlabled List");
        vCardData["fn"] = [{"value": listName}];
        vCardData["n"] = [{"value": listName}];
        vCardData["X-ADDRESSBOOKSERVER-KIND"] = [{"value": "group"}];

        // check UID status
        let uidProp = list.getProperty("X-DAV-UID");
        let uidItem = ""; try { uidItem = vCardData["uid"][0].value; } catch (e) {}
        if (!uidItem && !uidProp) {
            TbSync.eventlog.add("info", syncData.eventLogInfo, "Generated missing UID for list <"+listName+">");
            let uid = TbSync.generateUUID();
            list.setProperty("X-DAV-UID", uid);
            vCardData["uid"] = [{"value": uid}];
        } else if (!uidItem && uidProp) {
            vCardData["uid"] = [{"value": uidProp}];
            TbSync.eventlog.add("info", syncData.eventLogInfo, "Updating item uid from uid property for list <"+listName+">", JSON.stringify({uidProp, uidItem}));
        } else if (uidItem && !uidProp) {
            list.setProperty("X-DAV-UID", uidItem);
            TbSync.eventlog.add("info", syncData.eventLogInfo, "Updating uid property from item uid of list <"+listName+">", JSON.stringify({uidProp, uidItem}));
        } else if (uidItem != uidProp) {
            list.setProperty("X-DAV-UID", uidItem);
            TbSync.eventlog.add("info", syncData.eventLogInfo, "Updating uid property from item uid of list <"+listName+">", JSON.stringify({uidProp, uidItem}));
        }

        //build memberlist from scratch  
        vCardData["X-ADDRESSBOOKSERVER-MEMBER"]=[];
        for (let member of members) {
            // member has the UID (X-DAV-UID) of each member
            vCardData["X-ADDRESSBOOKSERVER-MEMBER"].push({"value": "urn:uuid:" + member});
        }

        let newCard = dav.vCard.generate(vCardData).trim();
        let oldCard = dav.vCard.generate(cCardData).trim();

        let modified = false;
        if (oldCard != newCard) {
            TbSync.dump("List has been modified!","");
            TbSync.dump("currentCard", oldCard);
            TbSync.dump("newCard", newCard);
            modified = true;
        }        
        return {data: newCard, etag: list.getProperty("X-DAV-ETAG"), modified: modified};
    },

    
    setDefaultMetaButKeepCaseIfPresent: function(defaults, currentObj) {
        const keys = Object.keys(defaults);
        for (const key of keys) {
            let defaultValue = defaults[key];

            // we need to set this value, but do not want to cause a "modified" if it was set like this before, but just with different case
            // so keep the current case
            try {
                let c = currentObj.meta[key][0];
                if (c.toLowerCase() == defaultValue.toLowerCase()) defaultValue = c;
            } catch(e) {
                //Components.utils.reportError(e);                
            }
            
            if (!currentObj.hasOwnProperty("meta")) currentObj.meta = {};
            currentObj.meta[key]=[defaultValue];
        }
    },
    
    getImageExtension: function(filename) {
        // get extension from filename
	    let extension = "jpg";
        try {
            let parts = filename.toString().split("/").pop().split(".");
            let lastPart = parts.pop();
            if (parts.length > 0 && lastPart) {
                extension = lastPart;
            }
        } catch (e) {}        
        return extension.toLowerCase();
    },
    
    
    //return the stored vcard of the card (or empty vcard if none stored) and merge local changes
    getVCardFromThunderbirdContactCard: function(syncData, card, generateUID = false) {
        let currentCard = card.getProperty("X-DAV-VCARD").trim();
        let cCardData = dav.vCard.parse(currentCard);
        let vCardData = dav.vCard.parse(currentCard);

        for (let f=0; f < dav.tools.supportedProperties.length; f++) {
            //Skip sync fields that have been added after this folder was created (otherwise we would delete them)
            if (Services.vc.compare(dav.tools.supportedProperties[f].minversion, syncData.currentFolderData.getFolderProperty("createdWithProviderVersion"))> 0) continue;

            let property = dav.tools.supportedProperties[f].name;
            let vCardField = dav.tools.getVCardField(syncData, property, vCardData);

            //some "properties" need special handling
            switch (property) {
                case "Photo":
                    {
                        let extension = this.getImageExtension(card.getProperty("PhotoURI", ""));
                        let type = (extension == "jpg") ? "JPEG" : extension.toUpperCase();
                        
                        if (card.getProperty("PhotoType", "") == "file") {
                            TbSync.eventlog.add("info", syncData.eventLogInfo, "before photo ("+vCardField.item+")", JSON.stringify(vCardData));
                            dav.tools.updateValueOfVCard(syncData, property, vCardData, vCardField, card.getPhoto());                            
                            this.setDefaultMetaButKeepCaseIfPresent({encoding : "B", type : type}, vCardData[vCardField.item][0]);
                            TbSync.eventlog.add("info", syncData.eventLogInfo, "after photo ("+vCardField.item+")", JSON.stringify(vCardData));
                        } else if (card.getProperty("PhotoType", "") == "web" && card.getProperty("PhotoURI", "")) {
                            TbSync.eventlog.add("info", syncData.eventLogInfo, "before photo ("+vCardField.item+")", JSON.stringify(vCardData));
                            dav.tools.updateValueOfVCard(syncData, property, vCardData, vCardField, card.getProperty("PhotoURI", ""));
                            this.setDefaultMetaButKeepCaseIfPresent({value : "uri", type : type}, vCardData[vCardField.item][0]);
                            TbSync.eventlog.add("info", syncData.eventLogInfo, "after photo ("+vCardField.item+")", JSON.stringify(vCardData));
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
                        dav.tools.updateValueOfVCard(syncData, property, vCardData, vCardField, value);

                        if (birthYear == APPLE_MISSING_YEAR_MARK && Array.isArray(vCardData[vCardField.item]) && vCardData[vCardField.item].length > 0) {
                            vCardData[vCardField.item][0].meta = {"x-apple-omit-year": [APPLE_MISSING_YEAR_MARK]};
                        }
                    }
                    break;

                case "X-DAV-JSON-Emails":
                    {
                        //this gets us all emails
                        let emails = dav.tools.getEmailsFromCard(card);
                        let idx = 0;
            
                        //store default meta type
                        let defaultMeta = vCardField.metatype;

                        for (let i=0; i < emails.length || (vCardData.hasOwnProperty(vCardField.item) && idx < vCardData[vCardField.item].length); i++) {
                            //get value or or empty if entry is to be deleted
                            let value = (i < emails.length) ? emails[i].value : "";
                            
                            //fix for bug 1522453 - ignore these
                            if (value.endsWith("@bug1522453")) 
                                continue;

                            //do we have a meta type? otherwise stick to default
                            if (i < emails.length && emails[i].meta.length > 0) {
                                vCardField.metatype = emails[i].meta;
                            } else {
                                vCardField.metatype = defaultMeta;
                            }
                            
                            //remove: value == "" and index != -1
                            //add        value != "" and index == -1                           
                            vCardField.entry = idx++;
                            if (!(vCardData.hasOwnProperty(vCardField.item) && vCardField.entry < vCardData[vCardField.item].length)) vCardField.entry = -1; //need to add a new one
                            
                            dav.tools.updateValueOfVCard(syncData, "Emails", vCardData, vCardField, value);
                        }
                    }
                    break;

                case "X-DAV-JSON-Phones":
                    {
                        //this gets us all phones
                        let phones = dav.tools.getPhoneNumbersFromCard(card);
                        let idx = 0;
            
                        //store default meta type
                        let defaultMeta = vCardField.metatype;

                        for (let i=0; i < phones.length || (vCardData.hasOwnProperty(vCardField.item) &&  idx < vCardData[vCardField.item].length); i++) {
                            //get value or or empty if entry is to be deleted
                            let value = (i < phones.length) ? phones[i].value : "";

                            //do we have a meta type? otherwise stick to default
                            if (i < phones.length && phones[i].meta.length > 0) {
                                vCardField.metatype = phones[i].meta;
                            } else {
                                vCardField.metatype = defaultMeta;
                            }
                            
                            //remove: value == "" and index != -1
                            //add        value != "" and index == -1                           
                            vCardField.entry = idx++;
                            if (!(vCardData.hasOwnProperty(vCardField.item) && vCardField.entry < vCardData[vCardField.item].length)) vCardField.entry = -1; //need to add a new one
                            
                            dav.tools.updateValueOfVCard(syncData, "Phones", vCardData, vCardField, value);
                        }
                    }
                    break;
                    
                default:
                    {
                        let value = card.getProperty(property, "");
                        dav.tools.updateValueOfVCard(syncData, property, vCardData, vCardField, value);
                    }
                    break;
            }
        }

        // check UID status
        let uidProp = card.getProperty("X-DAV-UID");
        let uidItem = ""; try { uidItem = vCardData["uid"][0].value; } catch (e) {}
        if (!uidItem && !uidProp) {
            TbSync.eventlog.add("info", syncData.eventLogInfo, "Generated missing UID for card <"+listName+">");
            let uid = TbSync.generateUUID();
            card.setProperty("X-DAV-UID", uid);
            vCardData["uid"] = [{"value": uid}];
            syncData.target.modifyItem(card);
        } else if (!uidItem && uidProp) {
            vCardData["uid"] = [{"value": uidProp}];
            TbSync.eventlog.add("info", syncData.eventLogInfo, "Updating item uid from uid property for card <"+listName+">", JSON.stringify({uidProp, uidItem}));
        } else if (uidItem && !uidProp) {
            card.setProperty("X-DAV-UID", uidItem);
            TbSync.eventlog.add("info", syncData.eventLogInfo, "Updating uid property from item uid of card <"+listName+">", JSON.stringify({uidProp, uidItem}));
            syncData.target.modifyItem(card);
        } else if (uidItem != uidProp) {
            card.setProperty("X-DAV-UID", uidItem);
            TbSync.eventlog.add("info", syncData.eventLogInfo, "Updating uid property from item uid of card <"+listName+">", JSON.stringify({uidProp, uidItem}));
            syncData.target.modifyItem(card);
        }

        //add required fields
        if (!vCardData.hasOwnProperty("version")) vCardData["version"] = [{"value": "3.0"}];
        if (!vCardData.hasOwnProperty("fn")) vCardData["fn"] = [{"value": " "}];
        if (!vCardData.hasOwnProperty("n")) vCardData["n"] = [{"value": [" ","","","",""]}];

        //build vCards
        let newCard = dav.vCard.generate(vCardData).trim();
        let oldCard = dav.vCard.generate(cCardData).trim();

        let modified = false;
        if (oldCard != newCard) {
            TbSync.dump("Card has been modified!","");
            TbSync.dump("currentCard", oldCard);
            TbSync.dump("newCard", newCard);
            modified = true;
        }
        return {data: newCard, etag: card.getProperty("X-DAV-ETAG"), modified: modified};
    },

}
