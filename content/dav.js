/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

// every object in here will be loaded into tbSync.providers.<providername> namespace
const dav = tbSync.providers.dav;

var prefSettings = Services.prefs.getBranch("extensions.dav4tbsync.");
var listOfRealms = {};

var ns = {
    d: "DAV:",
    cal: "urn:ietf:params:xml:ns:caldav" ,
    card: "urn:ietf:params:xml:ns:carddav" ,
    cs: "http://calendarserver.org/ns/",
    s: "http://sabredav.org/ns",
    apple: "http://apple.com/ns/ical/"
};

var serviceproviders = {
    "fruux" : {icon: "fruux", caldav: "https://dav.fruux.com", carddav: "https://dav.fruux.com"},
    "icloud" : {icon: "icloud", caldav: "https://caldav.icloud.com", carddav: "https://contacts.icloud.com"},
    "yahoo" : {icon: "yahoo", caldav: "https://caldav.calendar.yahoo.com", carddav: "https://carddav.address.yahoo.com"},
    "gmx.net" : {icon: "gmx", caldav: "https://caldav.gmx.net", carddav: "https://carddav.gmx.net/.well-known/carddav"},
    "gmx.com" : {icon: "gmx", caldav: "https://caldav.gmx.com", carddav: "https://carddav.gmx.com/.well-known/carddav"},
    "posteo" : {icon: "posteo", caldav: "https://posteo.de:8443", carddav: "posteo.de:8843"},
};

//https://bugzilla.mozilla.org/show_bug.cgi?id=669675
//non permanent cache
var problematicHosts = [];

/*var calendarManagerObserver = {
    onCalendarRegistered : function (aCalendar) {
        //this observer can go stale, if something bad happens during load and the unload is never called
        if (tbSync) {
            //identify a calendar which has been deleted and is now being recreated by lightning (not TbSync) - which is probably due to changing the offline support option
            let folders =  tbSync.db.findFoldersWithSetting(["status"], ["aborted"]); //if it is pending status, we are creating it, not someone else
            for (let f=0; f < folders.length; f++) {
                let provider = tbSync.db.getAccountSetting(folders[f].account, "provider");
            
                //only act on dav calendars which have the same uri
                if (provider == "dav" && folders[f].selected == "1" && folders[f].url == aCalendar.uri.spec) {
                    tbSync.db.setFolderSetting(folders[f].account, folders[f].folderID, "status", tbSync.StatusData.SUCCESS);
                    //add target to re-take control
                    tbSync.db.setFolderSetting(folders[f].account, folders[f].folderID, "target", aCalendar.id);
                    //update settings window, if open
                    Services.obs.notifyObservers(null, "tbsync.observer.manager.updateSyncstate", folders[f].account);
                }
            }
        }
    },
    onCalendarUnregistering : function (aCalendar) {},
    onCalendarDeleting : function (aCalendar) {},
};

var calendarObserver = { 
    onStartBatch : function () {},
    onEndBatch : function () {},
    onLoad : function (aCalendar) {},
    onAddItem : function (aItem) {},
    onModifyItem : function (aNewItem, aOldItem) {},
    onDeleteItem : function (aDeletedItem) {},
    onError : function (aCalendar, aErrNo, aMessage) {},
    onPropertyDeleting : function (aCalendar, aName) {},

    //Properties of the calendar itself (name, color etc.)
    onPropertyChanged : function (aCalendar, aName, aValue, aOldValue) {
        //this observer can go stale, if something bad happens during load and the unload is never called
        if (tbSync) {
            let folders = tbSync.db.findFoldersWithSetting(["target"], [aCalendar.id]);
            if (folders.length == 1) {
                switch (aName) {
                    case "color":
                        //prepare connection data
                        let accountData = new tbSync.AccountData(folders[0].account, folders[0].folderID);
                        let connection = new dav.network.Connection(accountData);

                        //update stored color to recover after disable
                        dav.network.sendRequest("<d:propertyupdate "+dav.tools.xmlns(["d","apple"])+"><d:set><d:prop><apple:calendar-color>"+(aValue + "FFFFFFFF").slice(0,9)+"</apple:calendar-color></d:prop></d:set></d:propertyupdate>", folders[0].href, "PROPPATCH", connection);
                        break;
                }
            }
        }
    },
};*/

