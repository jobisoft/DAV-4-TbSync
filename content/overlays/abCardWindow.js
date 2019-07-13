/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

var { tbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");
var { OS }  =ChromeUtils.import("resource://gre/modules/osfile.jsm");

var tbSyncAbDavCardWindow = {
    
    onBeforeInject: function (window) {
        let aParentDirURI  = "";

        if (window.location.href=="chrome://messenger/content/addressbook/abNewCardDialog.xul") {
            //get provider via uri from drop down
            aParentDirURI = window.document.getElementById("abPopup").value;
        } else {
            //function to get correct uri of current card for global book as well for mailLists
            aParentDirURI = tbSync.providers.dav.tools.getSelectedUri(window.arguments[0].abURI, window.arguments[0].card);
        }
        
        //returning false will prevent injection
        return (MailServices.ab.getDirectory(aParentDirURI).getStringValue("tbSyncProvider", "") == "dav");
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
    
    onLoadCard: function (aCard, aDocument) {                
        //load properties
        let items = aDocument.getElementsByClassName("davProperty");
        for (let i=0; i < items.length; i++) {
            items[i].value = aCard.getProperty(items[i].id, "");
        }

        //get all emails with metadata from card
        let emails = tbSync.providers.dav.tools.getEmailsFromCard(aCard); //array of objects {meta, value}
        //add emails to list
        let emailList = aDocument.getElementById("X-DAV-EmailAddressList");
        for (let i=0; i < emails.length; i++) {
            let item = tbSync.providers.dav.tools.getNewEmailListItem(aDocument, emails[i]);
            emailList.appendChild(item);

            tbSync.providers.dav.tools.updateType(aDocument,  tbSync.providers.dav.tools.getEmailListItemElement(item, "button"));
            tbSync.providers.dav.tools.updatePref(aDocument, tbSync.providers.dav.tools.getEmailListItemElement(item, "pref"));		
        }

        //get all phone numbers with metadata from card
        let phones = tbSync.providers.dav.tools.getPhoneNumbersFromCard(aCard); //array of objects {meta, value}
        //add phones to list
        let phoneList = aDocument.getElementById("X-DAV-PhoneNumberList");
        for (let i=0; i < phones.length; i++) {
            let item = tbSync.providers.dav.tools.getNewPhoneListItem(aDocument, phones[i]);
            phoneList.appendChild(item);

            tbSync.providers.dav.tools.updateType(aDocument,  tbSync.providers.dav.tools.getPhoneListItemElement(item, "button1"));
            tbSync.providers.dav.tools.updateType(aDocument,  tbSync.providers.dav.tools.getPhoneListItemElement(item, "button2"));
            tbSync.providers.dav.tools.updatePref(aDocument, tbSync.providers.dav.tools.getPhoneListItemElement(item, "pref"));		
        }

    },
    
    onSaveCard: function (aCard, aDocument) {
        let items = aDocument.getElementsByClassName("davProperty");
        for (let i=0; i < items.length; i++) {
            aCard.setProperty(items[i].id, items[i].value);
        }
    }
    
}
