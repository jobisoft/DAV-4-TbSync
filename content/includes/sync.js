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

    finish: function (aStatus = "", msg = "", details = "") {
        let status = TbSync.StatusData.SUCCESS
        switch (aStatus) {
            
            case "":
            case "ok":
                status = TbSync.StatusData.SUCCESS;
                break;
            
            case "info":
                status = TbSync.StatusData.INFO;
                break;
            
            case "resyncAccount":
                status = TbSync.StatusData.ACCOUNT_RERUN;
                break;

            case "resyncFolder":
                status = TbSync.StatusData.FOLDER_RERUN;
                break;
            
            case "warning":
                status = TbSync.StatusData.WARNING;
                break;
            
            case "error":
                status = TbSync.StatusData.ERROR;
                break;

            default:
                console.log("TbSync/DAV: Unknown status <"+aStatus+">");
                status = TbSync.StatusData.ERROR;
                break;
        }
        
        let e = new Error(); 
        e.name = "dav4tbsync";
        e.message = status.toUpperCase() + ": " + msg.toString() + " (" + details.toString() + ")";
        e.statusData = new TbSync.StatusData(status, msg.toString(), details.toString());        
        return e; 
    }, 

    prefSettings: Services.prefs.getBranch("extensions.dav4tbsync."),

    ns: {
        d: "DAV:",
        cal: "urn:ietf:params:xml:ns:caldav" ,
        card: "urn:ietf:params:xml:ns:carddav" ,
        cs: "http://calendarserver.org/ns/",
        s: "http://sabredav.org/ns",
        apple: "http://apple.com/ns/ical/"
    },

    serviceproviders: {
        "fruux" : {revision: 1, icon: "fruux", caldav: "https://dav.fruux.com", carddav: "https://dav.fruux.com"},
        "mbo" : {revision: 1, icon: "mbo", caldav: "caldav6764://mailbox.org", carddav: "carddav6764://mailbox.org"},
        "icloud" : {revision: 1, icon: "icloud", caldav: "https://caldav.icloud.com", carddav: "https://contacts.icloud.com"},
        "google" : {revision: 1, icon: "google", caldav: "https://apidata.googleusercontent.com/caldav/v2/", carddav: "https://www.googleapis.com/.well-known/carddav"},
        "gmx.net" : {revision: 1, icon: "gmx", caldav: "caldav6764://gmx.net", carddav: "carddav6764://gmx.net"},
        "gmx.com" : {revision: 1, icon: "gmx", caldav: "caldav6764://gmx.com", carddav: "carddav6764://gmx.com"},
        "posteo" : {revision: 1, icon: "posteo", caldav: "https://posteo.de:8443", carddav: "posteo.de:8843"},
        "web.de" : {revision: 1, icon: "web", caldav: "caldav6764://web.de", carddav: "carddav6764://web.de"},
        "yahoo" : {revision: 1, icon: "yahoo", caldav: "caldav6764://yahoo.com", carddav: "carddav6764://yahoo.com"},
    },

    onChange(abItem) {
        if (!this._syncOnChangeTimers)
            this._syncOnChangeTimers = {};
            
        this._syncOnChangeTimers[abItem.abDirectory.UID] = {};
        this._syncOnChangeTimers[abItem.abDirectory.UID].timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
        this._syncOnChangeTimers[abItem.abDirectory.UID].event = {
            notify: function(timer) {
                // if account is syncing, re-schedule
                // if folder got synced after the start time (due to re-scheduling) abort
                console.log("DONE: "+ abItem.abDirectory.UID);
            }
        }
        
        this._syncOnChangeTimers[abItem.abDirectory.UID].timer.initWithCallback(
            this._syncOnChangeTimers[abItem.abDirectory.UID].event, 
            2000, 
            Components.interfaces.nsITimer.TYPE_ONE_SHOT);
    },

    resetFolderSyncInfo : function (folderData) {
        folderData.resetFolderProperty("ctag");
        folderData.resetFolderProperty("token");
        folderData.setFolderProperty("createdWithProviderVersion", folderData.accountData.providerData.getVersion());
    },
    
    folderList: async function (syncData) {
        //Method description: http://sabre.io/dav/building-a-caldav-client/
        //get all folders currently known
        let folderTypes = ["caldav", "carddav", "ics"];
        let unhandledFolders = {};
        for (let type of folderTypes) {
            unhandledFolders[type] = [];
        }

        
        let folders = syncData.accountData.getAllFolders();
        for (let folder of folders) {
            //just in case
            if (!unhandledFolders.hasOwnProperty(folder.getFolderProperty("type"))) {
                unhandledFolders[folder.getFolderProperty("type")] = [];
            }
            unhandledFolders[folder.getFolderProperty("type")].push(folder);
        }

        // refresh urls of service provider, if they have been updated
        let serviceprovider = syncData.accountData.getAccountProperty("serviceprovider");
        let serviceproviderRevision = syncData.accountData.getAccountProperty("serviceproviderRevision");
        if (dav.sync.serviceproviders.hasOwnProperty(serviceprovider) && serviceproviderRevision != dav.sync.serviceproviders[serviceprovider].revision) {            
            TbSync.eventlog.add("info", syncData.eventLogInfo, "updatingServiceProvider", serviceprovider);
            syncData.accountData.setAccountProperty("serviceproviderRevision", dav.sync.serviceproviders[serviceprovider].revision);
            syncData.accountData.resetAccountProperty("calDavPrincipal");
            syncData.accountData.resetAccountProperty("cardDavPrincipal");
            syncData.accountData.setAccountProperty("calDavHost", dav.sync.serviceproviders[serviceprovider].caldav);
            syncData.accountData.setAccountProperty("cardDavHost", dav.sync.serviceproviders[serviceprovider].carddav);
        }

        let davjobs = {
            cal : {server: syncData.accountData.getAccountProperty("calDavHost")},
            card : {server: syncData.accountData.getAccountProperty("cardDavHost")},
        };
        
        for (let job in davjobs) {
            if (!davjobs[job].server) continue;
            
            // SOGo needs some special handling for shared addressbooks. We detect it by having SOGo/dav in the url.
            let isSogo = davjobs[job].server.includes("/SOGo/dav");

            //sync states are only printed while the account state is "syncing" to inform user about sync process (it is not stored in DB, just in syncData)
            //example state "getfolders" to get folder information from server
            //if you send a request to a server and thus have to wait for answer, use a "send." syncstate, which will give visual feedback to the user,
            //that we are waiting for an answer with timeout countdown

            let home = [];
            let own = [];

            // migration code for http setting, we might keep it as a fallback, if user removed the http:// scheme from the url in the settings
            if (!dav.network.startsWithScheme(davjobs[job].server)) {
                davjobs[job].server = "http" + (syncData.accountData.getAccountProperty("https") ? "s" : "") + "://" + davjobs[job].server;
                syncData.accountData.setAccountProperty(job + "DavHost", davjobs[job].server);
            }
            
            //add connection to syncData
            syncData.connectionData = new dav.network.ConnectionData(syncData);
            
            //only do that, if a new calendar has been enabled
            TbSync.network.resetContainerForUser(syncData.connectionData.username);

            syncData.setSyncState("send.getfolders");
            let principal = syncData.accountData.getAccountProperty(job + "DavPrincipal"); // defaults to null
            if (principal === null) {
          
                let response = await dav.network.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:current-user-principal /></d:prop></d:propfind>", davjobs[job].server , "PROPFIND", syncData.connectionData, {"Depth": "0", "Prefer": "return=minimal"});
                syncData.setSyncState("eval.folders");

                // keep track of permanent redirects for the server URL
                if (response && response.permanentlyRedirectedUrl) {
                    syncData.accountData.setAccountProperty(job + "DavHost", response.permanentlyRedirectedUrl)
                }

                // store dav options send by server
                if (response && response.davOptions) {
                    syncData.accountData.setAccountProperty(job + "DavOptions", response.davOptions.split(",").map(e => e.trim())); 
                }
                
                // allow 404 because iCloud sends it on valid answer (yeah!)
                if (response && response.multi) {
                    principal = dav.tools.getNodeTextContentFromMultiResponse(response, [["d","prop"], ["d","current-user-principal"], ["d","href"]], null, ["200","404"]);
                }
            }

            //principal now contains something like "/remote.php/carddav/principals/john.bieling/"
            //principal can also be an absolute url
            // -> get home/root of storage
            if (principal !== null) {
                syncData.setSyncState("send.getfolders");
                
                let options = syncData.accountData.getAccountProperty(job + "DavOptions");
                
                let homeset = (job == "cal")
                                        ? "calendar-home-set"
                                        : "addressbook-home-set";

                let request = "<d:propfind "+dav.tools.xmlns(["d", job, "cs"])+"><d:prop><"+job+":" + homeset + " />"
                                            + (job == "cal" && options.includes("calendar-proxy") ? "<cs:calendar-proxy-write-for /><cs:calendar-proxy-read-for />" : "") 
                                            + "<d:group-membership />"
                                            + "</d:prop></d:propfind>";

                let response = await dav.network.sendRequest(request, principal, "PROPFIND", syncData.connectionData, {"Depth": "0", "Prefer": "return=minimal"});
                syncData.setSyncState("eval.folders");

                // keep track of permanent redirects for the principal URL
                if (response && response.permanentlyRedirectedUrl) {
                    principal = response.permanentlyRedirectedUrl;
                }
                
                own = dav.tools.getNodesTextContentFromMultiResponse(response, [["d","prop"], [job, homeset ], ["d","href"]], principal);
                home = own.concat(dav.tools.getNodesTextContentFromMultiResponse(response, [["d","prop"], ["cs", "calendar-proxy-read-for" ], ["d","href"]], principal));
                home = home.concat(dav.tools.getNodesTextContentFromMultiResponse(response, [["d","prop"], ["cs", "calendar-proxy-write-for" ], ["d","href"]], principal));

                //Any groups we need to find? Only diving one level at the moment, 
                let g = dav.tools.getNodesTextContentFromMultiResponse(response, [["d","prop"], ["d", "group-membership" ], ["d","href"]], principal);
                for (let gc=0; gc < g.length; gc++) {
                    //SOGo reports a 403 if I request the provided resource, also since we do not dive, remove the request for group-membership                    
                    response = await dav.network.sendRequest(request.replace("<d:group-membership />",""), g[gc], "PROPFIND", syncData.connectionData, {"Depth": "0", "Prefer": "return=minimal"}, {softfail: [403, 404]});
                    if (response && response.softerror) {
                        continue;
                    }		    
                    home = home.concat(dav.tools.getNodesTextContentFromMultiResponse(response, [["d","prop"], [job, homeset ], ["d","href"]], g[gc]));
                }

                //calendar-proxy and group-membership could have returned the same values, make the homeset unique
                home = home.filter((v,i,a) => a.indexOf(v) == i);
            } else {
                // do not throw here, but log the error and skip this server
                TbSync.eventlog.add("error", syncData.eventLogInfo, job+"davservernotfound", davjobs[job].server);
            }

            //home now contains something like /remote.php/caldav/calendars/john.bieling/
            // -> get all resources
            if (home.length > 0) {
                // the used principal returned valid resources, store/update it
                // as the principal is being used as a starting point, it must be stored as absolute url
                syncData.accountData.setAccountProperty(job + "DavPrincipal", dav.network.startsWithScheme(principal) 
                    ? principal 
                    : "http" + (syncData.connectionData.https ? "s" : "") + "://" + syncData.connectionData.fqdn + principal);

                for (let h=0; h < home.length; h++) {
                    syncData.setSyncState("send.getfolders");
                    let request = (job == "cal")
                                            ? "<d:propfind "+dav.tools.xmlns(["d","apple","cs"])+"><d:prop><d:current-user-privilege-set/><d:resourcetype /><d:displayname /><apple:calendar-color/><cs:source/></d:prop></d:propfind>"
                                            : "<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:current-user-privilege-set/><d:resourcetype /><d:displayname /></d:prop></d:propfind>";

                    //some servers report to have calendar-proxy-read but return a 404 when that gets actually queried
                    let response = await dav.network.sendRequest(request, home[h], "PROPFIND", syncData.connectionData, {"Depth": "1", "Prefer": "return=minimal"}, {softfail: [403, 404]});
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
                        
                        //get ACL (grant read rights per default, if it is SOGo, as they do not send that permission)
                        let acl = isSogo ? 0x1 : 0;

                        let privilegNode = dav.tools.evaluateNode(response.multi[r].node, [["d","prop"], ["d","current-user-privilege-set"]]);
                        if (privilegNode) {
                            if (privilegNode.getElementsByTagNameNS(dav.sync.ns.d, "all").length > 0) { 
                                acl = 0xF; //read=1, mod=2, create=4, delete=8 
                            } else {
                                // check for individual write permissions
                                if (privilegNode.getElementsByTagNameNS(dav.sync.ns.d, "write").length > 0) {
                                    acl = 0xF; 
                                } else {
                                    if (privilegNode.getElementsByTagNameNS(dav.sync.ns.d, "write-content").length > 0) acl |= 0x2;
                                    if (privilegNode.getElementsByTagNameNS(dav.sync.ns.d, "bind").length > 0) acl |= 0x4;
                                    if (privilegNode.getElementsByTagNameNS(dav.sync.ns.d, "unbind").length > 0) acl |= 0x8;
                                }
                                
                                // check for read permission (implying read if any write is given)
                                if (privilegNode.getElementsByTagNameNS(dav.sync.ns.d, "read").length > 0 || acl != 0) acl |= 0x1;
                            }
                        }
                        
                        //ignore this resource, if no read access
                        if ((acl & 0x1) == 0) continue;

                        let href = response.multi[r].href;
                        if (resourcetype == "ics") href =  dav.tools.evaluateNode(response.multi[r].node, [["d","prop"], ["cs","source"], ["d","href"]]).textContent;
                        
                        let name_node = dav.tools.evaluateNode(response.multi[r].node, [["d","prop"], ["d","displayname"]]);
                        let name = TbSync.getString("defaultname." +  ((job == "cal") ? "calendar" : "contacts") , "dav");
                        if (name_node != null) {
                            name = name_node.textContent;
                        }
                        let color = dav.tools.evaluateNode(response.multi[r].node, [["d","prop"], ["apple","calendar-color"]]);

                        //remove found folder from list of unhandled folders
                        unhandledFolders[resourcetype] = unhandledFolders[resourcetype].filter(item => item.getFolderProperty("href") !== href);

                        
                        // interaction with TbSync
                        // do we have a folder for that href?
                        let folderData = syncData.accountData.getFolder("href", href);
                        if (!folderData) {
                            // create a new folder entry
                            folderData = syncData.accountData.createNewFolder();
                            // this MUST be set to either "addressbook" or "calendar" to use the standard target support, or any other value, which 
                            // requires a corresponding targets implementation by this provider
                            folderData.setFolderProperty("targetType", (job == "card") ? "addressbook" : "calendar");
                            
                            folderData.setFolderProperty("href", href);
                            folderData.setFolderProperty("foldername", name);
                            folderData.setFolderProperty("type", resourcetype);
                            folderData.setFolderProperty("shared", !own.includes(home[h]));
                            folderData.setFolderProperty("acl", acl.toString());
                            folderData.setFolderProperty("downloadonly", (acl == 0x1)); //if any write access is granted, setup as writeable

                            //we assume the folder has the same fqdn as the homeset, otherwise href must contain the full URL and the fqdn is ignored
                            folderData.setFolderProperty("fqdn", syncData.connectionData.fqdn);
                            folderData.setFolderProperty("https", syncData.connectionData.https);
                            
                            //do we have a cached folder?
                            let cachedFolderData = syncData.accountData.getFolderFromCache("href", href);
                            if (cachedFolderData) {
                                // copy fields from cache which we want to re-use
                                folderData.setFolderProperty("targetColor", cachedFolderData.getFolderProperty("targetColor"));
                                folderData.setFolderProperty("targetName", cachedFolderData.getFolderProperty("targetName"));
                                //if we have only READ access, do not restore cached value for downloadonly
                                if (acl > 0x1) folderData.setFolderProperty("downloadonly", cachedFolderData.getFolderProperty("downloadonly"));
                            }
                        } else {
                            //Update name & color
                            folderData.setFolderProperty("foldername", name);
                            folderData.setFolderProperty("fqdn", syncData.connectionData.fqdn);
                            folderData.setFolderProperty("https", syncData.connectionData.https);
                            folderData.setFolderProperty("acl", acl);
                            //if the acl changed from RW to RO we need to update the downloadonly setting
                            if (acl == 0x1) {
                                folderData.setFolderProperty("downloadonly", true);
                            }
                        }

                        // Update color from server (skip if nolightning, no
                        // need to run into error when hasTarget() throws).
                        if (color && job == "cal" && TbSync.lightning.isAvailable()) {
                            color = color.textContent.substring(0,7);
                            folderData.setFolderProperty("targetColor", color);
                            
                            // Do we have to update the calendar?
                            if (folderData.targetData && folderData.targetData.hasTarget()) {
                                try {
                                    let targetCal = await folderData.targetData.getTarget();
                                    targetCal.calendar.setProperty("color", color);
                                } catch (e) {
                                    Components.utils.reportError(e)
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
                //reset stored principal
                syncData.accountData.resetAccountProperty(job + "DavPrincipal");
            }
        }

        // Remove unhandled old folders, (because they no longer exist on the server).
        // Do not delete the targets, but keep them as stale/unconnected elements.
        for (let type of folderTypes) {
            for (let folder of unhandledFolders[type]) {
                folder.remove("[deleted on server]");
            }
        }
    },






    folder: async function (syncData) {
        // add connection data to syncData
        syncData.connectionData = new dav.network.ConnectionData(syncData);

        // add target to syncData (getTarget() will throw "nolightning" if lightning missing)
        let hadTarget;
        try {
            // accessing the target for the first time will check if it is avail and if not will create it (if possible)
            hadTarget = syncData.currentFolderData.targetData.hasTarget();
            syncData.target = await syncData.currentFolderData.targetData.getTarget();
        } catch (e) {
            Components.utils.reportError(e);
            throw dav.sync.finish("warning", e.message);
        }
        
        switch (syncData.currentFolderData.getFolderProperty("type")) {
            case "carddav":
                {
                    await dav.sync.singleFolder(syncData);
                }
                break;

            case "caldav":
            case "ics":
                {
                    // update downloadonly - we do not use TbCalendar (syncData.target) but the underlying lightning calendar obj
                    if (syncData.currentFolderData.getFolderProperty("downloadonly")) syncData.target.calendar.setProperty("readOnly", true);
                    
                    // update username of calendar
                    syncData.target.calendar.setProperty("username", syncData.connectionData.username);
                    
                    //init sync via lightning
                    if (hadTarget) syncData.target.calendar.refresh();

                    throw dav.sync.finish("ok", "managed-by-lightning");
                }
                break;

            default:
                {
                    throw dav.sync.finish("warning", "notsupported");
                }
                break;
        }
    },


    singleFolder: async function (syncData)  {
        let downloadonly = syncData.currentFolderData.getFolderProperty("downloadonly");
        
        // we have to abort sync of this folder, if it is contact, has groupSync enabled and gContactSync is enabled
        let syncGroups = syncData.accountData.getAccountProperty("syncGroups");
        let gContactSync = await AddonManager.getAddonByID("gContactSync@pirules.net") ;
        let contactSync = (syncData.currentFolderData.getFolderProperty("type") == "carddav");
        if (syncGroups && contactSync && gContactSync && gContactSync.isActive) {
            throw dav.sync.finish("warning", "gContactSync");
        }
        
        await dav.sync.remoteChanges(syncData);
        let numOfLocalChanges = await dav.sync.localChanges(syncData);

        //revert all local changes on permission error by doing a clean sync
        if (numOfLocalChanges < 0) {
            dav.sync.resetFolderSyncInfo(syncData.currentFolderData);
            await dav.sync.remoteChanges(syncData);

            if (!downloadonly) throw dav.sync.finish("info", "info.restored");
        } else if (numOfLocalChanges > 0){
            //we will get back our own changes and can store etags and vcards and also get a clean ctag/token
            await dav.sync.remoteChanges(syncData);
        }
    },










    remoteChanges: async function (syncData) {
        //Do we have a sync token? No? -> Initial Sync (or WebDAV sync not supported) / Yes? -> Get updates only (token only present if WebDAV sync is suported)
        let token = syncData.currentFolderData.getFolderProperty("token");
        let isGoogle = (syncData.accountData.getAccountProperty("serviceprovider") == "google");
        if (token && !isGoogle) {
            //update via token sync
            let tokenSyncSucceeded = await dav.sync.remoteChangesByTOKEN(syncData);
            if (tokenSyncSucceeded) return;

            //token sync failed, reset ctag and token and do a full sync
            dav.sync.resetFolderSyncInfo(syncData.currentFolderData);
        }

        //Either token sync did not work or there is no token (initial sync)
        //loop until ctag is the same before and after polling data (sane start condition)
        let maxloops = 20;
        for (let i=0; i <= maxloops; i++) {
                if (i == maxloops)
                    throw dav.sync.finish("warning", "could-not-get-stable-ctag");

                let ctagChanged = await dav.sync.remoteChangesByCTAG(syncData);
                if (!ctagChanged) break;
        }
    },

    remoteChangesByTOKEN: async function (syncData) {
        syncData.progressData.reset();

        let token = syncData.currentFolderData.getFolderProperty("token");
        syncData.setSyncState("send.request.remotechanges");
        let cards = await dav.network.sendRequest("<d:sync-collection "+dav.tools.xmlns(["d"])+"><d:sync-token>"+token+"</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>", syncData.currentFolderData.getFolderProperty("href"), "REPORT", syncData.connectionData, {}, {softfail: [415,403,409]});
        
        //EteSync throws 409 because it does not support sync-token
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

        let vCardsDeletedOnServer = [];
        let vCardsChangedOnServer = {};
        
        let localDeletes = syncData.target.getDeletedItemsFromChangeLog();
        
        let cardsFound = 0;
        for (let c=0; c < cards.multi.length; c++) {
            let id = cards.multi[c].href;
            if (id !==null) {
                //valid
                let card = syncData.target.getItemFromProperty("X-DAV-HREF", id);
                if (cards.multi[c].status == "200") {
                    //MOD or ADD
                    let etag = dav.tools.evaluateNode(cards.multi[c].node, [["d","prop"], ["d","getetag"]]);
                    if (!card) {
                        //if the user deleted this card (not yet send to server), do not add it again
                        if (!localDeletes.includes(id))  { 
                            cardsFound++;
                            vCardsChangedOnServer[id] = "ADD"; 
                        }
                    } else if (etag.textContent != card.getProperty("X-DAV-ETAG")) {
                        cardsFound++;
                        vCardsChangedOnServer[id] = "MOD"; 
                    }
                } else if (cards.multi[c].responsestatus == "404" && card) {
                    //DEL
                    cardsFound++;
                    vCardsDeletedOnServer.push(card);
                } else {
                    //We received something, that is not a DEL, MOD or ADD
                    TbSync.eventlog.add("warning", syncData.eventLogInfo, "Unknown XML", JSON.stringify(cards.multi[c]));
                }
            }
        }

        // reset sync process
        syncData.progressData.reset(0, cardsFound);

        //download all cards added to vCardsChangedOnServer and process changes
        await dav.sync.multiget(syncData, vCardsChangedOnServer);

        //delete all contacts added to vCardsDeletedOnServer
        await dav.sync.deleteContacts (syncData, vCardsDeletedOnServer);

        //update token
        syncData.currentFolderData.setFolderProperty("token", tokenNode.textContent);

        return true;
    },

    remoteChangesByCTAG: async function (syncData) {
        syncData.progressData.reset();

        //Request ctag and token
        syncData.setSyncState("send.request.remotechanges");
        let response = await dav.network.sendRequest("<d:propfind "+dav.tools.xmlns(["d", "cs"])+"><d:prop><cs:getctag /><d:sync-token /></d:prop></d:propfind>", syncData.currentFolderData.getFolderProperty("href"), "PROPFIND", syncData.connectionData, {"Depth": "0"});

        syncData.setSyncState("eval.response.remotechanges");
        let ctag = dav.tools.getNodeTextContentFromMultiResponse(response, [["d","prop"], ["cs", "getctag"]], syncData.currentFolderData.getFolderProperty("href"));
        let token = dav.tools.getNodeTextContentFromMultiResponse(response, [["d","prop"], ["d", "sync-token"]], syncData.currentFolderData.getFolderProperty("href"));

        let localDeletes = syncData.target.getDeletedItemsFromChangeLog();

        //if CTAG changed, we need to sync everything and compare
        if (ctag === null || ctag != syncData.currentFolderData.getFolderProperty("ctag")) {
            let vCardsFoundOnServer = [];
            let vCardsChangedOnServer = {};

            //get etags of all cards on server and find the changed cards
            syncData.setSyncState("send.request.remotechanges");
            let cards = await dav.network.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:getetag /></d:prop></d:propfind>", syncData.currentFolderData.getFolderProperty("href"), "PROPFIND", syncData.connectionData, {"Depth": "1", "Prefer": "return=minimal"});
            
            //to test other impl
            //let cards = await dav.network.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:getetag /></d:prop></d:propfind>", syncData.currentFolderData.getFolderProperty("href"), "PROPFIND", syncData.connectionData, {"Depth": "1", "Prefer": "return=minimal"}, {softfail: []}, false);

            //this is the same request, but includes getcontenttype, do we need it? icloud send contacts without
            //let cards = await dav.network.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:getetag /><d:getcontenttype /></d:prop></d:propfind>", syncData.currentFolderData.getFolderProperty("href"), "PROPFIND", syncData.connectionData, {"Depth": "1", "Prefer": "return=minimal"});

            //play with filters and limits for synology
            /*
            let additional = "<card:limit><card:nresults>10</card:nresults></card:limit>";
            additional += "<card:filter test='anyof'>";
                additional += "<card:prop-filter name='FN'>";
                    additional += "<card:text-match negate-condition='yes' match-type='equals'>bogusxy</card:text-match>";
                additional += "</card:prop-filter>";
            additional += "</card:filter>";*/
        
            //addressbook-query does not work on older servers (zimbra)
            //let cards = await dav.network.sendRequest("<card:addressbook-query "+dav.tools.xmlns(["d", "card"])+"><d:prop><d:getetag /></d:prop></card:addressbook-query>", syncData.currentFolderData.getFolderProperty("href"), "REPORT", syncData.connectionData, {"Depth": "1", "Prefer": "return=minimal"});

            syncData.setSyncState("eval.response.remotechanges");
            let cardsFound = 0;
            for (let c=0; cards.multi && c < cards.multi.length; c++) {
                let id =  cards.multi[c].href;
                if (id == syncData.currentFolderData.getFolderProperty("href")) {
                    //some servers (Radicale) report the folder itself and a querry to that would return everything again
                    continue;
                }
                let etag = dav.tools.evaluateNode(cards.multi[c].node, [["d","prop"], ["d","getetag"]]);

                //ctype is currently not used, because iCloud does not send one and sabre/dav documentation is not checking ctype 
                //let ctype = dav.tools.evaluateNode(cards.multi[c].node, [["d","prop"], ["d","getcontenttype"]]);

                if (cards.multi[c].status == "200" && etag !== null && id !== null /* && ctype !== null */) { //we do not actually check the content of ctype - but why do we request it? iCloud seems to send cards without ctype
                    vCardsFoundOnServer.push(id);
                    let card = syncData.target.getItemFromProperty("X-DAV-HREF", id);
                    if (!card) {
                        //if the user deleted this card (not yet send to server), do not add it again
                        if (!localDeletes.includes(id)) {
                            cardsFound++;
                            vCardsChangedOnServer[id] = "ADD"; 
                        }
                    } else if (etag.textContent != card.getProperty("X-DAV-ETAG")) {
                        cardsFound++;
                        vCardsChangedOnServer[id] = "MOD"; 
                    }
                }
            }

            //FIND DELETES: loop over current addressbook and check each local card if it still exists on the server
            let vCardsDeletedOnServer = [];
            let localAdditions = syncData.target.getAddedItemsFromChangeLog();
            let allItems = syncData.target.getAllItems()
            for (let card of allItems) {
                let id = card.getProperty("X-DAV-HREF");
                if (id && !vCardsFoundOnServer.includes(id) && !localAdditions.includes(id)) {
                    //delete request from server
                    cardsFound++;
                    vCardsDeletedOnServer.push(card);
                }
            }

            // reset sync process
            syncData.progressData.reset(0, cardsFound);

            //download all cards added to vCardsChangedOnServer and process changes
            await dav.sync.multiget(syncData, vCardsChangedOnServer);

            //delete all contacts added to vCardsDeletedOnServer
            await dav.sync.deleteContacts (syncData, vCardsDeletedOnServer);

            //update ctag and token (if there is one)
            if (ctag === null) return false; //if server does not support ctag, "it did not change"
            syncData.currentFolderData.setFolderProperty("ctag", ctag);
            if (token) syncData.currentFolderData.setFolderProperty("token", token);

            //ctag did change
            return true;
        } else {

            //ctag did not change
            return false;
        }

    },



    multiget: async function (syncData, vCardsChangedOnServer) {
        //keep track of found mailing lists and its members
        syncData.foundMailingListsDuringDownSync = {};
        
        //download all changed cards and process changes
        let cards2catch = Object.keys(vCardsChangedOnServer);
        let maxitems = dav.sync.prefSettings.getIntPref("maxitems");

        for (let i=0; i < cards2catch.length; i+=maxitems) {
            let request = dav.tools.getMultiGetRequest(cards2catch.slice(i, i+maxitems));
            if (request) {
                syncData.setSyncState("send.request.remotechanges");
                let cards = await dav.network.sendRequest(request, syncData.currentFolderData.getFolderProperty("href"), "REPORT", syncData.connectionData, {"Depth": "1"});

                syncData.setSyncState("eval.response.remotechanges");
                for (let c=0; c < cards.multi.length; c++) {
                    syncData.progressData.inc();
                    let id =  cards.multi[c].href;
                    let etag = dav.tools.evaluateNode(cards.multi[c].node, [["d","prop"], ["d","getetag"]]);
                    let data = dav.tools.evaluateNode(cards.multi[c].node, [["d","prop"], ["card","address-data"]]);

                    if (cards.multi[c].status == "200" && etag !== null && data !== null && id !== null && vCardsChangedOnServer.hasOwnProperty(id)) {
                        switch (vCardsChangedOnServer[id]) {
                            case "ADD":
                                await dav.tools.addContact (syncData, id, data, etag);
                                break;

                            case "MOD":
                                await dav.tools.modifyContact (syncData, id, data, etag);
                                break;
                        }
                        //Feedback from users: They want to see the individual count
                        syncData.setSyncState("eval.response.remotechanges");		
                        await TbSync.tools.sleep(100);
                    } else {
                        TbSync.dump("Skipped Card", [id, cards.multi[c].status == "200", etag !== null, data !== null, id !== null, vCardsChangedOnServer.hasOwnProperty(id)].join(", "));
                    }
                }
            }
        }
        // Feedback from users: They want to see the final count.
        syncData.setSyncState("eval.response.remotechanges");		
        await TbSync.tools.sleep(200);
    
        // On down sync, mailinglists need to be done at the very end so all member data is avail.
        if (syncData.accountData.getAccountProperty("syncGroups")) {
            let l=0;
            for (let listID in syncData.foundMailingListsDuringDownSync) {
                if (syncData.foundMailingListsDuringDownSync.hasOwnProperty(listID)) {
                    l++;
                    
                    let list = syncData.target.getItemFromProperty("X-DAV-HREF", listID);
                    if (!list.isMailList)
                        continue;
                    
                    let currentMembers = list.getMembersPropertyList("X-DAV-UID");
                    
                    //CardInfo contains the name and the X-DAV-UID list of the members
                    let vCardInfo = dav.tools.getGroupInfoFromCardData(syncData.foundMailingListsDuringDownSync[listID].vCardData, syncData.target);
                    let oCardInfo = dav.tools.getGroupInfoFromCardData(syncData.foundMailingListsDuringDownSync[listID].oCardData, syncData.target);

                    // Smart merge: oCardInfo contains the state during last sync, vCardInfo is the current state.
                    // By comparing we can learn, which member was deleted by the server (in old but not in new).
                    let removedMembers = oCardInfo.members.filter(e => !vCardInfo.members.includes(e));
                     
                    // The new list from the server is taken.
                    let newMembers = vCardInfo.members;
                    
                    // Any member in current but not in new is added.
                    for (let member of currentMembers) {
                        if (!newMembers.includes(member) && !removedMembers.includes(member)) 
                            newMembers.push(member);
                    }

                    // Remove local deletes.
                    for (let member of oCardInfo.members) {
                        if (!currentMembers.includes(member)) 
                            newMembers = newMembers.filter(e => e != member);
                    }
                    
                    // Check that all new members have an email address (fix for bug 1522453)
                    let m=0;
                    for (let member of newMembers) {
                        let card = syncData.target.getItemFromProperty("X-DAV-UID", member);
                        if (card) {
                            let email = card.getProperty("PrimaryEmail");
                            if (!email) {
                                let email = Date.now() + "." + l + "." + m + "@bug1522453";
                                card.setProperty("PrimaryEmail", email);
                                syncData.target.modifyItem(card);
                            }
                        } else {
                            TbSync.dump("Member not found: " + member);
                        }
                        m++;
                    }
                    list.setMembersByPropertyList("X-DAV-UID", newMembers);
                }
            }
        }            
    },

    deleteContacts: async function (syncData, cards2delete) {
        let maxitems = dav.sync.prefSettings.getIntPref("maxitems");

        // try to show a progress based on maxitens during delete and not delete all at once
        for (let i=0; i < cards2delete.length; i+=maxitems) {
            //get size of next block
            let remain = (cards2delete.length - i);
            let chunk = Math.min(remain, maxitems);

            syncData.progressData.inc(chunk);
            syncData.setSyncState("eval.response.remotechanges");
            await TbSync.tools.sleep(200); //we want the user to see, that deletes are happening

            for (let j=0; j < chunk; j++) {
                syncData.target.deleteItem(cards2delete[i+j]);
            }
        }
    },




    localChanges: async function (syncData) {
        //define how many entries can be send in one request
        let maxitems = dav.sync.prefSettings.getIntPref("maxitems");

        let downloadonly = syncData.currentFolderData.getFolderProperty("downloadonly");

        let permissionErrors = 0;
        let permissionError = { //keep track of permission errors - preset with downloadonly status to skip sync in that case
            "added_by_user": downloadonly, 
            "modified_by_user": downloadonly, 
            "deleted_by_user": downloadonly
        }; 
        
        let syncGroups = syncData.accountData.getAccountProperty("syncGroups");
        
        //access changelog to get local modifications (done and todo are used for UI to display progress)
        syncData.progressData.reset(0, syncData.target.getItemsFromChangeLog().length);

        do {
            syncData.setSyncState("prepare.request.localchanges");

            //get changed items from ChangeLog 
            let changes = syncData.target.getItemsFromChangeLog(maxitems);
            if (changes.length == 0)
                break;

            for (let i=0; i < changes.length; i++) {
                switch (changes[i].status) {
                    case "added_by_user":
                    case "modified_by_user":
                        {
                            let isAdding = (changes[i].status == "added_by_user");
                            if (!permissionError[changes[i].status]) { //if this operation failed already, do not retry

                                let card = syncData.target.getItem(changes[i].itemId);
                                if (card) {
                                    if (card.isMailList && !syncGroups) {                                        
                                        // Conditionally break out of the switch early, but do
                                        // execute the cleanup code below the switch. A continue would
                                        // miss that.
                                        break;
                                    }
                                    
                                    let vcard = card.isMailList
                                                        ? dav.tools.getVCardFromThunderbirdListCard(syncData, card, isAdding)
                                                        : dav.tools.getVCardFromThunderbirdContactCard(syncData, card, isAdding);
                                    let headers = {"Content-Type": "text/vcard; charset=utf-8"};
                                    //if (!isAdding) headers["If-Match"] = vcard.etag;

                                    syncData.setSyncState("send.request.localchanges");
                                    if (isAdding || vcard.modified) {
                                        let response = await dav.network.sendRequest(vcard.data, card.getProperty("X-DAV-HREF"), "PUT", syncData.connectionData, headers, {softfail: [403,405]});

                                        syncData.setSyncState("eval.response.localchanges");
                                        if (response && response.softerror) {
                                            permissionError[changes[i].status] = true;
                                            TbSync.eventlog.add("warning", syncData.eventLogInfo, "missing-permission::" + TbSync.getString(isAdding ? "acl.add" : "acl.modify", "dav"));
                                        }
                                    }
                                } else {
                                    TbSync.eventlog.add("warning", syncData.eventLogInfo, "cardnotfoundbutinchangelog::" + changes[i].itemId + "/" + changes[i].status);
                                }
                            }

                            if (permissionError[changes[i].status]) {
                                //we where not allowed to add or modify that card, remove it, we will get a fresh copy on the following revert
                                let card = syncData.target.getItem(changes[i].itemId);
                                if (card) syncData.target.deleteItem(card);
                                permissionErrors++;
                            }
                        }
                        break;

                    case "deleted_by_user":
                        {
                            if (!permissionError[changes[i].status]) { //if this operation failed already, do not retry
                                syncData.setSyncState("send.request.localchanges");
                                let response = await dav.network.sendRequest("", changes[i].itemId , "DELETE", syncData.connectionData, {}, {softfail: [403, 404, 405]});

                                syncData.setSyncState("eval.response.localchanges");
                                if (response  && response.softerror) {
                                    if (response.softerror != 404) { //we cannot do anything about a 404 on delete, the card has been deleted here and is not avail on server
                                        permissionError[changes[i].status] = true;
                                        TbSync.eventlog.add("warning", syncData.eventLogInfo, "missing-permission::" + TbSync.getString("acl.delete", "dav"));
                                    }
                                }
                            }

                            if (permissionError[changes[i].status]) {
                                permissionErrors++;                                
                            }
                        }
                        break;
                }

                syncData.target.removeItemFromChangeLog(changes[i].itemId);                
                syncData.progressData.inc(); //UI feedback
            }


        } while (true);

        //return number of modified cards or the number of permission errors (negativ)
        return (permissionErrors > 0 ? 0 - permissionErrors : syncData.progressData.done);
    },
}
