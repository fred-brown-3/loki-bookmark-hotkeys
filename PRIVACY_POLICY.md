# Privacy Policy for Loki — Bookmark Hotkeys

**Last updated: July 13, 2026**

This Privacy Policy describes how the **Loki — Bookmark Hotkeys** browser extension ("the Extension") handles your information. Please read this policy carefully.

---

## Summary

**Loki — Bookmark Hotkeys does not collect, transmit, or share any personal data.** All data processed by the Extension remains exclusively within your local browser environment and is never sent to any external server, third party, or the developer.

---

## 1. Data We Access

The Extension accesses the following browser information **locally on your device only** in order to perform its core keyboard-navigation functions:

- **Bookmarks**: The Extension reads your browser's bookmarks database locally using the `chrome.bookmarks` API. This is used solely to construct the list of available bookmarks in the command palette search and to let you map custom keyboard shortcuts to specific bookmarks.
- **Tabs and Windows**: The Extension reads tab information locally to execute your navigation choices (e.g., opening a bookmark in a new tab, active tab, new window, or private incognito window) and to check if a bookmarked URL is already open to refocus it.
- **Active Web Page URL/Title**: When you use the "Bookmark current page" feature (`Shift + Space`), the Extension reads the active tab's URL and page title locally to pre-fill the bookmark creation form.

None of this information is logged, stored permanently, or transmitted outside your local environment.

---

## 2. Data We Store

All storage is **local to your browser profile** using Chrome's built-in storage APIs. No external database or server is involved.

| Data | Storage Type | Syncs Across Devices? | Purpose |
|---|---|---|---|
| Hotkey configuration (bookmark mappings, keys, behaviors) | `chrome.storage.sync` | **Yes** — via your Google Account's native Chrome Sync | Synchronizes your customized hotkey bindings across your devices |
| Temporary session tracking (`lokiTrackedTabs`) | `chrome.storage.session` | **No** — cleared when the browser closes | Tracks newly opened bookmark tabs during a session for the "refocus if open" feature |
| UI/Theme settings (e.g. appearance, list sizing, search behavior) | `chrome.storage.local` | **No** | Stores local preference options |

---

## 3. Data We Do Not Collect

The Extension explicitly does **not**:

- Collect or transmit any personally identifiable information (PII).
- Track your general browsing history, search queries, or page content.
- Send any telemetry, usage statistics, or analytics data to the developer or any third party.
- Use cookies, tracking pixels, or any form of web beacons.
- Make any network requests of any kind (the Extension operates entirely offline and does not contain any remote fetches).

---

## 4. Data Sharing

**We do not share any data with anyone.** There are no third parties, advertisers, analytics providers, or data brokers involved. No data ever leaves your local Chrome browser sync profile.

---

## 5. Remote Code

The Extension does not load or execute any remote code. All HTML, JavaScript, CSS, and font files are bundled locally within the Extension package. No external scripts, stylesheets, or resources are fetched at runtime.

---

## 6. Permissions Justification

The Extension requests the following Chrome permissions, each used exclusively for the stated purpose:

- **`bookmarks`**: Required to read, search, and manage your browser's bookmarks so you can navigate them via hotkeys and quickly bookmark new pages.
- **`storage`**: Required to save your custom keyboard shortcut mappings and preferences using `chrome.storage.sync` and `chrome.storage.local`.
- **`tabs`**: Required to open bookmarks in new tabs/windows and to locate and refocus existing open bookmark tabs.

---

## 7. Children's Privacy

The Extension does not knowingly collect any data from anyone, including children under the age of 13. As no data is collected at all, the Extension is safe for use by all ages.

---

## 8. Changes to This Policy

If this Privacy Policy changes, the updated version will be committed to the public GitHub repository and the "Last updated" date at the top of this document will be revised. Continued use of the Extension after a policy update constitutes acceptance of the revised policy.

---

## 9. Contact

If you have any questions about this Privacy Policy, please open an issue on the GitHub repository:

**https://github.com/fred-brown-3/loki-bookmark-hotkeys/issues**
