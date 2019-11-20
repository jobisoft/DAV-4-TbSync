/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { cal } = ChromeUtils.import("resource://calendar/modules/calUtils.jsm");

Cu.importGlobalProperties(["TextDecoder"]);
Services.scriptloader.loadSubScript("resource://calendar/components/calDavCalendar.js", this);
Services.scriptloader.loadSubScript("resource://calendar/calendar-js/calDavRequestHandlers.js", this);

//
// tbSyncDavCalendar.js
//

function tbSyncDavCalendar() { 
  calDavCalendar.call(this); 
} 
  
tbSyncDavCalendar.prototype = { 
  __proto__: calDavCalendar.prototype,
  classID:  Components.ID('7eb8f992-3956-4607-95ac-b860ebd51f5a}'),
  classDescription: 'tbSyncCalDav',
  contractID: '@mozilla.org/calendar/calendar;1?type=tbSyncCalDav',
	
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
    return this.__proto__.__proto__.__proto__.getProperty.apply(this, arguments); //needed to add one more proto
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
  
}


/** Module Registration */
this.NSGetFactory = cid => {
  this.NSGetFactory = XPCOMUtils.generateNSGetFactory([tbSyncDavCalendar]);
  return this.NSGetFactory(cid);
};
