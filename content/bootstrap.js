/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

// no need to create namespace, we are in a sandbox

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { cal } = ChromeUtils.import("resource:///modules/calendar/calUtils.jsm");

let component = {};

let onInitDoneObserver = {
    observe: async function (aSubject, aTopic, aData) {        
        let valid = false;
        try {
            var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");
            valid = TbSync.enabled;
        } catch (e) {
            // If this fails, TbSync is not loaded yet and we will get the notification later again.
        }
        
        //load this provider add-on into TbSync
        if (valid) {
          Cu.unload("chrome://dav4tbsync/content/includes/GoogleDavCalendar.jsm");
          Cu.unload("chrome://dav4tbsync/content/includes/GoogleDavSession.jsm");
          let { GoogleDavCalendar } = ChromeUtils.import(
            "chrome://dav4tbsync/content/includes/GoogleDavCalendar.jsm"
          );
          if (cal.manager.wrappedJSObject.hasCalendarProvider("tbSyncCalDav")) {
            cal.manager.wrappedJSObject.unregisterCalendarProvider("tbSyncCalDav", true);
          }
          cal.manager.wrappedJSObject.registerCalendarProvider("tbSyncCalDav", GoogleDavCalendar);    
          await TbSync.providers.loadProvider(extension, "dav", "chrome://dav4tbsync/content/provider.js");
        }
    }
}


function startup(data, reason)  {
    // Possible reasons: APP_STARTUP, ADDON_ENABLE, ADDON_INSTALL, ADDON_UPGRADE, or ADDON_DOWNGRADE.

    Services.obs.addObserver(onInitDoneObserver, "tbsync.observer.initialized", false);
     
    // The startup of TbSync is delayed until all add-ons have called their startup(),
    // so all providers have registered the "tbsync.observer.initialized" observer.
    // Once TbSync has finished its startup, all providers will be notified (also if
    // TbSync itself is restarted) to load themself.
    // If this is not startup, we need load manually.
    if (reason != APP_STARTUP) {
        onInitDoneObserver.observe();
    }
}

function shutdown(data, reason)  {
    // Possible reasons: APP_STARTUP, ADDON_ENABLE, ADDON_INSTALL, ADDON_UPGRADE, or ADDON_DOWNGRADE.

    // When the application is shutting down we normally don't have to clean up.
    if (reason == APP_SHUTDOWN) {
        return;
    }

    
    Services.obs.removeObserver(onInitDoneObserver, "tbsync.observer.initialized");
    //unload this provider add-on from TbSync
    try {
        var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");
        TbSync.providers.unloadProvider("dav");
    } catch (e) {
        //if this fails, TbSync has been unloaded already and has unloaded this addon as well
    }
    Services.obs.notifyObservers(null, "startupcache-invalidate");
    Services.obs.notifyObservers(null, "chrome-flush-caches");     
}
