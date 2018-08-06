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
        //I am not even checking if there are changes, I jut pull the current list from the server and replace the local list
        //Method description: http://sabre.io/dav/building-a-caldav-client/
        
        let davjobs = {
            card : {type: 'carddav', hometag: 'addressbook-home-set', typetag: 'addressbook'},
            cal : {type: 'caldav', hometag: 'calendar-home-set', typetag: 'calendar'},
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
            
            let home = false;
            let principal = false;

            {
                tbSync.setSyncState("send.getfolders", syncdata.account);
                let response = yield dav.tools.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:current-user-principal /></d:prop></d:propfind>", "/.well-known/"+davjobs[job].type+"/", "PROPFIND", syncdata, {"Depth": "0", "Prefer": "return-minimal"});

                tbSync.setSyncState("eval.folders", syncdata.account); 
                principal = dav.tools.getNodeTextContentFromMultiResponse(response, [["d","propstat"], ["d","prop"], ["d","current-user-principal"], ["d","href"]]);
            }
            
            //principal now contains something like "/remote.php/carddav/principals/john.bieling/"
            // -> get home/root of storage            
            if (principal !== false) {
                tbSync.setSyncState("send.getfolders", syncdata.account);
                let response = yield dav.tools.sendRequest("<d:propfind "+dav.tools.xmlns(["d", job])+"><d:prop><"+job+":"+davjobs[job].hometag+" /></d:prop></d:propfind>", principal, "PROPFIND", syncdata, {"Depth": "0", "Prefer": "return-minimal"});

                tbSync.setSyncState("eval.folders", syncdata.account);
                home = dav.tools.getNodeTextContentFromMultiResponse(response, [["d","propstat"], ["d","prop"], [job, davjobs[job].hometag], ["d","href"]], principal);                       
            }
            
            //home now contains something like /remote.php/caldav/calendars/john.bieling/
            // -> get all calendars and addressbooks
            if (home !== false) {
                tbSync.setSyncState("send.getfolders", syncdata.account);
                let response = yield dav.tools.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:resourcetype /><d:displayname /></d:prop></d:propfind>", home, "PROPFIND", syncdata, {"Depth": "1", "Prefer": "return-minimal"});
                
                for (let r=0; r < response.multi.length; r++) {
                    //is this a result with a valid recourcetype? (the node must be present)
                    let valid = dav.tools.evaluateNode(response.multi[r].node, [["d","propstat"], ["d","prop"], ["d","resourcetype"], [job, davjobs[job].typetag]]);                       
                    if (valid === false || response.multi[r].status != "200") continue;

                    let href = response.multi[r].href;
                    let name = dav.tools.evaluateNode(response.multi[r].node, [["d","propstat"], ["d","prop"], ["d","displayname"]]).textContent;                       

                    let folder = tbSync.db.getFolder(syncdata.account, href);
                    if (folder === null || folder.cached === "1") {
                        let newFolder = {}
                        newFolder.folderID = href;
                        newFolder.name = name;
                        newFolder.type = davjobs[job].type;
                        newFolder.parentID = "0"; //root - tbsync flatens hierachy, using parentID to sort entries
                        newFolder.selected = (r == 1) ? "1" : "0"; //only select the first one

                        //if there is a cached version of this folderID, addFolder will merge all persistent settings - all other settings not defined here will be set to their defaults
                        tbSync.db.addFolder(syncdata.account, newFolder);
                    } else {
                        //Update name
                        tbSync.db.setFolderSetting(syncdata.account, href, "name", name);
                        deletedFolders = deletedFolders.filter(item => item !== href);
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
                throw dav.sync.succeeded();
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
                        
                        //throw dav.sync.failed("info.carddavnotimplemented");         
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

                        //we do not do anything here, because that calendar is managed by lightning directly
                        tbSync.db.clearChangeLog(tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "target"));
                        throw dav.sync.succeeded("managedbylightning");         
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
    }),
    
    



    singleFolder: Task.async (function* (syncdata)  {
        //The syncdata.targetObj has a comon interface, regardless if this is a contact or calendar sync, 
        //so you could use the same main sync process for both to reduce redundancy.
        //The actual type can be stored in syncdata.type, so you can call type-based functions to read 
        //or to create new Thunderbird items (contacts or events)

        //Request remote changes
        {
            //Do we have a sync token? No? -> Initial Sync (or WebDAV sync not supported) / Yes? -> Get updates only (token only present if WebDAV sync is suported)
            let token = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "token");
            if (token) {
                //update
                yield dav.sync.remoteChangesByTOKEN(syncdata);
                throw dav.sync.succeeded("token-update");
            } 
            
            //Either token update did not work or there is no token (initial sync)
            //loop until ctag is the same before and after polling data (sane start condition)
            let maxloops = 20;
            for (let i=0; i <= maxloops; i++) {
                    if (i == maxloops) 
                        throw dav.sync.failed("could-not-get-stable-ctag");
                
                    let ctagChanged = yield dav.sync.remoteChangesByCTAG(syncdata);
                    if (!ctagChanged) break;
            }
            throw dav.sync.succeeded("full-sync");
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
    









    remoteChangesByTOKEN: Task.async (function* (syncdata) {
    }),
    
    remoteChangesByCTAG: Task.async (function* (syncdata) {
        //Request ctag and token
        tbSync.setSyncState("send.request.remotechanges", syncdata.account, syncdata.folderID);
        let response = yield dav.tools.sendRequest("<d:propfind "+dav.tools.xmlns(["d", "cs"])+"><d:prop><cs:getctag /><d:sync-token /></d:prop></d:propfind>", syncdata.folderID, "PROPFIND", syncdata, {"Depth": "0"});

        syncdata.todo = 0;
        syncdata.done = 0;
        tbSync.setSyncState("eval.response.remotechanges", syncdata.account, syncdata.folderID);
        let ctag = dav.tools.getNodeTextContentFromMultiResponse(response, [["d","propstat"], ["d","prop"], ["cs", "getctag"]], syncdata.folderID);                       
        let token = dav.tools.getNodeTextContentFromMultiResponse(response, [["d","propstat"], ["d","prop"], ["d", "sync-token"]], syncdata.folderID);                       
        if (ctag === false) 
            throw dav.sync.failed("invalid-response");

        //if CTAG changed, we need to sync everything and compare
        if (ctag != tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "ctag")) {
            let vCardsFoundOnServer = [];
            let vCardsChangedOnServer = {};

            let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
            let addressBook = abManager.getDirectory(syncdata.targetId);

            //get etags of all cards on server and find the changed cards
            tbSync.setSyncState("send.request.remotechanges", syncdata.account, syncdata.folderID);
            let cards = yield dav.tools.sendRequest("<card:addressbook-query "+dav.tools.xmlns(["d", "card"])+"><d:prop><d:getetag /></d:prop></card:addressbook-query>", syncdata.folderID, "REPORT", syncdata, {"Depth": "1", "Prefer": "return-minimal"});           
            tbSync.setSyncState("eval.response.remotechanges", syncdata.account, syncdata.folderID);            
            for (let c=0; c < cards.multi.length; c++) {
                let id =  cards.multi[c].href;
                let etag = dav.tools.evaluateNode(cards.multi[c].node, [["d","propstat"], ["d","prop"], ["d","getetag"]]);                       
                if (cards.multi[c].status == "200" && etag !== false && id !== null) {
                    vCardsFoundOnServer.push(id);
                    let card = addressBook.getCardFromProperty("TBSYNCID", id, true);                    
                    if (!card) vCardsChangedOnServer[id] = "ADD";
                    else if (etag.textContent != card.getProperty("X-DAV-ETAG","")) vCardsChangedOnServer[id] = "MOD";
                }
            }

            //download all changed cards and process changes
            let cards2catch = Object.keys(vCardsChangedOnServer);
            syncdata.todo = cards2catch.length;
            syncdata.done = 0;
            let maxitems = 50;
            
            for (let i=0; i < cards2catch.length; i+=maxitems) {
                let request = dav.tools.getMultiGetRequest(cards2catch.slice(i, i+maxitems));
                if (request) {
                    tbSync.setSyncState("send.request.remotechanges", syncdata.account, syncdata.folderID);
                    let cards = yield dav.tools.sendRequest(request, syncdata.folderID, "REPORT", syncdata, {"Depth": "1", "Content-Type": "application/xml; charset=utf-8"});

                    syncdata.done = i;
                    tbSync.setSyncState("eval.response.remotechanges", syncdata.account, syncdata.folderID);
                    for (let c=0; c < cards.multi.length; c++) {
                        let id =  cards.multi[c].href;
                        let etag = dav.tools.evaluateNode(cards.multi[c].node, [["d","propstat"], ["d","prop"], ["d","getetag"]]);                       
                        let data = dav.tools.evaluateNode(cards.multi[c].node, [["d","propstat"], ["d","prop"], ["card","address-data"]]); 

                        if (cards.multi[c].status == "200" && etag !== false && data && id !== null && vCardsChangedOnServer.hasOwnProperty(id)) {
                            switch (vCardsChangedOnServer[id]) {
                                case "ADD":
                                    VCF.parse(data.textContent, function(vcard) {
                                            let card = Components.classes["@mozilla.org/addressbook/cardproperty;1"].createInstance(Components.interfaces.nsIAbCard);
                                            card.setProperty("TBSYNCID", id);
                                            card.setProperty("X-DAV-ETAG", etag.textContent);
                                            card.setProperty("X-DAV-VCARD", data.textContent);
                                            card.setProperty("DisplayName", vcard.fn);
                                            tbSync.db.addItemToChangeLog(syncdata.targetId, id, "added_by_server");
                                            addressBook.addCard(card);
                                        });
                                    break;

                                case "MOD":
                                    VCF.parse(data.textContent, function(vcard) {
                                        let card = addressBook.getCardFromProperty("TBSYNCID", id, true);                    
                                        card.setProperty("X-DAV-ETAG", etag.textContent);
                                        card.setProperty("X-DAV-VCARD", data.textContent);
                                        card.setProperty("DisplayName", vcard.fn);
                                        tbSync.db.addItemToChangeLog(syncdata.targetId, id, "modified_by_server");
                                        addressBook.modifyCard(card);
                                        });
                                    break;
                            }
                        }
                    }
                }
            }

            //FIND DELETES: loop over current addressbook and check each local card if still exists on the server
            let vCardsDeletedOnServer = Components.classes["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
            cards = addressBook.childCards;
            while (true) {
                let more = false;
                try { more = cards.hasMoreElements() } catch (ex) {} 
                if (!more) break;

                let card = cards.getNext().QueryInterface(Components.interfaces.nsIAbCard);
                let id = card.getProperty("TBSYNCID","");
                if (id && !vCardsFoundOnServer.includes(id) && tbSync.db.getItemStatusFromChangeLog(syncdata.targetId, id) != "added_by_user") {
                    //delete request from server
                    vCardsDeletedOnServer.appendElement(card, "");
                }
            }
            if (vCardsDeletedOnServer.length > 0) {
                syncdata.todo = vCardsDeletedOnServer.length;
                syncdata.done = 0;
                tbSync.setSyncState("eval.response.remotechanges", syncdata.account, syncdata.folderID);
                addressBook.deleteCards(vCardsDeletedOnServer);           
            }
            
            
            //update ctag and token (if there is one)
            tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "ctag", ctag);                        
            if (token) tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "token", token);

            //ctag did change
            return true;
        } else {        

            //ctag did not change
            return false;
        }
        
    }),
    
}
