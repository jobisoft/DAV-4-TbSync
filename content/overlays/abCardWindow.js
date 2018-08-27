/*
 * This file is part of TbSync.
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
 * along with TbSync. If not, see <https://www.gnu.org/licenses/>.
 */
 
 "use strict";

tbSync.dav.onBeforeInjectIntoCardEditWindow = function (window) {
    //is this NewCard or EditCard?
    if (window.location.href=="chrome://messenger/content/addressbook/abNewCardDialog.xul") {
        //always inject if NewCard, but hide if selected ab is not DAV
        return true;        
    } else {    
        //Only inject, if this card is an DAV card
        let cards = window.opener.GetSelectedAbCards();

        if (cards.length == 1) {
            let aParentDirURI = tbSync.getUriFromPrefId(cards[0].directoryId.split("&")[0]);
            if (aParentDirURI) { //could be undefined
                let folders = tbSync.db.findFoldersWithSetting("target", aParentDirURI);
                if (folders.length == 1 && tbSync.db.getAccountSetting(folders[0].account, "provider") == "dav") return true;
            }
        }
    }
    
    return false;
}


tbSync.dav.onInjectIntoCardEditWindow = function (window) {
    if (window.location.href=="chrome://messenger/content/addressbook/abNewCardDialog.xul") {
        //add handler for ab switching    
        tbSync.dav.onAbSelectChangeNewCard(window);
        window.document.getElementById("abPopup").addEventListener("select", function () {tbSync.dav.onAbSelectChangeNewCard(window);}, false);
        RegisterSaveListener(tbSync.dav.onSaveCard);
    } else {
        window.RegisterLoadListener(tbSync.dav.onLoadCard);
        window.RegisterSaveListener(tbSync.dav.onSaveCard);

        //if this window was open during inject, load the extra fields
        if (gEditCard) tbSync.dav.onLoadCard(gEditCard.card, window.document);
    }
}

tbSync.dav.onAbSelectChangeNewCard = function(window) {
    let folders = tbSync.db.findFoldersWithSetting("target", window.document.getElementById("abPopup").value);
    let dav = (folders.length == 1 && tbSync.db.getAccountSetting(folders[0].account, "provider") == "dav");
    window.document.getElementById("DavMainPhoneContainer").hidden = !dav;
    window.document.getElementById("DavMiddleNameContainer").hidden = !dav;
    window.document.getElementById("WorkAddress2Container").hidden = dav;
    window.document.getElementById("abHomeTab").children[1].hidden = dav;
}

//What to do, if card is opened for edit in UI (listener only registerd for DAV cards, so no need to check again)
tbSync.dav.onLoadCard = function (aCard, aDocument) {
    //aDocument.defaultView.console.log("read:" + aCard.getProperty("DAV-MiddleName", ""));
    let items = aDocument.getElementsByClassName("davProperty");
    for (let i=0; i < items.length; i++)
    {
        items[i].value = aCard.getProperty(items[i].id, "");
    }
    window.document.getElementById("WorkAddress2Container").hidden = true;
    window.document.getElementById("abHomeTab").children[1].hidden = true;
    
}


//What to do, if card is saved in UI (listener is registered for all cards, so we need to check for DAV cards)
tbSync.dav.onSaveCard = function (aCard, aDocument) {
    //use the hidden status of DavMiddleNameContainer to know, if this is an dav card
    if (window.document.getElementById("DavMiddleNameContainer") && !window.document.getElementById("DavMiddleNameContainer").hidden) {
        let items = aDocument.getElementsByClassName("davProperty");
        for (let i=0; i < items.length; i++)
        {
            aCard.setProperty(items[i].id, items[i].value);
        }
    }
}
