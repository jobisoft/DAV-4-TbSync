/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncAbDavCardWindow = {
    
    onBeforeInject: function (window) {
        let cardProvider = "";
        let aParentDirURI  = "";
        
        if (window.location.href=="chrome://messenger/content/addressbook/abNewCardDialog.xul") {
            aParentDirURI = window.document.getElementById("abPopup").value;
        } else {
            aParentDirURI = tbSyncAbDavCardWindow.getSelectedAbFromArgument(window.arguments[0]);
        }

        if (aParentDirURI) {
            let folders = tbSync.db.findFoldersWithSetting("target", aParentDirURI);
            if (folders.length == 1) {
                cardProvider = tbSync.db.getAccountSetting(folders[0].account, "provider");
            }
        }
        
        //returning false will prevent injection
        return (cardProvider == "dav");
    },

    onInject: function (window) {
        //keep track of default elements we hide/disable, so it can be undone during overlay remove
        tbSyncAbDavCardWindow.elementsToHide = [];
        tbSyncAbDavCardWindow.elementsToDisable = [];

        //register default elements we need to hide/disable
        tbSyncAbDavCardWindow.elementsToHide.push(window.document.getElementById("WorkAddress2Container"));
        tbSyncAbDavCardWindow.elementsToHide.push(window.document.getElementById("abHomeTab").children[1]);
        tbSyncAbDavCardWindow.elementsToHide.push(window.document.getElementById("PrimaryEmailContainer"));
        tbSyncAbDavCardWindow.elementsToHide.push(window.document.getElementById("SecondaryEmailContainer"));
        tbSyncAbDavCardWindow.elementsToHide.push(window.document.getElementById("PhoneNumbers"));
        
        //hide stuff from gContactSync *grrrr* - I cannot hide all because he adds them via javascript :-(
        tbSyncAbDavCardWindow.elementsToHide.push(window.document.getElementById("gContactSyncTab"));

        //hide registered default elements
        for (let i=0; i < tbSyncAbDavCardWindow.elementsToHide.length; i++) {
            if (tbSyncAbDavCardWindow.elementsToHide[i]) {
                tbSyncAbDavCardWindow.elementsToHide[i].collapsed = true;
            }
        }

        //disable registered default elements
        for (let i=0; i < tbSyncAbDavCardWindow.elementsToDisable.length; i++) {
            if (tbSyncAbDavCardWindow.elementsToDisable[i]) {
                tbSyncAbDavCardWindow.elementsToDisable[i].disabled = true;
            }
        }

        //get current size
        let currentWidth = window.outerWidth;
        let currentHeight = window.outerHeight;
        let newWidth;
        let newHeight;

        if (window.location.href=="chrome://messenger/content/addressbook/abNewCardDialog.xul") {
            newWidth = 750;
            newHeight = 500;
            window.RegisterSaveListener(tbSyncAbDavCardWindow.onSaveCard);        
        } else {            
            newWidth = 750;
            newHeight = 450;
            window.RegisterLoadListener(tbSyncAbDavCardWindow.onLoadCard);
            window.RegisterSaveListener(tbSyncAbDavCardWindow.onSaveCard);

            //if this window was open during inject, load the extra fields
            if (gEditCard) tbSyncAbDavCardWindow.onLoadCard(gEditCard.card, window.document);
        }
        
        //adjust size if needed
        if (currentWidth < newWidth || currentHeight < newHeight) {
            window.resizeTo(Math.max(newWidth, currentWidth), Math.max(newHeight, currentHeight));
        }
        
    },

    onRemove: function (window) {
        if (window.location.href=="chrome://messenger/content/addressbook/abNewCardDialog.xul") {
            window.UnregisterSaveListener(tbSyncAbDavCardWindow.onSaveCard);
        } else {
            window.UnregisterLoadListener(tbSyncAbDavCardWindow.onLoadCard);
            window.UnregisterSaveListener(tbSyncAbDavCardWindow.onSaveCard);
        }
          
        //unhide elements hidden by this provider
        for (let i=0; i < tbSyncAbDavCardWindow.elementsToHide.length; i++) {
            if (tbSyncAbDavCardWindow.elementsToHide[i]) {
                tbSyncAbDavCardWindow.elementsToHide[i].collapsed = false;
            }
        }

        //re-enable elements disabled by this provider
        for (let i=0; i < tbSyncAbDavCardWindow.elementsToDisable.length; i++) {
            if (tbSyncAbDavCardWindow.elementsToDisable[i]) {
                tbSyncAbDavCardWindow.elementsToDisable[i].disabled = false;
            }
        }
            
    },
    
    getSelectedAbFromArgument: function (arg) {
        let abURI = "";
        if (arg.hasOwnProperty("abURI")) {
            abURI = arg.abURI;
        } else if (arg.hasOwnProperty("selectedAB")) {
            abURI = arg.selectedAB;
        }
        
        if (abURI) {
            let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
            let ab = abManager.getDirectory(abURI);
            if (ab.isMailList) {
                let parts = abURI.split("/");
                parts.pop();
                return parts.join("/");
            }
        }
        return abURI;
    },   
    
    onLoadCard: function (aCard, aDocument) {                
        //load properties
        let items = aDocument.getElementsByClassName("davProperty");
        for (let i=0; i < items.length; i++) {
            items[i].value = aCard.getProperty(items[i].id, "");
        }

        //get all emails with metadata from card
        let emails = tbSync.dav.tools.getEmailsFromCard(aCard); //array of objects {meta, value}
        
        //add emails to list
        let list = aDocument.getElementById("X-DAV-EmailAddressList");
        for (let i=0; i < emails.length; i++) {
            let item = tbSync.dav.tools.getNewEmailListItem(aDocument, emails[i]);
            list.appendChild(item);

            let button = tbSync.dav.tools.getEmailListItemElement(item, "button");
            tbSync.dav.tools.updateEmailType(aDocument, button);
            tbSync.dav.tools.updateEmailPref(aDocument, item);
        }
    },
    
    onSaveCard: function (aCard, aDocument) {
        let items = aDocument.getElementsByClassName("davProperty");
        for (let i=0; i < items.length; i++) {
            aCard.setProperty(items[i].id, items[i].value);
        }
    }
    
}
