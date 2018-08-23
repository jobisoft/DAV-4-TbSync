# DAV-4-TbSync
The CalDAV/CardDAV provider for the Thunderbird synchronization AddOn TbSync. If this AddOn and TbSync are installed, TbSync is able to sync CalDAV/CardDAV accounts. This provider is closely following the specs defined by sabre/dav.

The server URL needed to add an CalDAV/CardDAV account is the plain server name (FQDN) like "cloud.server.com". There is no need to know any specific URL. The provider will find all available calendars and address books using the discovery service. Some servers do not provide the discovery service, than you have to enter the full path to the dav server itself, like "cloud.server.com/SOGo/dav".

This provider is not actually implementing the CalDAV protocol, but will add the found calendars to lightning and let lightning handle the sync. Please keep in mind: Lightning is not able to sync multiple calendars of different users on the same server.
**This limitation does not exist for the CardDAV implementation of this provider!**

The [DAV-4-TbSync extension](https://github.com/jobisoft/DAV-4-TbSync/releases) need the [TbSync v0.7.12 or later](https://github.com/jobisoft/TbSync/releases).

### Image of the sabre/dav provider hooked into TbSync:

![image](https://raw.githubusercontent.com/jobisoft/DAV-4-TbSync/master/screenshots/AddAccount.png)
