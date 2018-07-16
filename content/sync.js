"use strict";

dav.sync = {

    failed: function (msg = "") {
        let e = new Error(); 
        e.message = msg;
        e.type = "dav4tbsync";
        return e; 
    },

    succeeded: function () {
        let e = new Error(); 
        e.message = "OK";
        e.type = "dav4tbsync";
        return e; 
    },
    










    sendRequest: Task.async (function* (request, _url, method, syncdata, headers = {}, allowSoftFail = false) {
        let account = tbSync.db.getAccount(syncdata.account);
        let password = tbSync.getPassword(account);

        let url = "http" + (account.https ? "s" : "") + "://" + account.host + _url;
        tbSync.dump("URL", url);

        let options = {};
        options.method = method;
        options.body = request;
        options.cache = "no-cache";
        //do not include credentials, so we do not end up in a session, see https://github.com/owncloud/core/issues/27093
        options.credentials = "omit"; 
        options.redirect = "follow";// manual, *follow, error
        options.headers = {};
        options.headers["Authorization"] = 'Basic ' + btoa(account.user + ':' + password);
        options.headers["Content-Length"] = request.length;
        options.headers["Content-Type"] = "application/xml; charset=utf-8";            
        
            
        //TODO: timeout: https://github.com/matthew-andrews/isomorphic-fetch/issues/48
        //syncdata.req.timeout = tbSync.prefSettings.getIntPref("timeout");
        //else reject(dav.sync.failed("timeout"));

        //try to fetch
        let response = null;
        try {
            response = yield tbSync.window.fetch(url, options);
        } catch (e) {
            //fetch throws on network errors
            throw dav.sync.failed("networkerror");
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
    
    folderList: Task.async (function* (syncdata) {
        //This is a very simple implementation of the discovery method of sabre/dav.
        //I am not even checking if there are changes, I jut pull the current list from the server and replace the local list
        //Method description: http://sabre.io/dav/building-a-caldav-client/
        
        let davjobs = {
            carddav : {ns: 'card', tag: 'card:addressbook-home-set', type: 'card:addressbook'},
            caldav : {ns: 'cal', tag: 'cal:calendar-home-set', type: 'cal:calendar'},
        };
                
        //get all folders currently known
        let folders = tbSync.db.getFolders(syncdata.account);
        let deletedFolders = [];
        for (let f in folders) {
            deletedFolders.push(f);
        }
        
        for (let job in davjobs) {
            //sync states are only printed while the account state is "syncing" to inform user about sync process (it is not stored in DB, just in syncdata)
            //example state "getfolders" to get folder information from server
            //if you send a request to a server and thus have to wait for answer, use a "send." syncstate, which will give visual feedback to the user,
            //that we are waiting for an answer with timeout countdown
            tbSync.setSyncState("send.getfolders", syncdata.account);
            let response = yield dav.sync.sendRequest('<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal /></d:prop></d:propfind>', "/.well-known/"+job+"/", "PROPFIND", syncdata, {Depth: "0", Prefer: "return-minimal"});

            tbSync.setSyncState("eval.folders", syncdata.account); 
            let principal = dav.sync.getFirstChildTag(response.documentElement.getElementsByTagName("d:current-user-principal"), "d:href");
            let home = "";
            
            //OBACHT: We expect the server to return NS card and cal as defined in our davjobs. However, that is not guarenteed, we might need to extract the actual used NS from repsonse

            //principal now contains something like "/remote.php/carddav/principals/john.bieling/"
            // -> get home/root of storage
            if (principal) {
                tbSync.setSyncState("send.getfolders", syncdata.account);
                response = yield dav.sync.sendRequest('<d:propfind xmlns:d="DAV:" xmlns:'+davjobs[job].ns+'="urn:ietf:params:xml:ns:'+job+'"><d:prop><'+davjobs[job].tag+' /></d:prop></d:propfind>', principal, "PROPFIND", syncdata, {Depth: "0", Prefer: "return-minimal"});

                tbSync.setSyncState("eval.folders", syncdata.account); 
                home = dav.sync.getFirstChildTag(response.documentElement.getElementsByTagName(davjobs[job].tag), "d:href");
            }
            
            //home now contains something like /remote.php/caldav/calendars/john.bieling/
            // -> get all calendars and addressbooks
            if (home) {
                tbSync.setSyncState("send.getfolders", syncdata.account);
                response = yield dav.sync.sendRequest('<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype /><d:displayname /></d:prop></d:propfind>', home, "PROPFIND", syncdata, {Depth: "1", Prefer: "return-minimal"});
                
                tbSync.setSyncState("eval.folders", syncdata.account); 
                let nsResolver = response.createNSResolver( response.documentElement );
                let responses = response.documentElement.getElementsByTagName("d:response");
                for (let r=0; r < responses.length; r++) {
                    let valid = response.evaluate("./d:propstat/d:prop/d:resourcetype/"+davjobs[job].type, responses[r], nsResolver, 0, null); //XPathResult.ANY_TYPE = 0
                    if (valid.iterateNext()) {
                        //let results = response.evaluate("./d:href", responses[r], nsResolver, 0, null); //XPathResult.ANY_TYPE = 0
                        //let thisResult = results.iterateNext(); 
                        //if (thisResult) tbSync.dump("RESPONSE #"+r, thisResult.textContent);
                        let href =  responses[r].getElementsByTagName("d:href")[0].textContent;
                        let name = responses[r].getElementsByTagName("d:displayname")[0].textContent;

                        let folder = tbSync.db.getFolder(syncdata.account, href);
                        if (folder === null) {
                            let newFolder = tbSync.dav.getNewFolderEntry(syncdata.account);
                            newFolder.folderID = href;
                            newFolder.name = name;
                            newFolder.type = job;
                            newFolder.parentID = "0"; //root - tbsync flatens hierachy, using parentID to sort entries
                            newFolder.selected = (r == 1) ? "1" : "0"; //only select the first one
                            tbSync.db.addFolder(newFolder);
                        } else {
                            //Update name
                            tbSync.db.setFolderSetting(syncdata.account,href, "name", name);
                            deletedFolders = deletedFolders.filter(item => item !== href);
                        }
                        
                    }
                }
                                
            } else {
                //home was not found - connection error? - do not delete anything
                let deletedFolders = [];
            }
        }
        
        //remove deleted folders (no longer there)
        for (let i = 0; i < deletedFolders.length; i++) {
            tbSync.takeTargetOffline("dav", folders[deletedFolders[i]], " [deleted on server]");
        }                        

    }),

    allPendingFolders: Task.async (function* (syncdata) {
        do {
            //any pending folders left?
            let folders = tbSync.db.findFoldersWithSetting("status", "pending", syncdata.account);
            if (folders.length == 0) {
                //all folders of this account have been synced
                break;
            }
            //what folder are we syncing?
            syncdata.folderID = folders[0].folderID;
            syncdata.type = folders[0].type;
                                    
            try {
                switch ( syncdata.type) {
                    case "carddav": 
                        // check SyncTarget
                        if (!tbSync.checkAddressbook(syncdata.account, syncdata.folderID)) {
                            //could not create target
                            throw dav.sync.failed("notargets");         
                        }

                        //get sync target of this addressbook
                        syncdata.targetId = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "target");
                        syncdata.addressbookObj = tbSync.getAddressBookObject(syncdata.targetId);

                        //promisify addressbook, so it can be used together with yield (using same interface as promisified calender)
                        syncdata.targetObj = tbSync.promisifyAddressbook(syncdata.addressbookObj);
                        
                        yield dav.sync.singleFolder(syncdata);
                        break;

                    case "caldav":
                        // skip if lightning is not installed
                        if (tbSync.lightningIsAvailable() == false) {
                            throw dav.sync.failed("nolightning");         
                        }
                        
                        // check SyncTarget
                        if (!tbSync.checkCalender(syncdata.account, syncdata.folderID)) {
                            //could not create target
                            throw dav.sync.failed("notargets");         
                        }

                        syncdata.targetId = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "target");
                        syncdata.calendarObj = cal.getCalendarManager().getCalendarById(syncdata.targetId);
                        
                        //promisify calender, so it can be used together with yield
                        syncdata.targetObj = cal.async.promisifyCalendar(syncdata.calendarObj.wrappedJSObject);

                        syncdata.calendarObj.startBatch();
                        yield dav.sync.singleFolder(syncdata);
                        syncdata.calendarObj.endBatch();
                        break;

                    default:
                        throw dav.sync.failed("notsupported");
                        break;

                }
            } catch (e) {
                if (e.type == "dav4tbsync") tbSync.finishFolderSync(syncdata, e.message);
                else {
                    //abort sync of other folders on javascript error
                    tbSync.finishFolderSync(syncdata, "Javascript Error");
                    throw e;
                }
            }                            
        } while (true);
        throw dav.sync.succeeded();
    }),
    
    
    singleFolder: Task.async (function* (syncdata)  {
        //The syncdata.targetObj has a comon interface, regardless if this is a contact or calendar sync, 
        //so you could use the same main sync process for both to reduce redundancy.
        //The actual type can be stored in syncdata.type, so you can call type-based functions to read 
        //or to create new Thunderbird items (contacts or events)


        //Pretend to receive remote changes
        {
            tbSync.setSyncState("send.request.remotechanges", syncdata.account, syncdata.folderID);
            yield tbSync.sleep(1500);
        }

        //Pretend to send local changes
        {
            //define how many entries can be send in one request
            let maxnumbertosend = 10;
            
            //access changelog to get local modifications (done and todo are used for UI to display progress)
            syncdata.done = 0;
            syncdata.todo = db.getItemsFromChangeLog(syncdata.targetId, 0, "_by_user").length;

            do {
                tbSync.setSyncState("prepare.request.localchanges", syncdata.account, syncdata.folderID);
                yield tbSync.sleep(1500);

                //get changed items from ChangeLog
                let changes = db.getItemsFromChangeLog(syncdata.targetId, maxnumbertosend, "_by_user");
                if (changes == 0)
                    break;
                
                for (let i=0; i<changes.length; i++) {
                    //DAV API SIMULATION: do something with the Thunderbird object here

                    //eval based on changes[i].status (added_by_user, modified_by_user, deleted_by_user)
                    db.removeItemFromChangeLog(syncdata.targetId, changes[i].id);
                    syncdata.done++; //UI feedback
                }
                tbSync.setSyncState("send.request.localchanges", syncdata.account, syncdata.folderID); 
                yield tbSync.sleep(1500);

                tbSync.setSyncState("eval.response.localchanges", syncdata.account, syncdata.folderID); 	    
                
            } while (true);
        }
        
        //always finish sync by throwing failed or succeeded
        throw dav.sync.succeeded();
    }),
    
    
    


    

}
