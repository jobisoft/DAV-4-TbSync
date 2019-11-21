/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { AddonManager } = ChromeUtils.import("resource://gre/modules/AddonManager.jsm");
var { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { cal } = ChromeUtils.import("resource://calendar/modules/calUtils.jsm");

Cu.importGlobalProperties(["TextDecoder"]);
Services.scriptloader.loadSubScript("resource://calendar/components/calDavCalendar.js", this);
Services.scriptloader.loadSubScript("resource://calendar/calendar-js/calDavRequestHandlers.js", this);

//
// tbSyncDavCalendar.js
//

// Do not mess with these and do not use them anywhere else, otherwise Google may disable TbSync.
const OAUTH_BASE_URI = "https://accounts.google.com/o/";
const OAUTH_SCOPE = "https://www.googleapis.com/auth/carddav https://www.googleapis.com/auth/calendar";
const OAUTH_CLIENT_ID = "689460414096-e4nddn8tss5c59glidp4bc0qpeu3oper.apps.googleusercontent.com";
const OAUTH_HASH = "LeTdF3UEpCvP1V3EBygjP-kl";

function tbSyncDavCalendar() { 
  calDavCalendar.call(this);
  this.tbSyncLoaded = false;
} 
  
tbSyncDavCalendar.prototype = { 
  __proto__: calDavCalendar.prototype,
  classID:  Components.ID('7eb8f992-3956-4607-95ac-b860ebd51f5a}'),
  classDescription: 'tbSyncCalDav',
  contractID: '@mozilla.org/calendar/calendar;1?type=tbSyncCalDav',
	
  
  /** The following functions are almost copied 1-to-1 but neede little changes to work with tbSyncCalDav **/
  
  getProperty: function(aName) {
    if (aName in this.mACLProperties && this.mACLProperties[aName]) {
      return this.mACLProperties[aName];
    }

    switch (aName) {
      case "organizerId":
        if (this.calendarUserAddress) {
          return this.calendarUserAddress;
        } // else use configured email identity
        break;
      case "organizerCN":
        return null; // xxx todo
      case "itip.transport":
        if (this.hasAutoScheduling || this.hasScheduling) {
          return this.QueryInterface(Ci.calIItipTransport);
        } // else use outbound email-based iTIP (from cal.provider.BaseClass)
        break;
      case "capabilities.tasks.supported":
        return this.supportedItemTypes.includes("VTODO");
      case "capabilities.events.supported":
        return this.supportedItemTypes.includes("VEVENT");
      case "capabilities.autoschedule.supported":
        return this.hasAutoScheduling;
      case "capabilities.username.supported":
        return true;
    }
    // We needed to add one more __proto__.
    return this.__proto__.__proto__.__proto__.getProperty.apply(this, arguments); 
  },

  get type() {
    return "tbSyncCalDav";
  },

  firstInRealm: function() {
    let calendars = cal.getCalendarManager().getCalendars({});
    for (let i = 0; i < calendars.length; i++) {
      if (calendars[i].type != "tbSyncCalDav" || calendars[i].getProperty("disabled")) {
        continue;
      }
      // XXX We should probably expose the inner calendar via an
      // interface, but for now use wrappedJSObject.
      let calendar = calendars[i].wrappedJSObject;
      if (calendar.mUncachedCalendar) {
        calendar = calendar.mUncachedCalendar;
      }
      if (calendar.uri.prePath == this.uri.prePath && calendar.authRealm == this.mAuthRealm) {
        if (calendar.id == this.id) {
          return true;
        }
        break;
      }
    }
    return false;
  },
  
  
  /** Overriding lightning oauth **/
  
  sleep: function(delay) {
    let timer =  Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
    return new Promise(function(resolve, reject) {
      let event = {
        notify: function(timer) {
            resolve();
        }
      }
      timer.initWithCallback(event, delay, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
    });
  },
  
  setupAuthentication: async function(aChangeLogListener) {
    let self = this;
    function authSuccess() {
      self.checkDavResourceType(aChangeLogListener);
    }
    function authFailed() {
      self.setProperty("disabled", "true");
      self.setProperty("auto-enabled", "true");
      self.completeCheckServerInfo(aChangeLogListener, Cr.NS_ERROR_FAILURE);
    }

    // If TbSync is not installed, disable all calendars.
    let tbSyncAddon = await AddonManager.getAddonByID("tbsync@jobisoft.de");
    if (!tbSyncAddon || !tbSyncAddon.isActive) {
      console.log("Failed to load TbSync, GoogleDav calendar will be disabled.");
      authFailed();
      return;
    }

    // Wait until TbSync has been loaded
    for (let waitCycles=0; waitCycles < 120 && !this.tbSyncLoaded; waitCycles++) {
      await this.sleep(1000);
      try {
          var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");
          this.tbSyncLoaded = TbSync.enabled;
      } catch (e) {
          // If this fails, TbSync is not loaded yet.
      }
    }
    if (!this.tbSyncLoaded) {
      console.log("Failed to load TbSync, GoogleDav calendar will be disabled.");
      authFailed();
      return;
    }
      
    // Wait until master password has been entered (if needed)
    while (!Services.logins.isLoggedIn) {
      await this.sleep(1000);
    }

    if (this.mUri.host == "apidata.googleusercontent.com") {
      if (!this.oauth) {
        let authTitle = cal.l10n.getAnyString("global", "commonDialogs", "EnterUserPasswordFor2", [
          this.name,
        ]);        

        this.oauth = new OAuth2(OAUTH_BASE_URI, OAUTH_SCOPE, OAUTH_CLIENT_ID, OAUTH_HASH);
        this.oauth.requestWindowTitle = authTitle;
        this.oauth.requestWindowFeatures = "chrome,private,centerscreen,width=430,height=750";

        // Re-define refreshToken getter/setter to act on the password manager values belonging to this account/calendar
        Object.defineProperty(this.oauth, "refreshToken", {
          get: function() {
            this.mRefreshToken = "";
            try {
              // A call to this.authData.password will get the current value from password manager.
              this.mRefreshToken = JSON.parse(this.authData.password)["refresh"];
            } catch (e) {
              // User might have cancelled the master password prompt, that's ok.
              if (e.result != Cr.NS_ERROR_ABORT && !(e instanceof TypeError)) {
                throw e;
              }
            }
            return this.mRefreshToken;
          },
          set: function(val) {
            this.mRefreshToken = "";
            let tokens = {"access": "", "refresh": ""};
            try {
              // A call to this.authData.password will get the current value from password manager.
              let t = JSON.parse(this.authData.password);
              if (t) tokens = t;
            } catch(e) {}

            try {
              // A call to this.authData.password will get the current value from password manager.
              tokens["refresh"] = val;
              // Store the new value in password manager.
              this.authData.updateLoginData(this.authData.username, JSON.stringify(tokens));
              // Read back the new value.
              this.mRefreshToken = JSON.parse(this.authData.password)["refresh"];
            } catch (e) {
              // User might have cancelled the master password prompt, or password saving
              // could be disabled. That is ok, throw for everything else.
              if (e.result != Cr.NS_ERROR_ABORT && !(e instanceof TypeError)) {
                throw e;
              }
            }
            return (this.mRefreshToken = val);
          },
          enumerable: true,
        });

        // Re-define accessToken getter/setter
        Object.defineProperty(this.oauth, "accessToken", {
          get: function() {
            this.mAccessToken = "";
            try {
              // A call to this.authData.password will get the current value from password manager.
              this.mAccessToken = JSON.parse(this.authData.password)["access"];
            } catch (e) {
              // User might have cancelled the master password prompt, that's ok.
              if (e.result != Cr.NS_ERROR_ABORT && !(e instanceof TypeError)) {
                throw e;
              }
            }
            return this.mAccessToken;
          },
          set: function(val) {
            this.mAccessToken = "";
            let tokens = {"access": "", "refresh": ""};
            try {
              // A call to this.authData.password will get the current value from password manager.
              let t = JSON.parse(this.authData.password);
              if (t) tokens = t;
            } catch(e) {}

            try {
              // Password manager stores multiple tokens, only update the access token.
              tokens["access"] = val;
              // Store the new value in password manager.
              this.authData.updateLoginData(this.authData.username, JSON.stringify(tokens));
              // Read back the new value.
              this.mAccessToken = JSON.parse(this.authData.password)["access"];
            } catch (e) {
              // User might have cancelled the master password prompt, or password saving
              // could be disabled. That is ok, throw for everything else.
              Components.utils.reportError(e);
              if (e.result != Cr.NS_ERROR_ABORT && e.result != Cr.NS_ERROR_NOT_AVAILABLE && !(e instanceof TypeError)) {
                throw e;
              }
            }
            return (this.mAccessToken = val);
          },
          enumerable: true,
        });
        
        try {
          // Storing the accountID as part of the URI has two benefits:
          // - it does not get lost during offline support disable/enable
          // - we can connect multiple google accounts without running into same-url-issue of shared calendars
          let accountData = new TbSync.AccountData(this.mUri.username)
          // authData allows us to access the password manager values belonging to this account/calendar
          // simply by authdata.username and authdata.password
          this.oauth.authData = TbSync.providers.dav.network.getAuthData(accountData);
        } catch (e) {
          console.log("Failed to get TbSync account information from GoogleDav calendar, it will be disabled.");
          authFailed();
          return;
        }
      }

      if (this.oauth.accessToken) {
        authSuccess();
      } else {
        // bug 901329: If the calendar window isn't loaded yet the
        // master password prompt will show just the buttons and
        // possibly hang. If we postpone until the window is loaded,
        // all is well.
        setTimeout(function postpone() {
          // eslint-disable-line func-names
          let win = cal.window.getCalendarWindow();
          if (!win || win.document.readyState != "complete") {
            setTimeout(postpone, 0);
          } else {
            self.oauthConnect(authSuccess, authFailed);
          }
        }, 0);
      }
    } else {
      authSuccess();
    }
  },  
 
}


/** Module Registration */
this.NSGetFactory = cid => {
  this.NSGetFactory = XPCOMUtils.generateNSGetFactory([tbSyncDavCalendar]);
  return this.NSGetFactory(cid);
};