function onSettingsGUILoad(window, accountID) {
    let serviceprovider = tbSync.db.getAccountSetting(accountID, "serviceprovider");
    let isServiceProvider = dav.serviceproviders.hasOwnProperty(serviceprovider);
    
    // special treatment for configuration label, which is a permanent setting and will not change by switching modes
    let configlabel = window.document.getElementById("tbsync.accountsettings.label.config");
    if (configlabel) {
        let extra = "";
        if (isServiceProvider) {
            extra = " [" + tbSync.getString("add.serverprofile." + serviceprovider, "dav") + "]";
        }
        configlabel.setAttribute("value", tbSync.getString("config.custom", "dav") + extra);
    }

    //set certain elements as "alwaysDisable", if locked by service provider (alwaysDisabled is honored by main SettingsUpdate, so we do not have to do that in our own onSettingsGUIUpdate
    if (isServiceProvider) {
        let items = window.document.getElementsByClassName("lockIfServiceProvider");
        for (let i=0; i < items.length; i++) {
            items[i].setAttribute("alwaysDisabled", "true");
        }
    }
};

function stripHost(document, accountID, field) {
    let host = document.getElementById('tbsync.accountsettings.pref.' + field).value;
    if (host.indexOf("https://") == 0) {
        host = host.replace("https://","");
        document.getElementById('tbsync.accountsettings.pref.https').checked = true;
        tbSync.db.setAccountSetting(accountID, "https", true);
    } else if (host.indexOf("http://") == 0) {
        host = host.replace("http://","");
        document.getElementById('tbsync.accountsettings.pref.https').checked = false;
        tbSync.db.setAccountSetting(accountID, "https", false);
    }
    
    while (host.endsWith("/")) { host = host.slice(0,-1); }        
    document.getElementById('tbsync.accountsettings.pref.' + field).value = host
    tbSync.db.setAccountSetting(accountID, field, host);
};


/**
 * Implementation the TbSync interfaces for external provider extensions.
 */

