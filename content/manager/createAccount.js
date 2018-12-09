/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

Components.utils.import("resource://gre/modules/Task.jsm");
Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncDavNewAccount = {

    startTime: 0,
    maxTimeout: 30,

    onClose: function () {
        return !document.documentElement.getButton("finish").disabled;
    },


    addProviderEntry: function (icon, serviceprovider) {
        let name =  tbSync.getLocalizedMessage("add.serverprofile."+serviceprovider, "dav");
        let description =  tbSync.getLocalizedMessage("add.serverprofile."+serviceprovider+".description", "dav");
        
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
        for (let p in tbSync.dav.serviceproviders) {
            this.serviceproviderlist.appendChild(this.addProviderEntry(tbSync.dav.serviceproviders[p].icon +"32.png", p));
        }
        this.serviceproviderlist.selectedIndex = 0;
    },

    showSecondPage: function () {
        document.documentElement.getButton("finish").disabled = true;

        let serviceprovider =  this.serviceproviderlist.value;        
        //show/hide additional descriptions (if avail)
        let dFound = 0;
        for (let i=1; i < 4; i++) {
            let dElement = document.getElementById("tbsync.newaccount.details" + i);
            let dLocaleString = "add.serverprofile."+serviceprovider+".details" + i;
            let dLocaleValue = tbSync.getLocalizedMessage(dLocaleString, "dav");
            
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
                
        //clear fields
        this.elementName.value = "";
        this.elementUser = document.getElementById('tbsync.newaccount.user');
        this.elementPass = document.getElementById('tbsync.newaccount.password');
        this.elementServer.value = "";
        this.elementCalDavServer.value = "";                
        this.elementCardDavServer.value = "";

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
                this.elementName.value = tbSync.getLocalizedMessage("add.serverprofile."+serviceprovider, "dav");
                this.elementCalDavServer.value = tbSync.dav.serviceproviders[serviceprovider].caldav;
                this.elementCardDavServer.value = tbSync.dav.serviceproviders[serviceprovider].carddav;
            }            
        }
    },
    
    onUnload: function () {
    },

    onUserTextInput: function () {
        document.documentElement.getButton("finish").disabled = (this.elementServer.value.trim() + this.elementCalDavServer.value.trim() + this.elementCardDavServer.value.trim() == "" || this.elementName.value.trim() == "" || this.elementUser.value == "" || this.elementPass.value == "");
    },

    onAdd: function () {
        //window.alert(tbSync.getLocalizedMessage());
        //return false;
        
        if (document.documentElement.getButton("finish").disabled == false) {
            let user = this.elementUser.value;
            let password = this.elementPass.value;
            let server = this.elementServer.value.trim();
            while (server.endsWith("/")) { server = server.slice(0,-1); }        
            
            let caldavserver = this.elementCalDavServer.value.trim();
            let carddavserver = this.elementCardDavServer.value.trim();
            let accountname = this.elementName.value.trim();
            let serviceprovider =  this.serviceproviderlist.value;        

            if (serviceprovider == "discovery") {
                serviceprovider = "custom";
                caldavserver = server + "/.well-known/caldav";
                carddavserver = server + "/.well-known/carddav";
            }
            tbSyncDavNewAccount.addAccount(user, password, serviceprovider, caldavserver, carddavserver, accountname);
        } else {
            return false;
        }
    },

    addAccount (user, password, serviceprovider, caldavserver, carddavserver, accountname) {
        let newAccountEntry = tbSync.dav.getDefaultAccountEntries();
        newAccountEntry.accountname = accountname;
        newAccountEntry.user = user;
        newAccountEntry.createdWithProviderVersion = tbSync.loadedProviders.dav.version;

        //default to https, if not specified
        let hasHttp = (caldavserver.substring(0,4) == "http");
        let hasHttps = (caldavserver.substring(0,5) == "https");
        newAccountEntry.https = (!hasHttps && hasHttp) ? "0" : "1";

        newAccountEntry.serviceprovider = serviceprovider;
        newAccountEntry.host = caldavserver.replace("https://","").replace("http://","");
        newAccountEntry.host2 = carddavserver.replace("https://","").replace("http://","");
    
        //also update password in PasswordManager
        tbSync.setPassword (newAccountEntry, password);

        //create a new account and pass its id to updateAccountsList, which will select it
        //the onSelect event of the List will load the selected account
        window.opener.tbSyncAccounts.updateAccountsList(tbSync.db.addAccount(newAccountEntry));

        window.close();
    }
};
