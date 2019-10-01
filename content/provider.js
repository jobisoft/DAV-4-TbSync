/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";
// check if getItem returns an array because of recursions!

// Every object in here will be loaded into TbSync.providers.<providername>.
const dav = TbSync.providers.dav;

/**
 * Implementing the TbSync interface for external provider extensions.
 */

var Base = class {
    /**
     * Called during load of external provider extension to init provider.
     */
    static async load() {
        // Set default prefs
        let branch = Services.prefs.getDefaultBranch("extensions.dav4tbsync.");
        branch.setIntPref("maxitems", 50);
        branch.setIntPref("timeout", 90000);
        branch.setCharPref("clientID.type", "TbSync");
        branch.setCharPref("clientID.useragent", "Thunderbird CalDAV/CardDAV");    
        branch.setBoolPref("enforceUniqueCalendarUrls", false);    
        branch.setBoolPref("debugCreateCalendarsAsEnabled", true);    
        branch.setBoolPref("debugRequestLightningSyncOnSync", true);    

        dav.openWindows = {};

        dav.overlayManager = new OverlayManager({verbose: 0});
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abNewCardDialog.xul", "chrome://dav4tbsync/content/overlays/abNewCardWindow.xul");
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abNewCardDialog.xul", "chrome://dav4tbsync/content/overlays/abCardWindow.xul");
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abEditCardDialog.xul", "chrome://dav4tbsync/content/overlays/abCardWindow.xul");
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://dav4tbsync/content/overlays/addressbookoverlay.xul");
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://dav4tbsync/content/overlays/addressbookdetailsoverlay.xul");

        // The abCSS.xul overlay is just adding a CSS file.
        await dav.overlayManager.registerOverlay("chrome://messenger/content/messengercompose/messengercompose.xul", "chrome://dav4tbsync/content/overlays/abCSS.xul");
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/abNewCardDialog.xul", "chrome://dav4tbsync/content/overlays/abCSS.xul");
        await dav.overlayManager.registerOverlay("chrome://messenger/content/addressbook/addressbook.xul", "chrome://dav4tbsync/content/overlays/abCSS.xul");

        dav.overlayManager.startObserving();
    }


    /**
     * Called during unload of external provider extension to unload provider.
     */
    static async unload() {
        dav.overlayManager.stopObserving();	

        // Close all open windows of this provider.
        for (let id in dav.openWindows) {
          if (dav.openWindows.hasOwnProperty(id)) {
            dav.openWindows[id].close();
          }
        }
    }


    /**
     * Returns string for the name of provider for the add account menu.
     */
    static getProviderName() {
        return TbSync.getString("menu.name", "dav");
    }


    /**
     * Returns version of the TbSync API this provider is using
     */
    static getApiVersion() { return "2.2"; }



    /**
     * Returns location of a provider icon.
     */
    static getProviderIcon(size, accountData = null) {
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
    }


    /**
     * Returns a list of sponsors, they will be sorted by the index
     */
    static getSponsors() {
        return {
            "Thoben, Marc" : {name: "Marc Thoben", description: "Zimbra", icon: "", link: "" },
            "Biebl, Michael" : {name: "Michael Biebl", description: "Nextcloud", icon: "", link: "" },
            "László, Kovács" : {name: "Kovács László", description : "Radicale", icon: "", link: "" },
            "Lütticke, David" : {name: "David Lütticke", description : "", icon: "", link: "" },
        };
    }


    /**
     * Returns the email address of the maintainer (used for bug reports).
     */
    static getMaintainerEmail() {
        return "john.bieling@gmx.de";
    }


    /**
     * Returns the URL of the string bundle file of this provider, it can be
     * accessed by TbSync.getString(<key>, <provider>)
     */
    static getStringBundleUrl() {
        return "chrome://dav4tbsync/locale/dav.properties";
    }


    /**
     * Returns URL of the new account window.
     *
     * The URL will be opened via openDialog(), when the user wants to create a
     * new account of this provider.
     */
    static getCreateAccountWindowUrl() {
        return "chrome://dav4tbsync/content/manager/createAccount.xul";
    }


    /**
     * Returns overlay XUL URL of the edit account dialog
     * (chrome://tbsync/content/manager/editAccount.xul)
     */
    static getEditAccountOverlayUrl() {
        return "chrome://dav4tbsync/content/manager/editAccountOverlay.xul";
    }


    /**
     * Return object which contains all possible fields of a row in the
     * accounts database with the default value if not yet stored in the 
     * database.
     */
    static getDefaultAccountEntries() {
        let row = {
            "useCalendarCache" : true,
            "calDavHost" : "",            
            "cardDavHost" : "",
            // these must return null if not defined
            "calDavPrincipal" : null,
            "cardDavPrincipal" : null,

            "serviceprovider" : "",
            "user" : "",
            "https" : true, //deprecated
            "createdWithProviderVersion" : "0",
            "syncGroups" : false,
            }; 
        return row;
    }


    /**
     * Return object which contains all possible fields of a row in the folder 
     * database with the default value if not yet stored in the database.
     */
    static getDefaultFolderEntries() {
        let folder = {
            // different folders (caldav/carddav) can be stored on different 
            // servers (as with yahoo, icloud, gmx, ...), so we need to store
            // the fqdn information per folders
            "href" : "",
            "https" : true,
            "fqdn" : "",

            "url" : "", // used by calendar to store the full url of this cal
            
            "type" : "", //caldav, carddav or ics
            "shared": false, //identify shared resources
            "acl": "", //acl send from server
            "target" : "",
            "targetColor" : "",
            "targetName" : "",
            "ctag" : "",
            "token" : "",
            "createdWithProviderVersion" : "0",
            };
        return folder;
    }


    /**
     * Is called everytime an account of this provider is enabled in the
     * manager UI.
     */
    static onEnableAccount(accountData) {
        accountData.resetAccountProperty("calDavPrincipal");
        accountData.resetAccountProperty("cardDavPrincipal");
    }


    /**
     * Is called everytime an account of this provider is disabled in the
     * manager UI.
     */
    static onDisableAccount(accountData) {
    }


    /**
     * Implement this method, if this provider should add additional entries
     * to the autocomplete list while typing something into the address field
     * of the message composer.
     */
    static async abAutoComplete(accountData, currentQuery)  {
        // Instead of using accountData.getAllFolders() to get all folders of this account
        // and then request and check the targets of each, we simply run over all address
        // books and check for the directory property "tbSyncAccountID".
        let entries = [];
        let allAddressBooks = MailServices.ab.directories;
        while (allAddressBooks.hasMoreElements()) {
            let abook = allAddressBooks.getNext().QueryInterface(Components.interfaces.nsIAbDirectory);
            if (abook instanceof Components.interfaces.nsIAbDirectory) { // or nsIAbItem or nsIAbCollection
                if (abook.getStringValue("tbSyncAccountID","") == accountData.accountID) {
                    let cards = MailServices.ab.getDirectory(abook.URI + "?(or(NickName,c,"+currentQuery+")(FirstName,c,"+currentQuery+")(LastName,c,"+currentQuery+")(DisplayName,c,"+currentQuery+")(PrimaryEmail,c,"+currentQuery+")(SecondEmail,c,"+currentQuery+")(X-DAV-JSON-Emails,c,"+currentQuery+"))").childCards;
                    while (cards.hasMoreElements()) {
                        let card = cards.getNext().QueryInterface(Components.interfaces.nsIAbCard);
                        let emailData = JSON.parse(card.getProperty("X-DAV-JSON-Emails","[]").trim());
                        for (let i = 0; i < emailData.length; i++) { 
                            entries.push({
                                value: card.getProperty("DisplayName", [card.getProperty("FirstName",""), card.getProperty("LastName","")].join(" ")) + " <"+emailData[i].value+">", 
                                comment: emailData[i].meta
                                                    .filter(entry => ["PREF","HOME","WORK"].includes(entry))
                                                    .map(entry => entry.toUpperCase() != "PREF" ? entry.toUpperCase() : entry.toLowerCase()).sort()
                                                    .map(entry => TbSync.getString("autocomplete." + entry.toUpperCase() , "dav"))
                                                    .join(", "),
                                icon: dav.Base.getProviderIcon(16, accountData),
                                style: "",				    
                            });
                        }
                    }
                }
            }
        }
        
        return entries;
    }


    /**
     * Returns all folders of the account, sorted in the desired order.
     * The most simple implementation is to return accountData.getAllFolders();
     */
    static getSortedFolders(accountData) {
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
    }


    /**
     * Return the connection timeout for an active sync, so TbSync can append
     * a countdown to the connection timeout, while waiting for an answer from
     * the server. Only syncstates which start with "send." will trigger this.
     */
    static getConnectionTimeout(accountData) {
        return dav.sync.prefSettings.getIntPref("timeout");
    }
    

    /**
     * Is called if TbSync needs to synchronize the folder list.
     */
    static async syncFolderList(syncData, syncJob, syncRunNr) {        
        // Recommendation: Put the actual function call inside a try catch, to
        // ensure returning a proper StatusData object, regardless of what
        // happens inside that function. You may also throw custom errors
        // in that function, which have the StatusData obj attached, which
        // should be returned.
        
        try {
            await dav.sync.folderList(syncData);
        } catch (e) {
            if (e.name == "dav4tbsync") {
                return e.statusData;
            } else {
                Components.utils.reportError(e);
                // re-throw any other error and let TbSync handle it
                throw (e);
            }
        }

        // we fall through, if there was no error
        return new TbSync.StatusData();
    }
    

    /**
     * Is called if TbSync needs to synchronize a folder.
     */
    static async syncFolder(syncData, syncJob, syncRunNr) {
        // Recommendation: Put the actual function call inside a try catch, to
        // ensure returning a proper StatusData object, regardless of what
        // happens inside that function. You may also throw custom errors
        // in that function, which have the StatusData obj attached, which
        // should be returned.
        //process a single folder

        try {
            await dav.sync.folder(syncData);
        } catch (e) {
            if (e.name == "dav4tbsync") {
                return e.statusData;
            } else {
                Components.utils.reportError(e);
                // re-throw any other error and let TbSync handle it
                throw (e);
            }
        }

        // we fall through, if there was no error
        return new TbSync.StatusData();
    }
}





// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
// * TargetData implementation
// * Using TbSyncs advanced address book TargetData 
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

var TargetData_addressbook = class extends TbSync.addressbook.AdvancedTargetData {
    constructor(folderData) {
        super(folderData);
    }
  
    // define a card property, which should be used for the changelog
    // basically your primary key for the abItem properties
    // UID will be used, if nothing specified
    get primaryKeyField() {
        return "X-DAV-HREF"
    }

    generatePrimaryKey() {
        return this.folderData.getFolderProperty("href") + TbSync.generateUUID() + ".vcf";
    }
        
    // enable or disable changelog
    get logUserChanges() {
        return true;
    }

    directoryObserver(aTopic) {
        switch (aTopic) {
            case "addrbook-removed":
            case "addrbook-updated":
                //Services.console.logStringMessage("["+ aTopic + "] " + this.folderData.getFolderProperty("foldername"));
                break;
        }
    }
        
    cardObserver(aTopic, abCardItem) {
        switch (aTopic) {
            case "addrbook-contact-updated":
            case "addrbook-contact-removed":
                //Services.console.logStringMessage("["+ aTopic + "] " + abCardItem.getProperty("DisplayName"));
                break;

            case "addrbook-contact-created":
            {
                //Services.console.logStringMessage("["+ aTopic + "] Created new X-DAV-UID for Card <"+ abCardItem.getProperty("DisplayName")+">");
                abCardItem.setProperty("X-DAV-UID", TbSync.generateUUID());
                // the card is tagged with "_by_user" so it will not be changed to "_by_server" by the following modify
                abCardItem.abDirectory.modifyItem(abCardItem);
                break;
            }
        }
    }

    listObserver(aTopic, abListItem, abListMember) {
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
                abListItem.setProperty("X-DAV-UID", TbSync.generateUUID());
                // custom props of lists get updated directly, no need to call .modify()            
                break;
        }
    }

    async createAddressbook(newname) {
        let dirPrefId = MailServices.ab.newAddressBook(newname, "", 2);
        let directory = MailServices.ab.getDirectoryFromId(dirPrefId);
      
        dav.sync.resetFolderSyncInfo(this.folderData);
        
        if (directory && directory instanceof Components.interfaces.nsIAbDirectory && directory.dirPrefId == dirPrefId) {
            let serviceprovider = this.folderData.accountData.getAccountProperty("serviceprovider");
            let icon = "custom";
            if (dav.sync.serviceproviders.hasOwnProperty(serviceprovider)) {
                icon = dav.sync.serviceproviders[serviceprovider].icon;
            }
            directory.setStringValue("tbSyncIcon", "dav" + icon);
            
            // Disable AutoComplete, so we can have full control over the auto completion of our own directories.
            // Implemented by me in https://bugzilla.mozilla.org/show_bug.cgi?id=1546425
            directory.setBoolValue("enable_autocomplete", false);
            
            return directory;
        }
        return null;
    }
}


// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
// * TargetData implementation
// * Using TbSyncs advanced calendar TargetData 
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

var TargetData_calendar = class extends TbSync.lightning.AdvancedTargetData {
    constructor(folderData) {
        super(folderData);
    }       
    // The calendar target does not support a custom primaryKeyField, because
    // the lightning implementation only allows to search for items via UID.
    // Like the addressbook target, the calendar target item element has a
    // primaryKey getter/setter which - however - only works on the UID.
    
    // enable or disable changelog
    get logUserChanges(){
        return false;
    }

    calendarObserver(aTopic, tbCalendar, aPropertyName, aPropertyValue, aOldPropertyValue) {
        switch (aTopic) {
            case "onCalendarPropertyChanged":
            {
                //Services.console.logStringMessage("["+ aTopic + "] " + tbCalendar.calendar.name + " : " + aPropertyName);
                switch (aPropertyName) {
                    case "color":
                        if (aOldPropertyValue.toString().toUpperCase() != aPropertyValue.toString().toUpperCase()) {
                            //prepare connection data
                            let connection = new dav.network.ConnectionData(this.folderData);
                            //update color on server
                            dav.network.sendRequest("<d:propertyupdate "+dav.tools.xmlns(["d","apple"])+"><d:set><d:prop><apple:calendar-color>"+(aPropertyValue + "FFFFFFFF").slice(0,9)+"</apple:calendar-color></d:prop></d:set></d:propertyupdate>", this.folderData.getFolderProperty("href"), "PROPPATCH", connection);
                        }
                        break;
                }
            }
            break;
            
            case "onCalendarDeleted":
            case "onCalendarPropertyDeleted":
                //Services.console.logStringMessage("["+ aTopic + "] " +tbCalendar.calendar.name);
                break;
        }
    }

    itemObserver(aTopic, tbItem, tbOldItem) {
        switch (aTopic) {
            case "onAddItem":
            case "onModifyItem":
            case "onDeleteItem":
                //Services.console.logStringMessage("["+ aTopic + "] " + tbItem.nativeItem.title);
                break;
        }
    }

    async createCalendar(newname) {
        let calManager = TbSync.lightning.cal.getCalendarManager();
        let authData = dav.network.getAuthData(this.folderData.accountData);
      
        let caltype = this.folderData.getFolderProperty("type");

        let baseUrl = "";
        if (caltype != "ics") {
            baseUrl =  "http" + (this.folderData.getFolderProperty("https") ? "s" : "") + "://" + this.folderData.getFolderProperty("fqdn");
        }

        let url = dav.tools.parseUri(baseUrl + this.folderData.getFolderProperty("href") + (dav.sync.prefSettings.getBoolPref("enforceUniqueCalendarUrls") ? "?" + this.folderData.accountID : ""));
        this.folderData.setFolderProperty("url", url.spec);

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

        if (found) {
            newCalendar.setProperty("username", authData.username);
            newCalendar.setProperty("color", this.folderData.getFolderProperty("targetColor"));
            newCalendar.name = newname;                
        } else {
            newCalendar = calManager.createCalendar(caltype, url); //caldav or ics
            newCalendar.id = TbSync.lightning.cal.getUUID();
            newCalendar.name = newname;

            newCalendar.setProperty("username", authData.username);
            newCalendar.setProperty("color", this.folderData.getFolderProperty("targetColor"));
            newCalendar.setProperty("calendar-main-in-composite", true);
            newCalendar.setProperty("cache.enabled", this.folderData.accountData.getAccountProperty("useCalendarCache"));
        }
        
        // debug: create calendars as disabed, to not cause network traffic
        newCalendar.setProperty("disabled", !dav.sync.prefSettings.getBoolPref("debugCreateCalendarsAsEnabled"));
        
        if (this.folderData.getFolderProperty("downloadonly")) newCalendar.setProperty("readOnly", true);

        // Setup password for Lightning calendar, so users do not get prompted (ICS urls do not need a password)
        if (caltype != "ics") {
            TbSync.dump("Searching CalDAV authRealm for", url.host);
            let connectionData = new dav.network.ConnectionData();
            connectionData.username = authData.username;
            connectionData.password = authData.password;
            connectionData.timeout = 5000;
            let response = await dav.network.sendRequest("<d:propfind "+dav.tools.xmlns(["d"])+"><d:prop><d:resourcetype /><d:displayname /></d:prop></d:propfind>", url.spec , "PROPFIND", connectionData, {"Depth": "0", "Prefer": "return=minimal"}, {containerRealm: "setup", containerReset: true, passwordRetries: 0});
            
            let realm = connectionData.realm || "";
            if (realm !== "") {
                TbSync.dump("Adding Lightning password", "User <"+authData.username+">, Realm <"+realm+">");
                //manually create a lightning style entry in the password manager
                TbSync.passwordManager.updateLoginInfo(url.prePath, realm, /* old */ authData.username, /* new */ authData.username, authData.password);
            }
        }

        if (!found) {
            calManager.registerCalendar(newCalendar);
        }
        return newCalendar;
    }
}