var api = {    
    /**
     * Called during load of external provider extension to init provider.
     *
     * @param lightningIsAvail       [in] indicate wheter lightning is installed/enabled
     */
    load: async function (lightningIsAvail) {
        //load overlays or do other init stuff, use lightningIsAvail to init stuff if lightning is installed
        dav.overlayManager = new OverlayManager({verbose: 0});
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abNewCardDialog.xul", "chrome://dav4tbsync/content/overlays/abNewCardWindow.xul");
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abNewCardDialog.xul", "chrome://dav4tbsync/content/overlays/abCardWindow.xul");
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abEditCardDialog.xul", "chrome://dav4tbsync/content/overlays/abCardWindow.xul");
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://dav4tbsync/content/overlays/addressbookoverlay.xul");
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://dav4tbsync/content/overlays/addressbookdetailsoverlay.xul");
        dav.overlayManager.startObserving();

        if (lightningIsAvail) {
            //cal.getCalendarManager().addObserver(dav.calendarManagerObserver);    
            //cal.getCalendarManager().addCalendarObserver(dav.calendarObserver);            
        }
    },



    /**
     * Called during unload of external provider extension to unload provider.
     *
     * @param lightningIsAvail       [in] indicate wheter lightning is installed/enabled
     */
    unload: async function (lightningIsAvail) {
        if (lightningIsAvail) {
            //cal.getCalendarManager().removeObserver(dav.calendarManagerObserver);
            //cal.getCalendarManager().removeCalendarObserver(dav.calendarObserver);                        
        }
        dav.overlayManager.stopObserving();	
    },





    /**
     * Returns nice string for name of provider (is used in the add account menu).
     */
    getNiceProviderName: function () {
        return tbSync.getString("menu.name", "dav");
    },


    /**
     * Returns location of a provider icon.
     *
     * @param size       [in] size of requested icon
     * @param accountData  [in] optional AccountData
     *
     */
    getProviderIcon: function (size, accountData = null) {
        let base = "sabredav";
        if (accountData) {
            let serviceprovider = accountData.getAccountSetting("serviceprovider");
            if (dav.serviceproviders.hasOwnProperty(serviceprovider)) {
                base = dav.serviceproviders[serviceprovider].icon;
            }
        }
        
        switch (size) {
            case 16:
                return "chrome://dav4tbsync/skin/"+base+"16.png";
            case 32:
                return "chrome://dav4tbsync/skin/"+base+"32.png";
            default :
                return "chrome://dav4tbsync/skin/"+base+"48.png";
        }
    },



    /**
     * Returns a list of sponsors, they will be sorted by the index
     */
    getSponsors: function () {
        return {
            "Thoben, Marc" : {name: "Marc Thoben", description: "Zimbra", icon: "", link: "" },
            "Biebl, Michael" : {name: "Michael Biebl", description: "Nextcloud", icon: "", link: "" },
            "László, Kovács" : {name: "Kovács László", description : "Radicale", icon: "", link: "" },
            "Lütticke, David" : {name: "David Lütticke", description : "", icon: "", link: "" },
        };
    },



    /**
     * Returns the email address of the maintainer (used for bug reports).
     */
    getMaintainerEmail: function () {
        return "john.bieling@gmx.de";
    },


    /**
     * Returns the URL of the string bundle file of this provider, it can be accessed by
     * tbSync.getString(<key>, <provider>)
     */
    getStringBundleUrl: function () {
        return "chrome://dav4tbsync/locale/dav.strings";
    },
    
    
    /**
     * Returns XUL URL of the authentication prompt window
     */
    getAuthPromptXulUrl: function () {
        return "chrome://tbsync/content/manager/password.xul";
    },

    
    /**
     * Returns XUL URL of the new account dialog.
     */
    getCreateAccountXulUrl: function () {
        return "chrome://dav4tbsync/content/manager/createAccount.xul";
    },


    /**
     * Returns overlay XUL URL of the edit account dialog (chrome://tbsync/content/manager/editAccount.xul)
     */
    getEditAccountOverlayUrl: function () {
        return "chrome://dav4tbsync/content/manager/editAccountOverlay.xul";
    },



    /**
     * Return object which contains all possible fields of a row in the accounts database with the default value if not yet stored in the database.
     */
    getDefaultAccountEntries: function () {
        let row = {
            "useCalendarCache" : true,
            "calDavHost" : "",            
            "cardDavHost" : "",
            "serviceprovider" : "",
            "user" : "",
            "https" : true,
            "createdWithProviderVersion" : "0",
            "syncGroups" : false,
            }; 
        return row;
    },


    /**
     * Return object which contains all possible fields of a row in the folder database with the default value if not yet stored in the database.
     */
    getDefaultFolderEntries: function () { //TODO: shadow more standard entries
        let folder = {
            "selected" : false,
            "lastsynctime" : 0,
            "status" : "",
            "name" : "",
            "target" : "",
            "targetName" : "",
            "downloadonly" : false,

            //different folders can be stored on different servers (yahoo, icloud, gmx, ...), 
            //so we need to store the fqdn information per folders
            "href" : "",
            "fqdn" : "",

            "type" : "", //cladav, carddav or ics
            "shared": false, //identify shared resources
            "acl": "", //acl send from server
            "targetColor" : "",
            "ctag" : "",
            "token" : "",
            "createdWithProviderVersion" : "0",
            };
        return folder;
    },



    /**
     * Is called everytime an account of this provider is enabled in the manager UI, set/reset database fields as needed.
     *
     * @param accountData  [in] AccountData
     */
    onEnableAccount: function (accountData) {
    },



    /**
     * Is called everytime an account of this provider is disabled in the manager UI, set/reset database fields as needed and
     * remove/backup all sync targets of this account.
     *
     * @param accountData  [in] AccountData
     */
    onDisableAccount: function (accountData) {
    },



    /**
     * Is called everytime an new target is created, intended to set a clean sync status.
     *
     * @param accountData  [in] FolderData
     */
    onResetTarget: function (folderData) {
        folderData.resetFolderSetting("ctag");
        folderData.resetFolderSetting("token");
        folderData.setFolderSetting("createdWithProviderVersion", folderData.accountData.providerData.getVersion());
    },



    /**
     * Is called if TbSync needs to find contacts in the global address list (GAL / directory) of an account associated with this provider.
     * It is used for autocompletion while typing something into the address field of the message composer and for the address book search,
     * if something is typed into the search field of the Thunderbird address book.
     *
     * DO NOT IMPLEMENT AT ALL, IF NOT SUPPORTED
     *
     * TbSync will execute this only for queries longer than 3 chars.
     *
     * @param accountID       [in] id of the account which should be searched
     * @param currentQuery  [in] search query
     * @param caller        [in] "autocomplete" or "search" //TODO
     */
    abServerSearch: async function (accountID, currentQuery, caller)  {
        return null;
    },



    /**
     * Returns all folders of the account, sorted in the desired order.
     * The most simple implementation is to return accountData.getAllFolders();
     *
     * @param accountData         [in] AccountData for the account for which the 
     *                                 sorted folder should be returned
     */
    getSortedFolders: function (accountData) {
        let folders = accountData.getAllFolders();

        //we can only sort arrays, so we need to create an array of objects and those objects 
        //must contain the sort key and the associated folder
        let toBeSorted = [];
        for (let folder of folders) {
            let t = 100;
            switch (folder.getFolderSetting("type")) {
                case "carddav": 
                    t+=0; 
                    break;
                case "caldav": 
                    t+=1; 
                    break;
                case "ics": 
                    t+=2; 
                    break;
                default:
                    t+=9;
                    break;
            }

            if (folder.getFolderSetting("shared")) {
                t+=100;
            }
            
            toBeSorted.push({"key": t.toString() + folder.getFolderSetting("name"), "folder": folder});
        }
        
        //sort
        toBeSorted.sort(function(a,b) {
            return  a.key > b.key;
        });
        
        let sortedFolders = [];
        for (let sortObj of toBeSorted) {
            sortedFolders.push(sortObj.folder);
        }
        return sortedFolders;
    },


    /**
     * Is called if TbSync needs to synchronize the folder list.
     *
     * @param syncData      [in] SyncData
     *
     * return StatusData
     */
    syncFolderList: async function (syncData) {
        //update folders avail on server and handle added, removed, renamed folders
        return await dav.sync.folderList(syncData);
    },
    
    /**
     * Is called if TbSync needs to synchronize a folder.
     *
     * @param syncData      [in] SyncData
     *
     * return StatusData
     */
    syncFolder: async function (syncData) {
        //process a single folder
        return await dav.sync.folder(syncData);
    },
}



