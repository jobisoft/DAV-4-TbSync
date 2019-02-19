/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncDavAddressBook = {

    onInject: function (window) {
        if (window.document.getElementById("dirTree")) {
            window.document.getElementById("dirTree").addEventListener("select", tbSyncDavAddressBook.onAbDirectorySelectionChanged, false);
        }
    },

    onRemove: function (window) {
        if (window.document.getElementById("dirTree")) {
            window.document.getElementById("dirTree").removeEventListener("select", tbSyncDavAddressBook.onAbDirectorySelectionChanged, false);
        }
    },
    
    onAbDirectorySelectionChanged: function () {
        //TODO: Do not do this, if provider did not change
        //remove our details injection (if injected)
        tbSync.dav.overlayManager.removeOverlay(window, "chrome://dav4tbsync/content/overlays/addressbookdetailsoverlay.xul");
        //inject our details injection (if the new selected book is us)
        tbSync.dav.overlayManager.injectOverlay(window, "chrome://dav4tbsync/content/overlays/addressbookdetailsoverlay.xul");
    }
}



var tbSyncDavAddressBookDetails = {
    
    onBeforeInject: function (window) {
        let cardProvider = "";
        
        try {
            let aParentDirURI = window.GetSelectedDirectory();
            let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);
            let selectedBook = abManager.getDirectory(aParentDirURI);
            if (selectedBook.isMailList) {
                aParentDirURI = aParentDirURI.substring(0, aParentDirURI.lastIndexOf("/"));
            }

            if (aParentDirURI) {
                let folders = tbSync.db.findFoldersWithSetting("target", aParentDirURI);
                if (folders.length == 1) {
                    cardProvider = tbSync.db.getAccountSetting(folders[0].account, "provider");
                }
            }
        } catch (e) {
            //if the window / gDirTree is not yet avail 
        }
        
        //returning false will prevent injection
        return (cardProvider == "dav");
    },

    onInject: function (window) {
        //keep track of default elements we hide/disable, so it can be undone during overlay remove
        tbSyncDavAddressBookDetails.elementsToHide = [];
        tbSyncDavAddressBookDetails.elementsToDisable = [];

        if (window.document.getElementById("abResultsTree")) {
            window.document.getElementById("abResultsTree").addEventListener("select", tbSyncDavAddressBookDetails.onAbResultSelectionChanged, false);
            tbSyncDavAddressBookDetails.onAbResultSelectionChanged();
        }
        
        //hide primary and secondary email, but mark them as hidden by tbsync, so they get unhidden again
        tbSyncDavAddressBookDetails.elementsToHide.push(window.document.getElementById("cvEmail1Box"));
        tbSyncDavAddressBookDetails.elementsToHide.push(window.document.getElementById("cvEmail2Box"));
        
        //hide registered default elements
        for (let i=0; i < tbSyncDavAddressBookDetails.elementsToHide.length; i++) {
            if (tbSyncDavAddressBookDetails.elementsToHide[i]) {
                tbSyncDavAddressBookDetails.elementsToHide[i].collapsed = true;
            }
        }

        //disable registered default elements
        for (let i=0; i < tbSyncDavAddressBookDetails.elementsToDisable.length; i++) {
            if (tbSyncDavAddressBookDetails.elementsToDisable[i]) {
                tbSyncDavAddressBookDetails.elementsToDisable[i].disabled = true;
            }
        }
    },

    onRemove: function (window) {
        //unhide elements hidden by this provider
        for (let i=0; i < tbSyncDavAddressBookDetails.elementsToHide.length; i++) {
            if (tbSyncDavAddressBookDetails.elementsToHide[i]) {
                tbSyncDavAddressBookDetails.elementsToHide[i].collapsed = false;
            }
        }

        //re-enable elements disabled by this provider
        for (let i=0; i < tbSyncDavAddressBookDetails.elementsToDisable.length; i++) {
            if (tbSyncDavAddressBookDetails.elementsToDisable[i]) {
                tbSyncDavAddressBookDetails.elementsToDisable[i].disabled = false;
            }
        }

        if (window.document.getElementById("abResultsTree")) {
            window.document.getElementById("abResultsTree").removeEventListener("select", tbSyncDavAddressBookDetails.onAbResultSelectionChanged, false);
        }
    },
    
    onAbResultSelectionChanged: function () {
        let cards = window.GetSelectedAbCards();
        if (cards.length == 1) {
            let aCard = cards[0];
            
            //get all emails with metadata from card
            let emails = tbSync.dav.tools.getEmailsFromCard(aCard); //array of objects {meta, value}
            let details = window.document.getElementById("cvbEmailRows");        
            if (details) {
                //remove all rows
                while (details.firstChild) {
                    details.removeChild(details.firstChild);
                }

                for (let i=0; i < emails.length; i++) {
                    let emailType = "other";
                    if (emails[i].meta.includes("HOME")) emailType = "home";
                    else if (emails[i].meta.includes("WORK")) emailType = "work";            
                    details.appendChild(tbSync.dav.tools.getNewEmailDetailsRow(window, {pref: emails[i].meta.includes("PREF"), src: "chrome://dav4tbsync/skin/type."+emailType+"10.png", href: emails[i].value}));
                }
                
                if (window.document.getElementById("cvbEmails")) {
                    window.document.getElementById("cvbEmails").collapsed = (emails.length == 0);
                }
            }
            
            
            let cvPhMain = window.document.getElementById("cvPhMain");
            let phoneFound = false;
            if (cvPhMain) {
                let cvPhMainValue = aCard.getProperty("X-DAV-MainPhone","");
                if (cvPhMainValue) {
                    cvPhMain.textContent = cvPhMain.getAttribute("labelprefix") + " " + cvPhMainValue;
                    cvPhMain.collapsed = false;
                    phoneFound = true;
                }
            }        
            if (phoneFound) {
                window.document.getElementById("cvbPhone").collapsed = false;
                window.document.getElementById("cvhPhone").collapsed = false;
            } 
        }
    },
    
}

