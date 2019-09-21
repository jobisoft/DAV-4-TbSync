/*
 * This file is part of DAV-4-TbSync.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. 
 */

"use strict";

var { HttpRequest } = ChromeUtils.import("chrome://tbsync/content/HttpRequest.jsm");

var network = {
  
  getAuthData: function(accountData) {
      let connection = {
        get oldHost() {
          return accountData.getAccountProperty("calDavHost") ? accountData.getAccountProperty("calDavHost") : accountData.getAccountProperty("cardDavHost");
        },
        
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
          pw = TbSync.passwordManager.getLoginInfo(this.oldHost, "TbSync/DAV", this.username);
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
      };
      return connection;
  }, 

  //non permanent cache
  listOfRealms: {},

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

        this._https = accountData.getAccountProperty("https");
        this._accountname = accountData.getAccountProperty("accountname");
        if (folderData) {
          this._type = folderData.getFolderProperty("type");
          this._fqdn = folderData.getFolderProperty("fqdn");
        }
      }
      
      this.accountData = accountData;
    }
    
        
    set password(v) {this._password = v;}
    set username(v) {this._username = v;}
    set timeout(v) {this._timeout = v;}
    set https(v) {this._https = v;}
    set type(v) {this._type = v;}
    set fqdn(v) {this._fqdn = v;}
    set eventLogInfo(v) {this._eventLogInfo = v;}

    get password() {return this._password;}
    get username() {return this._username;}
    get timeout() {return this._timeout;}
    get https() {return this._https;}
    get type() {return this._type;}
    get fqdn() {return this._fqdn;}
    get eventLogInfo() {return this._eventLogInfo;}
  },
 

  sendRequest: async function (requestData, path, method, connectionData, headers = {}, options = {softfail: []}) {            
    // path could be absolute or relative, we may need to rebuild the full url.
    let url = (path.startsWith("http://") || path.startsWith("https://")) ? path : "http" + (connectionData.https ? "s" : "") + "://" + connectionData.fqdn + path;

    // A few bugs in TB and in client implementations require to retry a connection on certain failures.
    const MAX_RETRIES = 5;
    for (let i=1; i <= MAX_RETRIES; i++) {
      TbSync.dump("URL Request #" + i, url);

      connectionData.url = url;

      let r = await dav.network.promisifiedHttpRequest(requestData, method, connectionData, headers, options);
      
      // ConnectionData.uri.host may no longer be the correct value, as there might have been redirects, use connectionData.fqdn .
      if (r && r.retry && r.retry === true) {
        if (r.passwordPrompt && r.passwordPrompt === true) {
          if (i == MAX_RETRIES) {
            // If this is the final retry, abort with error.
            throw r.passwordError;
          } else {
            let credentials = null;

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
            }

            if (credentials) {
              // update login data
              dav.network.getAuthData(connectionData.accountData).updateLoginData(credentials.username, credentials.password);
              // update connection data
              connectionData.username = credentials.username;
              connectionData.password = credentials.password;
            } else {
              throw r.passwordError;
            }
          }
        }
        
        // There might have been a redirect, rebuild url.
        url = "http" + (connectionData.https ? "s" : "") + "://" + connectionData.fqdn + r.path;
        
      } else {
        return r;
      }
    }

  },
  
  // Promisified implementation of TbSync's HttpRequest (with XHR interface)
  promisifiedHttpRequest: function (requestData, method, connectionData, headers, options, aUseStreamLoader) {
    let responseData = "";
    let permanentRedirect = "";
    
    //do not log HEADERS, as it could contain an Authorization header
    //TbSync.dump("HEADERS", JSON.stringify(headers));
    if (TbSync.prefs.getIntPref("log.userdatalevel")>1) TbSync.dump("REQUEST", method + " : " + requestData);
  
    return new Promise(function(resolve, reject) {                  
      let req = new HttpRequest();

      req.timeout = connectionData.timeout;
      req.mozBackgroundRequest = true;
      
      req.open(method, connectionData.url, true, connectionData.username, connectionData.password);

      if (headers) {
          for (let header in headers) {
              req.setRequestHeader(header, headers[header]);
          }
      }

      req.realmCallback = function(username, realm, host) {
        // Store realm, needed later to setup lightning passwords.
        if (connectionData.type == "cal") {
          TbSync.dump("Found CalDAV authRealm for <"+host+">", realm);
          dav.network.listOfRealms[host] = realm;
        }
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
      
      req.onredirect = function(status, uri) {
        if (status == 301) {
          permanentRedirect = uri;
        }
      };
      
      req.onload = function() {
        if (TbSync.prefs.getIntPref("log.userdatalevel")>1) TbSync.dump("RESPONSE", req.status + " ("+req.statusText+")" + " : " + req.responseText);
        responseData = req.responseText.split("><").join(">\n<");

        //Redirected? Update connection settings from current URL
        if (req.responseURI) {
          let newHttps = (req.responseURI.scheme == "https");
          if (connectionData.https != newHttps) {
            TbSync.dump("Updating HTTPS", connectionData.https + " -> " + newHttps);
            connectionData.https = newHttps;
          }
          if (connectionData.fqdn !=req.responseURI.hostPort) {
            TbSync.dump("Updating FQDN", connectionData.fqdn + " -> " + req.responseURI.hostPort);
            connectionData.fqdn = req.responseURI.hostPort;
          }
        }
        
        let commLog = "URL:\n" + connectionData.url + " ("+method+")" + "\n\nRequest:\n" + requestData + "\n\nResponse:\n" + responseData;
        let aResult = req.responseText;
        let responseStatus = req.status;
        
        switch(responseStatus) {
          case 301:
          case 302:
          case 303:
          case 305:
          case 307:
          case 308:
            {
              // Since the default nsIChannelEventSink handles the redirects, this should never
              // be called. Just in case, do a retry with the updated connection settings.
              let response = {};
              response.retry = true;
              response.path = req.responseURI.pathQueryRef;
              return resolve(response);
            }
            break;

          case 401: //AuthError
            {
              let response = {};
              response.retry = true;
              response.path = req.responseURI.pathQueryRef;
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
              response.permanentRedirect = permanentRedirect;
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
