"use strict";

dav.sync = {

    getServerConnectionViaAutodiscover: Task.async (function* (user, password, timeout) {
        //DAV API SIMULATION: lets simulate the result for autodiscover
        yield tbSync.sleep(timeout/10, false);
        return {"server": "https://www.test.de", "user": user, "errorcode": "200", "error": ""};
    }),

/*

Retrieve calendards and addressbooks from server

curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/.well-known/carddav/
#get correct endpoint
curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/remote.php/carddav/
#get principals and addressbooks -- append username
curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/remote.php/carddav/addressbooks/USER/
curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/remote.php/carddav/principals/USER/

curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/.well-known/caldav/
#get correct endpoint
curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/remote.php/caldav/
#get principals and addressbooks -- append username
curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/remote.php/caldav/calendars/USER/
curl --basic --user 'USER:PASS' -i -X PROPFIND https://SERVER/remote.php/carddav/principals/USER/

*/
    
    updateFolders: Task.async (function* (syncdata) {
        //sync states are only printed while the account state is "syncing" to inform user about sync process (it is not stored in DB, just in syncdata)
        //example state "getfolders" to get folder information from server
        //if you send a request to a server and thus have to wait for answer, use a "send." syncstate, which will give visual feedback to the user,
        //that we are waiting for an answer with timeout countdown
        tbSync.setSyncState("send.getfolders", syncdata.account);
        yield tbSync.sleep(3500);
        tbSync.setSyncState("eval.folders", syncdata.account); 
        yield tbSync.sleep(500);

        //DAV API SIMULATION: lets simulate that a new folder of random type has been found on the server and add it to our DB
        let type = Math.floor(Math.random() * 2);
        let types = ["addressbook","calendar","task"]; //i just picked these types, getThunderbirdFolderType must match these (needs to be replaced with true DAV folder types)
        let id = Date.now();
    
        let newFolder = tbSync.eas.getNewFolderEntry(syncdata.account);
        newFolder.folderID = id.toString();
        newFolder.name = "DAV " + id;
        newFolder.type = types[type];
        newFolder.parentID = "0"; //root - tbsync flatens hierachy, using parentID to sort entries
        newFolder.selected = "1"; //only select address books, tasks and calendars!
        tbSync.db.addFolder(newFolder);            
    }),


    
    start: Task.async (function* (syncdata)  {
        //The syncdata.targetObj has a comon interface, regardless if this is a contact or calendar sync, 
        //so you could use the same main sync process for both to reduce redundancy.
        //The actual type can be stored in syncdata.type, so you can call type-based functions to read 
        //or to create new Thunderbird items (contacts or events)

        //SAMPLE IMPL for "sendLocalChanges"
        
        //define how many entries can be send in one request
        let maxnumbertosend = 10;
        
        //access changelog to get local modifications (done and todo are used for UI to display progress)
        syncdata.done = 0;
        syncdata.todo = db.getItemsFromChangeLog(syncdata.targetId, 0, "_by_user").length;

        do {
            tbSync.setSyncState("prepare.request.localchanges", syncdata.account, syncdata.folderID);

            //get changed items from ChangeLog
            let changes = db.getItemsFromChangeLog(syncdata.targetId, maxnumbertosend, "_by_user");
            if (changes == 0)
                break;
            
            for (let i=0; i<changes.length; i++) {
                //DAV API SIMULATION: do something with the Thunderbird object here

                //eval based on changes[i].status (added_by_user, modified_by_user, deleted_by_user)
                db.removeItemFromChangeLog(syncdata.targetId, changes[i].id);
                syncdata.done++; //UI feedback
            }
            tbSync.setSyncState("send.request.localchanges", syncdata.account, syncdata.folderID); 
            yield tbSync.sleep(3500);

            tbSync.setSyncState("eval.response.localchanges", syncdata.account, syncdata.folderID); 	    
            
        } while (true);

        tbSync.finishFolderSync(syncdata, "OK");         
    }),

}
