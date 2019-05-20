/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

// every object in here will be loaded into tbSync.providers.<providername>.<objectname>
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

var calendarManagerObserver = {
    onCalendarRegistered : function (aCalendar) {
        //this observer can go stale, if something bad happens during load and the unload is never called
        if (tbSync) {
            //identify a calendar which has been deleted and is now being recreated by lightning (not TbSync) - which is probably due to changing the offline support option
            let folders =  tbSync.db.findFoldersWithSetting(["status"], ["aborted"]); //if it is pending status, we are creating it, not someone else
            for (let f=0; f < folders.length; f++) {
                let provider = tbSync.db.getAccountSetting(folders[f].account, "provider");
            
                //only act on dav calendars which have the same uri
                if (provider == "dav" && folders[f].selected == "1" && folders[f].url == aCalendar.uri.spec) {
                    tbSync.db.setFolderSetting(folders[f].account, folders[f].folderID, "status", "OK");
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
                        let accountData = new tbSync.AccountObject(folders[0].account, folders[0].folderID);
                        let connection = new dav.network.Connection(accountData);

                        //update stored color to recover after disable
                        dav.network.sendRequest("<d:propertyupdate "+dav.tools.xmlns(["d","apple"])+"><d:set><d:prop><apple:calendar-color>"+(aValue + "FFFFFFFF").slice(0,9)+"</apple:calendar-color></d:prop></d:set></d:propertyupdate>", folders[0].folderID, "PROPPATCH", connection);
                        break;
                }
            }
        }
    },
};

function onSettingsGUILoad(window, accountID) {
    let serviceprovider = tbSync.db.getAccountSetting(accountID, "serviceprovider");
    let isServiceProvider = dav.serviceproviders.hasOwnProperty(serviceprovider);
    
    // special treatment for configuration label, which is a permanent setting and will not change by switching modes
    let configlabel = window.document.getElementById("tbsync.accountsettings.label.config");
    if (configlabel) {
        let extra = "";
        if (isServiceProvider) {
            extra = " [" + tbSync.tools.getLocalizedMessage("add.serverprofile." + serviceprovider, "dav") + "]";
        }
        configlabel.setAttribute("value", tbSync.tools.getLocalizedMessage("config.custom", "dav") + extra);
    }

    //set certain elements as "alwaysDisable", if locked by service provider (alwaysDisabled is honored by main SettingsUpdate, so we do not have to do that in our own onSettingsGUIUpdate
    if (isServiceProvider) {
        let items = window.document.getElementsByClassName("lockIfServiceProvider");
        for (let i=0; i < items.length; i++) {
            items[i].setAttribute("alwaysDisabled", "true");
        }
    }
};

function stripHost(document, account, field) {
    let host = document.getElementById('tbsync.accountsettings.pref.' + field).value;
    if (host.indexOf("https://") == 0) {
        host = host.replace("https://","");
        document.getElementById('tbsync.accountsettings.pref.https').checked = true;
        tbSync.db.setAccountSetting(account, "https", "1");
    } else if (host.indexOf("http://") == 0) {
        host = host.replace("http://","");
        document.getElementById('tbsync.accountsettings.pref.https').checked = false;
        tbSync.db.setAccountSetting(account, "https", "0");
    }
    
    while (host.endsWith("/")) { host = host.slice(0,-1); }        
    document.getElementById('tbsync.accountsettings.pref.' + field).value = host
    tbSync.db.setAccountSetting(account, field, host);
};






