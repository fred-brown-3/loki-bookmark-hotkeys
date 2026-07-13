# Chrome Web Store Listing & Publishing Guide — Loki

This document contains all the copy, justifications, asset requirements, and publishing checklists you need to publish **Loki — Bookmark Hotkeys** on the Chrome Web Store.

---

## 1. Store Listing Copy

### Extension Title
> **Loki — Bookmark Hotkeys**
* (24 / 45 characters)

### Short Description / Summary
> **A Raycast-style command palette for your bookmarks. Press Cmd+Shift+L to launch.**
* (81 / 150 characters)

### Detailed Description (Markdown formatting is supported in the dashboard)
```text
Loki is a lightning-fast, keyboard-first command palette that lets you navigate your browser bookmarks instantly. Inspired by tools like Raycast and Alfred, Loki keeps your hands on the keyboard and helps you access your favorite sites in a fraction of a second.

Simply press Cmd+Shift+L (Mac) or Ctrl+Shift+L (Windows/Linux) to open the palette, press your assigned hotkey, and you're there.

✨ KEY FEATURES:
• ⚡ Instant Hotkey Navigation — Open the palette and tap a key to jump to your favorite bookmark.
• 🔎 Fuzzy Bookmark Search — Press Space to immediately search your entire bookmark hierarchy by title or URL.
• 📁 Nested Folder Support — Drill into folders, flatten hierarchies, or open all bookmarks in a folder at once.
• 🔖 Quick-Bookmark (Shift+Space) — Instantly bookmark your active page and assign a hotkey in a single step without leaving the page.
• 🎨 Warm Westie-Inspired UI — A sleek, modern design featuring responsive styling, hover animations, and auto dark/light modes.
• 🔄 Chrome Sync Integration — All your custom hotkey bindings synchronize automatically across your Google Account profiles.
• 🌐 Works Everywhere — Built using native Action Popups, working seamlessly on restricted URLs (like chrome:// settings, new tabs, and PDF previews).

⌨️ KEYBOARD SHORTCUTS:
• Open Palette: Cmd+Shift+L (Mac) / Ctrl+Shift+L (Win/Linux)
• Activate Bookmark Hotkey: Press the assigned key (e.g. "g" for Gmail, "y" for YouTube)
• Search Bookmarks: Press Space to type
• Move selection: Up/Down Arrow keys
• Open selected: Enter
• Edit selected: Shift + Enter
• Add current tab to bookmarks: Shift + Space
• Exit/Close palette: Esc

🔒 PRIVACY & OFFLINE-FIRST:
Loki is built with privacy as a core principle. The extension operates entirely on your local machine. It does not track your browsing history, collect any telemetry, or make any network requests. Your data is yours alone.
```

---

## 2. Privacy & Data Declarations

When publishing, Chrome Web Store reviews the requested permissions closely. Use the following pre-written explanations:

### Single Purpose Declaration
> **Loki provides a keyboard-driven command palette popup that allows users to instantly search, map, and navigate browser bookmarks via custom hotkeys.**

### Permissions Justification (Crucial for passing reviews)
- **`bookmarks`**: Required to read, retrieve, and search the user's bookmarks locally, enabling quick search and hotkey mapping within the palette interface.
- **`storage`**: Required to store the user's custom hotkey assignments, theme preferences, and options locally and synchronize them across the user's Chrome devices using Chrome's native sync API.
- **`tabs`**: Required to navigate the browser to bookmarked URLs in the current tab, new tabs, or to refocus existing open tabs.

### Data Usage Policy Questions
During submission, you must tick standard data usage boxes:
- **No data collection**: Confirm that Loki does not collect, transmit, or share any personal data.
- **Data classification**: Ensure that no checkboxes under "Personal communications," "Web history," or "Location" are checked, as Loki reads bookmarks and tabs strictly locally and does not collect or transmit them.

---

## 3. Visual Asset Specifications

### A. Extension Icons
You need to bundle these in the ZIP and upload a 128x128 logo for the store.
- **16x16 px** (bundled: `icons/loki-16.png`)
- **48x48 px** (bundled: `icons/loki-48.png`)
- **128x128 px** (bundled: `icons/loki-128.png` - *Also upload this to the Store listing icon field*)

### B. Screenshots (1 to 5 required)
* **Dimensions**: Must be **1280x800** or **640x400** pixels.
* **Format**: PNG or JPEG.
* **Tip**: You can use the existing screen in the `screenshots/` directory. If you take fresh screenshots, crop/resize them to exactly `1280x800` (16:10 aspect ratio) to ensure they aren't rejected or distorted by the store.
* **Recommended Screenshots**:
  1. Main command palette showing hotkey letters aligned beside bookmark names.
  2. Search mode showing fuzzy matched search results.
  3. One-click bookmarking modal (`Shift + Space`) showing how to create a hotkey.
  4. Options/Settings page showing the full hotkey dashboard list.

### C. Promotional Tiles (Optional but recommended)
These are used if Chrome decides to feature the extension:
- **Small Tile (440x280 px)**: Essential (mandatory for listing).
- **Large Tile (920x680 px)**: Optional.
- **Marquee Tile (1400x560 px)**: Optional.
*Design tip:* Keep these bold, clean, and uncluttered. Use the Westie mascot icon alongside large, readable text: `"Loki — Bookmark Hotkeys"`.

---

## 4. Step-by-Step Publishing Checklist

1. **Test the Extension Locally**:
   - Go to `chrome://extensions`.
   - Click "Reload" on the Loki extension card.
   - Test the keyboard shortcut (`Cmd+Shift+L` or `Ctrl+Shift+L`) and verify the popup launches, searches, and executes hotkeys successfully.

2. **Package the Extension**:
   - Create a ZIP file of the extension directory.
   - Exclude unnecessary developer configuration files (like `.git`, `.gitignore`, `STORE_LISTING.md`, `screenshots/` etc.).
   - **Command Line Packager**:
     Run this command from your terminal inside the root directory to generate a clean zip:
     ```bash
     zip -r loki-bookmark-hotkeys.zip . -x "*.git*" "*screenshots*" "*STORE_LISTING.md" ".DS_Store" "*.zip"
     ```

3. **Submit via Chrome Developer Dashboard**:
   - Go to [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).
   - Click **+ New Item** in the top right.
   - Upload the `loki-bookmark-hotkeys.zip` file.
   - Fill in the **Store Listing** fields (copy-paste from Section 1 above).
   - Upload the **Store Icon** (128x128 px) and your **Screenshots** (1280x800 px).
   - Link the **Privacy Policy URL** (if you host `PRIVACY_POLICY.md` on GitHub, use the GitHub raw/rendered URL: e.g., `https://github.com/fred-brown-3/loki-bookmark-hotkeys/blob/main/PRIVACY_POLICY.md`).
   - Fill in the **Privacy** and **Permissions** justifications (copy-paste from Section 2 above).
   - Pay the one-time $5 developer registration fee (if you haven't published before).
   - Click **Submit for Review**.
