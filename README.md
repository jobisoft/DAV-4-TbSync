# DAV-4-TbSync
The CalDAV/CardDAV provider has always been a hidden part of TbSync. Since I finished the external sync provider interface, I decided to move the CalDav/CardDav stuff out of TbSync into its own extension.

This provider is able to retrieve all available resources (calendars, address books) from the server and adds the found CalDAV calendars to lightning. It does not implement CalDAV sync by its own, the calendars are managed by lightning.

The following is still missing:
 - support for digest auth
 - CardDAV sync
 - push sync

The [DAV-4-TbSync extension](https://github.com/jobisoft/DAV-4-TbSync/releases) needs the latest [beta of TbSync](https://github.com/jobisoft/TbSync/releases).

### Image of the sabre/dav provider hooked into TbSync:

![image](https://raw.githubusercontent.com/jobisoft/DAV-4-TbSync/master/screenshots/AddAccount.png)
