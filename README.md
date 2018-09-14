# DAV-4-TbSync
The CalDAV/CardDAV provider for the Thunderbird synchronization AddOn TbSync. If this AddOn and TbSync are installed, TbSync is able to sync CalDAV/CardDAV accounts. This provider is closely following the specs defined by sabre/dav.

Most servers provide the discovery service, which allows to use just the plain server name (FQDN) like "cloud.server.com" as server URL. TbSync will find all available calendars and address books and there is no need to know any specific URLs for individual address books or calendars. If this does not work because your server does not provide the discovery service, you have to enter the full path to the dav server itself, like "cloud.server.com/SOGo/dav".

This provider is not actually implementing the CalDAV protocol, but will add the found calendars to lightning and let lightning handle the sync. 

## Work around for subscribing calendars of different users on the same server

Lightning has problems subscribing to multiple calendars of different users on the same server. DAV-4-TbSync 0.8.17 (or later) can probably resolve this issue, if you set

*extensions.dav4tbsync.addCredentialsToCardDavUrl = true*

If this still does not work for you, also set

*network.cookie.cookieBehavior = 1*

The first setting works around a bug in the PasswordManager by adding the credentials directly to the URl and thus bypassing the PasswordManager. This is of course not very secure, but the only way until this is fixed in lightning (it is beeing worked on).
The second setting works around a bug in the cookie management by rejecting third-party-cookies. 

Feedback on this work around is appreciated.

<hr>

The [DAV-4-TbSync extension](https://github.com/jobisoft/DAV-4-TbSync/releases) need the [TbSync v0.7.15 or later](https://github.com/jobisoft/TbSync/releases).

## Image of the sabre/dav provider hooked into TbSync:

![image](https://raw.githubusercontent.com/jobisoft/DAV-4-TbSync/master/screenshots/AddAccount.png)
