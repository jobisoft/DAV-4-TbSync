/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");
Components.utils.import("resource://gre/modules/osfile.jsm");

var tbSyncAbDavCardWindow = {
    
    onBeforeInject: function (window) {
        let cardProvider = "";
        let aParentDirURI  = "";
        tbSyncAbDavCardWindow.addressbook = null;

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

        if (window.location.href=="chrome://messenger/content/addressbook/abNewCardDialog.xul") {
            window.RegisterSaveListener(tbSyncAbDavCardWindow.onSaveCard);        
        } else {            
            window.RegisterLoadListener(tbSyncAbDavCardWindow.onLoadCard);
            window.RegisterSaveListener(tbSyncAbDavCardWindow.onSaveCard);

            //if this window was open during inject, load the extra fields
            if (gEditCard) tbSyncAbDavCardWindow.onLoadCard(gEditCard.card, window.document);
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
            tbSyncAbDavCardWindow.addressbook = MailServices.ab.getDirectory(abURI);
            if (tbSyncAbDavCardWindow.addressbook.isMailList) {
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
        let emailList = aDocument.getElementById("X-DAV-EmailAddressList");
        for (let i=0; i < emails.length; i++) {
            let item = tbSync.dav.tools.getNewEmailListItem(aDocument, emails[i]);
            emailList.appendChild(item);

            tbSync.dav.tools.updateType(aDocument,  tbSync.dav.tools.getEmailListItemElement(item, "button"));
            tbSync.dav.tools.updatePref(aDocument, tbSync.dav.tools.getEmailListItemElement(item, "pref"));		
        }

        //get all phone numbers with metadata from card
        let phones = tbSync.dav.tools.getPhoneNumbersFromCard(aCard); //array of objects {meta, value}
        //add phones to list
        let phoneList = aDocument.getElementById("X-DAV-PhoneNumberList");
        for (let i=0; i < phones.length; i++) {
            let item = tbSync.dav.tools.getNewPhoneListItem(aDocument, phones[i]);
            phoneList.appendChild(item);

            tbSync.dav.tools.updateType(aDocument,  tbSync.dav.tools.getPhoneListItemElement(item, "button1"));
            tbSync.dav.tools.updateType(aDocument,  tbSync.dav.tools.getPhoneListItemElement(item, "button2"));
            tbSync.dav.tools.updatePref(aDocument, tbSync.dav.tools.getPhoneListItemElement(item, "pref"));		
        }

    },
    
    onSaveCard: function (aCard, aDocument) {
        let items = aDocument.getElementsByClassName("davProperty");
        for (let i=0; i < items.length; i++) {
            aCard.setProperty(items[i].id, items[i].value);
        }
    }
    
}
