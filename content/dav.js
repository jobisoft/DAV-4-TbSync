/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

// Every object in here will be loaded into tbSync.providers.<providername>.
const dav = tbSync.providers.dav;

/**
 * Implementation the TbSync interfaces for external provider extensions.
 */

var base = {
    /**
     * Called during load of external provider extension to init provider.
     */
    load: async function () {
        dav.openWindows = {};

        dav.overlayManager = new OverlayManager({verbose: 0});
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abNewCardDialog.xul", "chrome://dav4tbsync/content/overlays/abNewCardWindow.xul");
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abNewCardDialog.xul", "chrome://dav4tbsync/content/overlays/abCardWindow.xul");
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abEditCardDialog.xul", "chrome://dav4tbsync/content/overlays/abCardWindow.xul");
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://dav4tbsync/content/overlays/addressbookoverlay.xul");
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://dav4tbsync/content/overlays/addressbookdetailsoverlay.xul");
        dav.overlayManager.startObserving();
    },



    /**
     * Called during unload of external provider extension to unload provider.
     */
    unload: async function () {
        dav.overlayManager.stopObserving();	

        // Close all open windows of this provider.
        for (let id in dav.openWindows) {
          if (dav.openWindows.hasOwnProperty(id)) {
            dav.openWindows[id].close();
          }
        }
    },





    /**
     * Returns nice string for the name of provider for the add account menu.
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
        let root = "sabredav";
        if (accountData) {
            let serviceprovider = accountData.getAccountProperty("serviceprovider");
            if (dav.sync.serviceproviders.hasOwnProperty(serviceprovider)) {
                root = dav.sync.serviceproviders[serviceprovider].icon;
            }
        }
        
        switch (size) {
            case 16:
                return "chrome://dav4tbsync/skin/"+root+"16.png";
            case 32:
                return "chrome://dav4tbsync/skin/"+root+"32.png";
            default :
                return "chrome://dav4tbsync/skin/"+root+"48.png";
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
     * Returns the URL of the string bundle file of this provider, it can be
     * accessed by tbSync.getString(<key>, <provider>)
     */
    getStringBundleUrl: function () {
        return "chrome://dav4tbsync/locale/dav.strings";
    },

    
    /**
     * Returns URL of the new account window.
     *
     * The URL will be opened via openDialog(), when the user wants to create a
     * new account of this provider.
     */
    getCreateAccountWindowUrl: function () {
        return "chrome://dav4tbsync/content/manager/createAccount.xul";
    },


    /**
     * Returns overlay XUL URL of the edit account dialog
     * (chrome://tbsync/content/manager/editAccount.xul)
     *
     * The overlay must (!) implement:
     *
     *    tbSyncEditAccountOverlay.onload(window, accountData)
     *
     * which is called each time an account of this provider is viewed/selected
     * in the manager and provides the tbSync.AccountData of the corresponding
     * account.
     */
    getEditAccountOverlayUrl: function () {
        return "chrome://dav4tbsync/content/manager/editAccountOverlay.xul";
    },



    /**
     * Return object which contains all possible fields of a row in the
     * accounts database with the default value if not yet stored in the 
     * database.
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
     * Return object which contains all possible fields of a row in the folder 
     * database with the default value if not yet stored in the database.
     */
    getDefaultFolderEntries: function () {
        let folder = {
            // different folders (caldav/carddav) can be stored on different 
            // servers (as with yahoo, icloud, gmx, ...), so we need to store
            // the fqdn information per folders
            "href" : "",
            "fqdn" : "",

            "url" : "", // used by calendar to store the full url of this cal
            
            "type" : "", //caldav, carddav or ics
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
     * Is called everytime an account of this provider is enabled in the
     * manager UI.
     *
     * @param accountData  [in] AccountData
     */
    onEnableAccount: function (accountData) {
    },



    /**
     * Is called everytime an account of this provider is disabled in the
     * manager UI.
     *
     * @param accountData  [in] AccountData
     */
    onDisableAccount: function (accountData) {
    },



    /**
     * Is called everytime an new target is created, intended to set a clean
     * sync status.
     *
     * @param accountData  [in] FolderData
     */
    onResetTarget: function (folderData) {
        folderData.resetFolderProperty("ctag");
        folderData.resetFolderProperty("token");
        folderData.setFolderProperty("createdWithProviderVersion", folderData.accountData.providerData.getVersion());
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

        // we can only sort arrays, so we create an array of objects which must
        // contain the sort key and the associated folder
        let toBeSorted = [];
        for (let folder of folders) {
            let t = 100;
            switch (folder.getFolderProperty("type")) {
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

            if (folder.getFolderProperty("shared")) {
                t+=100;
            }
            
            toBeSorted.push({"key": t.toString() + folder.getFolderProperty("foldername"), "folder": folder});
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
     * Return the connection timeout for an active sync, so TbSync can append
     * a countdown to the connection timeout, while waiting for an answer from
     * the server. Only syncstates which start with "send." will trigger this.
     *
     * @param syncData      [in] SyncData
     *
     * return timeout in milliseconds
     */
    getConnectionTimeout: function (syncData) {
        return dav.sync.prefSettings.getIntPref("timeout");
    },
    
    /**
     * Is called if TbSync needs to synchronize the folder list.
     *
     * @param syncData      [in] SyncData
     * @param syncJob       [in] String with a specific sync job. Defaults to
     *                           "sync", but can be set via the syncDescription
     *                           of AccountData.sync() or FolderData.sync()
     * @param syncRunNr     [in] Indicates the n-th number the account is being synced.
     *                           It starts with 1 and is limited by 
     *                           syncDescription.maxAccountReruns.
     *
     * !!! NEVER CALL THIS FUNCTION DIRECTLY BUT USE !!!
     *    tbSync.AccountData::sync()
     *
     * return StatusData
     */
    syncFolderList: async function (syncData, syncJob, syncRunNr) {
        // update folders avail on server and handle added, removed and renamed
        // folders
        return await dav.sync.folderList(syncData);
    },
    
    /**
     * Is called if TbSync needs to synchronize a folder.
     *
     * @param syncData      [in] SyncData
     * @param syncJob       [in] String with a specific sync job. Defaults to
     *                           "sync", but can be set via the syncDescription
     *                           of AccountData.sync() or FolderData.sync()
     * @param syncRunNr     [in] Indicates the n-th number the folder is being synced.
     *                           It starts with 1 and is limited by 
     *                           syncDescription.maxFolderReruns.
     *
     * !!! NEVER CALL THIS FUNCTION DIRECTLY BUT USE !!!
     *    tbSync.AccountData::sync() or
     *    tbSync.FolderData::sync()
     *
     * return StatusData
     */
    syncFolder: async function (syncData, syncJob, syncRunNr) {
        //process a single folder
        return await dav.sync.folder(syncData);
    },    
}

// This provider is using the standard "addressbook" targetType, so it must
// implement the addressbook object.
var addressbook = {

    // define a card property, which should be used for the changelog
    // basically your primary key for the abItem properties
    // UID will be used, if nothing specified
    primaryKeyField: "X-DAV-HREF",
    
    generatePrimaryKey: function (folderData) {
         return folderData.getFolderProperty("href") + tbSync.generateUUID() + ".vcf";
    },
    
    // enable or disable changelog
    logUserChanges: true,

    directoryObserver: function (aTopic, folderData) {
        switch (aTopic) {
            case "addrbook-removed":
            case "addrbook-updated":
                //Services.console.logStringMessage("["+ aTopic + "] " + folderData.getFolderProperty("foldername"));
                break;
        }
    },
    
    cardObserver: function (aTopic, folderData, abCardItem) {
        switch (aTopic) {
            case "addrbook-contact-updated":
            case "addrbook-contact-removed":
                //Services.console.logStringMessage("["+ aTopic + "] " + abCardItem.getProperty("DisplayName"));
                break;

            case "addrbook-contact-created":
            {
                //Services.console.logStringMessage("["+ aTopic + "] Created new X-DAV-UID for Card <"+ abCardItem.getProperty("DisplayName")+">");
                abCardItem.setProperty("X-DAV-UID", tbSync.generateUUID());
                // the card is tagged with "_by_user" so it will not be changed to "_by_server" by the following modify
                abCardItem.abDirectory.modifyItem(abCardItem);
                break;
            }
        }
    },
    
    listObserver: function (aTopic, folderData, abListItem, abListMember) {
        switch (aTopic) {
            case "addrbook-list-member-added":
            case "addrbook-list-member-removed":
                //Services.console.logStringMessage("["+ aTopic + "] MemberName: " + abListMember.getProperty("DisplayName"));
                break;
            
            case "addrbook-list-removed":
            case "addrbook-list-updated":
                //Services.console.logStringMessage("["+ aTopic + "] ListName: " + abListItem.getProperty("ListName"));
                break;
            
            case "addrbook-list-created": 
                //Services.console.logStringMessage("["+ aTopic + "] Created new X-DAV-UID for List <"+abListItem.getProperty("ListName")+">");
                abListItem.setProperty("X-DAV-UID", tbSync.generateUUID());
                // custom props of lists get updated directly, no need to call .modify()            
                break;
        }
    },
    
    /**
     * Is called by TargetData::getTarget() if  the standard "addressbook"
     * targetType is used, and a new addressbook needs to be created.
     *
     * @param newname       [in] name of the new address book
     * @param folderData  [in] FolderData
     *
     * return the new directory
     */
    createAddressBook: function (newname, folderData) {
        // this is the standard target, should it not be created it like this?
        let dirPrefId = MailServices.ab.newAddressBook(newname, "", 2);
        let directory = MailServices.ab.getDirectoryFromId(dirPrefId);

        if (directory && directory instanceof Components.interfaces.nsIAbDirectory && directory.dirPrefId == dirPrefId) {
            let serviceprovider = folderData.accountData.getAccountProperty("serviceprovider");
            let icon = "custom";
            if (dav.sync.serviceproviders.hasOwnProperty(serviceprovider)) {
                icon = dav.sync.serviceproviders[serviceprovider].icon;
            }
            directory.setStringValue("tbSyncIcon", "dav" + icon);
            return directory;
        }
        return null;
    },    
}



// This provider is using the standard "calendar" targetType, so it must
// implement the calendar object.
var calendar = {
    
    // The calendar target does not support a custom primaryKeyField, because
    // the lightning implementation only allows to search for items via UID.
    // Like the addressbook target, the calendar target item element has a
    // primaryKey getter/setter which - however - only works on the UID.
    
    // enable or disable changelog
    //logUserChanges: false,
    
    calendarObserver: function (aTopic, folderData, aCalendar, aPropertyName, aPropertyValue, aOldPropertyValue) {
        switch (aTopic) {
            case "onCalendarPropertyChanged":
            {
                switch (aPropertyName) {
                    case "color":
                        if (aOldPropertyValue.toString().toUpperCase() != aPropertyValue.toString().toUpperCase()) {
                            //prepare connection data
                            let connection = new dav.network.ConnectionData(folderData);
                            //update color on server
                            dav.network.sendRequest("<d:propertyupdate "+dav.tools.xmlns(["d","apple"])+"><d:set><d:prop><apple:calendar-color>"+(aPropertyValue + "FFFFFFFF").slice(0,9)+"</apple:calendar-color></d:prop></d:set></d:propertyupdate>", folderData.getFolderProperty("href"), "PROPPATCH", connection);
                        }
                        break;
                }
            }
            break;
            
            case "onCalendarDeleted":
            case "onCalendarPropertyDeleted":
                //Services.console.logStringMessage("["+ aTopic + "] " + aCalendar.name);
                break;
        }
    },
    
    itemObserver: function (aTopic, folderData, aItem, aOldItem) {
        switch (aTopic) {
            case "onAddItem":
            case "onModifyItem":
            case "onDeleteItem":
                //Services.console.logStringMessage("["+ aTopic + "] " + aItem.title);
                break;
        }
    },

    /**
     * Is called by TargetData::getTarget() if  the standard "calendar" targetType is used, and a new calendar needs to be created.
     *
     * @param newname       [in] name of the new calendar
     * @param folderData  [in] folderData
     *
     * return the new calendar
     */
    createCalendar: function(newname, folderData) {
        let calManager = tbSync.lightning.cal.getCalendarManager();
        let authData = dav.network.getAuthData(folderData.accountData);
      
        let caltype = folderData.getFolderProperty("type");

        let baseUrl = "";
        if (caltype != "ics") {
            baseUrl =  "http" + (folderData.accountData.getAccountProperty("https") ? "s" : "") + "://" + folderData.getFolderProperty("fqdn");
        }

        let url = dav.tools.parseUri(baseUrl + folderData.getFolderProperty("href"));        
        folderData.setFolderProperty("url", url.spec);

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
            newCalendar.id = tbSync.lightning.cal.getUUID();
            newCalendar.name = newname;

            newCalendar.setProperty("username", authData.username);
            newCalendar.setProperty("color", folderData.getFolderProperty("targetColor"));
            newCalendar.setProperty("calendar-main-in-composite", true);
            newCalendar.setProperty("cache.enabled", folderData.accountData.getAccountProperty("useCalendarCache"));
        }
        
        if (folderData.getFolderProperty("downloadonly")) newCalendar.setProperty("readOnly", true);

        // ICS urls do not need a password
        if (caltype != "ics") {
            tbSync.dump("Searching CalDAV authRealm for", url.host);
            let realm = (dav.network.listOfRealms.hasOwnProperty(url.host)) ? dav.network.listOfRealms[url.host] : "";
            if (realm !== "") {
                tbSync.dump("Found CalDAV authRealm",  realm);
                //manually create a lightning style entry in the password manager
                tbSync.passwordManager.updateLoginInfo(url.prePath, realm, /* old */ authData.username, /* new */ authData.username, authData.password);
            }
        }

        if (!found) {
            calManager.registerCalendar(newCalendar);
        }
        return newCalendar;
    },
}


/**
 * This provider is using the standardFolderList (instead of this it could also
 * implement the full folderList object).
 *
 * The DOM of the folderlist can be accessed by
 * 
 *    let list = document.getElementById("tbsync.accountsettings.folderlist");
 * 
 * and the folderData of each entry is attached to each row:
 * 
 *    let folderData = folderList.selectedItem.folderData;
 *
 */
var standardFolderList = {
    /**
     * Is called before the context menu of the folderlist is shown, allows to
     * show/hide custom menu options based on selected folder. During an active
     * sync, folderData will be null.
     *
     * @param window        [in] window object of the account settings window
     * @param folderData    [in] FolderData of the selected folder
     */
    onContextMenuShowing: function (window, folderData) {
    },

    /**
     * Return the icon used in the folderlist to represent the different folder
     * types.
     *
     * @param folderData         [in] FolderData of the selected folder
     */
    getTypeImage: function (folderData) {
        let src = "";
        switch (folderData.getFolderProperty("type")) {
            case "carddav":
                if (folderData.getFolderProperty("shared")) {
                    return "chrome://tbsync/skin/contacts16_shared.png";
                } else {
                    return "chrome://tbsync/skin/contacts16.png";
                }
            case "caldav":
                if (folderData.getFolderProperty("shared")) {
                    return "chrome://tbsync/skin/calendar16_shared.png";
                } else {
                    return "chrome://tbsync/skin/calendar16.png";
                }
            case "ics":
                return "chrome://dav4tbsync/skin/ics16.png";
        }
    },
    
    /**
     * Return the name of the folder shown in the folderlist.
     *
     * @param folderData         [in] FolderData of the selected folder
     */ 
    getFolderDisplayName: function (folderData) {
        return folderData.getFolderProperty("foldername");
    },

    getAttributesRoAcl: function (folderData) {
        return {
            label: tbSync.getString("acl.readonly", "dav"),
        };
    },
    
    getAttributesRwAcl: function (folderData) {
        let acl = parseInt(folderData.getFolderProperty("acl"));
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
