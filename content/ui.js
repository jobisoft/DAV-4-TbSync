/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

var ui = {

    //function to get correct uri of current card for global book as well for mailLists
    getSelectedUri : function(aUri, aCard) {       
        if (aUri == "moz-abdirectory://?") {
            //get parent via card owner
            let ownerId = aCard.directoryId;
            return tbSync.addressbook.getUriFromDirectoryId(ownerId);            
        } else if (MailServices.ab.getDirectory(aUri).isMailList) {
            //MailList suck, we have to cut the url to get the parent
            return aUri.substring(0, aUri.lastIndexOf("/"))     
        } else {
            return aUri;
        }
    },



    //* * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    //* Functions to handle advanced UI elements of AB
    //* * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

    updatePref: function(aDocument, icon, toggle = false) {       
        if (toggle) {
            if (icon.parentNode.meta.includes("PREF")) icon.parentNode.meta = icon.parentNode.meta.filter(e => e != "PREF");
            else icon.parentNode.meta.push("PREF");            
 
            icon.parentNode.updateFunction (aDocument);
        }

        if (icon.parentNode.meta.includes("PREF")) {
            icon.setAttribute("src", "chrome://dav4tbsync/skin/type.pref.png");
        } else {
            icon.setAttribute("src", "chrome://dav4tbsync/skin/type.nopref.png");
        }
    },

    updateType: function(aDocument, button, newvalue = null) {        
        if (newvalue) {
            //we declare allowedValues to be non-overlapping -> remove all allowed values and just add the newvalue
            button.parentNode.meta = button.parentNode.meta.filter(value => -1 == button.allowedValues.indexOf(value));
            if (button.allowedValues.includes(newvalue)) {
                //hardcoded sort order: HOME/WORK always before other types
                if (["HOME","WORK"].includes(newvalue)) button.parentNode.meta.unshift(newvalue);
                else button.parentNode.meta.push(newvalue);
            }

            button.parentNode.updateFunction (aDocument);
        }

        let intersection = button.parentNode.meta.filter(value => -1 !== button.allowedValues.indexOf(value));
        let buttonType = (intersection.length > 0) ? intersection[0].toLowerCase() : button.otherIcon;       
        button.setAttribute("image","chrome://dav4tbsync/skin/type."+buttonType+"10.png");
    },    

    dragdrop: {
        handleEvent(event) {            
            //only allow to drag the elements which are valid drag targets
            if (event.target.getAttribute("dragtarget") != "true") {
                event.stopPropagation();
                return;
            }

            let outerbox = event.currentTarget;
            let richlistitem = outerbox.parentNode; 
                        
            switch (event.type) {
                case "dragenter":
                case "dragover":                 
                    let dropIndex = richlistitem.parentNode.getIndexOfItem(richlistitem);
                    let dragIndex = richlistitem.parentNode.getIndexOfItem(richlistitem.ownerDocument.getElementById(event.dataTransfer.getData("id")));

                    let centerY = event.currentTarget.clientHeight / 2;
                    let insertBefore = (event.offsetY < centerY);
                    let moveNeeded = !(dropIndex == dragIndex || (dropIndex+1 == dragIndex && !insertBefore) || (dropIndex-1 == dragIndex && insertBefore));

                    if (moveNeeded) {
                        if (insertBefore) {
                            richlistitem.parentNode.insertBefore(richlistitem.parentNode.getItemAtIndex(dragIndex), richlistitem);
                        } else {
                            richlistitem.parentNode.insertBefore(richlistitem.parentNode.getItemAtIndex(dragIndex), richlistitem.nextSibling);
                        }                        
                    }
                    
                    event.preventDefault();
                    break;
                
                case "drop":
                    event.preventDefault();
                case "dragleave":
                    break;
                
                case "dragstart": 
                    event.currentTarget.style["background-color"] = "#eeeeee"; 
                    event.dataTransfer.setData("id", richlistitem.id);
                    break;
                    
                case "dragend": 
                    event.currentTarget.style["background-color"] = "transparent";
                    outerbox.updateFunction(outerbox.ownerDocument);
                    break;
                
                default: 
                    return undefined;
          }
        },
    },
    
    //* * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    //* Functions to handle multiple email addresses in AB (UI)
    //* * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

    getEmailsFromCard: function (aCard) { //return array of objects {meta, value}
        let emails = aCard.getProperty("X-DAV-JSON-Emails","").trim();
        if (emails) {
            return JSON.parse(emails);
        }

        emails = [];
        
        //There is no X-DAV-JSON-Emails property (an empty JSON would not be "")
        //Is there a stored VCARD we can fallback to?
        let storedCard = aCard.getProperty("X-DAV-VCARD","").trim();
        let sCardData = dav.vCard.parse(storedCard);
        if (sCardData.hasOwnProperty("email")) {
            let metaTypeData = dav.tools.getMetaTypeData(sCardData, "email", "type");
            for (let i=0; i < metaTypeData.length; i++) {
                emails.push({value: sCardData["email"][i].value, meta: metaTypeData[i]});
            }
            return emails;
        }
        
        //So this card is not a "DAV" card: Get the emails from current emails stored in 
        //PrimaryEmail and SecondEmail
        for (let e of ["PrimaryEmail", "SecondEmail"]) {
            let email = aCard.getProperty(e,"").trim();
            if (email) {
                emails.push({value: email, meta: []});
            }
        }    
        return emails;
    },

    getEmailsFromJSON: function (emailDataJSON) {
        let emailFields = {};

        if (emailDataJSON) {
            try {
                //we pack the first entry into PrimaryEmail and all other into SecondEmail
                let emailData = JSON.parse(emailDataJSON);
                emailFields = {PrimaryEmail:[], SecondEmail:[]};
                
                for (let d=0; d < emailData.length; d++) {
                    let field = (d==0) ? "PrimaryEmail" : "SecondEmail";
                    emailFields[field].push(emailData[d].value);
                }
            } catch(e) {
                //something went wrong
                Components.utils.reportError(e);                
            }
        }
        
        //object with TB field names as keys and array of numbers as values
        return emailFields; 
    },


    getNewEmailDetailsRow: function (aWindow, aItemData) {
        let emailType = "other";
        if (aItemData.meta.includes("HOME")) emailType = "home";
        else if (aItemData.meta.includes("WORK")) emailType = "work";            

        //first column
        let vbox = aWindow.document.createElement("vbox");
        vbox.setAttribute("class","CardViewText");
        vbox.setAttribute("style","margin-right:1ex; margin-bottom:2px;");
            let image = aWindow.document.createElement("image");
            image.setAttribute("width","10");
            image.setAttribute("height","10");
            image.setAttribute("src", "chrome://dav4tbsync/skin/type."+emailType+"10.png");
        vbox.appendChild(image);

        //second column
        let description = aWindow.document.createElement("description");
        description.setAttribute("class","plain");
            let namespace = aWindow.document.lookupNamespaceURI("html");
            let a = aWindow.document.createElementNS(namespace, "a");
            a.setAttribute("href", "mailto:" + aItemData.value);    
            a.textContent = aItemData.value;
            description.appendChild(a);

            if (aItemData.meta.includes("PREF")) {
                let pref = aWindow.document.createElement("image");
                pref.setAttribute("style", "margin-left:1ex;");
                pref.setAttribute("width", "11");
                pref.setAttribute("height", "10");
                pref.setAttribute("src", "chrome://dav4tbsync/skin/type.nopref.png");
                description.appendChild(pref);
            }
        
        //row
        let row = aWindow.document.createElement("row");
        row.setAttribute("align","end");        
        row.appendChild(vbox);
        row.appendChild(description);
        return row;
    },
    
    getNewEmailListItem: function (aDocument, aItemData) {
        //hbox
        let outerhbox = aDocument.createElement("hbox");
        outerhbox.setAttribute("dragtarget", "true");
        outerhbox.setAttribute("flex", "1");
        outerhbox.setAttribute("align", "center");
        outerhbox.updateFunction = dav.tools.updateEmails;
        outerhbox.meta =  aItemData.meta;

        outerhbox.addEventListener("dragenter", dav.tools.dragdrop);
        outerhbox.addEventListener("dragover", dav.tools.dragdrop);
        outerhbox.addEventListener("dragleave", dav.tools.dragdrop);
        outerhbox.addEventListener("dragstart", dav.tools.dragdrop);
        outerhbox.addEventListener("dragend", dav.tools.dragdrop);
        outerhbox.addEventListener("drop", dav.tools.dragdrop);
        
        outerhbox.style["background-image"] = "url('chrome://dav4tbsync/skin/dragdrop.png')"; 
        outerhbox.style["background-position"] = "right";
        outerhbox.style["background-repeat"] = "no-repeat";
        
            //button
            let button = aDocument.createElement("button");
            button.allowedValues = ["HOME", "WORK"];
            button.otherIcon = "other";
            button.setAttribute("type", "menu");
            button.setAttribute("class", "plain");
            button.setAttribute("style", "width: 35px; min-width: 35px; margin: 0;");
            button.appendChild(aDocument.getElementById("DavEmailSpacer").children[0].cloneNode(true));
            outerhbox.appendChild(button);

            //email box
            let emailbox = aDocument.createElement("hbox");
            emailbox.setAttribute("flex", "1");
            emailbox.setAttribute("style", "padding-bottom:1px");
            let email = aDocument.createElement("textbox");
            email.setAttribute("flex", "1");
            email.setAttribute("class", "plain");
            email.setAttribute("value", aItemData.value);
            email.addEventListener("change", function(e) {dav.tools.updateEmails(aDocument)});
            email.addEventListener("keydown", function(e) {if (e.key == "Enter") {e.stopPropagation(); e.preventDefault(); if (e.target.value != "") { dav.tools.addEmailEntry(e.target.ownerDocument); }}});
            emailbox.appendChild(email);        
            outerhbox.appendChild(emailbox);
        
            //image
            let image = aDocument.createElement("image");
            image.setAttribute("width", "11");
            image.setAttribute("height", "10");
            image.setAttribute("style", "margin:2px 20px 2px 1ex");
            image.addEventListener("click", function(e) { dav.tools.updatePref(aDocument, e.target, true); });
            outerhbox.appendChild(image);
        
        //richlistitem
        let richlistitem = aDocument.createElement("richlistitem");
        richlistitem.setAttribute("id", "entry_" + tbSync.generateUUID());
        richlistitem.appendChild(outerhbox);
        
        return richlistitem;
    },
    
    getEmailListItemElement: function(item, element) {
        switch (element) {
            case "dataContainer": 
                return item.children[0];
            case "button": 
                return item.children[0].children[0];
            case "email":
                return item.children[0].children[1].children[0];
            case "pref":
                return item.children[0].children[2];
            default:
                return null;
        }
    },
    
    addEmailEntry: function(aDocument) {
        let list = aDocument.getElementById("X-DAV-EmailAddressList");
        let data = {value: "", meta: ["HOME"]};
        let item = list.appendChild(dav.tools.getNewEmailListItem(aDocument, data));
        list.ensureElementIsVisible(item);

        dav.tools.updateType(aDocument,  dav.tools.getEmailListItemElement(item, "button"));
        dav.tools.updatePref(aDocument, dav.tools.getEmailListItemElement(item, "pref"));
    
        dav.tools.getEmailListItemElement(item, "email").focus();
    },
    

    //if any setting changed, we need to update Primary and Secondary Email Fields
    updateEmails: function(aDocument) {
        let list = aDocument.getElementById("X-DAV-EmailAddressList");
        
        let emails = [];
        for (let i=0; i < list.children.length; i++) {
            let item = list.children[i];
            let email = dav.tools.getEmailListItemElement(item, "email").value.trim();
            if (email != "") {
                let json = {};
                json.meta = dav.tools.getEmailListItemElement(item, "dataContainer").meta;
                json.value = email;
                emails.push(json);
            } 
        }
        aDocument.getElementById("X-DAV-JSON-Emails").value = JSON.stringify(emails);
        
        //now update all other TB enail fields based on the new JSON data
        let emailData = dav.tools.getEmailsFromJSON(aDocument.getElementById("X-DAV-JSON-Emails").value);
        for (let field in emailData) {
            if (emailData.hasOwnProperty(field)) {
                aDocument.getElementById(field).value = emailData[field].join(", ");
            }
        }        
    },
    



    //* * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    //* Functions to handle multiple phone numbers in AB (UI)
    //* * * * * * * * * * * * * * * * * * * * * * * * * * * * *

    getPhoneNumbersFromCard: function (aCard) { //return array of objects {meta, value}
        let phones = aCard.getProperty("X-DAV-JSON-Phones","").trim();
        if (phones) {
            return JSON.parse(phones);
        }
                
        phones = [];
        
        //There is no X-DAV-JSON-Phones property (an empty JSON would not be "")
        //Is there a stored VCARD we can fallback to?
        let storedCard = aCard.getProperty("X-DAV-VCARD","").trim();
        let sCardData = dav.vCard.parse(storedCard);
        if (sCardData.hasOwnProperty("tel")) {
            let metaTypeData = dav.tools.getMetaTypeData(sCardData, "tel", "type");
            for (let i=0; i < metaTypeData.length; i++) {
                phones.push({value: sCardData["tel"][i].value, meta: metaTypeData[i]});
            }
            return phones;
        }
        
        //So this card is not a "DAV" card: Get the phone numbers from current numbers stored in 
        //CellularNumber, FaxNumber, PagerNumber, WorkPhone, HomePhone"},
        let todo = [
            {field: "CellularNumber", meta: ["CELL"]},
            {field: "FaxNumber", meta: ["FAX"]}, 
            {field: "PagerNumber", meta: ["PAGER"]}, 
            {field: "WorkPhone", meta: ["WORK"]}, 
            {field: "HomePhone", meta: ["HOME"]}
        ];
            
        for (let data of todo) {
            let phone = aCard.getProperty(data.field,"").trim();
            if (phone) {
                phones.push({value: phone, meta: data.meta});
            }
        }
        return phones;
    },

    getPhoneNumbersFromJSON: function (phoneDataJSON) {
        let phoneFields = {};

        if (phoneDataJSON) {
            try {
                //we first search and remove CELL, FAX, PAGER and WORK from the list and put the remains into HOME
                let phoneData = JSON.parse(phoneDataJSON);
                let phoneMap = [
                    {meta: "CELL", field: "CellularNumber"},
                    {meta: "FAX", field: "FaxNumber"},
                    {meta: "PAGER", field: "PagerNumber"},
                    {meta: "WORK", field: "WorkPhone"},
                    {meta: "", field: "HomePhone"},
                    ];
                
                for (let m=0; m < phoneMap.length; m++) {
                    phoneFields[phoneMap[m].field] = [];            
                    for (let d=phoneData.length-1; d >= 0; d--) {
                        if (phoneData[d].meta.includes(phoneMap[m].meta) || phoneMap[m].meta == "") {
                            phoneFields[phoneMap[m].field].unshift(phoneData[d].value);
                            phoneData.splice(d,1);
                        }
                    }
                }
            } catch(e) {
                //something went wrong
                Components.utils.reportError(e);                
            }
        }
        
        //object with TB field names as keys and array of numbers as values
        return phoneFields; 
    },

    getNewPhoneDetailsRow: function (aWindow, aItemData) {
        let phoneType1 = "";
        if (aItemData.meta.includes("HOME")) phoneType1 = "home";
        else if (aItemData.meta.includes("WORK")) phoneType1 = "work";            

        let phoneType2 = "";
        if (aItemData.meta.includes("CELL")) phoneType2 = "cell";            
        else if (aItemData.meta.includes("FAX")) phoneType2 = "fax";            
        else if (aItemData.meta.includes("PAGER")) phoneType2 = "pager";            
        else if (aItemData.meta.includes("CAR")) phoneType2 = "car";            
        else if (aItemData.meta.includes("VIDEO")) phoneType2 = "video";            
        else if (aItemData.meta.includes("VOICE")) phoneType2 = "voice";
        
        //first column
        let vbox = aWindow.document.createElement("hbox");
        vbox.setAttribute("pack","end");
        vbox.setAttribute("class","CardViewText");
        vbox.setAttribute("style","margin-bottom:3px;");
            if (phoneType1) {
                let image = aWindow.document.createElement("image");
                image.setAttribute("style","margin-right:1ex;");
                image.setAttribute("width","10");
                image.setAttribute("height","10");
                image.setAttribute("src", "chrome://dav4tbsync/skin/type."+phoneType1+"10.png");
                vbox.appendChild(image);
            }
            if (phoneType2) {
                let image = aWindow.document.createElement("image");
                image.setAttribute("style","margin-right:1ex;");
                image.setAttribute("width","10");
                image.setAttribute("height","10");
                image.setAttribute("src", "chrome://dav4tbsync/skin/type."+phoneType2+"10.png");
                vbox.appendChild(image);
            }

        //second column
        let description = aWindow.document.createElement("description");
        description.setAttribute("class","plain");
        description.setAttribute("style","-moz-user-select: text;");
        description.textContent = aItemData.value;

        if (aItemData.meta.includes("PREF")) {
            let pref = aWindow.document.createElement("image");
            pref.setAttribute("style", "margin-left:1ex;");
            pref.setAttribute("width", "11");
            pref.setAttribute("height", "10");
            pref.setAttribute("src", "chrome://dav4tbsync/skin/type.nopref.png");
            description.appendChild(pref);
        }
        
        //row
        let row = aWindow.document.createElement("row");
        row.setAttribute("align","end");        
        row.appendChild(vbox);
        row.appendChild(description);
        return row;
    },
    
    getNewPhoneListItem: function (aDocument, aItemData) {
        //hbox
        let outerhbox = aDocument.createElement("hbox");
        outerhbox.setAttribute("dragtarget", "true");
        outerhbox.setAttribute("flex", "1");
        outerhbox.setAttribute("align", "center");
        outerhbox.updateFunction = dav.tools.updatePhoneNumbers;
        outerhbox.meta = aItemData.meta;

        outerhbox.addEventListener("dragenter", dav.tools.dragdrop);
        outerhbox.addEventListener("dragover", dav.tools.dragdrop);
        outerhbox.addEventListener("dragleave", dav.tools.dragdrop);
        outerhbox.addEventListener("dragstart", dav.tools.dragdrop);
        outerhbox.addEventListener("dragend", dav.tools.dragdrop);
        outerhbox.addEventListener("drop", dav.tools.dragdrop);
        
        outerhbox.style["background-image"] = "url('chrome://dav4tbsync/skin/dragdrop.png')"; 
        outerhbox.style["background-position"] = "right";
        outerhbox.style["background-repeat"] = "no-repeat";

            //button1
            let button1 = aDocument.createElement("button");
            button1.allowedValues = ["HOME", "WORK"];
            button1.otherIcon = "none";
            button1.setAttribute("type", "menu");
            button1.setAttribute("class", "plain");
            button1.setAttribute("style", "width: 35px; min-width: 35px; margin: 0;");
            button1.appendChild(aDocument.getElementById("DavEmailSpacer").children[1].cloneNode(true));
            outerhbox.appendChild(button1);

            //button2
            let button2 = aDocument.createElement("button");
            button2.allowedValues = ["CELL", "FAX", "PAGER", "CAR", "VIDEO", "VOICE"] ; //same order as in getNewPhoneDetailsRow
            button2.otherIcon = "none";
            button2.setAttribute("type", "menu");
            button2.setAttribute("class", "plain");
            button2.setAttribute("style", "width: 35px; min-width: 35px; margin: 0;");
            button2.appendChild(aDocument.getElementById("DavEmailSpacer").children[2].cloneNode(true));
            outerhbox.appendChild(button2);

            //phone box
            let phonebox = aDocument.createElement("hbox");
            phonebox.setAttribute("flex", "1");
            phonebox.setAttribute("style", "padding-bottom:1px");
            let phone = aDocument.createElement("textbox");
            phone.setAttribute("flex", "1");
            phone.setAttribute("class", "plain");
            phone.setAttribute("value", aItemData.value);
            phone.addEventListener("change", function(e) {dav.tools.updatePhoneNumbers(aDocument)});
            phone.addEventListener("keydown", function(e) {if (e.key == "Enter") {e.stopPropagation(); e.preventDefault(); if (e.target.value != "") { dav.tools.addPhoneEntry(e.target.ownerDocument); }}});
            phonebox.appendChild(phone);        
            outerhbox.appendChild(phonebox);
        
            //image
            let image = aDocument.createElement("image");
            image.setAttribute("width", "11");
            image.setAttribute("height", "10");
            image.setAttribute("style", "margin:2px 20px 2px 1ex");
            image.addEventListener("click", function(e) { dav.tools.updatePref(aDocument, e.target, true); });
            outerhbox.appendChild(image);
        
        //richlistitem
        let richlistitem = aDocument.createElement("richlistitem");
        richlistitem.setAttribute("id", "entry_" + tbSync.generateUUID());
        richlistitem.appendChild(outerhbox);
        
        return richlistitem;
    },
    
    updatePhoneNumbers: function(aDocument) {
        let list = aDocument.getElementById("X-DAV-PhoneNumberList");
        
        let phones = [];
        for (let i=0; i < list.children.length; i++) {
            let item = list.children[i];
            let phone = dav.tools.getPhoneListItemElement(item, "phone").value.trim();
            if (phone != "") {
                let json = {};
                json.meta = dav.tools.getPhoneListItemElement(item, "dataContainer").meta;
                json.value = phone;
                phones.push(json);
            } 
        }
        aDocument.getElementById("X-DAV-JSON-Phones").value = JSON.stringify(phones);
        
        //now update all other TB number fields based on the new JSON data
        let phoneData = dav.tools.getPhoneNumbersFromJSON(aDocument.getElementById("X-DAV-JSON-Phones").value);
        for (let field in phoneData) {
            if (phoneData.hasOwnProperty(field)) {
                aDocument.getElementById(field).value = phoneData[field].join(", ");
            }
        }        
    },

    addPhoneEntry: function(aDocument) {
        let list = aDocument.getElementById("X-DAV-PhoneNumberList");
        let data = {value: "", meta: ["VOICE"]};
        let item = list.appendChild(dav.tools.getNewPhoneListItem(aDocument, data));
        list.ensureElementIsVisible(item);

        dav.tools.updateType(aDocument, dav.tools.getPhoneListItemElement(item, "button1"));
        dav.tools.updateType(aDocument, dav.tools.getPhoneListItemElement(item, "button2"));
        dav.tools.updatePref(aDocument, dav.tools.getPhoneListItemElement(item, "pref"));
    
        dav.tools.getPhoneListItemElement(item, "phone").focus();
    },    

    getPhoneListItemElement: function(item, element) {
        switch (element) {
            case "dataContainer": 
                return item.children[0];
            case "button1": 
                return item.children[0].children[0];
            case "button2": 
                return item.children[0].children[1];
            case "phone":
                return item.children[0].children[2].children[0];
            case "pref":
                return item.children[0].children[3];
            default:
                return null;
        }
    },

}
