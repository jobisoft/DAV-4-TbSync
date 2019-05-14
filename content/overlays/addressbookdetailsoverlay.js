/*
 * This file is part of TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */
 
 "use strict";

Components.utils.import("chrome://tbsync/content/tbsync.jsm");

var tbSyncDavAddressBookDetails = {
    
    onBeforeInject: function (window) {
        //we inject always now and let onAbResultSelectionChanged handle our custom display
        return true;
    },

    onInject: function (window) {
        if (window.document.getElementById("abResultsTree")) {
            window.document.getElementById("abResultsTree").addEventListener("select", tbSyncDavAddressBookDetails.onAbResultSelectionChanged, false);
            tbSyncDavAddressBookDetails.onAbResultSelectionChanged();
        }
    },

    onRemove: function (window) {
        tbSyncDavAddressBookDetails.undoChangesToDefaults();
        if (window.document.getElementById("abResultsTree")) {
            window.document.getElementById("abResultsTree").removeEventListener("select", tbSyncDavAddressBookDetails.onAbResultSelectionChanged, false);
        }
    },

    undoChangesToDefaults: function () {
        //unhide elements hidden by this provider
        if (tbSyncDavAddressBookDetails.hasOwnProperty("elementsToHide")) {
            for (let i=0; i < tbSyncDavAddressBookDetails.elementsToHide.length; i++) {
                if (tbSyncDavAddressBookDetails.elementsToHide[i]) {
                    tbSyncDavAddressBookDetails.elementsToHide[i].hidden = false;
                }
            }
        }

        //re-enable elements disabled by this provider
        if (tbSyncDavAddressBookDetails.hasOwnProperty("elementsToDisable")) {
            for (let i=0; i < tbSyncDavAddressBookDetails.elementsToDisable.length; i++) {
                if (tbSyncDavAddressBookDetails.elementsToDisable[i]) {
                    tbSyncDavAddressBookDetails.elementsToDisable[i].disabled = false;
                }
            }
        }
        
        tbSyncDavAddressBookDetails.elementsToHide = [];
        tbSyncDavAddressBookDetails.elementsToDisable = [];        
    },
    
    onAbResultSelectionChanged: function () {
        tbSyncDavAddressBookDetails.undoChangesToDefaults();

        let cards = window.GetSelectedAbCards();
        if (cards.length == 1) {
            let aCard = cards[0];

            //function to get correct uri of current card for global book as well for mailLists
            let abUri = tbSync.providers.dav.tools.getSelectedUri(window.GetSelectedDirectory(), aCard);
            if (MailServices.ab.getDirectory(abUri).getStringValue("tbSyncProvider", "") != "dav") {
                window.document.getElementById("cvbEmails").collapsed = true;
                window.document.getElementById("cvbPhoneNumbers").collapsed =true;
                return;
            }
            
            //add emails
            let emails = tbSync.providers.dav.tools.getEmailsFromCard(aCard); //array of objects {meta, value}
            let emailDetails = window.document.getElementById("cvbEmailRows");        
            if (emailDetails) {
                //remove all rows
                while (emailDetails.firstChild) {
                    emailDetails.removeChild(emailDetails.firstChild);
                }

                for (let i=0; i < emails.length; i++) {
                    emailDetails.appendChild(tbSync.providers.dav.tools.getNewEmailDetailsRow(window, emails[i]));
                }
                
                if (window.document.getElementById("cvbEmails")) {
                    window.document.getElementById("cvbEmails").collapsed = (emails.length == 0);
                }
            }
            
            //add phone numbers
            let phones = tbSync.providers.dav.tools.getPhoneNumbersFromCard(aCard); //array of objects {meta, value}
            let phoneDetails = window.document.getElementById("cvbPhoneRows");        
            if (phoneDetails) {
                //remove all rows
                while (phoneDetails.firstChild) {
                    phoneDetails.removeChild(phoneDetails.firstChild);
                }

                for (let i=0; i < phones.length; i++) {
                    phoneDetails.appendChild(tbSync.providers.dav.tools.getNewPhoneDetailsRow(window, phones[i])); 
                }
                
                if (window.document.getElementById("cvbPhoneNumbers")) {
                    window.document.getElementById("cvbPhoneNumbers").collapsed = (phones.length == 0);
                }
            }
            
            
            //hide primary and secondary email
            if (!tbSyncDavAddressBookDetails.hasOwnProperty("elementsToHide")) tbSyncDavAddressBookDetails.elementsToHide = [];
            if (!tbSyncDavAddressBookDetails.hasOwnProperty("elementsToDisable")) tbSyncDavAddressBookDetails.elementsToDisable = [];
            tbSyncDavAddressBookDetails.elementsToHide.push(window.document.getElementById("cvEmail1Box"));
            tbSyncDavAddressBookDetails.elementsToHide.push(window.document.getElementById("cvEmail2Box"));
            tbSyncDavAddressBookDetails.elementsToHide.push(window.document.getElementById("cvbPhone"));
            
            //hide registered default elements
            for (let i=0; i < tbSyncDavAddressBookDetails.elementsToHide.length; i++) {
                if (tbSyncDavAddressBookDetails.elementsToHide[i]) {
                    tbSyncDavAddressBookDetails.elementsToHide[i].hidden = true; 
                    //using "hidden" and not "collapsed", because TB is flipping collapsed itself after the card has been edited/saved
                    //and if we also use that property, the fields "blink" for a split second. Using "hidden" the field stays hidden even if TB is uncollapsing
                }
            }

            //disable registered default elements
            for (let i=0; i < tbSyncDavAddressBookDetails.elementsToDisable.length; i++) {
                if (tbSyncDavAddressBookDetails.elementsToDisable[i]) {
                    tbSyncDavAddressBookDetails.elementsToDisable[i].disabled = true;
                }
            }
            
        }
    },
    
}
