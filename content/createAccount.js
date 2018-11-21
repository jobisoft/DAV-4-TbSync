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
        return !document.documentElement.getButton("cancel").disabled;
    },

    onLoad: function () {
        this.elementName = document.getElementById('tbsync.newaccount.name');
        this.elementUser = document.getElementById('tbsync.newaccount.user');
        this.elementPass = document.getElementById('tbsync.newaccount.password');
        this.elementServer = document.getElementById('tbsync.newaccount.server');
        
        document.documentElement.getButton("extra1").disabled = true;
        document.getElementById("tbsync.newaccount.name").focus();
    },

    onUnload: function () {
    },

    onUserTextInput: function () {
        document.documentElement.getButton("extra1").disabled = (this.elementServer.value.trim() == "" || this.elementName.value.trim() == "" || this.elementUser.value == "" || this.elementPass.value == "");
    },

    onAdd: function () {
        if (document.documentElement.getButton("extra1").disabled == false) {
            let user = this.elementUser.value;
            let password = this.elementPass.value;
            let server = this.elementServer.value.trim();
            let accountname = this.elementName.value.trim();
            tbSyncDavNewAccount.addAccount(user, password, server, accountname);
        }
    },

    addAccount (user, password, server, accountname) {
        let newAccountEntry = tbSync.dav.getDefaultAccountEntries();
        newAccountEntry.accountname = accountname;
        newAccountEntry.user = user;
        newAccountEntry.createdWithProviderVersion = tbSync.providerList.dav.addon.version.toString();

        //default to https, if not specified
        let hasHttp = (server.substring(0,4) == "http");
        let hasHttps = (server.substring(0,5) == "https");
        newAccountEntry.https = (!hasHttps && hasHttp) ? "0" : "1";

        newAccountEntry.host = server.replace("https://","").replace("http://","");
    
        //also update password in PasswordManager
        tbSync.setPassword (newAccountEntry, password);

        //create a new account and pass its id to updateAccountsList, which will select it
        //the onSelect event of the List will load the selected account
        window.opener.tbSyncAccounts.updateAccountsList(tbSync.db.addAccount(newAccountEntry));

        window.close();
    }
};
