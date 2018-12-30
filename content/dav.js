/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

/**
 * Implements the TbSync interface for external provider extensions.
 */
var dav = {
    bundle: Services.strings.createBundle("chrome://dav4tbsync/locale/dav.strings"),
    prefSettings: Services.prefs.getBranch("extensions.dav4tbsync."),
    listOfRealms: {},

    ns: {
        d: "DAV:",
        cal: "urn:ietf:params:xml:ns:caldav" ,
        card: "urn:ietf:params:xml:ns:carddav" ,
        cs: "http://calendarserver.org/ns/",
        s: "http://sabredav.org/ns",
        apple: "http://apple.com/ns/ical/"
    },

    serviceproviders: {
        "fruux" : {icon: "fruux", caldav: "https://dav.fruux.com", carddav: "https://dav.fruux.com"},
        "icloud" : {icon: "icloud", caldav: "https://caldav.icloud.com", carddav: "https://contacts.icloud.com"},
        "yahoo" : {icon: "yahoo", caldav: "https://caldav.calendar.yahoo.com", carddav: "https://carddav.address.yahoo.com"},
        "gmx.net" : {icon: "gmx", caldav: "https://caldav.gmx.net", carddav: "https://carddav.gmx.net/.well-known/carddav"},
        "gmx.com" : {icon: "gmx", caldav: "https://caldav.gmx.com", carddav: "https://carddav.gmx.com/.well-known/carddav"},
    },
    
    //https://bugzilla.mozilla.org/show_bug.cgi?id=669675
    //non permanent cache
    problematicHosts: [],
    
    calendarManagerObserver : {
        onCalendarRegistered : function (aCalendar) { 
            
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
                    Services.obs.notifyObservers(null, "tbsync.updateSyncstate", folders[f].account);
                }
            }
        },
        onCalendarUnregistering : function (aCalendar) {},
        onCalendarDeleting : function (aCalendar) {},
    },
    
   calendarObserver : { 
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
            let folders = tbSync.db.findFoldersWithSetting(["target"], [aCalendar.id]);
            if (folders.length == 1) {
                switch (aName) {
                    case "color":
                        //update stored color to recover after disable
                        dav.tools.sendRequest("<d:propertyupdate "+dav.tools.xmlns(["d","apple"])+"><d:set><d:prop><apple:calendar-color>"+(aValue + "FFFFFFFF").slice(0,9)+"</apple:calendar-color></d:prop></d:set></d:propertyupdate>", folders[0].folderID, "PROPPATCH", {account: folders[0].account, fqdn: folders[0].fqdn});
                        break;
                }
            }
        },
    },    

    /** API **/
    
    /**
     * Called during load of external provider extension to init provider.
     *
     * @param lightningIsAvail       [in] indicate wheter lightning is installed/enabled
     */
    load: Task.async (function* (lightningIsAvail) {
        //load overlays or do other init stuff, use lightningIsAvail to init stuff if lightning is installed
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abEditCardDialog.xul", "chrome://dav4tbsync/content/overlays/abCardWindow.xul");
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abNewCardDialog.xul", "chrome://dav4tbsync/content/overlays/abCardWindow.xul");
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://dav4tbsync/content/overlays/addressbookoverlay.xul");

        if (lightningIsAvail) {
            cal.getCalendarManager().addObserver(tbSync.dav.calendarManagerObserver);    
            cal.getCalendarManager().addCalendarObserver(tbSync.dav.calendarObserver);            
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
    }),



    /**
     * Called during unload of external provider extension to unload provider.
     *
     * @param lightningIsAvail       [in] indicate wheter lightning is installed/enabled
     */
    unload: function (lightningIsAvail) {
        if (lightningIsAvail) {
            cal.getCalendarManager().removeObserver(tbSync.dav.calendarManagerObserver);
            cal.getCalendarManager().removeCalendarObserver(tbSync.dav.calendarObserver);                        
        }        
    },



    /**
     * Called to get passwords of accounts of this provider
     *
     * @param accountdata       [in] account data structure
     */
    getPassword: function (accountdata) {
        let hostField = (accountdata.host !== "") ? "host" : "host2";
        let host4PasswordManager = tbSync.getHost4PasswordManager(accountdata.provider, accountdata[hostField]);
        return tbSync.getLoginInfo(host4PasswordManager, "TbSync", accountdata.user);
    },



    /**
     * Called to set passwords of accounts of this provider
     *
     * @param accountdata       [in] account data structure
     * @param newPassword       [in] new password
     */
    setPassword: function (accountdata, newPassword) {
        let hostField = (accountdata.host !== "") ? "host" : "host2";
        let host4PasswordManager = tbSync.getHost4PasswordManager(accountdata.provider, accountdata[hostField]);
        tbSync.setLoginInfo(host4PasswordManager, "TbSync", accountdata.user, newPassword);
    },



    /**
     * Returns location of a provider icon.
     *
     * @param size       [in] size of requested icon
     * @param accountId  [in] optional ID of the account related to this request
     *
     */
    getProviderIcon: function (size, accountId = null) {
        let base = "sabredav";
        if (accountId !== null) {
            let serviceprovider = tbSync.db.getAccountSetting(accountId, "serviceprovider");
            if (tbSync.dav.serviceproviders.hasOwnProperty(serviceprovider)) {
                base =  tbSync.dav.serviceproviders[serviceprovider].icon;
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
            "Lütticke, David" : {name: "David Lütticke", description : "Posteo", icon: "", link: "" },
        };
    },



    /**
     * Returns the email address of the maintainer (used for bug reports).
     */
    getMaintainerEmail: function () {
        return "john.bieling@gmx.de";
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
     * Is called after the settings overlay of this provider has been added to the main settings window
     *
     * @param window       [in] window object of the settings window
     * @param accountID    [in] accountId of the selected account
     */
    onSettingsGUILoad: function (window, accountID) {
        let serviceprovider = tbSync.db.getAccountSetting(accountID, "serviceprovider");
        let isServiceProvider = tbSync.dav.serviceproviders.hasOwnProperty(serviceprovider);
        
        // special treatment for configuration label, which is a permanent setting and will not change by switching modes
        let configlabel = window.document.getElementById("tbsync.accountsettings.label.config");
        if (configlabel) {
            let extra = "";
            if (isServiceProvider) {
                extra = " [" + tbSync.getLocalizedMessage("add.serverprofile." + serviceprovider, "dav") + "]";
            }
            configlabel.setAttribute("value", tbSync.getLocalizedMessage("config.custom", "dav") + extra);
        }

        //set certain elements as "alwaysDisable", if locked by service provider (alwaysDisabled is honored by main SettingsUpdate, so we do not have to do that in our own onSettingsGUIUpdate
        if (isServiceProvider) {
            let items = window.document.getElementsByClassName("lockIfServiceProvider");
            for (let i=0; i < items.length; i++) {
                items[i].setAttribute("alwaysDisabled", "true");
            }
        }
    },



    /**
     * Is called each time after the settings window has been updated
     *
     * @param window       [in] window object of the settings window
     * @param accountID    [in] accountId of the selected account
     */
    onSettingsGUIUpdate: function (window, accountID) {
    },



    /**
     * Returns nice string for name of provider (is used in the add account menu).
     */
    getNiceProviderName: function () {
        return dav.bundle.GetStringFromName("menu.name")
    },



    /**
     * Return object which contains all possible fields of a row in the accounts database with the default value if not yet stored in the database.
     */
    getDefaultAccountEntries: function () {
        let row = {
            "account" : "",
            "accountname": "",
            "provider": "dav",
            "lastsynctime" : "0",
            "status" : "disabled", //global status: disabled, OK, syncing, notsyncronized, nolightning, ...
            "host" : "",            
            "host2" : "",
            "serviceprovider" : "",
            "user" : "",
            "https" : "1",
            "autosync" : "0",
            "downloadonly" : "0",
            "createdWithProviderVersion" : "0",
            //some example options
            "syncdefaultfolders" : "1",
            "useHomeAsPrimary" : "0",
            "useCache" : "1",
            };
        return row;
    },



    /**
     * Return object which contains all possible fields of a row in the folder database with the default value if not yet stored in the database.
     */
    getDefaultFolderEntries: function (account) {
        let folder = {
            "account" : account,
            "folderID" : "",

            //different folders can be stored on different servers (yahoo, icloud, gmx, ...), 
            //so we need to store the fqdn information per folders
            "fqdn" : "",

            "url" : "",
            "name" : "",
            "type" : "",
            "target" : "",
            "targetName" : "",
            "targetColor" : "",
            "selected" : "",
            "lastsynctime" : "",
            "status" : "",
            "parentID" : "",
            "useChangeLog" : "1", //log changes into changelog
            "ctag" : "",
            "token" : "",
            "downloadonly" : tbSync.db.getAccountSetting(account, "downloadonly"), //each folder has its own settings, the main setting is just the default,
            "createdWithProviderVersion" : "0",
            };
        return folder;
    },



    /**
     * Returns an array of folder settings, that should survive unsubscribe/subscribe and disable/re-enable (caching)
     */
    getPersistentFolderSettings: function () {
        return ["targetName", "targetColor"];
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
     * @param account       [in] account which is being enabled
     */
    onEnableAccount: function (account) {
        db.resetAccountSetting(account, "lastsynctime");
    },



    /**
     * Is called everytime an account of this provider is disabled in the manager UI, set/reset database fields as needed and
     * remove/backup all sync targets of this account.
     *
     * @param account       [in] account which is being disabled
     */
    onDisableAccount: function (account) {
    },



    /**
     * Is called everytime an new target is created, intended to set a clean sync status.
     *
     * @param account       [in] account the new target belongs to
     * @param folderID       [in] folder the new target belongs to
     */
    onResetTarget: function (account, folderID) {
        tbSync.db.resetFolderSetting(account, folderID, "ctag");
        tbSync.db.resetFolderSetting(account, folderID, "token");
        tbSync.db.setFolderSetting(account, folderID, "createdWithProviderVersion", tbSync.loadedProviders.dav.version);
    },



    /**
     * Is called if TbSync needs to create a new thunderbird address book associated with an account of this provider.
     *
     * @param newname       [in] name of the new address book
     * @param account       [in] id of the account this address book belongs to
     * @param folderID      [in] id of the folder this address book belongs to (sync target)
     *
     * return the id of the newAddressBook
     */
    createAddressBook: function (newname, account, folderID) {
        //This example implementation is using the standard address book, but you may use another one
        let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager);

        return abManager.newAddressBook(newname, "", 2);
    },



    /**
     * Is called if TbSync needs to create a new UID for an address book card
     *
     * @param aItem       [in] card that needs new ID
     *
     * returns the new id
     */
    getNewCardID: function (aItem, folder) {
        //actually use the full href of this vcard as id - the actual UID is not used by TbSync
        return folder.folderID + dav.tools.generateUUID() + ".vcf";
    },



    /**
     * Is called if TbSync needs to create a new lightning calendar associated with an account of this provider.
     *
     * @param newname       [in] name of the new calendar
     * @param account       [in] id of the account this calendar belongs to
     * @param folderID      [in] id of the folder this calendar belongs to (sync target)
     */
    createCalendar: function(newname, account, folderID) {
        let calManager = cal.getCalendarManager();
        let accountdata = tbSync.db.getAccount(account);
        let password = tbSync.dav.getPassword(accountdata);
        let user = accountdata.user;
        let caltype = tbSync.db.getFolderSetting(account, folderID, "type");
        
        let baseUrl = "";
        if (caltype == "caldav") {
            baseUrl =  "http" + (accountdata.https == "1" ? "s" : "") + "://" + (tbSync.dav.prefSettings.getBoolPref("addCredentialsToUrl") ? encodeURIComponent(user) + ":" + encodeURIComponent(password) + "@" : "") + tbSync.db.getFolderSetting(account, folderID, "fqdn");
        }

        let url = dav.tools.parseUri(baseUrl + folderID);        
        tbSync.db.setFolderSetting(account, folderID, "url", url.spec);

        let newCalendar = calManager.createCalendar(caltype, url); //caldav or ics
        newCalendar.id = cal.getUUID();
        newCalendar.name = newname;

        newCalendar.setProperty("color", tbSync.db.getFolderSetting(account, folderID, "targetColor"));
        newCalendar.setProperty("calendar-main-in-composite", true);
        newCalendar.setProperty("cache.enabled", (tbSync.db.getAccountSetting(account, "useCache") == "1"));

        //only add credentials to password manager if they are not added to the URL directly - only for caldav calendars, not for plain ics files
        if (!tbSync.dav.prefSettings.getBoolPref("addCredentialsToUrl") && caltype == "caldav") {
            tbSync.dump("Searching CalDAV authRealm for", url.host);
            let realm = (dav.listOfRealms.hasOwnProperty(url.host)) ? dav.listOfRealms[url.host] : "";
            if (realm !== "") {
                tbSync.dump("Found CalDAV authRealm",  realm);
                tbSync.setLoginInfo(url.prePath, realm, user, password);
            }
        }

        //do not monitor CalDAV calendars (managed by lightning)
        tbSync.db.setFolderSetting(account, folderID, "useChangeLog", "0");

        calManager.registerCalendar(newCalendar);
        return newCalendar;
    },



    /**
     * Is called if TbSync needs to find contacts in the global address list (GAL / directory) of an account associated with this provider.
     * It is used for autocompletion while typing something into the address field of the message composer and for the address book search,
     * if something is typed into the search field of the Thunderbird address book.
     *
     * TbSync will execute this only for queries longer than 3 chars.
     *
     * DO NOT IMPLEMENT AT ALL, IF NOT SUPPORTED
     *
     * @param account       [in] id of the account which should be searched
     * @param currentQuery  [in] search query
     */
//        abServerSearch: Task.async (function* (account, currentQuery)  {
//        let galdata = [];
//        return galdata;
//    }),



    /**
     * Is called if one or more cards have been selected in the addressbook, to update
     * field information in the card view pane
     *
     * OPTIONAL, do not implement, if this provider is not adding any fields to the
     * address book
     *
     * @param window       [in] window obj of address book
     * @param card         [in] selected card
     */
    onAbResultsPaneSelectionChanged: function (window, card) {
        let cvPhMain = window.document.getElementById("cvPhMain");
        if (cvPhMain) {
            let cvPhMainValue = card.getProperty("X-DAV-MainPhone","");
            if (cvPhMainValue) {
                cvPhMain.textContent = cvPhMain.getAttribute("labelprefix") + " " + cvPhMainValue;
                cvPhMain.hidden = false;
                window.document.getElementById("cvbPhone").collapsed = false;
                window.document.getElementById("cvhPhone").collapsed = false;
            }
        }
    },



    /**
     * Is called if a card is loaded in the edit dialog to show/hide elements
    *  besides those of class type "<provider>Container"
     *
     * OPTIONAL, do not implement, if this provider is not manipulating
     * the edit/new dialog beyond toggeling the elements of
     * class  "<provider>Container"
     *
     * @param document       [in] document obj of edit/new dialog
     * @param isOwnProvider  [in] true if the open card belongs to this provider
     */
    onAbCardLoad: function (document, isOwnProvider) {
        document.getElementById("WorkAddress2Container").hidden = isOwnProvider;
        document.getElementById("abHomeTab").children[1].hidden = isOwnProvider;
    },



    /**
     * Is called if TbSync needs to synchronize an account.
     *
     * @param syncdata      [in] object that contains the account and maybe the folder which needs to worked on
     *                           you are free to add more fields to this object which you need (persistent) during sync
     * @param job           [in] identifier about what is to be done, the standard job is "sync", you are free to add
     *                           custom jobs like "deletefolder" via your own accountSettings.xul
     */
    start: Task.async (function* (syncdata, job)  {
        try {
            switch (job) {
                case "sync":
                    //update folders avail on server and handle added, removed, renamed folders
                    yield dav.sync.folderList(syncdata);

                    //set all selected folders to "pending", so they are marked for syncing
                    //this also removes all leftover cached folders and sets all other folders to a well defined cached = "0"
                    //which will set this account as connected (if at least one folder with cached == "0" is present)
                    tbSync.prepareFoldersForSync(syncdata.account);

                    //check if any folder was found
                    if (!tbSync.isConnected(syncdata.account)) {
                        throw dav.sync.failed("no-folders-found-on-server");
                    }

                    //update folder list in GUI
                    Services.obs.notifyObservers(null, "tbsync.updateFolderList", syncdata.account);

                    //process all pending folders
                    yield dav.sync.allPendingFolders(syncdata);
                    break;

                default:
                    throw dav.sync.failed("unknown::"+job);
                    break;
            }
        } catch (e) {
            if (e.type == "dav4tbsync") {
                tbSync.finishAccountSync(syncdata, e);
            } else {
                //some other error
                e.type = "JavaScriptError";
                tbSync.finishAccountSync(syncdata, e); 
            }
        }
    }),



    /**
     * Functions used by the folderlist in the main account settings tab
     */
    folderList: {

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
         * it will be passed back to addRow() and updateRow()
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
                let t = "";
                switch (folders[folderIDs[i]].type) {
                    case "carddav": 
                        t="0"; 
                        break;
                    case "caldav": 
                        t="1"; 
                        break;
                    case "ics": 
                        t="2"; 
                        break;
                    default:
                        t="9";
                        break;
                }
                toBeSorted.push({"key": t + folders[folderIDs[i]].name, "id": folderIDs[i]});
            }
            
            //sort
            toBeSorted.sort(function(a,b) {
                return  a.key > b.key;
            });
            
            let folderData = [];
            for (let sorted of toBeSorted) {
                folderData.push(tbSync.dav.folderList.getRowData(folders[sorted.id]));
            }
            return folderData;
        },



        /**
         * Returns a folderRowData object, containing all information needed to fill one row
         * in the folderlist. The content of the folderRowData object is free to choose, it
         * will be passed back to addRow() and updateRow()
         *
         * Use tbSync.getSyncStatusMsg(folder, syncdata, provider) to get a nice looking
         * status message, including sync progress (if folder is synced)
         *
         * @param folder         [in] folder databasse object of requested folder
         * @param syncdata       [in] optional syncdata obj send by updateRow(),
         *                            needed to check if the folder is currently synced
         */
        getRowData: function (folder, syncdata = null) {
            let rowData = {};
            rowData.folderID = folder.folderID;
            rowData.selected = (folder.selected == "1");
            rowData.type = folder.type;
            rowData.name = folder.name;
            rowData.statusCode = folder.status;
            rowData.statusMsg = tbSync.getSyncStatusMsg(folder, syncdata, "dav");

            return rowData;
        },



        /**
         * Returns an array of attribute objects, which define the number of columns 
         * and the look of the header
         */
        getHeader: function () {
            return [
                {style: "font-weight:bold;", label: "", width: "50"},
                {style: "font-weight:bold;", label: tbSync.getLocalizedMessage("manager.resource"), width:"150"},
                {style: "font-weight:bold;", label: tbSync.getLocalizedMessage("manager.status"), flex :"1"},
            ]
        },



        /**
         * Is called to add a row to the folderlist. After this call, updateRow is called as well.
         *
         * @param document        [in] document object of the account settings window
         * @param newListItem     [in] the listitem of the row, where row items should be added to
         * @param rowData         [in] rowData object with all information needed to add the row
         * @param itemSelCheckbox [in] a checkbox object which can be used to allow the user to select/deselect this resource
         */        
        addRow: function (document, newListItem, rowData, itemSelCheckbox) {
            //checkbox
            itemSelCheckbox.setAttribute("style", "margin: 3px; padding: 0;");

            //icon
            let itemType = document.createElement("image");
            itemType.setAttribute("src", tbSync.dav.folderList.getTypeImage(rowData.type));
            itemType.setAttribute("style", "margin: 2px 3px 3px 3px;");

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

            let itemVGroup1 = document.createElement("vbox");
            itemVGroup1.setAttribute("style", "padding: 3px");
            itemVGroup1.setAttribute("width", "53");
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
            itemHGroup3.setAttribute("width", "250");
            itemHGroup3.appendChild(itemStatus);

            let itemVGroup3 = document.createElement("vbox");
            itemVGroup3.setAttribute("style", "padding: 3px");
            itemVGroup3.appendChild(itemHGroup3);

            //final row
            let row = document.createElement("hbox");
            row.appendChild(itemVGroup1);
            row.appendChild(itemVGroup2);            
            row.appendChild(itemVGroup3);            
            newListItem.appendChild(row);                
        },		



        /**
         * Is called to update a row of the folderlist (the first cell is a select checkbox inserted by TbSync)
         *
         * @param document       [in] document object of the account settings window
         * @param listItem       [in] the listitem of the row, which needs to be updated
         * @param rowData        [in] rowData object with all information needed to add the row
         */        
        updateRow: function (document, item, rowData) {
            item.childNodes[0].childNodes[1].childNodes[0].textContent = rowData.name;
            item.childNodes[0].childNodes[1].childNodes[0].setAttribute("disabled", !rowData.selected);
            item.childNodes[0].childNodes[1].childNodes[0].setAttribute("style", rowData.selected ? "" : "font-style:italic");
            item.childNodes[0].childNodes[2].childNodes[0].setAttribute("style", rowData.selected ? "" : "font-style:italic");
            item.childNodes[0].childNodes[2].childNodes[0].textContent = rowData.statusMsg;
        },



        /**
         * Return the icon used in the folderlist to represent the different folder types
         *
         * @param type       [in] provider folder type
         */
        getTypeImage: function (type) {
            let src = "";
            switch (type) {
                case "carddav":
                    return "chrome://tbsync/skin/contacts16.png";
                case "caldav":
                    return "chrome://tbsync/skin/calendar16.png";
                case "ics":
                    return "chrome://dav4tbsync/skin/ics16.png";
            }
        }
   }
};

tbSync.includeJS("chrome://dav4tbsync/content/sync.js");
tbSync.includeJS("chrome://dav4tbsync/content/tools.js");
tbSync.includeJS("chrome://dav4tbsync/content/vcard/vcard.js");
