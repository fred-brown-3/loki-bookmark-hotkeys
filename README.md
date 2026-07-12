# 🐾 Loki — Bookmark Hotkeys

A Chrome extension (Manifest V3) that provides a Raycast-style command palette for instantly navigating to bookmarks via user-assigned keyboard shortcuts.

Press **Cmd+Shift+L** (Mac) / **Ctrl+Shift+L** (Win/Linux) to open the palette popup, then press a bound key to jump to a bookmark.

---

## Table of Contents

- [Installation](#installation)
- [Architecture](#architecture)
- [File Structure](#file-structure)
- [How the Keyboard Shortcut Works](#how-the-keyboard-shortcut-works)
- [Data Model](#data-model)
- [Chrome APIs Used](#chrome-apis-used)
- [Known Constraints](#known-constraints)
- [Gotchas for Future Developers](#gotchas-for-future-developers)
- [Development Workflow](#development-workflow)
- [Design](#design)

---

## Installation

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select this directory
5. Press **Cmd+Shift+L** (or click the Loki extension icon in the toolbar) to launch the palette.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Chrome Browser                                          │
│                                                          │
│  ┌─────────────────────────┐                             │
│  │  chrome.commands API    │ Catches Cmd+Shift+L         │
│  │  ("_execute_action")    │ (Handled natively by Chrome)│
│  └───────────┬─────────────┘                             │
│              │ Opens Action Popup                        │
│              ▼                                           │
│  ┌─────────────────────────┐                             │
│  │  palette/palette.html   │ Renders command palette     │
│  │  (Action Popup Window)  │ Handles search, hotkeys, and│
│  │  & palette.js           │ direct tab navigation APIs  │
│  └─────────────────────────┘                             │
│                                                          │
│  ┌────────────┐                                          │
│  │ options/   │ Settings page (managing bookmark keys)   │
│  └────────────┘                                          │
└──────────────────────────────────────────────────────────┘
```

---

## File Structure

```
chrome-bookmark-hotkeys-extension/
├── manifest.json           # MV3 manifest — extension definition and keyboard mapping
├── background.js           # Service worker (currently a placeholder)
├── palette/
│   ├── palette.html        # Palette Popup HTML structure
│   ├── palette.css         # Palette styles (Westie color theme, auto light/dark)
│   └── palette.js          # Palette logic: hotkey matching, bookmark search, navigation
├── options/
│   ├── options.html        # Full settings page UI
│   └── options.js          # Hotkey manager, leader key config, domain blocklist
├── shared/
│   └── storage.js          # Storage helpers (used by options page)
└── icons/
    ├── loki-16.png
    ├── loki-48.png
    └── loki-128.png        # Westie terrier mascot
```

---

## How the Keyboard Shortcut Works

### Native Action Popup API (`_execute_action`)

Instead of utilizing background messaging and injected page content scripts, Loki utilizes Chrome's native Action API.

```
1. User presses Cmd+Shift+L
2. Chrome's chrome.commands API intercepts it natively via the reserved "_execute_action" target
3. Chrome automatically instantiates and displays the popup "palette/palette.html"
4. The palette script "palette.js" retrieves hotkey mappings and registers keydown listeners inside the popup
5. Selecting a bookmark triggers direct tab navigation and invokes window.close() to dismiss the popup
```

This guarantees 100% compatibility across all pages, including settings pages (`chrome://`), local files (`file://`), and the Chrome Web Store.

---

## Data Model

All data is stored in `chrome.storage.sync` (syncs across devices, 100 KB quota):

```javascript
{
  "hotkeys": [
    {
      "id": "loki-1720000000000-abc12",   // unique ID
      "bookmarkId": "12345",               // chrome.bookmarks node ID
      "url": "https://...",                // cached for fast access
      "title": "Gmail",                    // display name
      "isFolder": false,
      "folderBehavior": null,              // "drill_in" | "flat_list" | "open_all"
      "key": {
        "code": "KeyG",                   // KeyboardEvent.code
        "shift": false,                   // only Shift modifier allowed inside palette
        "ctrl": false, "alt": false, "meta": false
      },
      "openIn": "new_tab"                 // "new_tab" | "current_tab" | "new_window"
    }
  ],
  "settings": {
    "leaderKey": { "ctrl": false, "alt": false, "shift": true, "meta": true, "code": "KeyL" },
    "enabled": true,
    "blockedDomains": ["notion.so", "docs.google.com"],
    "theme": "auto"
  }
}
```

---

## Chrome APIs Used

| API | Where | Purpose |
|---|---|---|
| `chrome.bookmarks.search()` | palette.js, options.js | Substring search for bookmarks |
| `chrome.bookmarks.update()` | palette.js, options.js | Inline editing of bookmark title/URL |
| `chrome.bookmarks.getTree()` | options.js | Full bookmark tree for settings page |
| `chrome.storage.sync.get/set` | everywhere | Persist hotkey bindings + settings |
| `chrome.storage.onChanged` | palette.js, options.js | Live-reload bindings without page refresh |
| `chrome.tabs.create()` | palette.js | Open bookmark in a new tab |
| `chrome.tabs.update()` | palette.js | Navigate active tab |
| `chrome.windows.create()` | palette.js | Open bookmark in new window |
| `chrome.runtime.openOptionsPage()` | palette.js | Open settings page |

---

## Known Constraints

| Constraint | Details |
|---|---|
| **Popup Dimension Limits** | Chrome action popups are constrained to a maximum size of **800x600 pixels**. Loki's body size is set to **600x400 pixels**. |
| **`file://` URLs** | Require explicit user opt-in in Chrome's extension settings ("Allow access to file URLs"). |
| **`storage.sync` quota** | 100 KB total. Each binding is ~200 bytes, supporting ~500 bookmarks. |

---

## Gotchas for Future Developers

### 1. Sizing
Chrome popups dynamically resize to content if size isn't explicitly defined, which looks jarring. Always set explicit `width` and `height` on the `body` element in `palette.css`.

### 2. Autofocus
Ensure the search `<input>` element has the `autofocus` attribute in `palette.html` so users can type immediately upon opening.

### 3. Window Closing
Navigating via `chrome.tabs` APIs does not always dismiss the action popup natively. Be sure to call `window.close()` directly after initiating navigation in `palette.js`.

---

## Development Workflow

1. Edit files in this directory
2. Go to `chrome://extensions` → click **↺ Reload** on Loki
3. Press `Cmd+Shift+L` to inspect and test the popup.

---

## Design

### Color Palette (Westie-Inspired)

| Token | Light | Dark |
|---|---|---|
| Background | `#FDFAF5` (warm cream) | `#1C1A17` (warm charcoal) |
| Surface | `#F5EFE0` (linen) | `#2A2720` |
| Accent | `#C4873B` (warm amber) | `#D4975A` |
| Text | `#2C2416` | `#F0EAD8` |
| Key badge | `#EDE3CF` | `#332F28` |

---

## License

MIT