/**
 * This provider is implementing the StandardFolderList class instead of
 * the FolderList class.
 */
var StandardFolderList = class {
    /**
     * Is called before the context menu of the folderlist is shown, allows to
     * show/hide custom menu options based on selected folder. During an active
     * sync, folderData will be null.
     */
    static onContextMenuShowing(window, folderData) {
    }


    /**
     * Return the icon used in the folderlist to represent the different folder
     * types.
     */
    static getTypeImage(folderData) {
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
    }


    /**
     * Return the name of the folder shown in the folderlist.
     */ 
    static getFolderDisplayName(folderData) {
        return folderData.getFolderProperty("foldername");
    }


    /**
     * Return the attributes for the ACL RO (readonly) menu element per folder.
     * (label, disabled, hidden, style, ...)
     *
     * Return a list of attributes and their values. If both (RO+RW) do
     * not return any attributes, the ACL menu is not displayed at all.
     */ 
    static getAttributesRoAcl(folderData) {
        return {
            label: TbSync.getString("acl.readonly", "dav"),
        };
    }
    

    /**
     * Return the attributes for the ACL RW (readwrite) menu element per folder.
     * (label, disabled, hidden, style, ...)
     *
     * Return a list of attributes and their values. If both (RO+RW) do
     * not return any attributes, the ACL menu is not displayed at all.
     */ 
    static getAttributesRwAcl(folderData) {
        let acl = parseInt(folderData.getFolderProperty("acl"));
        let acls = [];
        if (acl & 0x2) acls.push(TbSync.getString("acl.modify", "dav"));
        if (acl & 0x4) acls.push(TbSync.getString("acl.add", "dav"));
        if (acl & 0x8) acls.push(TbSync.getString("acl.delete", "dav"));
        if (acls.length == 0)  acls.push(TbSync.getString("acl.none", "dav"));

        return {
            label: TbSync.getString("acl.readwrite::"+acls.join(", "), "dav"),
            disabled: (acl & 0x7) != 0x7,
        }             
    }
}

Services.scriptloader.loadSubScript("chrome://dav4tbsync/content/includes/sync.js", this, "UTF-8");
Services.scriptloader.loadSubScript("chrome://dav4tbsync/content/includes/abUI.js", this, "UTF-8");
Services.scriptloader.loadSubScript("chrome://dav4tbsync/content/includes/tools.js", this, "UTF-8");
Services.scriptloader.loadSubScript("chrome://dav4tbsync/content/includes/network.js", this, "UTF-8");
Services.scriptloader.loadSubScript("chrome://dav4tbsync/content/includes/vcard/vcard.js", this, "UTF-8");
