/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { setTimeout } = ChromeUtils.import("resource://gre/modules/Timer.jsm");
var { cal } = ChromeUtils.import("resource:///modules/calendar/calUtils.jsm");
var { TbSync } = ChromeUtils.import("chrome://tbsync/content/tbsync.jsm");

/**
 * Session and authentication tools for the googledav provider
 */

const EXPORTED_SYMBOLS = ["GoogleDavSession"]; /* exported GoogleDavSession */
let sessions = {};

/**
 * A session for the googledav provider. Two or more calendars can share a session if they have the
 * same auth credentials.
 */
class GoogleDavSession {
  QueryInterface(aIID) {
    return cal.generateClassQI(this, aIID, [Ci.nsIInterfaceRequestor]);
  }

  /**
   * Constant returned by |completeRequest| when the request should be restarted
   * @return {Number}    The constant
   */
  static get RESTART_REQUEST() {
    return 1;
  }

  /**
   * Creates a new googledav session
   *
   * @param {String} aSessionId    The session id, used in the password manager
   * @param {String} aName         The user-readable description of this session
   */
  constructor(aSessionId, aName) {
    this.id = aSessionId;
    this.name = aName;
  }

  /**
   * Implement nsIInterfaceRequestor. The base class has no extra interfaces, but a subclass of
   * the session may.
   *
   * @param {nsIIDRef} aIID       The IID of the interface being requested
   * @return {?*}                 Either this object QI'd to the IID, or null.
   *                                Components.returnCode is set accordingly.
   */
  getInterface(aIID) {
    try {
      // Try to query the this object for the requested interface but don't
      // throw if it fails since that borks the network code.
      return this.QueryInterface(aIID);
    } catch (e) {
      Components.returnCode = e;
    }

    return null;
  }

  /**
   * Calls the auth adapter for the given host in case it exists. This allows delegating auth
   * preparation based on the host, e.g. for OAuth.
   *
   * @param {String} aURI        The uri to check the auth adapter for
   * @param {String} aMethod      The method to call
   * @param {...*} aArgs          Remaining args specific to the adapted method
   * @return {*}                  Return value specific to the adapter method
   */
  getSession(aURI) {
    // accountID is stored as username
    let accountID = aURI.username || null;
    if (!accountID)
      return null;
    
    if (!sessions.hasOwnProperty(accountID)) {
      sessions[accountID] = TbSync.providers.dav.network.getOAuthObj(aURI);
    }
    return sessions[accountID];
  }

  /**
   * Prepare the channel for a request, e.g. setting custom authentication headers
   *
   * @param {nsIChannel} aChannel     The channel to prepare
   * @return {Promise}                A promise resolved when the preparations are complete
   */
  async prepareRequest(aChannel) {
    let session = this.getSession(aChannel.URI);
    if (!session)
      return null;
    
    try {
      if (!session.accessToken || session.isExpired()) {
          if (!(await session.asyncConnect({}))) {
            return null;
          }
      }
      aChannel.setRequestHeader("Authorization", "Bearer " +  session.accessToken, false);
    } catch(e) {
      Components.utils.reportError(e);
    }
  }

  /**
   * Prepare the given new channel for a redirect, e.g. copying headers.
   *
   * @param {nsIChannel} aOldChannel      The old channel that is being redirected
   * @param {nsIChannel} aNewChannel      The new channel to prepare
   * @return {Promise}                    A promise resolved when the preparations are complete
   */
  async prepareRedirect(aOldChannel, aNewChannel) {
    //console.log("prepareRedirect");
    //https://searchfox.org/comm-esr78/source/calendar/providers/caldav/modules/CalDavSession.jsm#192
  }

  /**
   * Complete the request based on the results from the response. Allows restarting the session if
   * |GoogleDavSession.RESTART_REQUEST| is returned.
   *
   * @param {CalDavResponseBase} aResponse    The response to inspect for completion
   * @return {Promise}                        A promise resolved when complete, with
   *                                            GoogleDavSession.RESTART_REQUEST or null
   */
  async completeRequest(aResponse) {
    //console.log("completeRequest");
    //https://searchfox.org/comm-esr78/source/calendar/providers/caldav/modules/CalDavSession.jsm#214    
  }
}
