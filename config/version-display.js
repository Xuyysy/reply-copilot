const version = chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version;
for (const node of document.querySelectorAll("[data-version]")) node.textContent = version;