// this provider is using the default authPrompt, so it must implement passwordAuth
var passwordAuth = {    
    getUserField4PasswordManager : function (accountData) {
        return "user";
    },
    
    getHostField4PasswordManager : function (accountData) {
        let host = accountData.getAccountSetting("calDavHost");
        return host ? "calDavHost" : "cardDavHost";
    },
}



// this provider is using the standard "addressbook" targetType, so it must implement the addressbook object
var addressbook = {

    // define a card property, which should be used for the changelog
    // basically your primary key for the abItem properties
    // UID will be used, if nothing specified
    changeLogKey: "X-DAV-HREF",
    
    // enable or disable changelog
    logUserChanges: true,

    directoryObserver: function (aTopic, folderData) {
        switch (aTopic) {
            case "addrbook-removed":
            case "addrbook-updated":
                Services.console.logStringMessage("["+ aTopic + "] " + folderData.getFolderSetting("name"));
            break;
        }
    },
    
    cardObserver: function (aTopic, folderData, abCardItem) {
        switch (aTopic) {
            case "addrbook-contact-created":
            case "addrbook-contact-updated":
            case "addrbook-contact-removed":
                Services.console.logStringMessage("["+ aTopic + "] " + abCardItem.getProperty("DisplayName"));
            break;
        }
    },
    
    listObserver: function (aTopic, folderData, abListItem, abListMember) {
        switch (aTopic) {
            case "addrbook-list-member-added":
            case "addrbook-list-member-removed":
                Services.console.logStringMessage("["+ aTopic + "] " + abListMember.getProperty("DisplayName"));

            case "addrbook-list-created": 
            case "addrbook-list-removed":
            case "addrbook-list-updated":
                Services.console.logStringMessage("["+ aTopic + "] " + abListItem.getProperty("ListName"));
            break;
        }
    },
    
    /**
     * Is called by TargetData::getTarget() if  the standard "addressbook" targetType is used, and a new addressbook needs to be created.
     *
     * @param newname       [in] name of the new address book
     * @param folderData  [in] FolderData
     *
     * return the new directory
     */
    createAddressBook: function (newname, folderData) {
        // maybe use target.create or something
        let dirPrefId = MailServices.ab.newAddressBook(newname, "", 2);
        let directory = MailServices.ab.getDirectoryFromId(dirPrefId);

        if (directory && directory instanceof Components.interfaces.nsIAbDirectory && directory.dirPrefId == dirPrefId) {
            let serviceprovider = folderData.accountData.getAccountSetting("serviceprovider");
            let icon = "custom";
            if (dav.serviceproviders.hasOwnProperty(serviceprovider)) {
                icon = dav.serviceproviders[serviceprovider].icon;
            }
            directory.setStringValue("tbSyncIcon", "dav" + icon);
            return directory;
        }
        return null;
    },    
}



