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

//no need to create namespace, we are in a sandbox

Components.utils.import("resource://gre/modules/Services.jsm");

function install(data, reason) {
}

function uninstall(data, reason) {
}

function startup(data, reason) {
    //possible reasons: APP_STARTUP, ADDON_ENABLE, ADDON_INSTALL, ADDON_UPGRADE, or ADDON_DOWNGRADE.

    //set default prefs (examples)
    let branch = Services.prefs.getDefaultBranch("extensions.dav4tbsync.");
    branch.setIntPref("maxitems", 50);
    branch.setCharPref("clientID.type", "TbSync");
    branch.setCharPref("clientID.useragent", "Thunderbird CalDAV/CardDAV");    
    
    //during APP_STARTUP, TbSync will find auto load all active providers, if this provider gets enabled later, load it dynamically 
    if (reason != APP_STARTUP) {
        Services.obs.notifyObservers(null, "tbsync.addProvider", "dav");
    }
}

function shutdown(data, reason) {
    //unload this provider from TbSync
    Services.obs.notifyObservers(null, "tbsync.removeProvider", "dav");
    Services.obs.notifyObservers(null, "chrome-flush-caches", null);
}
