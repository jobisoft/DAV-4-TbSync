    
    
    /* connection data:
   
            connection.provider = "dav";
            connection.accountname = accountname;
            connection.uri

    */
            
        startTimeout(aChannel) {
            let rv = Components.results.NS_ERROR_NET_TIMEOUT;
            let event = {
                notify: function(timer) {
                    if (aChannel) aChannel.cancel(rv);
                }
            }
            this._timer.initWithCallback(event, this._timeout, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
        }
                
