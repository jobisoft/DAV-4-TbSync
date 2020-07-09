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

const dav = TbSync.providers.dav;

var tbSyncDavNewAccount = {
    
    // standard data fields
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
            let subparts = parts[1].split(".");
            if (subparts.length > 1 && subparts[subparts.length-1].length > 1) return parts[1];
        }
        return null;
    },

    set accountname(v) { this.elementName.value = v; },
    set username(v) { this.elementUser.value = v; },
    set password(v) { this.elementPass.value = v; },
    set server(v) { this.elementServer.value = v; },
    set calDavServer(v) { this.elementCalDavServer.value = v; },
    set cardDavServer(v) { this.elementCardDavServer.value = v; },
    
    
    
    // final data fields on final page
    get elementFinalName() { return document.getElementById('tbsync.finalaccount.name'); },
    get elementFinalUser() { return document.getElementById('tbsync.finalaccount.user'); },
    get elementFinalCalDavServer() { return document.getElementById('tbsync.finalaccount.caldavserver'); },
    get elementFinalCardDavServer() { return document.getElementById('tbsync.finalaccount.carddavserver'); },

    get finalAccountname() { return this.elementFinalName.value.trim(); },
    get finalUsername() { return this.elementFinalUser.value.trim(); },
    get finalCalDavServer() { return this.elementFinalCalDavServer.value.trim(); },
    get finalCardDavServer() { return this.elementFinalCardDavServer.value.trim(); },

    set finalAccountname(v) { this.elementFinalName.value = v;},
    set finalUsername(v) {
        this.elementFinalUser.value = v; 
        this.elementFinalUser.setAttribute("tooltiptext", v);
    },
    set finalCalDavServer(v) { 
        this.elementFinalCalDavServer.value = v; 
        this.elementFinalCalDavServer.setAttribute("tooltiptext", v);
        document.getElementById("tbsyncfinalaccount.caldavserver.row").hidden = (v.trim() == "");
    },
    set finalCardDavServer(v) { 
        this.elementFinalCardDavServer.value = v; 
        this.elementFinalCardDavServer.setAttribute("tooltiptext", v);
        document.getElementById("tbsyncfinalaccount.carddavserver.row").hidden = (v.trim() == "");
    },    
    
    get validated() { return this._validated || false; },
    set validated(v) {
        this._validated = v;
        if (v) {
            this.finalAccountname = this.accountname;
        } else {
            this.finalAccountname = "";
            this.finalUsername = "";
            this.finalCalDavServer = "";
            this.finalCardDavServer = "";
        }
    },
    
    
    showSpinner: function(spinnerText) {
        document.getElementById("tbsync.spinner").hidden = false;
        document.getElementById("tbsync.spinner.label").value = TbSync.getString("add.spinner." + spinnerText, "dav");
    },
    
    hideSpinner: function() {
        document.getElementById("tbsync.spinner").hidden = true;
    },
    
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
        newAccountEntry.serviceproviderRevision = dav.sync.serviceproviders.hasOwnProperty(this.serviceprovider) ? dav.sync.serviceproviders[this.serviceprovider].revision : 0
        newAccountEntry.calDavHost = this.finalCalDavServer;
        newAccountEntry.cardDavHost = this.finalCardDavServer;
    
        // Add the new account.
        let newAccountData = this.providerData.addAccount(this.finalAccountname, newAccountEntry);
        dav.network.getAuthData(newAccountData).updateLoginData(this.finalUsername, this.password);
    },





    // HELPER FUNCTIONS
    addProviderEntry: function (icon, serviceprovider) {
        let name =  TbSync.getString("add.serverprofile."+serviceprovider, "dav");
        let description =  TbSync.getString("add.serverprofile."+serviceprovider+".description", "dav");
        
        //left column
        let image = document.createXULElement("image");
        image.setAttribute("src", "chrome://dav4tbsync/content/skin/" + icon);
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

    checkUrlForPrincipal: async function (job) {
        // according to RFC6764, we must also try the username with cut-off domain part
        // Note: This is never called for OAUTH serves (see onAdvance)
        let users = [];
        users.push(this.username);
        if (this.userdomain) users.push(this.username.split("@")[0]);
        
        for (let user of users) {
            let connectionData = new dav.network.ConnectionData();
            connectionData.password = this.password;
            connectionData.username = user;
            connectionData.timeout = 5000;

            //only needed for proper error reporting - that dav needs this is beyond API - connectionData is not used by TbSync
            //connectionData is a structure which contains all the information needed to establish and evaluate a network connection
            connectionData.eventLogInfo = new TbSync.EventLogInfo("dav", this.accountname);
            
            job.valid = false;
            job.error = "";
            
            try {
                let response = await dav.network.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:current-user-principal /></d:prop></d:propfind>", job.server , "PROPFIND", connectionData, {"Depth": "0", "Prefer": "return=minimal"}, {containerRealm: "setup", containerReset: true, passwordRetries: 0});
                // allow 404 because iCloud sends it on valid answer (yeah!)
                let principal = (response && response.multi) ? dav.tools.getNodeTextContentFromMultiResponse(response, [["d","prop"], ["d","current-user-principal"], ["d","href"]], null, ["200","404"]) : null;
                job.valid = (principal !== null);
                if (!job.valid) {
                    job.error = job.type + "servernotfound";
                    TbSync.eventlog.add("warning", connectionData.eventLogInfo, job.error, response ? response.commLog : "");
                } else {
                    job.validUser = user;
                    job.validUrl = (response ? response.permanentlyRedirectedUrl : null) || job.server;
                    return;
                }
            } catch (e) {
                job.valid = false;
                job.error = (e.statusData ? e.statusData.message : e.message);
                
                if (e.name == "dav4tbsync") {
                    TbSync.eventlog.add("warning", connectionData.eventLogInfo, e.statusData.message, e.statusData.details);
                } else {
                    Components.utils.reportError(e);
                }
            }
            
            // only retry with other user, if 401
            if (!job.error.startsWith("401")) {
                break;
            }
        }
        
        return;
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
        // bug https://bugzilla.mozilla.org/show_bug.cgi?id=1618252
        document.getElementById('tbsync.newaccount.wizard')._adjustWizardHeader();
        this.isLocked = false;
        this.validated = false;
    },

    resetSecondPage: function () {
        // RESET / INIT second page
        this.isLocked = false;
        this.validated = false;
        
        document.getElementById("tbsync.newaccount.wizard").canRewind = true;
        document.getElementById("tbsync.newaccount.wizard").canAdvance = false;
        this.hideSpinner();
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
    lockUI: function(spinnerText) {
        this.showSpinner(spinnerText);
        document.getElementById("tbsync.error").hidden = true;
        document.getElementById("tbsync.newaccount.wizard").canAdvance = false;
        document.getElementById("tbsync.newaccount.wizard").canRewind = false;
        this.isLocked = true;
    },

    unlockUI: function() {
        this.hideSpinner();
        document.getElementById("tbsync.newaccount.wizard").canRewind = true;
        this.isLocked = false;
        this.checkUI();
    },

    checkUI: function (hideError) {
        if (hideError) {
            document.getElementById("tbsync.error").hidden = true;
        }
        
        // determine, if we can advance or not
        if (this.serviceprovider == "discovery") {
            document.getElementById("tbsync.newaccount.wizard").canAdvance = !(
                                                                                (this.accountname == "") ||
                                                                                (this.server == "" && !this.userdomain) ||
                                                                                (this.server == "" && this.username == ""));
        } else if (this.serviceprovider == "custom") {
            // custom does not need username or password (allow annonymous access)
            document.getElementById("tbsync.newaccount.wizard").canAdvance = !(
                                                                                (this.accountname == "") ||
                                                                                (this.calDavServer + this.cardDavServer == ""));
        } else if (this.serviceprovider == "google") {
            // google does not need a password field and also no username
            document.getElementById("tbsync.newaccount.wizard").canAdvance = !(
                                                                                (this.accountname == ""));
        } else {
            // build in service providers do need a username and password
            document.getElementById("tbsync.newaccount.wizard").canAdvance = !(
                                                                                (this.accountname == "") ||
                                                                                (this.password == "") ||
                                                                                (this.username == ""));
        }

        // update placeholder attribute of server
        this.elementServer.setAttribute("placeholder", this.userdomain ? TbSync.getString("add.serverprofile.discovery.server-optional", "dav") : "");

        
        //show/hide additional descriptions (if avail)
        let dFound = 0;
        for (let i=1; i < 4; i++) {
            let dElement = document.getElementById("tbsync.newaccount.details" + i);
            let dLocaleString = "add.serverprofile." + this.serviceprovider + ".details" + i;
            let dLocaleValue = TbSync.getString(dLocaleString, "dav");
            
            let hide = (dLocaleValue == dLocaleString);
            if (this.serviceprovider == "discovery") {
                // show them according to UI state
                switch (i) {
                    case 1: 
                        hide = false;
                        break;
                    case 2: 
                        hide = !this.userdomain;
                        break;
                }
            }

            if (hide) {
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
        document.getElementById("tbsync.newaccount.finaluser.row").hidden = (this.serviceprovider == "google");
        document.getElementById("tbsync.newaccount.user.row").hidden = (this.serviceprovider == "google");
        document.getElementById("tbsync.newaccount.password.row").hidden = (this.serviceprovider == "google");

        if (this.serviceprovider == "discovery") {
            document.getElementById("tbsync.newaccount.caldavserver.row").hidden = true;
            document.getElementById("tbsync.newaccount.carddavserver.row").hidden = true;
            document.getElementById("tbsync.newaccount.server.row").hidden = false;
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
            while (this.server.endsWith("/")) { this.server = this.server.slice(0,-1); }        
            // the user may either specify a server or he could have entered an email with domain
            let parts = (this.server || this.userdomain).split("://");            
            let scheme = (parts.length > 1) ? parts[0].toLowerCase() : "";
            let host = parts[parts.length-1];

            this.calDavServer = scheme + "caldav6764://" + host;
            this.cardDavServer = scheme + "carddav6764://" + host;
            this.validateDavServers();
        } else if (this.serviceprovider == "google") {
            // do not verify, just prompt for permissions
            this.promptForOAuth();            
        } else {
            // custom or service provider
            this.validateDavServers();
        }
        
        event.preventDefault();
    },
     
    promptForOAuth: async function() {
        this.lockUI("validating");
        let oauthData = dav.network.getOAuthObj(this.calDavServer, { username: this.username, accountname: this.accountname });
        if (oauthData) {
            let rv = {};
            if (await oauthData.asyncConnect(rv)) {
                this.password = rv.tokens;
                this.finalCalDavServer = this.calDavServer;
                this.finalCardDavServer = this.cardDavServer;
                this.finalUsername = this.username;
                this.validated = true;
                this.unlockUI();
                this.advance();
                return;
            } else {
                document.getElementById("tbsync.error.message").textContent = TbSync.getString("status." + rv.error, "dav");
                document.getElementById("tbsync.error").hidden = false;
                this.unlockUI();                
                return;
            }
        }    
        document.getElementById("tbsync.error.message").textContent = TbSync.getString("status.OAuthNetworkError", "dav");
        document.getElementById("tbsync.error").hidden = false;
        this.unlockUI();                
    },
    
    validateDavServers: async function() {
        this.lockUI("validating");
      
        // Do not manipulate input here.
        //while (this.calDavServer.endsWith("/")) { this.calDavServer = this.calDavServer.slice(0,-1); }        
        //while (this.cardDavServer.endsWith("/")) { this.cardDavServer = this.cardDavServer.slice(0,-1); }        

        // Default to https, if http is not explicitly specified
        if (this.calDavServer && !dav.network.startsWithScheme(this.calDavServer)) {
            this.calDavServer = "https://" + this.calDavServer;
        }
        if (this.cardDavServer && !dav.network.startsWithScheme(this.cardDavServer)) {
            this.cardDavServer = "https://" + this.cardDavServer;
        }
        
        let davJobs = [
            {type: "caldav", server: this.calDavServer},
            {type: "carddav", server: this.cardDavServer},
        ];
            
        let failedDavJobs = [];
        let validUserFound = "";
        
        for (let job = 0; job < davJobs.length; job++) {
            if (!davJobs[job].server) {
                continue;
            }
            await this.checkUrlForPrincipal(davJobs[job]);
            if (!davJobs[job].valid) {
                failedDavJobs.push(job);
            } else if (!validUserFound) {
                // set the found user
                validUserFound = davJobs[job].validUser;
            } else if (validUserFound != davJobs[job].validUser) {
                // users do not match
                failedDavJobs.push(job);                
            }
        }
        
        if (failedDavJobs.length == 0) {
            // boom, setup completed
            this.finalCalDavServer = davJobs[0].validUrl || "";
            this.finalCardDavServer = davJobs[1].validUrl || "";
            this.finalUsername = validUserFound;
            this.validated = true;
            this.unlockUI();
            this.advance();
            return;
        } else {
            //only display one error
            let failedJob = failedDavJobs[0];
            console.log("ERROR ("+davJobs[failedJob].type+"): " + davJobs[failedJob].error.toString());
            switch (davJobs[failedJob].error.toString().split("::")[0]) {
                case "401":
                case "403":
                case "503":
                case "security":
                    document.getElementById("tbsync.error.message").textContent = TbSync.getString("status."+davJobs[failedJob].error, "dav");
                    break;
                default:
                    if (this.serviceprovider == "discovery" && this.userdomain && !this.server) {
                        // the discovery mode has a special error msg, in case a userdomain was used as server, but failed and we need the user to provide the server
                        document.getElementById("tbsync.error.message").textContent = TbSync.getString("status.rfc6764-lookup-failed::" +this.userdomain, "dav");
                    } else if (this.serviceprovider != "discovery" && this.serviceprovider != "custom") {
                        // error msg, that the serviceprovider setup seems wrong
                        document.getElementById("tbsync.error.message").textContent = TbSync.getString("status.service-provider-setup-failed", "dav");
                    } else if (dav.network.isRFC6764Request(davJobs[failedJob].server)) {
                        // error msg, that discovery mode failed
                        document.getElementById("tbsync.error.message").textContent = TbSync.getString("status.service-discovery-failed::" +davJobs[failedJob].server.split("://")[1], "dav");
                    } else {
                        document.getElementById("tbsync.error.message").textContent = TbSync.getString("status." + davJobs[failedJob].type + "servernotfound", "dav");
                    }
            }
            document.getElementById("tbsync.error").hidden = false;
            this.unlockUI();
        }
    },
};
