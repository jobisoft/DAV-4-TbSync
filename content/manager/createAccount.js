/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");
const { DNS } = ChromeUtils.import("resource:///modules/DNS.jsm");

const dav = TbSync.providers.dav;

var tbSyncDavNewAccount = {
    
    get elementName() { return document.getElementById('tbsync.newaccount.name'); },
    get elementUser() { return document.getElementById('tbsync.newaccount.user'); },
    get elementPass() { return document.getElementById('tbsync.newaccount.password'); },
    get elementServer() { return document.getElementById('tbsync.newaccount.server'); },
    get elementCalDavServer() { return document.getElementById('tbsync.newaccount.caldavserver'); },
    get elementCardDavServer() { return document.getElementById('tbsync.newaccount.carddavserver'); },
    get serviceproviderlist() { return document.getElementById('tbsync.newaccount.serviceproviderlist'); },

    get accountname() { return this.elementName.value.trim(); },
    get username() { return this.elementUser.value.trim(); },
    get password() { return this.elementPass.value.trim(); },
    get server() { return this.elementServer.value.trim(); },
    get calDavServer() { return this.elementCalDavServer.value.trim(); },
    get cardDavServer() { return this.elementCardDavServer.value.trim(); },
    get serviceprovider() { return this.serviceproviderlist.value; },      
    get userdomain() { 
        let parts = this.username.split("@");
        if (parts.length == 2) {
            return parts[1];
        }
        return null;
    },

    set accountname(v) { this.elementName.value = v; },
    set username(v) { this.elementUser.value = v; },
    set password(v) { this.elementPass.value = v; },
    set server(v) { this.elementServer.value = v; },
    set calDavServer(v) { this.elementCalDavServer.value = v; },
    set cardDavServer(v) { this.elementCardDavServer.value = v; },
    
    onLoad: function () {
        this.providerData = new TbSync.ProviderData("dav");

        //init list
        this.serviceproviderlist.appendChild(this.addProviderEntry("sabredav32.png", "discovery"));
        this.serviceproviderlist.appendChild(this.addProviderEntry("sabredav32.png", "custom"));
        for (let p in dav.sync.serviceproviders) {
            this.serviceproviderlist.appendChild(this.addProviderEntry(dav.sync.serviceproviders[p].icon +"32.png", p));
        }
        
        document.addEventListener("wizardfinish", tbSyncDavNewAccount.onFinish.bind(this));
        document.addEventListener("wizardnext", tbSyncDavNewAccount.onAdvance.bind(this));
        document.addEventListener("wizardcancel", tbSyncDavNewAccount.onCancel.bind(this));
        document.getElementById("firstPage").addEventListener("pageshow", tbSyncDavNewAccount.resetFirstPage.bind(this));
        document.getElementById("secondPage").addEventListener("pageshow", tbSyncDavNewAccount.resetSecondPage.bind(this));
        document.getElementById("thirdPage").addEventListener("pageshow", tbSyncDavNewAccount.resetThirdPage.bind(this));
        
        this.serviceproviderlist.selectedIndex = 0;
        tbSyncDavNewAccount.resetFirstPage();
    },
    
    onUnload: function () {
    },

    onClose: function () {
        //disallow closing of wizard while isLocked
        return !this.isLocked;
    },

    onCancel: function (event) {
        //disallow closing of wizard while isLocked
        if (this.isLocked) {
            event.preventDefault();
        }
    },
    
    onFinish () {                
        let newAccountEntry = this.providerData.getDefaultAccountEntries();
        newAccountEntry.createdWithProviderVersion = this.providerData.getVersion();
        newAccountEntry.serviceprovider = this.serviceprovider == "discovery" ? "custom" : this.serviceprovider;
        newAccountEntry.calDavHost = this.calDavServer;
        newAccountEntry.cardDavHost = this.cardDavServer;
    
        // Add the new account.
        let newAccountData = this.providerData.addAccount(this.accountname, newAccountEntry);
        dav.network.getAuthData(newAccountData).updateLoginData(this.username, this.password);
    },





    // HELPER FUNCTIONS
    addProviderEntry: function (icon, serviceprovider) {
        let name =  TbSync.getString("add.serverprofile."+serviceprovider, "dav");
        let description =  TbSync.getString("add.serverprofile."+serviceprovider+".description", "dav");
        
        //left column
        let image = document.createXULElement("image");
        image.setAttribute("src", "chrome://dav4tbsync/skin/" + icon);
        image.setAttribute("style", "margin:1ex;");

        let leftColumn = document.createXULElement("vbox");
        leftColumn.appendChild(image);
        
        //right column
        let label = document.createXULElement("label");
        label.setAttribute("class", "header");
        label.setAttribute("value", name);
        
        let desc = document.createXULElement("description");
        desc.setAttribute("style", "width: 300px");
        desc.textContent = description;
        
        let rightColumn = document.createXULElement("vbox");
        rightColumn.appendChild(label);
        rightColumn.appendChild(desc);
        
        //columns
        let columns = document.createXULElement("hbox");
        columns.appendChild(leftColumn);
        columns.appendChild(rightColumn);
        
        //richlistitem
        let richlistitem = document.createXULElement("richlistitem");
        richlistitem.setAttribute("style", "padding:4px");
        richlistitem.setAttribute("value", serviceprovider);
        richlistitem.appendChild(columns);
        
        return richlistitem;
    },

    checkUrlForPrincipal: async function (accountname, username, password, url, type) {
        let connectionData = new dav.network.ConnectionData();
        connectionData.password = password;
        connectionData.username = username;
        connectionData.timeout = 5000;
        connectionData.type = type;

        //only needed for proper error reporting - that dav needs this is beyond API - connectionData is not used by TbSync
        //connectionData is a structure which contains all the information needed to establish and evaluate a network connection
        connectionData.eventLogInfo = new TbSync.EventLogInfo("dav", accountname);
        
        let rv = {valid: false, error: ""};
        
        try {
            let response = await dav.network.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:current-user-principal /></d:prop></d:propfind>", url , "PROPFIND", connectionData, {"Depth": "0", "Prefer": "return=minimal"});
            // allow 404 because iCloud sends it on valid answer (yeah!)
            let principal = (response && response.multi) ? dav.tools.getNodeTextContentFromMultiResponse(response, [["d","prop"], ["d","current-user-principal"], ["d","href"]], null, ["200","404"]) : null;
            rv.valid = (principal !== null);
            if (!rv.valid) {
                rv.error = type + "davservernotfound";
                TbSync.eventlog.add("warning", connectionData.eventLogInfo, rv.error, response.commLog);
            }
        } catch (e) {
            rv.valid = false;
            rv.error = (e.statusData ? e.statusData.message : e.message);
            
            if (e.name == "dav4tbsync") {
                TbSync.eventlog.add("warning", connectionData.eventLogInfo, e.statusData.message, e.statusData.details);
            } else {
                Components.utils.reportError(e);
            }
        }
        return rv;
    },

    advance: function () {
        document.getElementById("tbsync.newaccount.wizard").advance(null);
    },





    // RESET AND INIT FUNCTIONS
    clearValues: function () {
        //clear fields
        this.username = "";
        this.password = "";
        this.server = "";
        this.calDavServer = "";                
        this.cardDavServer = "";

        if (this.serviceprovider == "discovery" || this.serviceprovider == "custom") {
            this.accountname = "";
        } else {
            this.accountname = TbSync.getString("add.serverprofile." + this.serviceprovider, "dav");
        }
    },

    resetFirstPage: function () {
        // RESET / INIT first page
        document.getElementById("tbsync.newaccount.wizard").canRewind = false;
        document.getElementById("tbsync.newaccount.wizard").canAdvance = true;
        this.isLocked = false;
        this.validated = false;
    },

    resetSecondPage: function () {
        // RESET / INIT second page
        this.isLocked = false;
        this.validated = false;
        
        if (this.serviceprovider == "discovery") {
            this.discoveryMode = "RFC6764";
        } else {
            //custom or serviceprovider
            this.discoveryMode = "NONE";
        }
        
        document.getElementById("tbsync.newaccount.wizard").canRewind = true;
        document.getElementById("tbsync.newaccount.wizard").canAdvance = false;
        document.getElementById("tbsync.spinner").hidden = true;
        document.getElementById("tbsync.error").hidden = true;

        this.checkUI();
    },

    resetThirdPage: function () {
        // RESET / INIT third page
        document.getElementById("tbsync.newaccount.wizard").canRewind = true;
        document.getElementById("tbsync.newaccount.wizard").canAdvance = true;
        this.isLocked = false;
    },





    // UI FUNCTIONS
    lockUI: function() {
        document.getElementById("tbsync.spinner").hidden = false;
        document.getElementById("tbsync.error").hidden = true;
        document.getElementById("tbsync.newaccount.wizard").canAdvance = false;
        document.getElementById("tbsync.newaccount.wizard").canRewind = false;
        this.isLocked = true;
    },

    unlockUI: function() {
        document.getElementById("tbsync.spinner").hidden = true;        
        document.getElementById("tbsync.newaccount.wizard").canRewind = true;
        this.isLocked = false;
        this.checkUI();
    },

    checkUI: function () {        
        // determine, if we can advance or not
        if (this.serviceprovider == "discovery") {
            document.getElementById("tbsync.newaccount.wizard").canAdvance = !(this.accountname == ""
                                                                                || (this.calDavServer + this.cardDavServer == "" && this.discoveryMode == "CUSTOM")
                                                                                || (this.server == "" && this.discoveryMode == "RFC6764" && !this.userdomain)
                                                                                || this.username == "");
        } else if (this.serviceprovider == "custom") {
            // custom does not need username or password (allow annonymous access)
            document.getElementById("tbsync.newaccount.wizard").canAdvance = !(this.accountname == ""
                                                                                || this.calDavServer + this.cardDavServer == "");
        } else {
            // build in service providers do need a username and password
            document.getElementById("tbsync.newaccount.wizard").canAdvance = !(this.accountname == ""
                                                                                || this.password == ""
                                                                                || this.username == "");
        }

        // update placeholder attribute of server
        this.elementServer.setAttribute("placeholder", this.userdomain ? TbSync.getString("server.optional", "dav") : "");

        
        //show/hide additional descriptions (if avail)
        let dFound = 0;
        for (let i=1; i < 4; i++) {
            let dElement = document.getElementById("tbsync.newaccount.details" + i);
            let dLocaleString = "add.serverprofile." + this.serviceprovider + ".details" + i;
            let dLocaleValue = TbSync.getString(dLocaleString, "dav");
            
            if (dLocaleValue == dLocaleString) {
                dElement.textContent = "";
                dElement.hidden = true;
            } else {
                dFound++;
                dElement.textContent = dLocaleValue
                dElement.hidden =false;
            }
        }
        
        //hide Notes header, if no descriptions avail
        let dLabel = document.getElementById("tbsync.newaccount.details.header");
        dLabel.hidden = (dFound == 0);
        
        //which server fields to show?
        if (this.serviceprovider == "discovery") {
            document.getElementById("tbsync.newaccount.caldavserver.row").hidden = (this.discoveryMode != "CUSTOM");
            document.getElementById("tbsync.newaccount.carddavserver.row").hidden = (this.discoveryMode != "CUSTOM");
            document.getElementById("tbsync.newaccount.server.row").hidden = (this.discoveryMode == "CUSTOM");
            //this.elementCalDavServer.disabled = false;
            //this.elementCardDavServer.disabled = false;
        } else if (this.serviceprovider == "custom") {
            // custom
            document.getElementById("tbsync.newaccount.caldavserver.row").hidden = false;
            document.getElementById("tbsync.newaccount.carddavserver.row").hidden = false;
            document.getElementById("tbsync.newaccount.server.row").hidden = true;
            //this.elementCalDavServer.disabled = false;
            //this.elementCardDavServer.disabled = false;
        } else {
            // build in service provider
            document.getElementById("tbsync.newaccount.caldavserver.row").hidden = true;
            document.getElementById("tbsync.newaccount.carddavserver.row").hidden = true;
            document.getElementById("tbsync.newaccount.server.row").hidden = true;
            //this.elementCalDavServer.disabled = true;
            //this.elementCardDavServer.disabled = true;
            this.calDavServer = dav.sync.serviceproviders[this.serviceprovider].caldav;
            this.cardDavServer = dav.sync.serviceproviders[this.serviceprovider].carddav;
        }        
    },





    // SETUP LOGIC FUNCTION
    onAdvance: function (event) {
        // do not prevent advancing if we go from page 1 to page 2, or if validation succeeded
        if (document.getElementById("tbsync.newaccount.wizard").currentPage.id == "firstPage" || this.validated) {
            return;
        }
                        
        // if we reach this, we are on page 2 but may not advance but 
        // go through the setup steps

        if (this.serviceprovider == "discovery") {
            // Possible dicovery modes:
            // - RFC6764 : only username (server is optional)
            // - CUSTOM: username + servers
            switch (this.discoveryMode) {
                case "RFC6764":
                    // if the user specified a server url, do well-know discovery
                    while (this.server.endsWith("/")) { this.server = this.server.slice(0,-1); }        
                    if (this.server) {
                        this.calDavServer = this.server + "/.well-known/caldav";
                        this.cardDavServer = this.server + "/.well-known/carddav";
                        this.validateDavServers();
                    } else {
                        this.findValidDavServers();
                    }
                    break;
                case "CUSTOM":
                    this.validateDavServers();
                    break;
            }
        } else {
            // custom or service provider
            this.validateDavServers();
        }
        
        event.preventDefault();
    },

    findValidDavServers: async function() {
        this.lockUI();
        
        if (this.userdomain) {
            // we do dns lookup and we need to validate all 6 candidates and if all fail,
            // show the server field(s)
            let rv = await this.doRFC6764Lookup(this.userdomain);
            document.getElementById("tbsync.spinner").hidden = true;

            if (rv.cal.validUrl && rv.card.validUrl) {
                // boom, setup completed
                this.calDavServer = rv.cal.validUrl;
                this.cardDavServer = rv.card.validUrl;
                this.validated = true;
                this.unlockUI();
                this.advance();
                return;
            } else if (rv.cal.validUrl || rv.card.validUrl) {
                // only partial results, switch to CUSTOM mode and 
                // show them to the user
                this.discoveryMode = "CUSTOM";
                this.calDavServer = rv.cal.validUrl || "";
                this.cardDavServer = rv.card.validUrl || "";
                this.unlockUI();
                return;
            } else if (rv.cal.errors.includes("401") || rv.card.errors.includes("401")) {
                //show for 401 errors
                document.getElementById("tbsync.error.message").textContent = TbSync.getString("info.error") + ": " + TbSync.getString("status.401", "dav");
                document.getElementById("tbsync.error").hidden = false;
                this.unlockUI();
                return;
            } else {
                //show general error, that doRFC6764Lookup failed and the user must specify a server
                document.getElementById("tbsync.error.message").textContent = TbSync.getString("info.error") + ": " + TbSync.getString("status.rfc6764LookupFailedPleaseEnterServerUrl", "dav");
                document.getElementById("tbsync.error").hidden = false;
                this.unlockUI();
                return;
            }
        }

        // we have no domain or RFC6764 lookup failed altogether
        this.unlockUI();
    },
    
    doRFC6764Lookup: async function (domain) {
        function checkDefaultSecPort (sec) {
            return sec ? "443" : "80";
        }
        
        let result = {
            cal: {},
            card: {}
        };
        
        for (let type of Object.keys(result)) {
            result[type].candidates = [];
            result[type].errors = [];
            
            for (let sec of [true, false]) {
                let request = "_" + type + "dav" + (sec ? "s" : "") + "._tcp." + domain;

                // get host from SRV record
                let rv = await DNS.srv(request);                     
                if (rv && Array.isArray(rv) && rv.length>0 && rv[0].host) {
                    result[type].secure = sec;
                    result[type].host = rv[0].host + ((checkDefaultSecPort(sec) == rv[0].port) ? "" : ":" + rv[0].port);

                    // Now try to get path from TXT
                    rv = await DNS.txt(request);   
                    if (rv && Array.isArray(rv) && rv.length>0 && rv[0].data && rv[0].data.toLowerCase().startsWith("path=")) {
                        result[type].path = rv[0].data.substring(5);
                    } else {
                        result[type].path = "/.well-known/" + type + "dav";
                    }

                    result[type].candidates.push("http" + (result[type].secure ? "s" : "") + "://" + result[type].host +  result[type].path);
                    break;
                }
            }
            
            // we now have an educated guess for the initial request (or not)
            // in addition, we use the domain part of the email to do a lookup
            result[type].candidates.push("https://" + domain + "/.well-known/" + type + "dav");
            result[type].candidates.push("http://" + domain + "/.well-known/" + type + "dav");
            
            // try to get principal from candidate
            for (let url of result[type].candidates) {
                let rv = await this.checkUrlForPrincipal(this.accountname, this.username, this.password, url, type);
                if (rv.valid) {
                    result[type].validUrl = url;
                    break;
                } else {
                    result[type].errors.push(rv.error);
                    // if we run into a 401, we have reached a valid endpoint but should not go on
                    if (rv.error.startsWith("401"))
                        break;
                }
            }
        }
        
        return result;
    },
     
    validateDavServers: async function() {
        this.lockUI();
      
        while (this.calDavServer.endsWith("/")) { this.calDavServer = this.calDavServer.slice(0,-1); }        
        while (this.cardDavServer.endsWith("/")) { this.cardDavServer = this.cardDavServer.slice(0,-1); }        

        // Default to https, if http is not explicitly specified
        if (this.calDavServer && !dav.network.startsWithScheme(this.calDavServer)) {
            this.calDavServer = "https://" + this.calDavServer;
        }
        if (this.cardDavServer && !dav.network.startsWithScheme(this.cardDavServer)) {
            this.cardDavServer = "https://" + this.cardDavServer;
        }
        
        let davJobs = {
            cal : {valid: false, error: "", server: this.calDavServer},
            card : {valid: false, error: "", server: this.cardDavServer},
        };
        let failedDavJobs = [];
        
        for (let job in davJobs) {
            if (!davJobs[job].server) {
                continue;
            }
            davJobs[job] = await this.checkUrlForPrincipal(this.accountname, this.username, this.password, davJobs[job].server, job);
            if (!davJobs[job].valid) {
                failedDavJobs.push(job);
            }
        }
        
        if (failedDavJobs.length == 0) {
            // boom, setup completed
            this.validated = true;
            this.unlockUI();
            this.advance();
            return;
        } else {
            //only display one error
            let failedJob = failedDavJobs[0];
            switch (davJobs[failedJob].error.toString().split("::")[0]) {
                case "401":
                case "403":
                case "404":
                case "500":
                case "503":
                case "network":
                case "security":
                    document.getElementById("tbsync.error.message").textContent = TbSync.getString("info.error") + ": " + TbSync.getString("status."+davJobs[failedJob].error, "dav");
                    break;
                default:
                    document.getElementById("tbsync.error.message").textContent = TbSync.getString("info.error") + ": " + TbSync.getString("status.networkerror", "dav");
            }
            document.getElementById("tbsync.error").hidden = false;
            this.unlockUI();
        }
    },
};
