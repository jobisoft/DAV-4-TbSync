function handleUpdateAvailable(details) {
  console.log("Update available for Dav4TbSync");
}

async function main() {
  // just by registering this listener, updates will not install until next restart
  //messenger.runtime.onUpdateAvailable.addListener(handleUpdateAvailable);

  await messenger.BootstrapLoader.registerChromeUrl([ ["content", "dav4tbsync", "content/"] ]);
  await messenger.BootstrapLoader.registerBootstrapScript("chrome://dav4tbsync/content/bootstrap.js");  
}

main();
