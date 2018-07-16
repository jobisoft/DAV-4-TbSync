# DAV-4-TbSync
The CalDAV/CardDAV provider (prototype) has always been a hidden part of TbSync. Since I finished the external sync provider interface, I decided to move the CalDav/CardDav stuff out of TbSync into its own extension.

This prototype is only retrieving the available resources (calendars, address books) from the server. It is not yet syncing any data.

The [prototype of the DAV-4-TbSync extension](https://github.com/jobisoft/DAV-4-TbSync/releases) needs the latest [beta of TbSync](https://github.com/jobisoft/TbSync/releases).

### sabre/dav provider hookes into TbSync:

![image](https://github.com/jobisoft/EWS-4-TbSync/raw/master/screenshots/add_account.png)
