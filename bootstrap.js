/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

//no need to create namespace, we are in a sandbox

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/Task.jsm");

let thisID = "";

let onInitDoneObserver = {
    observe: Task.async (function* (aSubject, aTopic, aData) {        
        //it is now safe to import tbsync.jsm
        Components.utils.import("chrome://tbsync/content/tbsync.jsm");
        
        //load all providers of this provider Add-on into TbSync (one at a time, obey order)
       try {
            yield tbSync.loadProvider(thisID, "dav", "//dav4tbsync/content/dav.js");
        } catch (e) {}
    })
}

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
    branch.setBoolPref("addCredentialsToUrl", false);

    thisID = data.id;
    Services.obs.addObserver(onInitDoneObserver, "tbsync.init.done", false);

    //during app startup, the load of the provider will be triggered by a "tbsync.init.done" notification, 
    //if load happens later, we need load manually 
    if (reason != APP_STARTUP) {
        //OLD API - REMOVE AFTER SWITCH
        Services.obs.notifyObservers(null, "tbsync.addProvider", "dav");
        onInitDoneObserver.observe();
    }
}

function shutdown(data, reason) {
    //OLD API - REMOVE AFTER SWITCH
    Services.obs.notifyObservers(null, "tbsync.removeProvider", "dav");

    Services.obs.removeObserver(onInitDoneObserver, "tbsync.init.done");

    //unload this provider Add-On and all its loaded providers from TbSync
    try {
        tbSync.unloadProviderAddon(data.id);
    } catch (e) {}
    Services.obs.notifyObservers(null, "chrome-flush-caches", null);
}