/**
 * Implements the TbSync interface for external provider extensions.
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
            cal.getCalendarManager().addObserver(dav.calendarManagerObserver);    
            cal.getCalendarManager().addCalendarObserver(dav.calendarObserver);            
        }
        
        //Migration - accounts without a serviceprovider setting only have a value in host
        //is it a discovery setting (only fqdn) or a custom value?
        let accounts = tbSync.db.getAccounts();
        for (let i=0; i<accounts.IDs.length; i++) {
            let accountID = accounts.IDs[i];
            if (accounts.data[accountID].provider == "dav") {
                
                let serviceprovider = tbSync.db.getAccountSetting(accountID, "serviceprovider");
                if (serviceprovider == "") {
                    let account = tbSync.db.getAccount(accountID);
                    let hostparts = account.host.split("/").filter(i => i != "");
                    let fqdn = hostparts.splice(0,1).toString();
                    if (hostparts.length == 0) {
                        tbSync.db.setAccountSetting(accountID, "host", fqdn + "/.well-known/caldav");
                        tbSync.db.setAccountSetting(accountID, "host2", fqdn + "/.well-known/carddav");
                        tbSync.db.setAccountSetting(accountID, "serviceprovider", "discovery");
                    } else {
                        tbSync.db.setAccountSetting(accountID, "host", fqdn + "/" + hostparts.join("/"));
                        tbSync.db.setAccountSetting(accountID, "host2", fqdn + "/" + hostparts.join("/"));
                        tbSync.db.setAccountSetting(accountID, "serviceprovider", "custom");
                    }
                }

            }
        }
    },



    /**
     * Called during unload of external provider extension to unload provider.
     *
     * @param lightningIsAvail       [in] indicate wheter lightning is installed/enabled
     */
    unload: async function (lightningIsAvail) {
        if (lightningIsAvail) {
            cal.getCalendarManager().removeObserver(dav.calendarManagerObserver);
            cal.getCalendarManager().removeCalendarObserver(dav.calendarObserver);                        
        }
        dav.overlayManager.stopObserving();	
    },



    /**
     * Returns location of a provider icon.
     *
     * @param size       [in] size of requested icon
     * @param accountObject  [in] optional AccountObject
     *
     */
    getProviderIcon: function (size, accountObject = null) {
        let base = "sabredav";
        if (accountObject) {
            let serviceprovider = accountObject.getAccountSetting("serviceprovider");
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
     * tbSync.tools.getLocalizedMessage(<key>, <provider>)
     */
    getStringBundleUrl: function () {
        return "chrome://dav4tbsync/locale/dav.strings";
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
     * Returns nice string for name of provider (is used in the add account menu).
     */
    getNiceProviderName: function () {
        return tbSync.tools.getLocalizedMessage("menu.name", "dav");
    },



    /**
     * Return object which contains all possible fields of a row in the accounts database with the default value if not yet stored in the database.
     */
    getDefaultAccountEntries: function () {
        let row = {
            "useCache" : "1",
            "host" : "",            
            "host2" : "",
            "serviceprovider" : "",
            "user" : "",
            "https" : "1",
            "createdWithProviderVersion" : "0",
            "syncGroups" : "0",
            "useCardBook" : "0",
            }; 
        return row;
    },


    /**
     * Return object which contains all possible fields of a row in the folder database with the default value if not yet stored in the database.
     */
    getDefaultFolderEntries: function () { //TODO: shadow more standard entries
        let folder = {
            "selected" : "",
            "lastsynctime" : "",
            "status" : "",
            "name" : "",
            "target" : "",
            "targetName" : "",
            "useChangeLog" : "1", //log changes into changelog
            "downloadonly" : "0",

            //different folders can be stored on different servers (yahoo, icloud, gmx, ...), 
            //so we need to store the fqdn information per folders
            "fqdn" : "",

            "type" : "", //cladav, carddav or ics
            "shared": "", //identify shared resources
            "acl": "", //acl send from server
            "targetColor" : "",
            "parentID" : "", //??? global ???
            "ctag" : "",
            "token" : "",
            "createdWithProviderVersion" : "0",
            };
        return folder;
    },



    /**
     * Returns an array of folder settings, that should survive unsubscribe/subscribe and disable/re-enable (caching)
     */
    getPersistentFolderSettings: function () {
        return ["targetName", "targetColor","downloadonly"];
    },



    /**
     * Return the thunderbird type (tb-contact, tb-event, tb-todo) for a given folder type of this provider. A provider could have multiple
     * type definitions for a single thunderbird type (default calendar, shared address book, etc), this maps all possible provider types to
     * one of the three thunderbird types.
     *
     * @param type       [in] provider folder type
     */
    getThunderbirdFolderType: function(type) {
        switch (type) {
            case "carddav":
                return "tb-contact";
            case "caldav":
            case "ics":
                return "tb-event";
            default:
                return "unknown ("+type + ")";
        };
    },



    /**
     * Is called everytime an account of this provider is enabled in the manager UI, set/reset database fields as needed.
     *
     * @param accountObject  [in] AccountObject
     */
    onEnableAccount: function (accountObject) {
    },



    /**
     * Is called everytime an account of this provider is disabled in the manager UI, set/reset database fields as needed and
     * remove/backup all sync targets of this account.
     *
     * @param accountObject  [in] AccountObject
     */
    onDisableAccount: function (accountObject) {
    },



    /**
     * Is called everytime an new target is created, intended to set a clean sync status.
     *
     * @param accountObject  [in] AccountObject
     */
    onResetTarget: function (accountObject) {
        accountObject.resetFolderSetting("ctag");
        accountObject.resetFolderSetting("token");
        accountObject.setFolderSetting("createdWithProviderVersion", accountObject.providerInfo.getVersion());
    },



    /**
     * Is called if TbSync needs to create a new thunderbird address book associated with an account of this provider.
     *
     * @param newname       [in] name of the new address book
     * @param accountObject  [in] AccountObject
     *
     * return the id of the newAddressBook
     */
    createAddressBook: function (newname, accountObject) {
        let dirPrefId = MailServices.ab.newAddressBook(newname, "", 2);
        let directory = MailServices.ab.getDirectoryFromId(dirPrefId);

        if (directory && directory instanceof Components.interfaces.nsIAbDirectory && directory.dirPrefId == dirPrefId) {
            let serviceprovider = accountObject.getAccountSetting("serviceprovider");
            let icon = "custom";
            if (dav.serviceproviders.hasOwnProperty(serviceprovider)) {
                icon = dav.serviceproviders[serviceprovider].icon;
            }
            directory.setStringValue("tbSyncIcon", "dav" + icon);
            return directory;
        }
        return null;
    },



    /**
     * Is called if TbSync needs to create a new UID for an address book card
     *
     * @param aItem       [in] card that needs new ID
     *
     * returns the new id
     */
    getNewCardID: function (aItem, folder) {
        //actually use the full href of this vcard as id - the actual UID is not used by TbSync (only for mailinglist members)
        return folder.folderID + dav.tools.generateUUID() + ".vcf";
    },



    /**
     * Is called if TbSync needs to create a new lightning calendar associated with an account of this provider.
     *
     * @param newname       [in] name of the new calendar
     * @param accountObject  [in] AccountObject
     */
    createCalendar: function(newname, accountObject) {
        let calManager = cal.getCalendarManager();
        let auth = dav.network.getAuthentication(accountObject);
        
        let caltype = accountObject.getFolderSetting("type");
        let downloadonly = (accountObject.getFolderSetting("downloadonly") == "1");

        let baseUrl = "";
        if (caltype != "ics") {
            baseUrl =  "http" + (accountObject.getAccountSetting("https") == "1" ? "s" : "") + "://" + (dav.prefSettings.getBoolPref("addCredentialsToUrl") ? encodeURIComponent(auth.getUsername()) + ":" + encodeURIComponent(auth.getPassword()) + "@" : "") + accountObject.getFolderSetting("fqdn");
        }

        let url = dav.tools.parseUri(baseUrl + accountObject.folderID);        
        accountObject.setFolderSetting("url", url.spec);

        let newCalendar = calManager.createCalendar(caltype, url); //caldav or ics
        newCalendar.id = cal.getUUID();
        newCalendar.name = newname;

        newCalendar.setProperty("user", auth.getUsername());
        newCalendar.setProperty("color", accountObject.getFolderSetting("targetColor"));
        newCalendar.setProperty("calendar-main-in-composite", true);
        newCalendar.setProperty("cache.enabled", (accountObject.getAccountSetting("useCache") == "1"));
        if (downloadonly) newCalendar.setProperty("readOnly", true);

        //only add credentials to password manager if they are not added to the URL directly - only for caldav calendars, not for plain ics files
        if (!dav.prefSettings.getBoolPref("addCredentialsToUrl") && caltype != "ics") {
            tbSync.dump("Searching CalDAV authRealm for", url.host);
            let realm = (dav.listOfRealms.hasOwnProperty(url.host)) ? dav.listOfRealms[url.host] : "";
            if (realm !== "") {
                tbSync.dump("Found CalDAV authRealm",  realm);
                tbSync.authentication.setLoginInfo(url.prePath, realm, auth.getUsername(), auth.getPassword());
            }
        }

        //do not monitor CalDAV calendars (managed by lightning)
        accountObject.setFolderSetting("useChangeLog", "0");

        calManager.registerCalendar(newCalendar);
        return newCalendar;
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
     * @param account       [in] id of the account which should be searched
     * @param currentQuery  [in] search query
     * @param caller        [in] "autocomplete" or "search"
     */
    abServerSearch: async function (account, currentQuery, caller)  {
        return null;
    },



    syncFolderList: async function (syncdata) {
        //update folders avail on server and handle added, removed, renamed folders
        await dav.sync.folderList(syncdata);
    },
    
    /**
     * Is called if TbSync needs to synchronize a folder.
     *
     * @param syncdata      [in] SyncdataObject
     *
     * return false on error which should abort the entire sync (if more than
     * one folder is in the queue)
     */
    syncFolder: async function (syncdata) {
        //process a single folder
        return await dav.sync.folder(syncdata);
    },
}




/**
 * Functions used by the folderlist in the main account settings tab
 */
var folderList = {

    /**
     * Is called before the context menu of the folderlist is shown, allows to
     * show/hide custom menu options based on selected folder
     *
     * @param document       [in] document object of the account settings window
     * @param folder         [in] folder databasse object of the selected folder
     */
    onContextMenuShowing: function (document, folder) {
    },



    /**
     * Returns an array of folderRowData objects, containing all information needed
     * to fill the folderlist. The content of the folderRowData object is free to choose,
     * it will be passed back to getRow() and updateRow()
     *
     * @param account        [in] account id for which the folder data should be returned
     */
    getSortedData: function (account) {
        let folders = tbSync.db.getFolders(account);
        let folderIDs = Object.keys(folders);

        //we can only sort arrays, so we need to create an array of objects and those objects 
        //must contain the sort key and the associated folderId
        let toBeSorted = [];
        for (let i=0; i < folderIDs.length; i++) {
            let t = 100;
            switch (folders[folderIDs[i]].type) {
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

            if (folders[folderIDs[i]].shared == "1") {
                t+=100;
            }
            
            toBeSorted.push({"key": t.toString() + folders[folderIDs[i]].name, "id": folderIDs[i]});
        }
        
        //sort
        toBeSorted.sort(function(a,b) {
            return  a.key > b.key;
        });
        
        let folderData = [];
        for (let sorted of toBeSorted) {
            folderData.push(dav.folderList.getRowData(folders[sorted.id]));
        }
        return folderData;
    },



    /**
     * Returns a folderRowData object, containing all information needed to fill one row
     * in the folderlist. The content of the folderRowData object is free to choose, it
     * will be passed back to getRow() and updateRow()
     *
     * Use syncdata.getSyncStatus(folder) to get a nice looking
     * status message, including sync progress (if folder is synced)
     *
     * @param folder         [in] folder databasse object of requested folder
     * @param syncdata       [in] optional syncdata obj send by updateRow(),
     *                            needed to check if the folder is currently synced
     */
    getRowData: function (folder, syncdata = null) {
        let rowData = {};
        rowData.account = folder.account;
        rowData.folderID = folder.folderID;
        rowData.selected = (folder.selected == "1");
        rowData.type = folder.type;
        rowData.shared = folder.shared;
        rowData.downloadonly = folder.downloadonly;
        rowData.acl = folder.acl;
        rowData.name = folder.name;
        rowData.statusCode = folder.status;
        rowData.statusMsg = syncdata ? syncdata.getSyncStatus(folder) : "";

        return rowData;
    },



    /**
     * Returns an array of attribute objects, which define the number of columns 
     * and the look of the header
     */
    getHeader: function () {
        return [
            {style: "font-weight:bold;", label: "", width: "93"},
            {style: "font-weight:bold;", label: tbSync.tools.getLocalizedMessage("manager.resource"), width:"150"},
            {style: "font-weight:bold;", label: tbSync.tools.getLocalizedMessage("manager.status"), flex :"1"},
        ]
    },

    
    //not part of API
    updateReadOnly: function (event) {
        let p = event.target.parentNode.parentNode;
        let account = p.getAttribute('account');
        let folderID = p.getAttribute('folderID');
        let value = event.target.value;
        let type = tbSync.db.getFolderSetting(account, folderID, "type");

        //update value
        tbSync.db.setFolderSetting(account, folderID, "downloadonly", value);

        //update icon
        if (value == "0") {
            p.setAttribute('image','chrome://tbsync/skin/acl_rw.png');
        } else {
            p.setAttribute('image','chrome://tbsync/skin/acl_ro.png');
        }
            
        //update ro flag if calendar
        switch (type) {
            case "carddav":
                break;
            case "caldav":
            case "ics":
                {
                    let target = tbSync.db.getFolderSetting(account, folderID, "target");
                    if (target != "") {
                        let calManager = cal.getCalendarManager();
                        let targetCal = calManager.getCalendarById(target); 
                        targetCal.setProperty("readOnly", value == '1');
                    }
                }
                break;
        }
    },

    /**
     * Is called to add a row to the folderlist. After this call, updateRow is called as well.
     *
     * @param document        [in] document object of the account settings window
     * @param newListItem     [in] the listitem of the row, where row items should be added to
     * @param rowData         [in] rowData object with all information needed to add the row
     * @param itemSelCheckbox [in] a checkbox object which can be used to allow the user to select/deselect this resource
     */        
    getRow: function (document, rowData, itemSelCheckbox) {
        //checkbox
        itemSelCheckbox.setAttribute("style", "margin: 0px 0px 0px 3px;");

        //icon
        let itemType = document.createElement("image");
        itemType.setAttribute("src", dav.folderList.getTypeImage(rowData));
        itemType.setAttribute("style", "margin: 0px 9px 0px 3px;");

        //ACL                 
        let itemACL = document.createElement("button");
        itemACL.setAttribute("image", "chrome://tbsync/skin/acl_" + (rowData.downloadonly == "1" ? "ro" : "rw") + ".png");
        itemACL.setAttribute("class", "plain");
        itemACL.setAttribute("style", "width: 35px; min-width: 35px; margin: 0; height:26px");
        itemACL.setAttribute("account", rowData.account);
        itemACL.setAttribute("folderID", rowData.folderID);
        itemACL.setAttribute("type", "menu");
        let menupopup = document.createElement("menupopup");
            let menuitem1 = document.createElement("menuitem");
            menuitem1.setAttribute("value", "1");
            menuitem1.setAttribute("class", "menuitem-iconic");
            menuitem1.setAttribute("label", tbSync.tools.getLocalizedMessage("acl.readonly", "dav"));
            menuitem1.setAttribute("image", "chrome://tbsync/skin/acl_ro2.png");
            menuitem1.addEventListener("command", dav.folderList.updateReadOnly);

            let acl = parseInt(rowData.acl);
            let acls = [];
            if (acl & 0x2) acls.push(tbSync.tools.getLocalizedMessage("acl.modify", "dav"));
            if (acl & 0x4) acls.push(tbSync.tools.getLocalizedMessage("acl.add", "dav"));
            if (acl & 0x8) acls.push(tbSync.tools.getLocalizedMessage("acl.delete", "dav"));
            if (acls.length == 0)  acls.push(tbSync.tools.getLocalizedMessage("acl.none", "dav"));

            let menuitem2 = document.createElement("menuitem");
            menuitem2.setAttribute("value", "0");
            menuitem2.setAttribute("class", "menuitem-iconic");
            menuitem2.setAttribute("label", tbSync.tools.getLocalizedMessage("acl.readwrite::"+acls.join(", "), "dav"));
            menuitem2.setAttribute("image", "chrome://tbsync/skin/acl_rw2.png");
            menuitem2.setAttribute("disabled", (acl & 0x7) != 0x7);                
            menuitem2.addEventListener("command", dav.folderList.updateReadOnly);

            menupopup.appendChild(menuitem2);
            menupopup.appendChild(menuitem1);
        itemACL.appendChild(menupopup);

        //folder name
        let itemLabel = document.createElement("description");
        itemLabel.setAttribute("disabled", !rowData.selected);

        //status
        let itemStatus = document.createElement("description");
        itemStatus.setAttribute("disabled", !rowData.selected);

        //group1
        let itemHGroup1 = document.createElement("hbox");
        itemHGroup1.setAttribute("align", "center");
        itemHGroup1.appendChild(itemSelCheckbox);
        itemHGroup1.appendChild(itemType);
        itemHGroup1.appendChild(itemACL);

        let itemVGroup1 = document.createElement("vbox");
        itemVGroup1.setAttribute("width", "93");
        itemVGroup1.appendChild(itemHGroup1);

        //group2
        let itemHGroup2 = document.createElement("hbox");
        itemHGroup2.setAttribute("align", "center");
        itemHGroup2.setAttribute("width", "146");
        itemHGroup2.appendChild(itemLabel);

        let itemVGroup2 = document.createElement("vbox");
        itemVGroup2.setAttribute("style", "padding: 3px");
        itemVGroup2.appendChild(itemHGroup2);

        //group3
        let itemHGroup3 = document.createElement("hbox");
        itemHGroup3.setAttribute("align", "center");
        itemHGroup3.setAttribute("width", "200");
        itemHGroup3.appendChild(itemStatus);

        let itemVGroup3 = document.createElement("vbox");
        itemVGroup3.setAttribute("style", "padding: 3px");
        itemVGroup3.appendChild(itemHGroup3);

        //final row
        let row = document.createElement("hbox");
        row.setAttribute("style", "min-height: 24px;");
        row.appendChild(itemVGroup1);
        row.appendChild(itemVGroup2);            
        row.appendChild(itemVGroup3);            
        return row;               
    },		



    /**
     * Is called to update a row of the folderlist (the first cell is a select checkbox inserted by TbSync)
     *
     * @param document       [in] document object of the account settings window
     * @param listItem       [in] the listitem of the row, which needs to be updated
     * @param rowData        [in] rowData object with all information needed to add the row
     */        
    updateRow: function (document, item, rowData) {
        //acl image
        item.childNodes[0].childNodes[0].childNodes[0].childNodes[2].setAttribute("image", "chrome://tbsync/skin/acl_" + (rowData.downloadonly == "1" ? "ro" : "rw") + ".png");

        //select checkbox
        if (rowData.selected) {
            item.childNodes[0].childNodes[0].childNodes[0].childNodes[0].setAttribute("checked", true);
        } else {
            item.childNodes[0].childNodes[0].childNodes[0].childNodes[0].removeAttribute("checked");
        }
        
        if (item.childNodes[0].childNodes[1].childNodes[0].textContent != rowData.name) item.childNodes[0].childNodes[1].childNodes[0].textContent = rowData.name;
        if (item.childNodes[0].childNodes[2].childNodes[0].textContent != rowData.statusMsg) item.childNodes[0].childNodes[2].childNodes[0].textContent = rowData.statusMsg;
        item.childNodes[0].childNodes[1].childNodes[0].setAttribute("disabled", !rowData.selected);
        item.childNodes[0].childNodes[1].childNodes[0].setAttribute("style", rowData.selected ? "" : "font-style:italic");
        item.childNodes[0].childNodes[2].childNodes[0].setAttribute("style", rowData.selected ? "" : "font-style:italic");
    },



    /**
     * Return the icon used in the folderlist to represent the different folder types 
     * Not part of API, only called by getRow
     *
     * @param rowData       [in] rowData object
     */
    getTypeImage: function (rowData) {
        let src = "";
        switch (rowData.type) {
            case "carddav":
                if (rowData.shared == "1") {
                    return "chrome://tbsync/skin/contacts16_shared.png";
                } else {
                    return "chrome://tbsync/skin/contacts16.png";
                }
            case "caldav":
                if (rowData.shared == "1") {
                    return "chrome://tbsync/skin/calendar16_shared.png";
                } else {
                    return "chrome://tbsync/skin/calendar16.png";
                }
            case "ics":
                return "chrome://dav4tbsync/skin/ics16.png";
        }
    }
};

Services.scriptloader.loadSubScript("chrome://dav4tbsync/content/sync.js", this, "UTF-8");
Services.scriptloader.loadSubScript("chrome://dav4tbsync/content/tools.js", this, "UTF-8");
Services.scriptloader.loadSubScript("chrome://dav4tbsync/content/network.js", this, "UTF-8");
Services.scriptloader.loadSubScript("chrome://dav4tbsync/content/vcard/vcard.js", this, "UTF-8");