// this provider is using the standard "calendar" targetType, so it must implement the calendar object
var calendar = {
    
    // define a card property, which should be used for the changelog
    // basically your primary key for the abItem properties
    // UID will be used, if nothing specified
    changeLogKey: "",
    
    // enable or disable changelog
    logUserChanges: false,

    /**
     * Is called by TargetData::getTarget() if  the standard "calendar" targetType is used, and a new calendar needs to be created.
     *
     * @param newname       [in] name of the new calendar
     * @param folderData  [in] folderData
     *
     * return the new calendar
     */
    createCalendar: function(newname, folderData) {
        let calManager = cal.getCalendarManager();
        let auth = new tbSync.PasswordAuthData(folderData.accountData);
        
        let caltype = folderData.getFolderSetting("type");

        let baseUrl = "";
        if (caltype != "ics") {
            baseUrl =  "http" + (folderData.accountData.getAccountSetting("https") ? "s" : "") + "://" + (dav.prefSettings.getBoolPref("addCredentialsToUrl") ? encodeURIComponent(auth.getUsername()) + ":" + encodeURIComponent(auth.getPassword()) + "@" : "") + folderData.getFolderSetting("fqdn");
        }

        let url = dav.tools.parseUri(baseUrl + folderData.getFolderSetting("href"));        
        folderData.setFolderSetting("url", url.spec);

        //check if that calendar already exists
        let cals = calManager.getCalendars({});
        let newCalendar = null;
        let found = false;
        for (let calendar of calManager.getCalendars({})) {
            if (calendar.uri.spec == url.spec) {
                newCalendar = calendar;
                found = true;
                break;
            }
        }

        if (!found) {
            newCalendar = calManager.createCalendar(caltype, url); //caldav or ics
            newCalendar.id = cal.getUUID();
            newCalendar.name = newname;

            newCalendar.setProperty("user", auth.getUsername());
            newCalendar.setProperty("color", folderData.getFolderSetting("targetColor"));
            newCalendar.setProperty("calendar-main-in-composite", true);
            newCalendar.setProperty("cache.enabled", folderData.accountData.getAccountSetting("useCalendarCache"));
        }
        
        if (folderData.getFolderSetting("downloadonly")) newCalendar.setProperty("readOnly", true);

        //only add credentials to password manager if they are not added to the URL directly - only for caldav calendars, not for plain ics files
        if (!dav.prefSettings.getBoolPref("addCredentialsToUrl") && caltype != "ics") {
            tbSync.dump("Searching CalDAV authRealm for", url.host);
            let realm = (dav.listOfRealms.hasOwnProperty(url.host)) ? dav.listOfRealms[url.host] : "";
            if (realm !== "") {
                tbSync.dump("Found CalDAV authRealm",  realm);
                //manually create a lightning style entry in the password manager
                tbSync.passwordAuth.setLoginInfo(url.prePath, realm, auth.getUsername(), auth.getPassword());
            }
        }

        if (!found) {
            calManager.registerCalendar(newCalendar);
        }
        return newCalendar;
    },
}


