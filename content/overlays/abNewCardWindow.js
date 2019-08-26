/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncDavAbNewCardWindow = {

    onInject: function (window) {
        window.document.getElementById("abPopup").addEventListener("select", tbSyncDavAbNewCardWindow.onAbSelectChangeNewCard, false);
    },

    onRemove: function (window) {
        window.document.getElementById("abPopup").removeEventListener("select", tbSyncDavAbNewCardWindow.onAbSelectChangeNewCard, false);
    },

    onAbSelectChangeNewCard: function () {        
        //remove our overlay (if injected)
        TbSync.providers.dav.overlayManager.removeOverlay(window, "chrome://dav4tbsync/content/overlays/abCardWindow.xul");
        //inject our overlay (if our card)
        TbSync.providers.dav.overlayManager.injectOverlay(window, "chrome://dav4tbsync/content/overlays/abCardWindow.xul");
    },
        
}
