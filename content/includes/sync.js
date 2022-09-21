/*
/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

const { CardDAVDirectory } = ChromeUtils.import(
    "resource:///modules/CardDAVDirectory.jsm"
);

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
        "gmx.net" : {revision: 1, icon: "gmx", caldav: "caldav6764://gmx.net", carddav: "carddav6764://gmx.net"},
        "gmx.com" : {revision: 1, icon: "gmx", caldav: "caldav6764://gmx.com", carddav: "carddav6764://gmx.com"},
        "posteo" : {revision: 1, icon: "posteo", caldav: "https://posteo.de:8443", carddav: "posteo.de:8843"},
        "web.de" : {revision: 1, icon: "web", caldav: "caldav6764://web.de", carddav: "carddav6764://web.de"},
        "yahoo" : {revision: 1, icon: "yahoo", caldav: "caldav6764://yahoo.com", carddav: "carddav6764://yahoo.com"},
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
            
            // SOGo needs some special handling for shared addressbooks. We detect
            // it by having SOGo/dav in the url.
            let isSogo = davjobs[job].server.includes("/SOGo/dav");

            // sync states are only printed while the account state is "syncing"
            // to inform user about sync process (it is not stored in DB, just in
            // syncData)
            // example state "getfolders" to get folder information from server
            // if you send a request to a server and thus have to wait for answer,
            // use a "send." syncstate, which will give visual feedback to the user,
            // that we are waiting for an answer with timeout countdown

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

                        // Update color from server.
                        if (color && job == "cal") {
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

        // add target to syncData
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
                    // update downloadonly - we do not use AbDirectory (syncData.target) but the underlying thunderbird addressbook obj
                    if (syncData.currentFolderData.getFolderProperty("downloadonly")) syncData.target.directory.setBoolValue("readOnly", true);

                    try {
                        let davDirectory = CardDAVDirectory.forFile(syncData.target.directory.fileName);
                        if (!hadTarget) {
                            davDirectory.fetchAllFromServer();
                        } else {
                            davDirectory.syncWithServer();
                        }
                    } catch (ex) {
                        throw dav.sync.finish("error", "non-carddav-addrbook");
                    }

                    throw dav.sync.finish("ok", "managed-by-thunderbird");
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

                    throw dav.sync.finish("ok", "managed-by-thunderbird");
                }
                break;

            default:
                {
                    throw dav.sync.finish("warning", "notsupported");
                }
                break;
        }
    },

}
