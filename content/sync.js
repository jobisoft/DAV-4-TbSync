/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

dav.sync = {

    failed: function (msg = "", details = "") {
        let e = new Error();
        e.type = "dav4tbsync";
        e.message = msg;
        e.details = details;
        e.failed = true;
        return e;
    },

    succeeded: function (msg = "") {
        let e = new Error();
        e.type = "dav4tbsync";
        e.message = "OK";
        if (msg) e.message = e.message + "." + msg;
        e.details = "";
        e.failed = false;
        return e;
    },





    folderList: Task.async (function* (syncdata) {
        //Method description: http://sabre.io/dav/building-a-caldav-client/

        //get all folders currently known
        let folderTypes = ["caldav", "carddav", "ics"];
        let unhandledFolders = {};
        for (let t of folderTypes) {
            unhandledFolders[t] = [];
        }

        let folders = tbSync.db.getFolders(syncdata.account);
        for (let f in folders) {
            //just in case
            if (!unhandledFolders.hasOwnProperty(folders[f].type)) {
                unhandledFolders[folders[f].type] = [];
            }
            unhandledFolders[folders[f].type].push(f);
        }

        let davjobs = {
            card : {run: true},
            cal : {run: tbSync.lightningIsAvailable()},        
        };

        //get server urls from account setup - update urls of serviceproviders
        let serviceprovider = tbSync.db.getAccountSetting(syncdata.account, "serviceprovider");
        if (tbSync.dav.serviceproviders.hasOwnProperty(serviceprovider)) {
            tbSync.db.setAccountSetting(syncdata.account, "host", tbSync.dav.serviceproviders[serviceprovider].caldav.replace("https://","").replace("http://",""));
            tbSync.db.setAccountSetting(syncdata.account, "host2", tbSync.dav.serviceproviders[serviceprovider].carddav.replace("https://","").replace("http://",""));
        }
        davjobs.cal.initialURL = tbSync.db.getAccountSetting(syncdata.account, "host");
        davjobs.card.initialURL = tbSync.db.getAccountSetting(syncdata.account, "host2");
        
        let authenticationManager = Components.classes["@mozilla.org/network/http-auth-manager;1"].getService(Components.interfaces.nsIHttpAuthManager); 

        for (let job in davjobs) {
            if (!davjobs[job].run || !davjobs[job].initialURL) continue;

            //clear credential cache, so the Channel will call nsIAuthPrompt2 and expose the realm (caldav and carddav could be on the same host but use different realms, so we reset for each type)
            authenticationManager.clearAll();

            //keep track of the current job
            syncdata.type = job;
            
            //sync states are only printed while the account state is "syncing" to inform user about sync process (it is not stored in DB, just in syncdata)
            //example state "getfolders" to get folder information from server
            //if you send a request to a server and thus have to wait for answer, use a "send." syncstate, which will give visual feedback to the user,
            //that we are waiting for an answer with timeout countdown

            let home = [];
            let own = [];
            let principal = null;

            tbSync.setSyncState("send.getfolders", syncdata.account);
            {
                //split initialURL into host and url
                let parts = davjobs[job].initialURL.split("/").filter(i => i != "");
                syncdata.fqdn = parts.splice(0,1).toString();
                let addr = "/" + parts.join("/");                
                
                let response = yield dav.tools.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:current-user-principal /></d:prop></d:propfind>", addr , "PROPFIND", syncdata, {"Depth": "0", "Prefer": "return-minimal"});

                tbSync.setSyncState("eval.folders", syncdata.account);
                if (response && response.multi) principal = dav.tools.getNodeTextContentFromMultiResponse(response, [["d","prop"], ["d","current-user-principal"], ["d","href"]]);
            }

            //principal now contains something like "/remote.php/carddav/principals/john.bieling/"
            // -> get home/root of storage
            if (principal !== null) {
                tbSync.setSyncState("send.getfolders", syncdata.account);
                
                let homeset = (job == "cal")
                                        ? "calendar-home-set"
                                        : "addressbook-home-set";

                let request = (job == "cal")
                                        ? "<d:propfind "+dav.tools.xmlns(["d", "cal", "cs"])+"><d:prop><cal:" + homeset + " /><cs:calendar-proxy-write-for /><cs:calendar-proxy-read-for /><d:group-membership /></d:prop></d:propfind>"
                                        : "<d:propfind "+dav.tools.xmlns(["d", "card"])+"><d:prop><card:" + homeset + " /><d:group-membership /></d:prop></d:propfind>";

                let response = yield dav.tools.sendRequest(request, principal, "PROPFIND", syncdata, {"Depth": "0", "Prefer": "return-minimal"});

                tbSync.setSyncState("eval.folders", syncdata.account);
                own = dav.tools.getNodesTextContentFromMultiResponse(response, [["d","prop"], [job, homeset ], ["d","href"]], principal);
                home = own.concat(dav.tools.getNodesTextContentFromMultiResponse(response, [["d","prop"], ["cs", "calendar-proxy-read-for" ], ["d","href"]], principal));
                home = home.concat(dav.tools.getNodesTextContentFromMultiResponse(response, [["d","prop"], ["cs", "calendar-proxy-write-for" ], ["d","href"]], principal));

                //Any groups we need to find? Only diving one level at the moment, 
                let g = dav.tools.getNodesTextContentFromMultiResponse(response, [["d","prop"], ["d", "group-membership" ], ["d","href"]], principal);
                for (let gc=0; gc < g.length; gc++) {
                    response = yield dav.tools.sendRequest(request, g[gc], "PROPFIND", syncdata, {"Depth": "0", "Prefer": "return-minimal"});
                    home = home.concat(dav.tools.getNodesTextContentFromMultiResponse(response, [["d","prop"], [job, homeset ], ["d","href"]], g[gc]));
                }

                //calendar-proxy and group-membership could have returned the same values, make the homeset unique
                home = home.filter((v,i,a) => a.indexOf(v) == i);
            } else {
                throw dav.sync.failed(job+"davservernotfound", davjobs[job].initialURL)
            }

            //home now contains something like /remote.php/caldav/calendars/john.bieling/
            // -> get all resources
            if (home.length > 0) {
                for (let h=0; h < home.length; h++) {
                    tbSync.setSyncState("send.getfolders", syncdata.account);
                    let request = (job == "cal")
                                            ? "<d:propfind "+dav.tools.xmlns(["d","apple","cs"])+"><d:prop><d:current-user-privilege-set/><d:resourcetype /><d:displayname /><apple:calendar-color/><cs:source/></d:prop></d:propfind>"
                                            : "<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:current-user-privilege-set/><d:resourcetype /><d:displayname /></d:prop></d:propfind>";

                    //some servers report to have calendar-proxy-read but return a 404 when that gets actually queried
                    let response = yield dav.tools.sendRequest(request, home[h], "PROPFIND", syncdata, {"Depth": "1", "Prefer": "return-minimal"}, {softfail: [404]});
                    if (response && response.softerror) {
                        continue;
                    }
                    
                    for (let r=0; r < response.multi.length; r++) {
                        if (response.multi[r].status != "200") continue;
                        
                        let resourcetype = null;
                        //is this a result with a valid recourcetype? (the node must be present)
                        switch (job) {
                            case "card": 
                                    if (dav.tools.evaluateNode(response.multi[r].node, [["d","prop"], ["d","resourcetype"], ["card", "addressbook"]]) !== null) resourcetype = "carddav";
                                break;
                                
                            case "cal":
                                    if (dav.tools.evaluateNode(response.multi[r].node, [["d","prop"], ["d","resourcetype"], ["cal", "calendar"]]) !== null) resourcetype = "caldav";
                                    else if (dav.tools.evaluateNode(response.multi[r].node, [["d","prop"], ["d","resourcetype"], ["cs", "subscribed"]]) !== null) resourcetype = "ics";
                                break;
                        }
                        if (resourcetype === null) continue;
                        
                        //get ACL
                        let acl = 0;
                        let privilegNode = dav.tools.evaluateNode(response.multi[r].node, [["d","prop"], ["d","current-user-privilege-set"]]);
                        if (privilegNode) {
                            if (privilegNode.getElementsByTagNameNS(dav.ns.d, "all").length > 0) { 
                                acl = 0xF; //read=1, mod=2, create=4, delete=8 
                            } else if (privilegNode.getElementsByTagNameNS(dav.ns.d, "read").length > 0) { 
                                acl = 0x1;
                                if (privilegNode.getElementsByTagNameNS(dav.ns.d, "write").length > 0) {
                                    acl = 0xF; 
                                } else {
                                    if (privilegNode.getElementsByTagNameNS(dav.ns.d, "write-content").length > 0) acl |= 0x2;
                                    if (privilegNode.getElementsByTagNameNS(dav.ns.d, "bind").length > 0) acl |= 0x4;
                                    if (privilegNode.getElementsByTagNameNS(dav.ns.d, "unbind").length > 0) acl |= 0x8;
                                }
                            }
                        }
                        
                        //ignore this resource, if no read access
                        if ((acl & 0x1) == 0) continue;

                        let href = response.multi[r].href;
                        if (resourcetype == "ics") href =  dav.tools.evaluateNode(response.multi[r].node, [["d","prop"], ["cs","source"], ["d","href"]]).textContent;
                        
                        let name_node = dav.tools.evaluateNode(response.multi[r].node, [["d","prop"], ["d","displayname"]]);
                        let name = (job == "cal") ? "Calendar" : "Contacts";
                        if (name_node != null) {
                            name = name_node.textContent;
                        }
                        let color = dav.tools.evaluateNode(response.multi[r].node, [["d","prop"], ["apple","calendar-color"]]);

                        //remove found folder from list of unhandled folders
                        unhandledFolders[resourcetype] = unhandledFolders[resourcetype].filter(item => item !== href);

                        let folder = tbSync.db.getFolder(syncdata.account, href);
                        if (folder === null || folder.cached === "1") { //this is NOT called by unsubscribing/subscribing
                            let newFolder = {}
                            newFolder.folderID = href;
                            newFolder.name = name;
                            newFolder.type = resourcetype;
                            newFolder.shared = (own.includes(home[h])) ? "0" : "1";
                            newFolder.acl = acl.toString();
                            newFolder.downloadonly = (acl == 0x1) ? "1" : "0"; //if any write access is granted, setup as writeable
                                
                            newFolder.parentID = "0"; //root - tbsync flatens hierachy, using parentID to sort entries
                            newFolder.selected = "0";
                            newFolder.fqdn = syncdata.fqdn;
                    
                            //if there is a cached version of this folderID, addFolder will merge all persistent settings - all other settings not defined here will be set to their defaults
                            tbSync.db.addFolder(syncdata.account, newFolder);
                        } else {
                            //Update name & color
                            tbSync.db.setFolderSetting(syncdata.account, href, "name", name);
                            tbSync.db.setFolderSetting(syncdata.account, href, "fqdn", syncdata.fqdn);
                            tbSync.db.setFolderSetting(syncdata.account, href, "acl", acl);
                            //if the acl changed from RW to RO we need to update the downloadonly setting
                            if (acl == 0x1) {
                                tbSync.db.setFolderSetting(syncdata.account, href, "downloadonly", "1");
                            }
                        }

                        //update color from server
                        if (color && job == "cal") {
                            color = color.textContent.substring(0,7);
                            tbSync.db.setFolderSetting(syncdata.account, href, "targetColor", color);
                            //do we have to update the calendar?
                            if (tbSync.lightningIsAvailable() && folder && folder.target) {
                                let targetCal = cal.getCalendarManager().getCalendarById(folder.target);
                                if (targetCal !== null) {
                                    targetCal.setProperty("color", color);
                                }
                            }
                        }
                    }
                }
            } else {
                //home was not found - connection error? - do not delete unhandled folders
                switch (job) {
                    case "card": 
                            unhandledFolders.carddav = [];
                        break;
                        
                    case "cal":
                            unhandledFolders.caldav = [];
                            unhandledFolders.ics = [];
                        break;
                }
            }
        }

        //remove unhandled old folders, (because they no longer exist on the server)
        for (let t of folderTypes) {
            for (let i = 0; i < unhandledFolders[t].length; i++) {
                tbSync.takeTargetOffline("dav", folders[unhandledFolders[t][i]], " [deleted on server]");
                tbSync.db.deleteFolder(folders[unhandledFolders[t][i]].account, folders[unhandledFolders[t][i]].folderID);
            }
        }

    }),




    getNextPendingFolder: function (accountID) {
        //using getSortedData, to sync in the same order as shown in the list
        let sortedFolders = dav.folderList.getSortedData(accountID);       
        for (let i=0; i < sortedFolders.length; i++) {
            if (sortedFolders[i].statusCode != "pending") continue;
            return tbSync.db.getFolder(accountID, sortedFolders[i].folderID);
        }
        
        return null;
    },

    allPendingFolders: Task.async (function* (syncdata) {
        do {
            //any pending folders left?
            let nextFolder = dav.sync.getNextPendingFolder(syncdata.account);
            if (nextFolder === null) {
                //all folders of this account have been synced
                throw dav.sync.succeeded();
            }
            //what folder are we syncing?
            syncdata.folderID = nextFolder.folderID;
            syncdata.type = nextFolder.type;
            syncdata.fqdn = nextFolder.fqdn;
            
            try {
                switch (syncdata.type) {
                    case "carddav":
                        {
                            // check SyncTarget
                            if (!tbSync.checkAddressbook(syncdata.account, syncdata.folderID)) {
                                //could not create target
                                throw dav.sync.failed("notargets");
                            }

                            //get sync target of this addressbook
                            syncdata.targetId = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "target");
                            yield dav.sync.singleFolder(syncdata);
                        }
                        break;

                    case "caldav":
                    case "ics":
                        {
                            // skip if lightning is not installed
                            if (tbSync.lightningIsAvailable() == false) {
                                throw dav.sync.failed("nolightning");
                            }

                            // check SyncTarget
                            if (!tbSync.checkCalender(syncdata.account, syncdata.folderID)) {
                                //could not create target
                                throw dav.sync.failed("notargets");
                            }

                            //init sync via lightning
                            let target = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "target");
                            let calManager = cal.getCalendarManager();
                            let targetCal = calManager.getCalendarById(target);
                            targetCal.refresh();
                            tbSync.db.clearChangeLog(target);

                            //update downloadonly
                            if (tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "downloadonly") == "1") targetCal.setProperty("readOnly", true);

                            throw dav.sync.succeeded("managed-by-lightning");
                        }
                        break;

                    default:
                        {
                            throw dav.sync.failed("notsupported");
                        }
                        break;

                }
            } catch (e) {
                if (e.type == "dav4tbsync") {
                    tbSync.finishFolderSync(syncdata, e);
                } else {
                    //abort sync of other folders on javascript error
                    e.type = "JavaScriptError";
                    tbSync.finishFolderSync(syncdata, e);
                    throw e;
                }
            }
        } while (true);
    }),





    singleFolder: Task.async (function* (syncdata)  {
        syncdata.downloadonly = (tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "downloadonly") == "1");
        syncdata.folderCreatedWithProviderVersion = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "createdWithProviderVersion");

        yield dav.sync.remoteChanges(syncdata);
        let numOfLocalChanges = yield dav.sync.localChanges(syncdata);

        //revert all local changes on permission error by doing a clean sync
        if (numOfLocalChanges < 0) {
            dav.onResetTarget(syncdata.account, syncdata.folderID);
            yield dav.sync.remoteChanges(syncdata);

            if (!syncdata.downloadonly) throw dav.sync.failed("info.restored");
        } else if (numOfLocalChanges > 0){
            //we will get back our own changes and can store etags and vcards and also get a clean ctag/token
            yield dav.sync.remoteChanges(syncdata);
        }

        //always finish sync by throwing failed or succeeded
        throw dav.sync.succeeded();
    }),










    remoteChanges: Task.async (function* (syncdata) {
        //Do we have a sync token? No? -> Initial Sync (or WebDAV sync not supported) / Yes? -> Get updates only (token only present if WebDAV sync is suported)
        let token = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "token");
        if (token) {
            //update via token sync
            let tokenSyncSucceeded = yield dav.sync.remoteChangesByTOKEN(syncdata);
            if (tokenSyncSucceeded) return;

            //token sync failed, reset ctag and token and do a full sync
            dav.onResetTarget(syncdata.account, syncdata.folderID);
        }

        //Either token sync did not work or there is no token (initial sync)
        //loop until ctag is the same before and after polling data (sane start condition)
        let maxloops = 20;
        for (let i=0; i <= maxloops; i++) {
                if (i == maxloops)
                    throw dav.sync.failed("could-not-get-stable-ctag");

                let ctagChanged = yield dav.sync.remoteChangesByCTAG(syncdata);
                if (!ctagChanged) break;
        }
    }),

    remoteChangesByTOKEN: Task.async (function* (syncdata) {
        syncdata.todo = 0;
        syncdata.done = 0;

        let token = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "token");
        tbSync.setSyncState("send.request.remotechanges", syncdata.account, syncdata.folderID);
        let cards = yield dav.tools.sendRequest("<d:sync-collection "+dav.tools.xmlns(["d"])+"><d:sync-token>"+token+"</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>", syncdata.folderID, "REPORT", syncdata, {"Content-Type": "application/xml; charset=utf-8"}, {softfail: [415,403]});

        //Sabre\DAV\Exception\ReportNotSupported - Unsupported media type - returned by fruux if synctoken is 0 (empty book), 415 & 403
        //https://github.com/sabre-io/dav/issues/1075
        //Sabre\DAV\Exception\InvalidSyncToken (403)
        if (cards && cards.softerror) {
            //token sync failed, reset ctag and do a full sync
            return false;
        }

        let tokenNode = dav.tools.evaluateNode(cards.node, [["d", "sync-token"]]);
        if (tokenNode === null) {
            //token sync failed, reset ctag and do a full sync
            return false;
        }

        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        let addressBook = abManager.getDirectory(syncdata.targetId);

        let vCardsDeletedOnServer = new dav.tools.deleteCardsContainer(tbSync.dav.prefSettings.getIntPref("maxitems"));
        let vCardsChangedOnServer = {};

        for (let c=0; c < cards.multi.length; c++) {
            let id = cards.multi[c].href;
            if (id !==null) {
                //valid
                let status = cards.multi[c].status;
                let card = tbSync.getCardFromProperty(addressBook, "TBSYNCID", id);
                if (status == "200") {
                    //MOD or ADD
                    let etag = dav.tools.evaluateNode(cards.multi[c].node, [["d","prop"], ["d","getetag"]]);
                    if (!card) {
                        //if the user deleted this card (not yet send to server), do not add it again
                        if (tbSync.db.getItemStatusFromChangeLog(syncdata.targetId, id) != "deleted_by_user")  {
                            syncdata.todo++;
                            vCardsChangedOnServer[id] = "ADD"; 
                        }
                    } else if (etag.textContent != tbSync.getPropertyOfCard(card, "X-DAV-ETAG")) {
                        syncdata.todo++;
                        vCardsChangedOnServer[id] = "MOD"; 
                    }
                } else if (status == "404" && card) {
                    //DEL
                    syncdata.todo++;
                    vCardsDeletedOnServer.appendElement(card, false);
                    tbSync.db.addItemToChangeLog(syncdata.targetId, id, "deleted_by_server");
                }
            }
        }

        //download all cards added to vCardsChangedOnServer and process changes
        yield dav.sync.multiget(addressBook, vCardsChangedOnServer, syncdata);

        //delete all contacts added to vCardsDeletedOnServer
        yield dav.sync.deleteContacts (addressBook, vCardsDeletedOnServer, syncdata);

        //update token
        tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "token", tokenNode.textContent);

        return true;
    }),

    remoteChangesByCTAG: Task.async (function* (syncdata) {
        syncdata.todo = 0;
        syncdata.done = 0;

        //Request ctag and token
        tbSync.setSyncState("send.request.remotechanges", syncdata.account, syncdata.folderID);
        let response = yield dav.tools.sendRequest("<d:propfind "+dav.tools.xmlns(["d", "cs"])+"><d:prop><cs:getctag /><d:sync-token /></d:prop></d:propfind>", syncdata.folderID, "PROPFIND", syncdata, {"Depth": "0"});

        tbSync.setSyncState("eval.response.remotechanges", syncdata.account, syncdata.folderID);
        let ctag = dav.tools.getNodeTextContentFromMultiResponse(response, [["d","prop"], ["cs", "getctag"]], syncdata.folderID);
        let token = dav.tools.getNodeTextContentFromMultiResponse(response, [["d","prop"], ["d", "sync-token"]], syncdata.folderID);

        //if CTAG changed, we need to sync everything and compare
        if (ctag === null || ctag != tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "ctag")) {
            let vCardsFoundOnServer = [];
            let vCardsChangedOnServer = {};

            let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
            let addressBook = abManager.getDirectory(syncdata.targetId);

            //get etags of all cards on server and find the changed cards
            tbSync.setSyncState("send.request.remotechanges", syncdata.account, syncdata.folderID);
            let cards = yield dav.tools.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:getetag /></d:prop></d:propfind>", syncdata.folderID, "PROPFIND", syncdata, {"Depth": "1", "Prefer": "return-minimal"});

            //this is the same request, but includes getcontenttype, do we need it? icloud send contacts without
            //let cards = yield dav.tools.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:getetag /><d:getcontenttype /></d:prop></d:propfind>", syncdata.folderID, "PROPFIND", syncdata, {"Depth": "1", "Prefer": "return-minimal"});

            //addressbook-query does not work on older servers (zimbra)
            //let cards = yield dav.tools.sendRequest("<card:addressbook-query "+dav.tools.xmlns(["d", "card"])+"><d:prop><d:getetag /></d:prop></card:addressbook-query>", syncdata.folderID, "REPORT", syncdata, {"Depth": "1", "Prefer": "return-minimal"});

            tbSync.setSyncState("eval.response.remotechanges", syncdata.account, syncdata.folderID);
            for (let c=0; cards.multi && c < cards.multi.length; c++) {
                let id =  cards.multi[c].href;
                if (id == syncdata.folderID) {
                    //some servers (Radicale) report the folder itself and a querry to that would return everything again
                    continue;
                }
                let etag = dav.tools.evaluateNode(cards.multi[c].node, [["d","prop"], ["d","getetag"]]);

                //ctype is currently not used, because iCloud does not send one and sabre/dav documentation is not checking ctype 
                //let ctype = dav.tools.evaluateNode(cards.multi[c].node, [["d","prop"], ["d","getcontenttype"]]);

                if (cards.multi[c].status == "200" && etag !== null && id !== null /* && ctype !== null */) { //we do not actually check the content of ctype - but why do we request it? iCloud seems to send cards without ctype
                    vCardsFoundOnServer.push(id);
                    let card = tbSync.getCardFromProperty(addressBook, "TBSYNCID", id);
                    if (!card) {
                        //if the user deleted this card (not yet send to server), do not add it again
                        if (tbSync.db.getItemStatusFromChangeLog(syncdata.targetId, id) != "deleted_by_user") {
                            syncdata.todo++;
                            vCardsChangedOnServer[id] = "ADD"; 
                        }
                    } else if (etag.textContent != tbSync.getPropertyOfCard(card, "X-DAV-ETAG")) {
                        syncdata.todo++;
                        vCardsChangedOnServer[id] = "MOD"; 
                    }
                }
            }

            //FIND DELETES: loop over current addressbook and check each local card if it still exists on the server
            let vCardsDeletedOnServer =  new dav.tools.deleteCardsContainer(tbSync.dav.prefSettings.getIntPref("maxitems"));
            cards = addressBook.childCards;
            while (true) {
                let more = false;
                try { more = cards.hasMoreElements() } catch (ex) {}
                if (!more) break;

                let card = cards.getNext().QueryInterface(Components.interfaces.nsIAbCard);
                let id = card.getProperty("TBSYNCID","");
                if (id && !vCardsFoundOnServer.includes(id) && tbSync.db.getItemStatusFromChangeLog(syncdata.targetId, id) != "added_by_user") {
                    //delete request from server
                    syncdata.todo++;
                    vCardsDeletedOnServer.appendElement(card, false);
                    tbSync.db.addItemToChangeLog(syncdata.targetId, id, "deleted_by_server");
                }
            }


            //download all cards added to vCardsChangedOnServer and process changes
            yield dav.sync.multiget(addressBook, vCardsChangedOnServer, syncdata);

            //delete all contacts added to vCardsDeletedOnServer
            yield dav.sync.deleteContacts (addressBook, vCardsDeletedOnServer, syncdata);

            //update ctag and token (if there is one)
            if (ctag === null) return false; //if server does not support ctag, "it did not change"
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "ctag", ctag);
            if (token) tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "token", token);

            //ctag did change
            return true;
        } else {

            //ctag did not change
            return false;
        }

    }),



    multiget: Task.async (function*(addressBook, vCardsChangedOnServer, syncdata) {
        //keep track of found mailing lists and its members
        syncdata.foundMailingLists = {};
        
        //download all changed cards and process changes
        let cards2catch = Object.keys(vCardsChangedOnServer);
        let maxitems = tbSync.dav.prefSettings.getIntPref("maxitems");

        for (let i=0; i < cards2catch.length; i+=maxitems) {
            let request = dav.tools.getMultiGetRequest(cards2catch.slice(i, i+maxitems));
            if (request) {
                tbSync.setSyncState("send.request.remotechanges", syncdata.account, syncdata.folderID);
                let cards = yield dav.tools.sendRequest(request, syncdata.folderID, "REPORT", syncdata, {"Depth": "1", "Content-Type": "application/xml; charset=utf-8"});

                tbSync.setSyncState("eval.response.remotechanges", syncdata.account, syncdata.folderID);
                for (let c=0; c < cards.multi.length; c++) {
                    syncdata.done++;
                    let id =  cards.multi[c].href;
                    let etag = dav.tools.evaluateNode(cards.multi[c].node, [["d","prop"], ["d","getetag"]]);
                    let data = dav.tools.evaluateNode(cards.multi[c].node, [["d","prop"], ["card","address-data"]]);

                    if (cards.multi[c].status == "200" && etag !== null && data !== null && id !== null && vCardsChangedOnServer.hasOwnProperty(id)) {
                        switch (vCardsChangedOnServer[id]) {
                            case "ADD":
                                dav.tools.addContact (addressBook, id, data, etag, syncdata);
                                break;

                            case "MOD":
                                dav.tools.modifyContact (addressBook, id, data, etag, syncdata);
                                break;
                        }
                    } else {
                        tbSync.dump("Skipped Card", [id, cards.multi[c].status == "200", etag !== null, data !== null, id !== null, vCardsChangedOnServer.hasOwnProperty(id)].join(", "));
                    }
                }
            }
        }
        
        //process members of found mailinglists
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        for (let mailListCardID in syncdata.foundMailingLists) {
            if (syncdata.foundMailingLists.hasOwnProperty(mailListCardID)) {
                let locked = 0;
                let mailListCard = tbSync.getCardFromProperty(addressBook, "TBSYNCID", mailListCardID);
                let mailListDirectory = abManager.getDirectory(mailListCard.mailListURI);
                
                //smart merge: oldMembers contains the state during last sync, newMembers is the current state
                //by comparing we can learn, what was added on the server (in new but not in old) and what was deleted (in old but not in new)
                //when adding, we need to check, if it is already part of local list (added by user as well)
                //when deleting, we need to check, if it has been deleted already in the local list (deleted by user as well)
                //all other local changes remain untouched and will be send back to the server as local changes
                let addedMembers = syncdata.foundMailingLists[mailListCardID].newMembers.filter(e => !syncdata.foundMailingLists[mailListCardID].oldMembers.includes(e));
                let removedMembers = syncdata.foundMailingLists[mailListCardID].oldMembers.filter(e => !syncdata.foundMailingLists[mailListCardID].newMembers.includes(e));
                
                //remove requested members from list (IDs stored in this array are X-DAV-UIDs)
                for (let i=0; i < removedMembers.length; i++) {
                    let card = addressBook.getCardFromProperty("X-DAV-UID", removedMembers[i], true);
                    if (card) {
                        let idx = tbSync.findIndexOfMailingListMemberWithProperty(mailListDirectory, "X-DAV-UID", removedMembers[i]);
                        if (idx != -1) {
                            tbSync.db.addItemToChangeLog(syncdata.targetId, card.getProperty("TBSYNCID", ""), "locked_by_mailinglist_operations");
                            locked++;
                            mailListDirectory.addressLists.removeElementAt(idx);  
                        }                                
                    }
                }
                
                //add requested members to list (IDs stored in this array are X-DAV-UIDs)
                for (let i=0; i < addedMembers.length; i++) {
                    let card = addressBook.getCardFromProperty("X-DAV-UID", addedMembers[i], true);
                    if (card) {
                        let idx = tbSync.findIndexOfMailingListMemberWithProperty(mailListDirectory, "X-DAV-UID", addedMembers[i]);
                        if (idx == -1) {
                            tbSync.db.addItemToChangeLog(syncdata.targetId, card.getProperty("TBSYNCID", ""), "locked_by_mailinglist_operations");
                            locked++;
                            mailListDirectory.addressLists.appendElement(card, false);
                        }
                    }
                }
                
                //if at least one member has been changed, we need to call editMailListToDatabase to update the directory, which will unlock all locked cards
                if (locked > 0) {
                    tbSync.db.addItemToChangeLog(syncdata.targetId, mailListCardID, "locked_by_mailinglist_operations");
                    //editMailListToDatabase will mod all members of this list, so we need to lock all of them
                    for (let i=0; i < syncdata.foundMailingLists[mailListCardID].newMembers.length; i++) {
                        let card = addressBook.getCardFromProperty("X-DAV-UID", syncdata.foundMailingLists[mailListCardID].newMembers[i], true);
                        if (card) {
                            tbSync.db.addItemToChangeLog(syncdata.targetId, card.getProperty("TBSYNCID", ""), "locked_by_mailinglist_operations");
                        }
                    }
                    mailListDirectory.editMailListToDatabase(mailListCard);
                }
            }
        }            
    }),

    deleteContacts: Task.async (function*(addressBook, vCardsDeletedOnServer, syncdata) {
        //the vCardsDeletedOnServer object has a data member (array of nsIMutableArray) and each nsIMutableArray has a maximum size
        //of maxitems, so we can show a progress during delete and not delete all at once
        for (let i=0; i < vCardsDeletedOnServer.data.length; i++) {
            syncdata.done += vCardsDeletedOnServer.data[i].length;
            tbSync.setSyncState("eval.response.remotechanges", syncdata.account, syncdata.folderID);
            yield tbSync.sleep(200); //we want the user to see, that deletes are happening
            addressBook.deleteCards(vCardsDeletedOnServer.data[i]);
        }
    }),




    localChanges: Task.async (function* (syncdata) {
        //keep track of found mailing lists and its members
        syncdata.foundMailingLists = {};

        //define how many entries can be send in one request
        let maxitems = tbSync.dav.prefSettings.getIntPref("maxitems");

        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        let addressBook = abManager.getDirectory(syncdata.targetId);
        
        let permissionErrors = 0;
        let permissionError = { //keep track of permission errors - preset with downloadonly status to skip sync in that case
            "added_by_user": syncdata.downloadonly, 
            "modified_by_user": syncdata.downloadonly, 
            "deleted_by_user": syncdata.downloadonly
        }; 
        
        //special handling of lists/groups
        //ADD/MOD of the list cards itself is not detectable, we only detect the change of its member cards when membership changes
        //DEL is handled like a normal card, no special handling needed        
        let result = abManager.getDirectory(addressBook.URI +  "?(or(IsMailList,=,TRUE))").childCards;
        while (result.hasMoreElements()) {
            let mailListCard = result.getNext().QueryInterface(Components.interfaces.nsIAbCard);
            let mailListInfo = dav.tools.getGroupInfoFromList(mailListCard.mailListURI);           

            let mailListCardId = tbSync.getPropertyOfCard(mailListCard, "TBSYNCID");
            if (mailListCardId) {
                //get old data from vCard to find changes
                let oCardInfo = dav.tools.getGroupInfoFromCardData(tbSync.dav.vCard.parse(tbSync.getPropertyOfCard(mailListCard, "X-DAV-VCARD")));            
                
                let addedMembers = mailListInfo.members.filter(e => !oCardInfo.members.includes(e));
                let removedMembers = oCardInfo.members.filter(e => !mailListInfo.members.includes(e));
                
                if (oCardInfo.name != mailListInfo.name || addedMembers.length > 0 || removedMembers.length > 0) {
                    tbSync.db.addItemToChangeLog(syncdata.targetId, mailListCardId, "modified_by_user");
                }
            } else {
                //that card has no id yet (because the general TbSync addressbook listener cannot catch it)
                let folder = tbSync.db.getFolder(syncdata.account, syncdata.folderID);
                mailListCardId = tbSync.dav.getNewCardID(mailListCard, folder);
                tbSync.setPropertyOfCard (mailListCard, "TBSYNCID", mailListCardId);                
                tbSync.db.addItemToChangeLog(syncdata.targetId, mailListCardId, "added_by_user");
            }
            syncdata.foundMailingLists[mailListCardId] = mailListInfo;
        }

        //access changelog to get local modifications (done and todo are used for UI to display progress)
        syncdata.done = 0;
        syncdata.todo = db.getItemsFromChangeLog(syncdata.targetId, 0, "_by_user").length;

        do {
            tbSync.setSyncState("prepare.request.localchanges", syncdata.account, syncdata.folderID);

            //get changed items from ChangeLog
            let changes = db.getItemsFromChangeLog(syncdata.targetId, maxitems, "_by_user");
            if (changes == 0)
                break;

            for (let i=0; i<changes.length; i++) {
                switch (changes[i].status) {
                    case "added_by_user":
                    case "modified_by_user":
                        {
                            let isAdding = (changes[i].status == "added_by_user");
                            if (!permissionError[changes[i].status]) { //if this operation failed already, do not retry

                                let card = tbSync.getCardFromProperty(addressBook, "TBSYNCID", changes[i].id);
                                if (card) {
                                    let vcard = card.isMailList
                                                        ? dav.tools.getVCardFromThunderbirdListCard(syncdata, addressBook, card, isAdding)
                                                        : dav.tools.getVCardFromThunderbirdContactCard(syncdata, addressBook, card, isAdding);
                                    let headers = {"Content-Type": "text/vcard; charset=utf-8"};
                                    //if (!isAdding) options["If-Match"] = vcard.etag;

                                    tbSync.setSyncState("send.request.localchanges", syncdata.account, syncdata.folderID);
                                    if (isAdding || vcard.modified) {
                                        let response = yield dav.tools.sendRequest(vcard.data, changes[i].id, "PUT", syncdata, headers, {softfail: [403,405]});

                                        tbSync.setSyncState("eval.response.localchanges", syncdata.account, syncdata.folderID);
                                        if (response && response.softerror) {
                                            permissionError[changes[i].status] = true;
                                            tbSync.errorlog(syncdata, "missing-permission::" + tbSync.getLocalizedMessage(isAdding ? "acl.add" : "acl.modify", "dav"));
                                        }
                                    }
                                } else {
                                    tbSync.errorlog(syncdata, "cardnotfoundbutinchangelog::" + changes[i].id);
                                }
                            }

                            if (permissionError[changes[i].status]) {
                                dav.tools.invalidateThunderbirdCard(syncdata, addressBook, changes[i].id);
                                permissionErrors--;
                            }
                        }
                        break;

                    case "deleted_by_user":
                        {
                            if (!permissionError[changes[i].status]) { //if this operation failed already, do not retry
                                tbSync.setSyncState("send.request.localchanges", syncdata.account, syncdata.folderID);
                                let response = yield dav.tools.sendRequest("", changes[i].id , "DELETE", syncdata, {}, {softfail: [403, 405]});

                                tbSync.setSyncState("eval.response.localchanges", syncdata.account, syncdata.folderID);
                                if (response  && response.softerror) {
                                    permissionError[changes[i].status] = true;
                                    tbSync.errorlog(syncdata, "missing-permission::" + tbSync.getLocalizedMessage("acl.delete", "dav"));
                                }
                            }

                            if (permissionError[changes[i].status]) {
                                tbSync.db.addItemToChangeLog(syncdata.targetId, changes[i].id, "deleted_by_server");
                                permissionErrors--;                                
                            }
                        }
                        break;
                }

                db.removeItemFromChangeLog(syncdata.targetId, changes[i].id);
                syncdata.done++; //UI feedback
            }


        } while (true);

        //return number of modified cards or the number of permission errors (negativ)
        return (permissionErrors < 0 ? permissionErrors : syncdata.done);
    }),


}
