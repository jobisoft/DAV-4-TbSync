/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("chrome://tbsync/content/tbsync.jsm");
const dav = tbSync.providers.dav;

var tbSyncDavNewAccount = {

    startTime: 0,
    maxTimeout: 30,

    addProviderEntry: function (icon, serviceprovider) {
        let name =  tbSync.tools.getLocalizedMessage("add.serverprofile."+serviceprovider, "dav");
        let description =  tbSync.tools.getLocalizedMessage("add.serverprofile."+serviceprovider+".description", "dav");
        
        //left column
        let image = document.createElement("image");
        image.setAttribute("src", "chrome://dav4tbsync/skin/" + icon);
        image.setAttribute("style", "margin:1ex;");

        let leftColumn = document.createElement("vbox");
        leftColumn.appendChild(image);
        
        //right column
        let label = document.createElement("label");
        label.setAttribute("class", "header");
        label.setAttribute("value", name);
        
        let desc = document.createElement("description");
        desc.setAttribute("style", "width: 300px");
        desc.textContent = description;
        
        let rightColumn = document.createElement("vbox");
        rightColumn.appendChild(label);
        rightColumn.appendChild(desc);
        
        //columns
        let columns = document.createElement("hbox");
        columns.appendChild(leftColumn);
        columns.appendChild(rightColumn);
        
        //richlistitem
        let richlistitem = document.createElement("richlistitem");
        richlistitem.setAttribute("style", "padding:4px");
        richlistitem.setAttribute("value", serviceprovider);
        richlistitem.appendChild(columns);
        
        return richlistitem;
    },
    
    onLoad: function () {
        this.elementName = document.getElementById('tbsync.newaccount.name');
        this.elementUser = document.getElementById('tbsync.newaccount.user');
        this.elementPass = document.getElementById('tbsync.newaccount.password');
        this.elementServer = document.getElementById('tbsync.newaccount.server');
        this.elementCalDavServer = document.getElementById('tbsync.newaccount.caldavserver');
        this.elementCardDavServer = document.getElementById('tbsync.newaccount.carddavserver');
        this.serviceproviderlist = document.getElementById('tbsync.newaccount.serviceproviderlist');
        
        //init list
        this.serviceproviderlist.appendChild(this.addProviderEntry("sabredav32.png", "discovery"));
        this.serviceproviderlist.appendChild(this.addProviderEntry("sabredav32.png", "custom"));
        for (let p in dav.serviceproviders) {
            this.serviceproviderlist.appendChild(this.addProviderEntry(dav.serviceproviders[p].icon +"32.png", p));
        }
        this.serviceproviderlist.selectedIndex = 0;
        this.validating = false;
    },
    
    clearValues: function () {
        //clear fields
        this.elementUser.value = "";
        this.elementPass.value = "";
        this.elementServer.value = "";
        this.elementCalDavServer.value = "";                
        this.elementCardDavServer.value = "";

        let serviceprovider =  this.serviceproviderlist.value;        
        if (serviceprovider == "discovery" || serviceprovider == "custom") {
            this.elementName.value = "";
        } else {
            this.elementName.value = tbSync.tools.getLocalizedMessage("add.serverprofile."+serviceprovider, "dav");
        }
    },
    
    showFirstPage: function () {
        document.getElementById("tbsync.newaccount.wizard").canAdvance = true;
        this.validating = false;
    },
    
    showSecondPage: function () {
        tbSyncDavNewAccount.onUserTextInput();
        
        let serviceprovider =  this.serviceproviderlist.value;        
        //show/hide additional descriptions (if avail)
        let dFound = 0;
        for (let i=1; i < 4; i++) {
            let dElement = document.getElementById("tbsync.newaccount.details" + i);
            let dLocaleString = "add.serverprofile."+serviceprovider+".details" + i;
            let dLocaleValue = tbSync.tools.getLocalizedMessage(dLocaleString, "dav");
            
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
                
        //always show the two server URLs, excpet for "discovery" serviceprovider
        if (serviceprovider == "discovery") {
            document.getElementById("tbsync.newaccount.caldavserver.row").hidden = true;
            document.getElementById("tbsync.newaccount.carddavserver.row").hidden = true;
            document.getElementById("tbsync.newaccount.server.row").hidden = false;
            this.elementCalDavServer.disabled = false;
            this.elementCardDavServer.disabled = false;
        } else {
            document.getElementById("tbsync.newaccount.server.row").hidden = true;            
            if (serviceprovider == "custom") {
                document.getElementById("tbsync.newaccount.caldavserver.row").hidden = false;
                document.getElementById("tbsync.newaccount.carddavserver.row").hidden = false;
                this.elementCalDavServer.disabled = false;
                this.elementCardDavServer.disabled = false;
            } else {
                document.getElementById("tbsync.newaccount.caldavserver.row").hidden = true;
                document.getElementById("tbsync.newaccount.carddavserver.row").hidden = true;
                this.elementCalDavServer.disabled = true;
                this.elementCardDavServer.disabled = true;
                this.elementCalDavServer.value = dav.serviceproviders[serviceprovider].caldav;
                this.elementCardDavServer.value = dav.serviceproviders[serviceprovider].carddav;
            }            
        }
        
        this.validating = false;
        document.getElementById("tbsync.spinner").hidden = true;
        document.getElementById("tbsync.error").hidden = true;
    },
    
    onUnload: function () {
    },

    advance: function () {
        document.getElementById("tbsync.newaccount.wizard").advance(null);
    },
    
    onUserTextInput: function () {
        document.documentElement.getButton("finish").disabled = (this.elementServer.value.trim() + this.elementCalDavServer.value.trim() + this.elementCardDavServer.value.trim() == "" || this.elementName.value.trim() == "" || this.elementUser.value == "" || this.elementPass.value == "");
    },

    onFinish: function () {
        if (document.documentElement.getButton("finish").disabled == false) {
            //initiate validation of server connection,
            document.getElementById("tbsync.newaccount.wizard").canRewind = false;
            document.documentElement.getButton("finish").disabled = true;
            this.validating = true;                
            this.validate();
        }
        return false;
    },

    validate: async function () {
        document.getElementById("tbsync.error").hidden = true;
        document.getElementById("tbsync.spinner").hidden = false;

        this.accountdata = {};
        this.accountdata.accountname = this.elementName.value.trim();
        this.accountdata.user = this.elementUser.value;
        this.accountdata.password = this.elementPass.value;
        this.accountdata.caldavserver = this.elementCalDavServer.value.trim();
        this.accountdata.carddavserver = this.elementCardDavServer.value.trim();
       
        this.accountdata.serviceprovider = this.serviceproviderlist.value;        
        if (this.accountdata.serviceprovider == "discovery") {
            this.accountdata.serviceprovider = "custom";
            let server = this.elementServer.value.trim();
            while (server.endsWith("/")) { server = server.slice(0,-1); }        
            
            this.accountdata.caldavserver = server + "/.well-known/caldav";
            this.accountdata.carddavserver = server + "/.well-known/carddav";
        } else {
            while (this.accountdata.caldavserver.endsWith("/")) { this.accountdata.caldavserver = this.accountdata.caldavserver.slice(0,-1); }        
            while (this.accountdata.carddavserver.endsWith("/")) { this.accountdata.carddavserver = this.accountdata.carddavserver.slice(0,-1); }        
        }

        //HTTP or HTTPS? Default to https, if http is not explicitly specified
        this.accountdata.https = (this.accountdata.caldavserver.toLowerCase().substring(0,7) == "http://") ? "0" : "1";
        this.accountdata.caldavserver = this.accountdata.caldavserver.replace("https://","").replace("http://","");
        this.accountdata.carddavserver = this.accountdata.carddavserver.replace("https://","").replace("http://","");

        let davjobs = {
            cal : {valid: false, error: "", server: this.accountdata.caldavserver},
            card : {valid: false, error: "", server: this.accountdata.carddavserver},
        };
        
        for (let job in davjobs) {
            if (!davjobs[job].server) {
                davjobs[job].valid = true;
                continue;
            }

            let connection = {};
            connection.password = this.accountdata.password;
            connection.user = this.accountdata.user;
            connection.https = this.accountdata.https;
            connection.timeout = 15000;
            connection.type = job;
            connection.fqdn = "";
            //only needed for proper error reporting
            connection.provider = "dav";
            connection.accountname = this.accountdata.accountname;

            //build full url, so we do not need fqdn
            let url = "http" + (connection.https == "1" ? "s" : "") + "://" + davjobs[job].server;
            
            try {
                let response = await dav.tools.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:current-user-principal /></d:prop></d:propfind>", url , "PROPFIND", connection, {"Depth": "0", "Prefer": "return-minimal"});
                let principal = (response && response.multi) ? dav.tools.getNodeTextContentFromMultiResponse(response, [["d","prop"], ["d","current-user-principal"], ["d","href"]]) : null;
                davjobs[job].valid = (principal !== null);
                if (!davjobs[job].valid) {
                    davjobs[job].error = job+"davservernotfound";
                }
            } catch (e) {
                davjobs[job].valid = false;
                davjobs[job].error = e.message;
                if (e.type == "dav4tbsync") {
                    tbSync.errorlog.add("warning", connection, e.message, e.details ? e.details : null);
                } else {
                    Components.utils.reportError(e);
                }
            }
        }
        
        if (davjobs.cal.valid && davjobs.card.valid) {
            tbSyncDavNewAccount.addAccount(this.accountdata);
            this.validating = false;
            document.getElementById("tbsync.newaccount.wizard").cancel();
        } else {
            //only display one error
            let badjob = !davjobs.cal.valid ? "cal" : "card";
            switch (davjobs[badjob].error.toString().split("::")[0]) {
                case "401":
                case "403":
                case "404":
                case "500":
                case "503":
                case "network":
                case "security":
                    document.getElementById("tbsync.error.message").textContent = tbSync.tools.getLocalizedMessage("info.error") + ": " + tbSync.tools.getLocalizedMessage("status."+davjobs[badjob].error, "dav");
                    break;
                default:
                    document.getElementById("tbsync.error.message").textContent = tbSync.tools.getLocalizedMessage("info.error") + ": " + tbSync.tools.getLocalizedMessage("status.networkerror", "dav");
            }
                        
            document.getElementById("tbsync.spinner").hidden = true;
            document.getElementById("tbsync.error").hidden = false;
            document.getElementById("tbsync.newaccount.wizard").canRewind = true;
            document.documentElement.getButton("finish").disabled = false;
            this.validating = false;
        }
    },
    
    onClose: function () {
        //disallow closing of wizard while validating
        return !this.validating;
    },

    onCancel: function () {
        //disallow closing of wizard while validating
        return !this.validating;
    },
    

    addAccount (accountdata) {
        let newAccountEntry = dav.api.getDefaultAccountEntries();
        newAccountEntry.accountname = accountdata.accountname;
        newAccountEntry.user = accountdata.user;
        newAccountEntry.createdWithProviderVersion = tbSync.providers.loadedProviders.dav.version;

        newAccountEntry.https = accountdata.https
        newAccountEntry.serviceprovider = accountdata.serviceprovider;
        newAccountEntry.host = accountdata.caldavserver;
        newAccountEntry.host2 = accountdata.carddavserver;
    
        //also update password in PasswordManager
        dav.api.setPassword (newAccountEntry, accountdata.password);

        //create a new account and pass its id to updateAccountsList, which will select it
        //the onSelect event of the List will load the selected account
        window.opener.tbSyncAccounts.updateAccountsList(tbSync.db.addAccount(newAccountEntry));

        window.close();
    }
};
