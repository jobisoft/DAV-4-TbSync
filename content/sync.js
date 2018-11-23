/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

dav.sync = {

    failed: function (msg = "") {
        let e = new Error();
        e.message = msg;
        e.type = "dav4tbsync";
        return e;
    },

    succeeded: function (msg = "") {
        let e = new Error();
        e.message = "OK";
        if (msg) e.message = e.message + "." + msg;
        e.type = "dav4tbsync";
        return e;
    },





    folderList: Task.async (function* (syncdata) {
        //This is a very simple implementation of the discovery method of sabre/dav.
        //I am not even checking if there are changes, I just pull the current list from the server and replace the local list
        //Method description: http://sabre.io/dav/building-a-caldav-client/


        //get all folders currently known
        let folders = tbSync.db.getFolders(syncdata.account);
        let deletedFolders = [];
        for (let f in folders) {
            deletedFolders.push(f);
        }

        let davjobs = {
            card : {run: true, hometag: 'addressbook-home-set'},
            cal : {run: tbSync.lightningIsAvailable(), hometag: 'calendar-home-set'},        
        };

        //get and update FQDN from account setup
        let account = tbSync.db.getAccount(syncdata.account);
        let hostparts = account.host.split("/").filter(i => i != "");
        let fqdn = hostparts.splice(0,1).toString();
        let domain = dav.tools.getDomainFromHost(fqdn);
        
        //Manipulate account.host, to help users setup their accounts
        switch (domain) {
            case "yahoo.com":
                tbSync.db.setAccountSetting(syncdata.account, "host", "yahoo.com");
                davjobs.card.initialURL = "carddav.address.yahoo.com/.well-known/carddav";
                davjobs.cal.initialURL = "caldav.calendar.yahoo.com/.well-known/caldav";
                break;
            
            case "gmx.net":
                tbSync.db.setAccountSetting(syncdata.account, "host", "gmx.net");
                davjobs.card.initialURL = "carddav.gmx.net/.well-known/carddav";
                davjobs.cal.initialURL =  "caldav.gmx.net";
                //TODO : GMX has disabled the ./well-known redirect for the caldav server and the dav server is directly sitting there, got to check for that in general!
                break;
            
            case "icloud.com":
                tbSync.db.setAccountSetting(syncdata.account, "host", "icloud.com");
                davjobs.card.initialURL = "contacts.icloud.com";
                davjobs.cal.initialURL = "caldav.icloud.com";
                break;
            
            default:
                //if host is FQDN assume .well-known approach on root, otherwise direct specification of dav server
                davjobs.card.initialURL = fqdn + ((hostparts.length == 0) ? "/.well-known/carddav" : "/" + hostparts.join("/"));
                davjobs.cal.initialURL = fqdn + ((hostparts.length == 0) ? "/.well-known/caldav" : "/" + hostparts.join("/"));
        }
        
        let jobsfound = 0;
        for (let job in davjobs) {
            if (!davjobs[job].run) continue;

            //sync states are only printed while the account state is "syncing" to inform user about sync process (it is not stored in DB, just in syncdata)
            //example state "getfolders" to get folder information from server
            //if you send a request to a server and thus have to wait for answer, use a "send." syncstate, which will give visual feedback to the user,
            //that we are waiting for an answer with timeout countdown

            let home = null;
            let principal = null;

            tbSync.setSyncState("send.getfolders", syncdata.account);
            {
                //split initialURL into host and url
                let parts = davjobs[job].initialURL.split("/").filter(i => i != "");
                syncdata.fqdn = parts.splice(0,1).toString();
                let addr = "/" + parts.join("/");                
                
                let response = yield dav.tools.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:current-user-principal /></d:prop></d:propfind>", addr , "PROPFIND", syncdata, {"Depth": "0", "Prefer": "return-minimal"});
                if (response && response.error) continue;

                tbSync.setSyncState("eval.folders", syncdata.account);
                principal = dav.tools.getNodeTextContentFromMultiResponse(response, [["d","prop"], ["d","current-user-principal"], ["d","href"]]);
            }
            jobsfound++;

            //principal now contains something like "/remote.php/carddav/principals/john.bieling/"
            // -> get home/root of storage
            if (principal !== null) {
                tbSync.setSyncState("send.getfolders", syncdata.account);
                let response = yield dav.tools.sendRequest("<d:propfind "+dav.tools.xmlns(["d", job])+"><d:prop><"+job+":"+davjobs[job].hometag+" /></d:prop></d:propfind>", principal, "PROPFIND", syncdata, {"Depth": "0", "Prefer": "return-minimal"});
                if (response && response.error) continue;

                tbSync.setSyncState("eval.folders", syncdata.account);
                home = dav.tools.getNodeTextContentFromMultiResponse(response, [["d","prop"], [job, davjobs[job].hometag], ["d","href"]], principal);
            }

            //home now contains something like /remote.php/caldav/calendars/john.bieling/
            // -> get all calendars and addressbooks
            if (home !== null) {
                tbSync.setSyncState("send.getfolders", syncdata.account);
                let request = (job == "cal")
                                        ? "<d:propfind "+dav.tools.xmlns(["d","apple","cs"])+"><d:prop><d:resourcetype /><d:displayname /><apple:calendar-color/><cs:source/></d:prop></d:propfind>"
                                        : "<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:resourcetype /><d:displayname /></d:prop></d:propfind>";

                let response = yield dav.tools.sendRequest(request, home, "PROPFIND", syncdata, {"Depth": "1", "Prefer": "return-minimal"});
                if (response && response.error) continue;
                
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
                    
                    let href = response.multi[r].href;
                    if (resourcetype == "ics") href =  dav.tools.evaluateNode(response.multi[r].node, [["d","prop"], ["cs","source"], ["d","href"]]).textContent;
                    
                    let name_node = dav.tools.evaluateNode(response.multi[r].node, [["d","prop"], ["d","displayname"]]);
                    let name = (job == "cal") ? "default calendar" : "default address book";
                    if (name_node != null) {
                        name = name_node.textContent;
                    }
                    let color = dav.tools.evaluateNode(response.multi[r].node, [["d","prop"], ["apple","calendar-color"]]);

                    let folder = tbSync.db.getFolder(syncdata.account, href);
                    if (folder === null || folder.cached === "1") { //this is NOT called by unsubscribing/subscribing
                        let newFolder = {}
                        newFolder.folderID = href;
                        newFolder.name = name;
                        newFolder.type = resourcetype;
                        newFolder.parentID = "0"; //root - tbsync flatens hierachy, using parentID to sort entries
                        newFolder.selected = (r == 1) ? tbSync.db.getAccountSetting(syncdata.account, "syncdefaultfolders") : "0"; //only select the first one
                        newFolder.fqdn = syncdata.fqdn;
                
                        //if there is a cached version of this folderID, addFolder will merge all persistent settings - all other settings not defined here will be set to their defaults
                        tbSync.db.addFolder(syncdata.account, newFolder);
                    } else {
                        //Update name & color
                        tbSync.db.setFolderSetting(syncdata.account, href, "name", name);
                        tbSync.db.setFolderSetting(syncdata.account, href, "fqdn", syncdata.fqdn);
                        deletedFolders = deletedFolders.filter(item => item !== href);
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

            } else {
                //home was not found - connection error? - do not delete anything
                let deletedFolders = [];
            }
        }

        if (jobsfound == 0) {
            throw dav.sync.failed("service-discovery-failed");
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
                throw dav.sync.succeeded();
            }
            //what folder are we syncing?
            syncdata.folderID = folders[0].folderID;
            syncdata.type = folders[0].type;
            syncdata.fqdn = folders[0].fqdn;
            
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
                            syncdata.addressbookObj = tbSync.getAddressBookObject(syncdata.targetId);

                            //promisify addressbook, so it can be used together with yield (using same interface as promisified calender)
                            syncdata.targetObj = tbSync.promisifyAddressbook(syncdata.addressbookObj);

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
                            throw dav.sync.succeeded();
                        }
                        break;

                    default:
                        {
                            throw dav.sync.failed("notsupported");
                        }
                        break;

                }
            } catch (e) {
                if (e.type == "dav4tbsync") tbSync.finishFolderSync(syncdata, e.message);
                else {
                    //abort sync of other folders on javascript error
                    tbSync.finishFolderSync(syncdata, "javascriptError::" + (e.message ? e.message : e));
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
        let cards = yield dav.tools.sendRequest("<d:sync-collection "+dav.tools.xmlns(["d"])+"><d:sync-token>"+token+"</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>", syncdata.folderID, "REPORT", syncdata, {"Content-Type": "application/xml; charset=utf-8"});

        if (cards.error) { //Sabre\DAV\Exception\InvalidSyncToken
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
                let card = addressBook.getCardFromProperty("TBSYNCID", id, true);
                if (status == "200") {
                    //MOD or ADD
                    let etag = dav.tools.evaluateNode(cards.multi[c].node, [["d","prop"], ["d","getetag"]]);
                    if (!card) {
                        //if the user deleted this card (not yet send to server), do not add it again
                        if (tbSync.db.getItemStatusFromChangeLog(syncdata.targetId, id) != "deleted_by_user")  {
                            syncdata.todo++;
                            vCardsChangedOnServer[id] = "ADD"; 
                        }
                    } else if (etag.textContent != card.getProperty("X-DAV-ETAG","")) {
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
            let cards = yield dav.tools.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:getetag /><d:getcontenttype /></d:prop></d:propfind>", syncdata.folderID, "PROPFIND", syncdata, {"Depth": "1", "Prefer": "return-minimal"});

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
                let ctype = dav.tools.evaluateNode(cards.multi[c].node, [["d","prop"], ["d","getcontenttype"]]);
                if (cards.multi[c].status == "200" && etag !== null && id !== null && ctype !== null) { //we do not actually check the content of ctype
                    vCardsFoundOnServer.push(id);
                    let card = addressBook.getCardFromProperty("TBSYNCID", id, true);
                    if (!card) {
                        //if the user deleted this card (not yet send to server), do not add it again
                        if (tbSync.db.getItemStatusFromChangeLog(syncdata.targetId, id) != "deleted_by_user") {
                            syncdata.todo++;
                            vCardsChangedOnServer[id] = "ADD"; 
                        }
                    } else if (etag.textContent != card.getProperty("X-DAV-ETAG","")) {
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
        //define how many entries can be send in one request
        let maxitems = tbSync.dav.prefSettings.getIntPref("maxitems");

        //access changelog to get local modifications (done and todo are used for UI to display progress)
        syncdata.done = 0;
        syncdata.todo = db.getItemsFromChangeLog(syncdata.targetId, 0, "_by_user").length;

        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
        let addressBook = abManager.getDirectory(syncdata.targetId);
        let permissionError = syncdata.downloadonly; //start with "permissionError", if the user has set this to downloadonly

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
                            if (!permissionError) { //no need to do any other requests, if there was a permission error already
                                let isAdding = (changes[i].status == "added_by_user");
                                let vcard = dav.tools.getVCardFromThunderbirdCard (syncdata, addressBook, changes[i].id, isAdding);
                                let options = {"Content-Type": "text/vcard; charset=utf-8"};
                                //if (!isAdding) options["If-Match"] = vcard.etag;

                                tbSync.setSyncState("send.request.localchanges", syncdata.account, syncdata.folderID);
                                let response = yield dav.tools.sendRequest(vcard.data, changes[i].id, "PUT", syncdata, options);

                                tbSync.setSyncState("eval.response.localchanges", syncdata.account, syncdata.folderID);
                                if (response && [403,405].includes(response.error)) {
                                    permissionError = true;
                                }
                            }

                            if (permissionError) {
                                dav.tools.invalidateThunderbirdCard(syncdata, addressBook, changes[i].id);
                            }
                        }
                        break;

                    case "deleted_by_user":
                        {
                            if (!permissionError) { //no need to do any other requests, if there was a permission error already
                                tbSync.setSyncState("send.request.localchanges", syncdata.account, syncdata.folderID);
                                let response = yield dav.tools.sendRequest("", changes[i].id , "DELETE", syncdata, {});

                                tbSync.setSyncState("eval.response.localchanges", syncdata.account, syncdata.folderID);
                                if (response && [403,405].includes(response.error)) {
                                    permissionError = true;
                                }
                            }

                            if (permissionError) {
                                tbSync.db.addItemToChangeLog(syncdata.targetId, changes[i].id, "deleted_by_server");
                            }
                        }
                        break;
                }

                db.removeItemFromChangeLog(syncdata.targetId, changes[i].id);
                syncdata.done++; //UI feedback
            }


        } while (true);

        //return number of modified cards or -1 on permission error
        return (permissionError ? -1 : syncdata.done);
    }),


}
