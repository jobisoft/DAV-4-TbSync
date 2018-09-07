/*
 * This file is part of DAV-4-TbSync.
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
 * along with DAV-4-TbSync. If not, see <https://www.gnu.org/licenses/>.
 */

"use strict";

/**
 * Implements the TbSync interface for external provider extensions.
 */
var dav = {
    bundle: Services.strings.createBundle("chrome://dav4tbsync/locale/dav.strings"),
    prefSettings: Services.prefs.getBranch("extensions.dav4tbsync."),
    minTbSyncVersionRequired: "0.7.15",

    ns: {
        d: "DAV:",
        cal: "urn:ietf:params:xml:ns:caldav" ,
        card: "urn:ietf:params:xml:ns:carddav" ,
        cs: "http://calendarserver.org/ns/",
        s: "http://sabredav.org/ns",
        apple: "http://apple.com/ns/ical/"
    },


    /**
     * Called during load of external provider extension to init provider.
     *
     * @param lightningIsAvail       [in] indicate wheter lightning is installed/enabled
     */
    init: Task.async (function* (lightningIsAvail)  {
        //load overlays or do other init stuff, use lightningIsAvail to init stuff if lightning is installed
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abEditCardDialog.xul", "chrome://dav4tbsync/content/overlays/abCardWindow.xul");
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abNewCardDialog.xul", "chrome://dav4tbsync/content/overlays/abCardWindow.xul");
        yield tbSync.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://dav4tbsync/content/overlays/addressbookoverlay.xul");

    }),



    /**
     * Returns location of 16x16 pixel provider icon.
     */
    getProviderIcon: function () {
        return "chrome://dav4tbsync/skin/sabredav16.png";
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
            "servertype": "custom",
            "authMethod" :"",
            "authOptions" :"",
            "authDigestNC" :"",
            "host" : "",
            "fqdn" : "",
            "user" : "",
            "https" : "1",
            "autosync" : "0",
            "downloadonly" : "0",
            "createdWithProviderVersion" : "0",
            //some example options
            "syncdefaultfolders" : "1",
            "useHomeAsPrimary" : "0",
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
        return ["targetName", "targetColor", "selected"];
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

        // reset custom values
        //db.resetAccountSetting(account, "policykey");
        //db.resetAccountSetting(account, "foldersynckey");
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
        tbSync.db.setFolderSetting(account, folderID, "createdWithProviderVersion", tbSync.providerList.dav.version);
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
        let uuid = new dav.UUID();
        //actually use the full href of this vcard as id - the actual UID is not used by TbSync
        return folder.folderID + uuid.toString() + ".vcf";
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
        let password = tbSync.getPassword(accountdata);
        let user = accountdata.user;

        //Create the new standard calendar with a unique name
        let hostport = "http" + (accountdata.https ? "s" : "") + "://" + tbSync.db.getAccountSetting(account, "fqdn");
        let url = dav.tools.parseUri(hostport + folderID);

        let newCalendar = calManager.createCalendar("caldav", url);
        newCalendar.id = cal.getUUID();
        newCalendar.name = newname;

        newCalendar.setProperty("color", tbSync.db.getFolderSetting(account, folderID, "targetColor"));
        newCalendar.setProperty("calendar-main-in-composite", true);

        let authOptions = dav.tools.getAuthOptions(accountdata.authOptions);
        tbSync.setLoginInfo(hostport, authOptions.realm, user, password);
        //tbSync.setLoginInfo(url.spec.toLowerCase(), authOptions.realm, user, password);

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
            if (e.type == "dav4tbsync") tbSync.finishAccountSync(syncdata, e.message);
            else {
                tbSync.finishAccountSync(syncdata, "javascriptError::" + (e.message ? e.message : e));
                Components.utils.reportError(e);
            }
        }
    }),




    /**
     * Implements the TbSync UI interface for external provider extensions,
     * only needed, if the standard TbSync UI logic is used (chrome://tbsync/content/manager/accountSettings.js).
     */
    ui: {

        /**
         * Returns array of all possible account options (field names of a row in the accounts database).
         */
        getAccountStorageFields: function () {
            return Object.keys(tbSync.dav.getDefaultAccountEntries()).sort();
        },



        /**
         * Returns array of all options, that should not lock while being connected.
         */
        getAlwaysUnlockedSettings: function () {
            return ["autosync"];
        },



        /**
         * Returns object with fixed entries for rows in the accounts database. This is useable for two cases:
         *   1. indicate which entries where retrieved by autodiscover, do not assign a value
         *   2. other special server profiles (like "outlook") which the user can select during account creation with predefined values
         * In either case, these entries are not editable in the UI by default,but the user has to unlock them.
         *
         * @param servertype       [in] return fixed set based on the given servertype
         */
        getFixedServerSettings: function(servertype) {
            let settings = {};
            switch (servertype) {
                case "auto":
                    //settings["host"] = null;
                    //settings["https"] = null;
                    break;
            }
            return settings;
        },



        /**
         * Is called before the context menu of the folderlist is shown, allows to
         * show/hide custom menu options based on selected folder
         *
         * @param document       [in] document object of the account settings window
         * @param folder         [in] folder databasse object of the selected folder
         */
        onFolderListContextMenuShowing: function (document, folder) {
        },



        /**
         * Returns an array of folderRowData objects, containing all information needed
         * to fill the folderlist. The content of the folderRowData object is free to choose,
         * it will be passed back to addRowToFolderList() and updateRowOfFolderList()
         *
         * @param account        [in] account id for which the folder data should be returned
         */
        getSortedFolderData: function (account) {
            let folderData = [];
            let folders = tbSync.db.getFolders(account);
            let folderIDs = Object.keys(folders);

            for (let i=0; i < folderIDs.length; i++) {
                folderData.push(tbSync.dav.ui.getFolderRowData(folders[folderIDs[i]]));
            }
            return folderData;
        },



        /**
         * Returns a folderRowData object, containing all information needed to fill one row
         * in the folderlist. The content of the folderRowData object is free to choose, it
         * will be passed back to addRowToFolderList() and updateRowOfFolderList()
         *
         * Use tbSync.getSyncStatusMsg(folder, syncdata, provider) to get a nice looking
         * status message, including sync progress (if folder is synced)
         *
         * @param folder         [in] folder databasse object of requested folder
         * @param syncdata       [in] optional syncdata obj send by updateRowOfFolderList(),
         *                            needed to check if the folder is currently synced
         */
        getFolderRowData: function (folder, syncdata = null) {
            let rowData = {};
            rowData.folderID = folder.folderID;
            rowData.selected = (folder.selected == "1");
            rowData.type = folder.type;
            rowData.name = folder.name;
            rowData.status = tbSync.getSyncStatusMsg(folder, syncdata, "dav");

            return rowData;
        },



        /**
         * Is called to add a row to the folderlist.
         *
         * @param document       [in] document object of the account settings window
         * @param newListItem    [in] the listitem of the row, where row items should be added to
         * @param rowData        [in] rowData object with all information needed to add the row
         */
        addRowToFolderList: function (document, newListItem, rowData) {
            //add folder type/img
            let itemTypeCell = document.createElement("listcell");
            itemTypeCell.setAttribute("class", "img");
            itemTypeCell.setAttribute("width", "24");
            itemTypeCell.setAttribute("height", "24");
                let itemType = document.createElement("image");
                itemType.setAttribute("src", tbSync.dav.ui.getTypeImage(rowData.type));
                itemType.setAttribute("style", "margin: 4px;");
            itemTypeCell.appendChild(itemType);
            newListItem.appendChild(itemTypeCell);

            //add folder name
            let itemLabelCell = document.createElement("listcell");
            itemLabelCell.setAttribute("class", "label");
            itemLabelCell.setAttribute("width", "145");
            itemLabelCell.setAttribute("crop", "end");
            itemLabelCell.setAttribute("label", rowData.name);
            itemLabelCell.setAttribute("tooltiptext", rowData.name);
            itemLabelCell.setAttribute("disabled", !rowData.selected);
            if (!rowData.selected) itemLabelCell.setAttribute("style", "font-style:italic;");
            newListItem.appendChild(itemLabelCell);

            //add folder status
            let itemStatusCell = document.createElement("listcell");
            itemStatusCell.setAttribute("class", "label");
            itemStatusCell.setAttribute("flex", "1");
            itemStatusCell.setAttribute("crop", "end");
            itemStatusCell.setAttribute("label", rowData.status);
            itemStatusCell.setAttribute("tooltiptext", rowData.status);
            newListItem.appendChild(itemStatusCell);
        },



        /**
         * Is called to update a row of the folderlist.
         *
         * @param document       [in] document object of the account settings window
         * @param listItem       [in] the listitem of the row, which needs to be updated
         * @param rowData        [in] rowData object with all information needed to add the row
         */
        updateRowOfFolderList: function (document, listItem, rowData) {
            tbSync.updateListItemCell(listItem.childNodes[1], ["label","tooltiptext"], rowData.name);
            tbSync.updateListItemCell(listItem.childNodes[2], ["label","tooltiptext"], rowData.status);
            if (rowData.selected) {
                tbSync.updateListItemCell(listItem.childNodes[1], ["style"], "font-style:normal;");
                tbSync.updateListItemCell(listItem.childNodes[1], ["disabled"], "false");
            } else {
                tbSync.updateListItemCell(listItem.childNodes[1], ["style"], "font-style:italic;");
                tbSync.updateListItemCell(listItem.childNodes[1], ["disabled"], "true");
            }
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
                    src = "contacts16.png";
                    break;
                case "caldav":
                    src = "calendar16.png";
                    break;
            }
            return "chrome://tbsync/skin/" + src;
        }
   }
};

tbSync.includeJS("chrome://dav4tbsync/content/sync.js");
tbSync.includeJS("chrome://dav4tbsync/content/tools.js");
tbSync.includeJS("chrome://dav4tbsync/content/vcard/vcard.js");
tbSync.includeJS("chrome://dav4tbsync/content/uuid/uuid.js", dav);
