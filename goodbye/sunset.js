/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

let manifest = browser.runtime.getManifest();

// Localization
document.getElementById("discontinue-text").textContent = browser.i18n.getMessage("discontinue-text", manifest.name);
document.getElementById("discontinue-header").textContent = browser.i18n.getMessage("discontinue-header", manifest.name);
document.getElementById("replacement-text").textContent = browser.i18n.getMessage("replacement-text", manifest.name);
document.getElementById("uninstall").textContent = browser.i18n.getMessage("uninstall-button", manifest.name);
document.title = browser.i18n.getMessage("title", manifest.name);

// When the user clicks uninstall, prompt them to confirm and uninstall the add-on.
document.getElementById("uninstall").addEventListener("click", () => {
  let name = browser.runtime.getManifest().name;
  browser.management.uninstallSelf({
    showConfirmDialog: true,
    dialogMessage: `You are about to uninstall ${name}.\n`
  });
});
