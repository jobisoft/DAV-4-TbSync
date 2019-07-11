/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

var auth = {
  getHost: function(accountData) {
    return accountData.getAccountProperty("calDavHost") ? accountData.getAccountProperty("calDavHost") : accountData.getAccountProperty("cardDavHost");
  },
  
  getUsername: function(accountData) {
    return accountData.getAccountProperty("user");
  },

  getPassword: function(accountData) {
    return tbSync.passwordManager.getLoginInfo(this.getHost(accountData), "TbSync/DAV", this.getUsername(accountData));
  },
  
  updateLoginData: function(accountData, newUsername, newPassword) {
    let oldUsername = this.getUsername(accountData);
    tbSync.passwordManager.updateLoginInfo(this.getHost(accountData), "TbSync/DAV", oldUsername, newUsername, newPassword);
    // Also update the username of this account.
    accountData.setAccountProperty("user", newUsername);
  },
}
