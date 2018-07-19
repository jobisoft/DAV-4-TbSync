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
        document.documentElement.getButton("extra1").disabled = (this.elementServer.value == "" || this.elementName.value == "" || this.elementUser.value == "" || this.elementPass.value == "");
    },

    onAdd: function () {
        if (document.documentElement.getButton("extra1").disabled == false) {
            let user = this.elementUser.value;
            let password = this.elementPass.value;
            let server = this.elementServer.value;
            let accountname = this.elementName.value;
            tbSyncDavNewAccount.addAccount(user, password, server, accountname);
        }
    },

    addAccount (user, password, server, accountname) {
        let newAccountEntry = tbSync.dav.getNewAccountEntry();
        newAccountEntry.accountname = accountname;
        newAccountEntry.user = user;
        
        //default to https, if not specified
        newAccountEntry.https = (server.substring(0,4) == "http") ? "0" : "1";
        newAccountEntry.host = server.replace("https://","").replace("http://","");
    
        //also update password in PasswordManager
        tbSync.setPassword (newAccountEntry, password);

        //create a new account and pass its id to updateAccountsList, which will select it
        //the onSelect event of the List will load the selected account
        window.opener.tbSyncAccounts.updateAccountsList(tbSync.db.addAccount(newAccountEntry));

        window.close();
    }
};
