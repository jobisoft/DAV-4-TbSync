/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

var { HttpRequest } = ChromeUtils.import("chrome://tbsync/content/HttpRequest.jsm");
var { OAuth2 } = ChromeUtils.import("resource:///modules/OAuth2.jsm");
const { DNS } = ChromeUtils.import("resource:///modules/DNS.jsm");

var network = {
  
  getAuthData: function(accountData) {
      let connection = {
        get host() {
          return "TbSync#" + accountData.accountID;
        },
        
        get username() {
          return accountData.getAccountProperty("user");
        },

        get password() {
          // try new host first
          let pw = TbSync.passwordManager.getLoginInfo(this.host, "TbSync/DAV", this.username);
          if (pw) {
            return pw;
          }

          // try old host as fallback
          let oldHost = accountData.getAccountProperty("calDavHost") ? accountData.getAccountProperty("calDavHost") : accountData.getAccountProperty("cardDavHost");
          if (oldHost.startsWith("http://")) oldHost = oldHost.substr(7);
          if (oldHost.startsWith("https://")) oldHost = oldHost.substr(8);          
          pw = TbSync.passwordManager.getLoginInfo(oldHost, "TbSync/DAV", this.username);
          if (pw) {
            //migrate
            this.updateLoginData(this.username, pw);
          }
          return pw;
        },
        
        updateLoginData: function(newUsername, newPassword) {
          let oldUsername = this.username;
          TbSync.passwordManager.updateLoginInfo(this.host, "TbSync/DAV", oldUsername, newUsername, newPassword);
          // Also update the username of this account.
          accountData.setAccountProperty("user", newUsername);
        },
        
        removeLoginData: function() {
          TbSync.passwordManager.removeLoginInfos(this.host, "TbSync/DAV");
        }
      };
      return connection;
  },
  
  ConnectionData: class {
    constructor(data) {            
      this._password = "";
      this._username = "";
      this._https = "";
      this._type = "";
      this._fqdn = "";
      this._timeout = dav.Base.getConnectionTimeout();

      //for error logging
      this._eventLogInfo = null;
      
      //typof syncdata?
      let folderData = null;
      let accountData = null;            
      
      if (data instanceof TbSync.SyncData) {
        folderData = data.currentFolderData;
        accountData = data.accountData;
        this._eventLogInfo = data.eventLogInfo;                
      } else if (data instanceof TbSync.FolderData) {
        folderData = data;
        accountData = data.accountData;
        this._eventLogInfo =  new TbSync.EventLogInfo(
          accountData.getAccountProperty("provider"),
          accountData.getAccountProperty("accountname"),
          accountData.accountID,
          folderData.getFolderProperty("foldername"));
      } else if (data instanceof TbSync.AccountData) {
        accountData = data;
        this._eventLogInfo =  new TbSync.EventLogInfo(
          accountData.getAccountProperty("provider"),
          accountData.getAccountProperty("accountname"),
          accountData.accountID,
          "");
      }
      
      if (accountData) {
        let authData = dav.network.getAuthData(accountData);
        this._password = authData.password;
        this._username = authData.username;

        this._accountname = accountData.getAccountProperty("accountname");
        if (folderData) {
          this._fqdn = folderData.getFolderProperty("fqdn");
          this._https = folderData.getFolderProperty("https");
        }
        this.accountData = accountData;
      }
    }
    
        
    set password(v) {this._password = v;}
    set username(v) {this._username = v;}
    set timeout(v) {this._timeout = v;}
    set https(v) {this._https = v;}
    set fqdn(v) {this._fqdn = v;}
    set eventLogInfo(v) {this._eventLogInfo = v;}

    get password() {return this._password;}
    get username() {return this._username;}
    get timeout() {return this._timeout;}
    get https() {return this._https;}
    get fqdn() {return this._fqdn;}
    get eventLogInfo() {return this._eventLogInfo;}
  },
 

  checkForRFC6764Request: async function (path, eventLogInfo) {
      function checkDefaultSecPort (sec) {
        return sec ? "443" : "80";
      }

      if (!this.isRFC6764Request(path)) {
        return path;
      }
      
      let parts = path.toLowerCase().split("6764://");
      let type = parts[0].endsWith("caldav") ? "caldav" : "carddav";

      // obey preselected security level for DNS lookup
      // and only use insecure option if specified
      let scheme = parts[0].startsWith("httpca") ? "http" : "https"; //httpcaldav or httpcarddav = httpca = http      
      let sec = (scheme == "https");
      
      let hostPath = parts[1];
      while (hostPath.endsWith("/")) { hostPath = hostPath.slice(0,-1); }
      let host = hostPath.split("/")[0];
      
      let result = {};
      
      //only perform dns lookup, if the provided path does not contain any path information
      if (host == hostPath) {
          let request = "_" + type + (sec ? "s" : "") + "._tcp." + host;

          // get host from SRV record
          let rv = await DNS.srv(request);                     
          if (rv && Array.isArray(rv) && rv.length>0 && rv[0].host) {
              result.secure = sec;
              result.host = rv[0].host + ((checkDefaultSecPort(sec) == rv[0].port) ? "" : ":" + rv[0].port);
              TbSync.eventlog.add("info", eventLogInfo, "RFC6764 DNS request succeeded", "SRV record @ " + request + "\n" + JSON.stringify(rv[0]));

              // Now try to get path from TXT
              rv = await DNS.txt(request);   
              if (rv && Array.isArray(rv) && rv.length>0 && rv[0].data && rv[0].data.toLowerCase().startsWith("path=")) {
                  result.path = rv[0].data.substring(5);
                  TbSync.eventlog.add("info", eventLogInfo, "RFC6764 DNS request succeeded", "TXT record @ " + request + "\n" + JSON.stringify(rv[0]));
              } else {
                  result.path = "/.well-known/" + type;
              }

              result.url = "http" + (result.secure ? "s" : "") + "://" + result.host +  result.path;
              return result.url;
          } else {
              TbSync.eventlog.add("warning", eventLogInfo, "RFC6764 DNS request failed", "SRV record @ " + request);
          }
    }
    
    // use the provided hostPath and build standard well-known url
    return scheme + "://" + hostPath + "/.well-known/" + type;
  },

  startsWithScheme: function (url) {
    return (url.toLowerCase().startsWith("http://") || url.toLowerCase().startsWith("https://") || this.isRFC6764Request(url));
  },

  isRFC6764Request: function (url) {
    let parts = url.split("6764://");
    return (parts.length == 2 && parts[0].endsWith("dav"));
  },

  sendRequest: async function (requestData, path, method, connectionData, headers = {}, options = {}) {            
    let url = await this.checkForRFC6764Request(path, connectionData.eventLogInfo);
    let enforcedPermanentlyRedirectedUrl = (url != path) ? url : null;
    
    // path could be absolute or relative, we may need to rebuild the full url.
    if (url.startsWith("http://") || url.startsWith("https://")) {
      // extract segments from url
      let uri = Services.io.newURI(url);
      connectionData.https = (uri.scheme == "https");
      connectionData.fqdn = uri.hostPort;
    } else {
      url = "http" + (connectionData.https ? "s" : "") + "://" + connectionData.fqdn + url;
    }

    let currentSyncState = connectionData.accountData ? connectionData.accountData.syncData.getSyncState().state : "";
    let accountID = connectionData.accountData ? connectionData.accountData.accountID : "";
    
    // Loop: Prompt user for password and retry
    const MAX_RETRIES = options.hasOwnProperty("passwordRetries") ? options.passwordRetries+1 : 5;
    for (let i=1; i <= MAX_RETRIES; i++) {
      TbSync.dump("URL Request #" + i, url);

      connectionData.url = url;

      // Restore original syncstate before open the connection
      if (connectionData.accountData && currentSyncState != connectionData.accountData.syncData.getSyncState().state) {
        connectionData.accountData.syncData.setSyncState(currentSyncState);
      }
      
      let r = await dav.network.promisifiedHttpRequest(requestData, method, connectionData, headers, options);
      if (r && enforcedPermanentlyRedirectedUrl && !r.permanentlyRedirectedUrl) {
        r.permanentlyRedirectedUrl = enforcedPermanentlyRedirectedUrl;
      }
      
      if (r && r.passwordPrompt && r.passwordPrompt === true) {
        if (i == MAX_RETRIES) {
          // If this is the final retry, abort with error.
          throw r.passwordError;
        } else {
          let credentials = null;
          let retry = false;
          
          // Prompt, if connection belongs to an account (and not from the create wizard)
          if (connectionData.accountData) {
            let promptData = {
              windowID: "auth:" + connectionData.accountData.accountID,
              accountname: connectionData.accountData.getAccountProperty("accountname"),
              usernameLocked: connectionData.accountData.isConnected(),
              username: connectionData.username,
            }
            connectionData.accountData.syncData.setSyncState("passwordprompt");

            credentials = await TbSync.passwordManager.asyncPasswordPrompt(promptData, dav.openWindows);
            if (credentials) {
              // update login data
              dav.network.getAuthData(connectionData.accountData).updateLoginData(credentials.username, credentials.password);
              // update connection data
              connectionData.username = credentials.username;
              connectionData.password = credentials.password;
              retry = true;
            }
          }

          if (!retry) {
            throw r.passwordError;
          }

        }
      } else {
        return r;
      }
    }
  },
  
  // Promisified implementation of TbSync's HttpRequest (with XHR interface)
  promisifiedHttpRequest: function (requestData, method, connectionData, headers, options) {
    let responseData = "";
    
    //do not log HEADERS, as it could contain an Authorization header
    //TbSync.dump("HEADERS", JSON.stringify(headers));
    if (TbSync.prefs.getIntPref("log.userdatalevel") > 1) TbSync.dump("REQUEST", method + " : " + requestData);
  
    if (!options.hasOwnProperty("softfail")) {
      options.softfail = [];
    }
    
    if (!options.hasOwnProperty("responseType")) {
      options.responseType = "xml";
    }
    
    return new Promise(function(resolve, reject) {                  
      let req = new HttpRequest();

      req.timeout = connectionData.timeout;
      req.mozBackgroundRequest = true;
      
      req.open(method, connectionData.url, true, connectionData.username, connectionData.password);

      if (options.hasOwnProperty("containerRealm")) req.setContainerRealm(options.containerRealm);
      if (options.hasOwnProperty("containerReset") && options.containerReset == true) req.clearContainerCache();
      
      if (headers) {
          for (let header in headers) {
              req.setRequestHeader(header, headers[header]);
          }
      }

      if (options.responseType == "base64") {
        req.responseAsBase64 = true;
      }

      req.setRequestHeader("User-Agent", dav.sync.prefSettings.getCharPref("clientID.useragent"));

      req.realmCallback = function(username, realm, host) {
        // Store realm, needed later to setup lightning passwords.
        TbSync.dump("Found CalDAV authRealm for <"+host+">", realm);
        connectionData.realm = realm;
      };

      req.onerror = function () {
        let error = TbSync.network.createTCPErrorFromFailedXHR(req);
        if (!error) {
          return reject(dav.sync.finish("error", "networkerror", "URL:\n" + connectionData.url + " ("+method+")")); //reject/resolve do not terminate control flow
        } else {
          return reject(dav.sync.finish("error", error, "URL:\n" + connectionData.url + " ("+method+")"));
        }
      };
      
      req.ontimeout = req.onerror;
      
      req.onredirect = function(flags, uri) {
        console.log("Redirect ("+ flags.toString(2) +"): " + uri.spec);
        // Update connection settings from current URL
        let newHttps = (uri.scheme == "https");
        if (connectionData.https != newHttps) {
          TbSync.dump("Updating HTTPS", connectionData.https + " -> " + newHttps);
          connectionData.https = newHttps;
        }
        if (connectionData.fqdn !=uri.hostPort) {
          TbSync.dump("Updating FQDN", connectionData.fqdn + " -> " + uri.hostPort);
          connectionData.fqdn = uri.hostPort;
        }        
      };
      
      req.onload = function() {
        if (TbSync.prefs.getIntPref("log.userdatalevel") > 1) TbSync.dump("RESPONSE", req.status + " ("+req.statusText+")" + " : " + req.responseText);
        responseData = req.responseText.split("><").join(">\n<");
        
        let commLog = "URL:\n" + connectionData.url + " ("+method+")" + "\n\nRequest:\n" + requestData + "\n\nResponse:\n" + responseData;
        let aResult = req.responseText;
        let responseStatus = req.status;
        
        switch(responseStatus) {
          case 401: //AuthError
            {
              let response = {};
              response.passwordPrompt = true;
              response.passwordError = dav.sync.finish("error", responseStatus, commLog);
              return resolve(response);                
            }
            break;
            
          case 207: //preprocess multiresponse
            {
              let xml = dav.tools.convertToXML(aResult);
              if (xml === null) return reject(dav.sync.finish("warning", "malformed-xml", commLog));
              
              let response = {};
              response.davOptions = req.getResponseHeader("dav");
              response.responseURL = req.responseURL;
              response.permanentlyRedirectedUrl = req.permanentlyRedirectedUrl;
              response.commLog = commLog;
              response.node = xml.documentElement;

              let multi = xml.documentElement.getElementsByTagNameNS(dav.sync.ns.d, "response");
              response.multi = [];
              for (let i=0; i < multi.length; i++) {
                let hrefNode = dav.tools.evaluateNode(multi[i], [["d","href"]]);
                let responseStatusNode = dav.tools.evaluateNode(multi[i], [["d", "status"]]);
                let propstats = multi[i].getElementsByTagNameNS(dav.sync.ns.d, "propstat");
                if (propstats.length > 0) {
                  //response contains propstats, push each as single entry
                  for (let p=0; p < propstats.length; p++) {
                    let statusNode = dav.tools.evaluateNode(propstats[p], [["d", "status"]]);

                    let resp = {};
                    resp.node = propstats[p];
                    resp.status = statusNode === null ? null : statusNode.textContent.split(" ")[1];
                    resp.responsestatus = responseStatusNode === null ? null : responseStatusNode.textContent.split(" ")[1];
                    resp.href = hrefNode === null ? null : hrefNode.textContent;
                    response.multi.push(resp);
                  }
                } else {
                  //response does not contain any propstats, push raw response
                  let resp = {};
                  resp.node = multi[i];
                  resp.status = responseStatusNode === null ? null : responseStatusNode.textContent.split(" ")[1];
                  resp.responsestatus = responseStatusNode === null ? null : responseStatusNode.textContent.split(" ")[1];
                  resp.href = hrefNode === null ? null : hrefNode.textContent;
                  response.multi.push(resp);
                }
              }

              return resolve(response);
            }


          case 200: //returned by DELETE by radicale - watch this !!!
            return resolve(aResult);

          case 204: //is returned by DELETE - no data
          case 201: //is returned by CREATE - no data
            return resolve(null);
            break;

          default:
            if (options.softfail.includes(responseStatus)) {
              let noresponse = {};
              noresponse.softerror = responseStatus;
              let xml = dav.tools.convertToXML(aResult);
              if (xml !== null) {
                let exceptionNode = dav.tools.evaluateNode(xml.documentElement, [["s","exception"]]);
                if (exceptionNode !== null) {
                  noresponse.exception = exceptionNode.textContent;
                }
              }
              //manually log this non-fatal error
              TbSync.eventlog.add("info", connectionData.eventLogInfo, "softerror::"+responseStatus, commLog);
              return resolve(noresponse);
            } else {
              return reject(dav.sync.finish("warning", responseStatus, commLog)); 
            }                                
            break;

        }                
      };

      req.send(requestData);
    });
  }
}
