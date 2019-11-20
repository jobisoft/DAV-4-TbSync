/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { cal } = ChromeUtils.import("resource://calendar/modules/calUtils.jsm");

Services.scriptloader.loadSubScript("resource://calendar/components/calDavCalendar.js", this);

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
  contractID: '@mozilla.org/calendar/calendar;1?type=tbSyncCalDav'
}


/** Module Registration */
this.NSGetFactory = cid => {
  this.NSGetFactory = XPCOMUtils.generateNSGetFactory([tbSyncDavCalendar]);
  return this.NSGetFactory(cid);
};
