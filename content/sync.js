/*
/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

var sync = {

    failed: function (msg = "", details = "") {
        let e = new Error();
        e.name = "dav4tbsync";
        e.message = msg.toString();
        e.details = details;
        return e;
    },

    succeeded: function (msg = "") {
        let e = new Error();
        e.name = "dav4tbsync";
        e.message = "OK";
        if (msg) e.message = e.message + "." + msg;
        e.details = "";
        return e;
    },





    folderList: async function (syncdata) {
        //Method description: http://sabre.io/dav/building-a-caldav-client/
        try {
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

            //get server urls from account setup - update urls of serviceproviders
            let serviceprovider = tbSync.db.getAccountSetting(syncdata.account, "serviceprovider");
            if (dav.serviceproviders.hasOwnProperty(serviceprovider)) {
                tbSync.db.setAccountSetting(syncdata.account, "host", dav.serviceproviders[serviceprovider].caldav.replace("https://","").replace("http://",""));
                tbSync.db.setAccountSetting(syncdata.account, "host2", dav.serviceproviders[serviceprovider].carddav.replace("https://","").replace("http://",""));
            }

            let davjobs = {
                cal : {server: tbSync.db.getAccountSetting(syncdata.account, "host")},
                card : {server: tbSync.db.getAccountSetting(syncdata.account, "host2")},
            };
            
            for (let job in davjobs) {
                if (!davjobs[job].server) continue;
                
                //sync states are only printed while the account state is "syncing" to inform user about sync process (it is not stored in DB, just in syncdata)
                //example state "getfolders" to get folder information from server
                //if you send a request to a server and thus have to wait for answer, use a "send." syncstate, which will give visual feedback to the user,
                //that we are waiting for an answer with timeout countdown

                let home = [];
                let own = [];
                let principal = null;

                //add connection to syncdata
                syncdata.connection = new dav.network.Connection(syncdata);

                syncdata.setSyncState("send.getfolders");
                {
                    //split server into fqdn and path
                    let parts = davjobs[job].server.split("/").filter(i => i != "");

                    syncdata.connection.fqdn = parts.splice(0,1).toString();
                    syncdata.connection.type = job;
                    
                    let path = "/" + parts.join("/");                
                    let response = await dav.network.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:current-user-principal /></d:prop></d:propfind>", path , "PROPFIND", syncdata.connection, {"Depth": "0", "Prefer": "return-minimal"});

                    syncdata.setSyncState("eval.folders");
                    if (response && response.multi) principal = dav.tools.getNodeTextContentFromMultiResponse(response, [["d","prop"], ["d","current-user-principal"], ["d","href"]]);
                }

                //principal now contains something like "/remote.php/carddav/principals/john.bieling/"
                // -> get home/root of storage
                if (principal !== null) {
                    syncdata.setSyncState("send.getfolders");
                    
                    let homeset = (job == "cal")
                                            ? "calendar-home-set"
                                            : "addressbook-home-set";

                    let request = (job == "cal")
                                            ? "<d:propfind "+dav.tools.xmlns(["d", "cal", "cs"])+"><d:prop><cal:" + homeset + " /><cs:calendar-proxy-write-for /><cs:calendar-proxy-read-for /><d:group-membership /></d:prop></d:propfind>"
                                            : "<d:propfind "+dav.tools.xmlns(["d", "card"])+"><d:prop><card:" + homeset + " /><d:group-membership /></d:prop></d:propfind>";

                    let response = await dav.network.sendRequest(request, principal, "PROPFIND", syncdata.connection, {"Depth": "0", "Prefer": "return-minimal"});

                    syncdata.setSyncState("eval.folders");
                    own = dav.tools.getNodesTextContentFromMultiResponse(response, [["d","prop"], [job, homeset ], ["d","href"]], principal);
                    home = own.concat(dav.tools.getNodesTextContentFromMultiResponse(response, [["d","prop"], ["cs", "calendar-proxy-read-for" ], ["d","href"]], principal));
                    home = home.concat(dav.tools.getNodesTextContentFromMultiResponse(response, [["d","prop"], ["cs", "calendar-proxy-write-for" ], ["d","href"]], principal));

                    //Any groups we need to find? Only diving one level at the moment, 
                    let g = dav.tools.getNodesTextContentFromMultiResponse(response, [["d","prop"], ["d", "group-membership" ], ["d","href"]], principal);
                    for (let gc=0; gc < g.length; gc++) {
                        //SOGo reports a 403 if I request the provided resource, also since we do not dive, remove the request for group-membership                    
                        response = await dav.network.sendRequest(request.replace("<d:group-membership />",""), g[gc], "PROPFIND", syncdata.connection, {"Depth": "0", "Prefer": "return-minimal"}, {softfail: [403, 404]});
                        if (response && response.softerror) {
                            continue;
                        }		    
                        home = home.concat(dav.tools.getNodesTextContentFromMultiResponse(response, [["d","prop"], [job, homeset ], ["d","href"]], g[gc]));
                    }

                    //calendar-proxy and group-membership could have returned the same values, make the homeset unique
                    home = home.filter((v,i,a) => a.indexOf(v) == i);
                } else {
                    throw dav.sync.failed(job+"davservernotfound", davjobs[job].server)
                }

                //home now contains something like /remote.php/caldav/calendars/john.bieling/
                // -> get all resources
                if (home.length > 0) {
                    for (let h=0; h < home.length; h++) {
                        syncdata.setSyncState("send.getfolders");
                        let request = (job == "cal")
                                                ? "<d:propfind "+dav.tools.xmlns(["d","apple","cs"])+"><d:prop><d:current-user-privilege-set/><d:resourcetype /><d:displayname /><apple:calendar-color/><cs:source/></d:prop></d:propfind>"
                                                : "<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:current-user-privilege-set/><d:resourcetype /><d:displayname /></d:prop></d:propfind>";

                        //some servers report to have calendar-proxy-read but return a 404 when that gets actually queried
                        let response = await dav.network.sendRequest(request, home[h], "PROPFIND", syncdata.connection, {"Depth": "1", "Prefer": "return-minimal"}, {softfail: [403, 404]});
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
                            let name = tbSync.tools.getLocalizedMessage("defaultname." +  ((job == "cal") ? "calendar" : "contacts") , "dav");
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
                                //we assume the folder has the same fqdn as the homeset, otherwise the folderID must contain the full URL and the fqdn is ignored
                                newFolder.fqdn = syncdata.connection.fqdn;
                        
                                //if there is a cached version of this folderID, addFolder will merge all persistent settings - all other settings not defined here will be set to their defaults
                                tbSync.db.addFolder(syncdata.account, newFolder);
                            } else {
                                //Update name & color
                                tbSync.db.setFolderSetting(syncdata.account, href, "name", name);
                                tbSync.db.setFolderSetting(syncdata.account, href, "fqdn", syncdata.connection.fqdn);
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
                                if (tbSync.lightning.isAvailable() && folder && folder.target) {
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
                    tbSync.core.takeTargetOffline("dav", folders[unhandledFolders[t][i]], " [deleted on server]");
                }
            }
        } catch (e) {
            if (e.name == "dav4tbsync") {
                syncdata.setSyncStatus(e.message, e.details);
            } else {
                syncdata.setSyncStatus("JavaScriptError", e.message + "\n\n" + e.stack);
                Components.utils.reportError(e);
            }
        }
    },






    folder: async function (syncdata) {
        try {
            
            //add connection data to syncdata
            syncdata.connection = new dav.network.Connection(syncdata);

            switch (syncdata.connection.type) {
                case "carddav":
                    {
                        // check SyncTarget
                        if (!tbSync.addressbook.checkAddressbook(syncdata)) {
                            //could not create target
                            throw dav.sync.failed("notargets");
                        }

                        await dav.sync.singleFolder(syncdata);
                    }
                    break;

                case "caldav":
                case "ics":
                    {
                        // skip if lightning is not installed
                        if (tbSync.lightning.isAvailable() == false) {
                            throw dav.sync.failed("nolightning");
                        }

                        // check SyncTarget
                        if (!tbSync.lightning.checkCalender(syncdata)) {
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
            if (e.name == "dav4tbsync") {
                syncdata.setSyncStatus(e.message, e.details);
            } else {
                Components.utils.reportError(e);
                syncdata.setSyncStatus("JavaScriptError", e.message + "\n\n" + e.stack);
                //abort sync of other folders on javascript error
                return false;
            }
        }
        return true;
    },


    singleFolder: async function (syncdata)  {
        let downloadonly = (syncdata.getFolderSetting("downloadonly") == "1");
        
        await dav.sync.remoteChanges(syncdata);
        let numOfLocalChanges = await dav.sync.localChanges(syncdata);

        //revert all local changes on permission error by doing a clean sync
        if (numOfLocalChanges < 0) {
            dav.onResetTarget(syncdata);
            await dav.sync.remoteChanges(syncdata);

            if (!downloadonly) throw dav.sync.failed("info.restored");
        } else if (numOfLocalChanges > 0){
            //we will get back our own changes and can store etags and vcards and also get a clean ctag/token
            await dav.sync.remoteChanges(syncdata);
        }

        //always finish sync by throwing failed or succeeded
        throw dav.sync.succeeded();
    },










    remoteChanges: async function (syncdata) {
        //Do we have a sync token? No? -> Initial Sync (or WebDAV sync not supported) / Yes? -> Get updates only (token only present if WebDAV sync is suported)
        let token = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "token");
        if (token) {
            //update via token sync
            let tokenSyncSucceeded = await dav.sync.remoteChangesByTOKEN(syncdata);
            if (tokenSyncSucceeded) return;

            //token sync failed, reset ctag and token and do a full sync
            dav.onResetTarget(syncdata);
        }

        //Either token sync did not work or there is no token (initial sync)
        //loop until ctag is the same before and after polling data (sane start condition)
        let maxloops = 20;
        for (let i=0; i <= maxloops; i++) {
                if (i == maxloops)
                    throw dav.sync.failed("could-not-get-stable-ctag");

                let ctagChanged = await dav.sync.remoteChangesByCTAG(syncdata);
                if (!ctagChanged) break;
        }
    },

    remoteChangesByTOKEN: async function (syncdata) {
        syncdata.todo = 0;
        syncdata.done = 0;

        let token = tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "token");
        syncdata.setSyncState("send.request.remotechanges");
        let cards = await dav.network.sendRequest("<d:sync-collection "+dav.tools.xmlns(["d"])+"><d:sync-token>"+token+"</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>", syncdata.folderID, "REPORT", syncdata.connection, {}, {softfail: [415,403]});

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

        let addressBook = MailServices.ab.getDirectory(syncdata.getFolderSetting("target"));

        let vCardsDeletedOnServer = new dav.tools.deleteCardsContainer(dav.prefSettings.getIntPref("maxitems"));
        let vCardsChangedOnServer = {};

        for (let c=0; c < cards.multi.length; c++) {
            let id = cards.multi[c].href;
            if (id !==null) {
                //valid
                let card = tbSync.addressbook.getCardFromProperty(addressBook, "TBSYNCID", id);
                if (cards.multi[c].status == "200") {
                    //MOD or ADD
                    let etag = dav.tools.evaluateNode(cards.multi[c].node, [["d","prop"], ["d","getetag"]]);
                    if (!card) {
                        //if the user deleted this card (not yet send to server), do not add it again
                        if (tbSync.db.getItemStatusFromChangeLog(syncdata.getFolderSetting("target"), id) != "deleted_by_user")  {
                            syncdata.todo++;
                            vCardsChangedOnServer[id] = "ADD"; 
                        }
                    } else if (etag.textContent != tbSync.addressbook.getPropertyOfCard(card, "X-DAV-ETAG")) {
                        syncdata.todo++;
                        vCardsChangedOnServer[id] = "MOD"; 
                    }
                } else if (cards.multi[c].responsestatus == "404" && card) {
                    //DEL
                    syncdata.todo++;
                    vCardsDeletedOnServer.appendElement(card, false);
                    tbSync.db.addItemToChangeLog(syncdata.getFolderSetting("target"), id, "deleted_by_server");
                } else {
                    //We received something, that is not a DEL, MOD or ADD
                    tbSync.errorlog.add("warning", syncdata, "Unknown XML", JSON.stringify(cards.multi[c]));
                }
            }
        }

        //download all cards added to vCardsChangedOnServer and process changes
        await dav.sync.multiget(addressBook, vCardsChangedOnServer, syncdata);

        //delete all contacts added to vCardsDeletedOnServer
        await dav.sync.deleteContacts (addressBook, vCardsDeletedOnServer, syncdata);

        //update token
        tbSync.db.setFolderSetting(syncdata.account, syncdata.folderID, "token", tokenNode.textContent);

        return true;
    },

    remoteChangesByCTAG: async function (syncdata) {
        syncdata.todo = 0;
        syncdata.done = 0;

        //Request ctag and token
        syncdata.setSyncState("send.request.remotechanges");
        let response = await dav.network.sendRequest("<d:propfind "+dav.tools.xmlns(["d", "cs"])+"><d:prop><cs:getctag /><d:sync-token /></d:prop></d:propfind>", syncdata.folderID, "PROPFIND", syncdata.connection, {"Depth": "0"});

        syncdata.setSyncState("eval.response.remotechanges");
        let ctag = dav.tools.getNodeTextContentFromMultiResponse(response, [["d","prop"], ["cs", "getctag"]], syncdata.folderID);
        let token = dav.tools.getNodeTextContentFromMultiResponse(response, [["d","prop"], ["d", "sync-token"]], syncdata.folderID);

        //if CTAG changed, we need to sync everything and compare
        if (ctag === null || ctag != tbSync.db.getFolderSetting(syncdata.account, syncdata.folderID, "ctag")) {
            let vCardsFoundOnServer = [];
            let vCardsChangedOnServer = {};

            let addressBook = MailServices.ab.getDirectory(syncdata.getFolderSetting("target"));

            //get etags of all cards on server and find the changed cards
            syncdata.setSyncState("send.request.remotechanges");
            let cards = await dav.network.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:getetag /></d:prop></d:propfind>", syncdata.folderID, "PROPFIND", syncdata.connection, {"Depth": "1", "Prefer": "return-minimal"});
            
            //to test other impl
            //let cards = await dav.network.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:getetag /></d:prop></d:propfind>", syncdata.folderID, "PROPFIND", syncdata.connection, {"Depth": "1", "Prefer": "return-minimal"}, {softfail: []}, false);

            //this is the same request, but includes getcontenttype, do we need it? icloud send contacts without
            //let cards = await dav.network.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:getetag /><d:getcontenttype /></d:prop></d:propfind>", syncdata.folderID, "PROPFIND", syncdata.connection, {"Depth": "1", "Prefer": "return-minimal"});

            //play with filters and limits for synology
            /*
            let additional = "<card:limit><card:nresults>10</card:nresults></card:limit>";
            additional += "<card:filter test='anyof'>";
                additional += "<card:prop-filter name='FN'>";
                    additional += "<card:text-match negate-condition='yes' match-type='equals'>bogusxy</card:text-match>";
                additional += "</card:prop-filter>";
            additional += "</card:filter>";*/
        
            //addressbook-query does not work on older servers (zimbra)
            //let cards = await dav.network.sendRequest("<card:addressbook-query "+dav.tools.xmlns(["d", "card"])+"><d:prop><d:getetag /></d:prop></card:addressbook-query>", syncdata.folderID, "REPORT", syncdata.connection, {"Depth": "1", "Prefer": "return-minimal"});

            syncdata.setSyncState("eval.response.remotechanges");
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
                    let card = tbSync.addressbook.getCardFromProperty(addressBook, "TBSYNCID", id);
                    if (!card) {
                        //if the user deleted this card (not yet send to server), do not add it again
                        if (tbSync.db.getItemStatusFromChangeLog(syncdata.getFolderSetting("target"), id) != "deleted_by_user") {
                            syncdata.todo++;
                            vCardsChangedOnServer[id] = "ADD"; 
                        }
                    } else if (etag.textContent != tbSync.addressbook.getPropertyOfCard(card, "X-DAV-ETAG")) {
                        syncdata.todo++;
                        vCardsChangedOnServer[id] = "MOD"; 
                    }
                }
            }

            //FIND DELETES: loop over current addressbook and check each local card if it still exists on the server
            let vCardsDeletedOnServer =  new dav.tools.deleteCardsContainer(dav.prefSettings.getIntPref("maxitems"));
            cards = addressBook.childCards;
            while (true) {
                let more = false;
                try { more = cards.hasMoreElements() } catch (ex) {}
                if (!more) break;

                let card = cards.getNext().QueryInterface(Components.interfaces.nsIAbCard);
                let id = card.getProperty("TBSYNCID","");
                if (id && !vCardsFoundOnServer.includes(id) && tbSync.db.getItemStatusFromChangeLog(syncdata.getFolderSetting("target"), id) != "added_by_user") {
                    //delete request from server
                    syncdata.todo++;
                    vCardsDeletedOnServer.appendElement(card, false);
                    tbSync.db.addItemToChangeLog(syncdata.getFolderSetting("target"), id, "deleted_by_server");
                }
            }


            //download all cards added to vCardsChangedOnServer and process changes
            await dav.sync.multiget(addressBook, vCardsChangedOnServer, syncdata);

            //delete all contacts added to vCardsDeletedOnServer
            await dav.sync.deleteContacts (addressBook, vCardsDeletedOnServer, syncdata);

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

    },



    multiget: async function (addressBook, vCardsChangedOnServer, syncdata) {
        //keep track of found mailing lists and its members
        syncdata.foundMailingListsDuringDownSync = {};
        
        //download all changed cards and process changes
        let cards2catch = Object.keys(vCardsChangedOnServer);
        let maxitems = dav.prefSettings.getIntPref("maxitems");

        for (let i=0; i < cards2catch.length; i+=maxitems) {
            let request = dav.tools.getMultiGetRequest(cards2catch.slice(i, i+maxitems));
            if (request) {
                syncdata.setSyncState("send.request.remotechanges");
                let cards = await dav.network.sendRequest(request, syncdata.folderID, "REPORT", syncdata.connection, {"Depth": "1"});

                syncdata.setSyncState("eval.response.remotechanges");
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
                        //Feedback from users: They want to see the individual count
                        syncdata.setSyncState("eval.response.remotechanges");		
                        await tbSync.tools.sleep(100, false);
                    } else {
                        tbSync.dump("Skipped Card", [id, cards.multi[c].status == "200", etag !== null, data !== null, id !== null, vCardsChangedOnServer.hasOwnProperty(id)].join(", "));
                    }
                }
            }
        }
        //Feedback from users: They want to see the final count
        syncdata.setSyncState("eval.response.remotechanges");		
        await tbSync.tools.sleep(200, false);
    
        let syncGroups = (tbSync.db.getAccountSetting(syncdata.account, "syncGroups") == "1");
        if (syncGroups) {
            //mailinglists (we need to do that at the very end so all member data is avail)
            let listcount = 0;
            for (let mailListCardID in syncdata.foundMailingListsDuringDownSync) {
                if (syncdata.foundMailingListsDuringDownSync.hasOwnProperty(mailListCardID)) {
                    listcount++;
                    let locked = 0;
                    let mailListCard = tbSync.addressbook.getCardFromProperty(addressBook, "TBSYNCID", mailListCardID);
                    let mailListDirectory = MailServices.ab.getDirectory(mailListCard.mailListURI);
                    
                    //smart merge: oCardInfo contains the state during last sync, vCardInfo is the current state
                    //by comparing we can learn, what was added on the server (in new but not in old) and what was deleted (in old but not in new)
                    //when adding, we need to check, if it is already part of local list (added by user as well)
                    //when deleting, we need to check, if it has been deleted already in the local list (deleted by user as well)
                    //all other local changes remain untouched and will be send back to the server as local changes
                     let vCardInfo = dav.tools.getGroupInfoFromCardData(syncdata.foundMailingListsDuringDownSync[mailListCardID].vCardData, addressBook);
                     let oCardInfo = dav.tools.getGroupInfoFromCardData(syncdata.foundMailingListsDuringDownSync[mailListCardID].oCardData, addressBook);
                    
                    let addedMembers = vCardInfo.members.filter(e => !oCardInfo.members.includes(e));
                    let removedMembers = oCardInfo.members.filter(e => !vCardInfo.members.includes(e));
                    
                    //remove requested members from list
                    for (let i=0; i < removedMembers.length; i++) {
                        if (removedMembers[i]) {
                        let card = addressBook.getCardFromProperty("TBSYNCID", removedMembers[i], true);
                            if (card) {
                                let idx = tbSync.addressbook.findIndexOfMailingListMemberWithProperty(mailListDirectory, "TBSYNCID", removedMembers[i]);
                                if (idx != -1) {
                                    tbSync.db.addItemToChangeLog(syncdata.getFolderSetting("target"), removedMembers[i], "locked_by_mailinglist_operations");
                                    locked++;
                                    mailListDirectory.addressLists.removeElementAt(idx);  
                                }                                
                            }
                        }
                    }
                    
                    //add requested members to list (make sure it has an email as long that bug is not fixed in TB!)
                    for (let i=0; i < addedMembers.length; i++) {
                        if (addedMembers[i]) {
                            let card = addressBook.getCardFromProperty("TBSYNCID", addedMembers[i], true);
                            if (card) {
                                let idx = tbSync.addressbook.findIndexOfMailingListMemberWithProperty(mailListDirectory, "TBSYNCID", addedMembers[i]);
                                if (idx == -1) {
                                    tbSync.db.addItemToChangeLog(syncdata.getFolderSetting("target"), addedMembers[i], "locked_by_mailinglist_operations");
                                    locked++;
                                    //fix for bug 1522453
                                    let email = card.getProperty("PrimaryEmail", "");
                                    if (!email) {
                                        let email = Date.now() + "." +listcount + "." + i + "@bug1522453";
                                        card.setProperty("PrimaryEmail", email);
                                        card.setProperty("X-DAV-JSON-Emails", JSON.stringify([{meta: [], value: email}]));
                                        addressBook.modifyCard(card);
                                    }
                                    mailListDirectory.addressLists.appendElement(card, false);
                                }
                            }
                        }
                    }

                    //if at least one member (or the name) has been changed, we need to call 
                    //editMailListToDatabase to update the directory, which will modify all members
                    if (locked > 0 || vCardInfo.name != oCardInfo.name) {
                        tbSync.db.addItemToChangeLog(syncdata.getFolderSetting("target"), mailListCardID, "locked_by_mailinglist_operations");
                        mailListDirectory.dirName = vCardInfo.name;                    
                        //editMailListToDatabase will mod all members of this list, so we need to lock all of them
                        for (let i=0; i < vCardInfo.members.length; i++) {
                            tbSync.db.addItemToChangeLog(syncdata.getFolderSetting("target"), vCardInfo.members[i], "locked_by_mailinglist_operations");
                        }
                        mailListDirectory.editMailListToDatabase(mailListCard);
                    }
                }
            }
        }            
    },

    deleteContacts: async function (addressBook, vCardsDeletedOnServer, syncdata) {
        //the vCardsDeletedOnServer object has a data member (array of nsIMutableArray) and each nsIMutableArray has a maximum size
        //of maxitems, so we can show a progress during delete and not delete all at once
        for (let i=0; i < vCardsDeletedOnServer.data.length; i++) {
            syncdata.done += vCardsDeletedOnServer.data[i].length;
            syncdata.setSyncState("eval.response.remotechanges");
            await tbSync.tools.sleep(200); //we want the user to see, that deletes are happening
            addressBook.deleteCards(vCardsDeletedOnServer.data[i]);
        }
    },




    localChanges: async function (syncdata) {
        //keep track of found mailing lists and its members
        syncdata.foundMailingListsDuringUpSync = {};

        //define how many entries can be send in one request
        let maxitems = dav.prefSettings.getIntPref("maxitems");

        let addressBook = MailServices.ab.getDirectory(syncdata.getFolderSetting("target"));
        let downloadonly = (syncdata.getFolderSetting("downloadonly") == "1");

        let permissionErrors = 0;
        let permissionError = { //keep track of permission errors - preset with downloadonly status to skip sync in that case
            "added_by_user": downloadonly, 
            "modified_by_user": downloadonly, 
            "deleted_by_user": downloadonly
        }; 
        
        let syncGroups = (tbSync.db.getAccountSetting(syncdata.account, "syncGroups") == "1");
        if (syncGroups) {
            //special handling of lists/groups
            //ADD/MOD of the list cards itself is not detectable, we only detect the change of its member cards when membership changes
            //DEL is handled like a normal card, no special handling needed        
            let result = MailServices.ab.getDirectory(addressBook.URI +  "?(or(IsMailList,=,TRUE))").childCards;
            while (result.hasMoreElements()) {
                let mailListCard = result.getNext().QueryInterface(Components.interfaces.nsIAbCard);
                let mailListInfo = dav.tools.getGroupInfoFromList(mailListCard.mailListURI);           

                let mailListCardId = tbSync.addressbook.getPropertyOfCard(mailListCard, "TBSYNCID");
                if (mailListCardId) {
                    //get old data from vCard to find changes
                    let oCardInfo = dav.tools.getGroupInfoFromCardData(dav.vCard.parse(tbSync.addressbook.getPropertyOfCard(mailListCard, "X-DAV-VCARD")), addressBook);            
                    
                    let addedMembers = mailListInfo.members.filter(e => !oCardInfo.members.includes(e));
                    let removedMembers = oCardInfo.members.filter(e => !mailListInfo.members.includes(e));
                    
                    if (oCardInfo.name != mailListInfo.name || addedMembers.length > 0 || removedMembers.length > 0) {
                        tbSync.db.addItemToChangeLog(syncdata.getFolderSetting("target"), mailListCardId, "modified_by_user");
                    }
                } else {
                    //that listcard has no id yet (because the general TbSync addressbook listener cannot catch it)
                    let folder = tbSync.db.getFolder(syncdata.account, syncdata.folderID);
                    mailListCardId = dav.getNewCardID(mailListCard, folder);
                    tbSync.addressbook.setPropertyOfCard (mailListCard, "TBSYNCID", mailListCardId);                
                    tbSync.db.addItemToChangeLog(syncdata.getFolderSetting("target"), mailListCardId, "added_by_user");
                }
                syncdata.foundMailingListsDuringUpSync[mailListCardId] = mailListInfo;
            }
        }
        
        //access changelog to get local modifications (done and todo are used for UI to display progress)
        syncdata.done = 0;
        syncdata.todo = tbSync.db.getItemsFromChangeLog(syncdata.getFolderSetting("target"), 0, "_by_user").length;

        do {
            syncdata.setSyncState("prepare.request.localchanges");

            //get changed items from ChangeLog
            let changes = tbSync.db.getItemsFromChangeLog(syncdata.getFolderSetting("target"), maxitems, "_by_user");
            if (changes == 0)
                break;

            for (let i=0; i<changes.length; i++) {
                switch (changes[i].status) {
                    case "added_by_user":
                    case "modified_by_user":
                        {
                            let isAdding = (changes[i].status == "added_by_user");
                            if (!permissionError[changes[i].status]) { //if this operation failed already, do not retry

                                let card = tbSync.addressbook.getCardFromProperty(addressBook, "TBSYNCID", changes[i].id);
                                if (card) {
                                    if (card.isMailList && !syncGroups)
                                        continue;
                                    
                                    let vcard = card.isMailList
                                                        ? dav.tools.getVCardFromThunderbirdListCard(syncdata, addressBook, card, isAdding)
                                                        : dav.tools.getVCardFromThunderbirdContactCard(syncdata, addressBook, card, isAdding);
                                    let headers = {"Content-Type": "text/vcard; charset=utf-8"};
                                    //if (!isAdding) options["If-Match"] = vcard.etag;

                                    syncdata.setSyncState("send.request.localchanges");
                                    if (isAdding || vcard.modified) {
                                        let response = await dav.network.sendRequest(vcard.data, changes[i].id, "PUT", syncdata.connection, headers, {softfail: [403,405]});

                                        syncdata.setSyncState("eval.response.localchanges");
                                        if (response && response.softerror) {
                                            permissionError[changes[i].status] = true;
                                            tbSync.errorlog.add("warning", syncdata, "missing-permission::" + tbSync.tools.getLocalizedMessage(isAdding ? "acl.add" : "acl.modify", "dav"));
                                        }
                                    }
                                } else {
                                    tbSync.errorlog.add("warning", syncdata, "cardnotfoundbutinchangelog::" + changes[i].id);
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
                                syncdata.setSyncState("send.request.localchanges");
                                let response = await dav.network.sendRequest("", changes[i].id , "DELETE", syncdata.connection, {}, {softfail: [403, 404, 405]});

                                syncdata.setSyncState("eval.response.localchanges");
                                if (response  && response.softerror) {
                                    if (response.softerror != 404) { //we cannot do anything about a 404 on delete, the card has been deleted here and is not avail on server
                                        permissionError[changes[i].status] = true;
                                        tbSync.errorlog.add("warning", syncdata, "missing-permission::" + tbSync.tools.getLocalizedMessage("acl.delete", "dav"));
                                    }
                                }
                            }

                            if (permissionError[changes[i].status]) {
                                tbSync.db.addItemToChangeLog(syncdata.getFolderSetting("target"), changes[i].id, "deleted_by_server");
                                permissionErrors--;                                
                            }
                        }
                        break;
                }

                tbSync.db.removeItemFromChangeLog(syncdata.getFolderSetting("target"), changes[i].id);
                syncdata.done++; //UI feedback
            }


        } while (true);

        //return number of modified cards or the number of permission errors (negativ)
        return (permissionErrors < 0 ? permissionErrors : syncdata.done);
    },


}