// this provider is using the standardFolderList (instead of this it could also implement the full folderList)
var standardFolderList = {
    /**
     * Is called before the context menu of the folderlist is shown, allows to
     * show/hide custom menu options based on selected folder
     *
     * @param document       [in] document object of the account settings window
     * @param folderData         [in] FolderData of the selected folder
     */
    onContextMenuShowing: function (document, folderData) {
    },

    /**
     * Return the icon used in the folderlist to represent the different folder types 
     *
     * @param folderData         [in] FolderData of the selected folder
     */
    getTypeImage: function (folderData) {
        let src = "";
        switch (folderData.getFolderSetting("type")) {
            case "carddav":
                if (folderData.getFolderSetting("shared")) {
                    return "chrome://tbsync/skin/contacts16_shared.png";
                } else {
                    return "chrome://tbsync/skin/contacts16.png";
                }
            case "caldav":
                if (folderData.getFolderSetting("shared")) {
                    return "chrome://tbsync/skin/calendar16_shared.png";
                } else {
                    return "chrome://tbsync/skin/calendar16.png";
                }
            case "ics":
                return "chrome://dav4tbsync/skin/ics16.png";
        }
    },
    
    getAttributesRoAcl: function (folderData) {
        return {
            label: tbSync.getString("acl.readonly", "dav"),
        };
    },
    
    getAttributesRwAcl: function (folderData) {
        let acl = parseInt(folderData.getFolderSetting("acl"));
        let acls = [];
        if (acl & 0x2) acls.push(tbSync.getString("acl.modify", "dav"));
        if (acl & 0x4) acls.push(tbSync.getString("acl.add", "dav"));
        if (acl & 0x8) acls.push(tbSync.getString("acl.delete", "dav"));
        if (acls.length == 0)  acls.push(tbSync.getString("acl.none", "dav"));

        return {
            label: tbSync.getString("acl.readwrite::"+acls.join(", "), "dav"),
            disabled: (acl & 0x7) != 0x7,
        }             
    },
}

Services.scriptloader.loadSubScript("chrome://dav4tbsync/content/sync.js", this, "UTF-8");
Services.scriptloader.loadSubScript("chrome://dav4tbsync/content/tools.js", this, "UTF-8");
Services.scriptloader.loadSubScript("chrome://dav4tbsync/content/network.js", this, "UTF-8");
Services.scriptloader.loadSubScript("chrome://dav4tbsync/content/vcard/vcard.js", this, "UTF-8");
