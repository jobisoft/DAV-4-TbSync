"use strict";

dav.tools = {

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
    
    

    sendRequest: Task.async (function* (request, _url, method, syncdata, headers = {}, allowSoftFail = false) {
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
        options.headers["Authorization"] = 'Basic ' + btoa(account.user + ':' + password);
        options.headers["Content-Length"] = request.length;
        options.headers["Content-Type"] = "application/xml; charset=utf-8";            

        let controler = null;
        if (useAbortSignal) {
            controller = new  tbSync.window.AbortController();
            options.signal = controller.signal;
        }
        
        //try to fetch
        let response = null;
        let timeoutId = null;
        try {
            if (useAbortSignal) timeoutId = tbSync.window.setTimeout(() => controller.abort(), 20);//tbSync.prefSettings.getIntPref("timeout"));
            response = yield tbSync.window.fetch(url, options);
            if (useAbortSignal) tbSync.window.clearTimeout(timeoutId);
        } catch (e) {
            //fetch throws on network errors or timeout errors
            if (useAbortSignal && e instanceof AbortError) {
                dav.sync.failed("timeout")
            } else {
                throw dav.sync.failed("networkerror");
            }        
        }

        //try to convert response body to xml
        let text = yield response.text();
        let xml = null;
        let oParser = (Services.vc.compare(Services.appinfo.platformVersion, "61.*") >= 0) ? new DOMParser() : Components.classes["@mozilla.org/xmlextras/domparser;1"].createInstance(Components.interfaces.nsIDOMParser);
        try {
            xml = oParser.parseFromString(text, "application/xml");
        } catch (e) {
            //however, domparser does not throw an error, it returns an error document
            //https://developer.mozilla.org/de/docs/Web/API/DOMParser
            //just in case
            throw dav.sync.failed("mailformed-xml");
        }
        //check if xml is error document
        if (xml.documentElement.nodeName == "parsererror") {
            throw dav.sync.failed("mailformed-xml");
        }

        //TODO: Handle cert errors ??? formaly done by
        //let error = tbSync.createTCPErrorFromFailedXHR(syncdata.req);
        
        tbSync.dump("RESPONSE", response.status + " : " + text);
        switch(response.status) {
            case 401: // AuthError
            case 403: // Forbiddden (some servers send forbidden on AuthError, like Freenet)
                throw dav.sync.failed("401");
                break;

            case 451: // Redirect - update host and login manager 
                break;
                
            default:
                return xml;
        }
    }),
    
    

    //eventually this will be replaced by a full multistatus parser...
    getFirstChildTag: function (elementsByTagName, childTag) {
        for (let p=0; p < elementsByTagName.length; p++) {
            let childs = elementsByTagName[p].getElementsByTagName(childTag);
            if (childs.length > 0 && childs[0].textContent) {
                return childs[0].textContent;
            }
        }
        return "";
    },
    
}
