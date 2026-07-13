/**
 * shared/storage.js
 * Shared helpers for reading/writing Loki's chrome.storage.sync data.
 * Exported as plain functions — works in service worker, content script, options, and popup.
 */

const STORAGE_KEYS = {
  HOTKEYS: 'hotkeys',
  SETTINGS: 'settings',
  TRACKED_TABS: 'lokiTrackedTabs', // chrome.storage.session — maps bookmarkId → tabId
};

const DEFAULT_SETTINGS = {
  leaderKey: {
    ctrl: false,
    alt: false,
    shift: true,
    meta: true, // Cmd on Mac, Win on Windows
    code: 'KeyL',
  },
  enabled: true,
  blockedDomains: [],
  theme: 'auto', // 'auto' | 'light' | 'dark'
};

/**
 * Returns all hotkey bindings from storage.
 * @returns {Promise<Array>}
 */
async function getHotkeys() {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.HOTKEYS);
  return result[STORAGE_KEYS.HOTKEYS] ?? [];
}

/**
 * Replaces all hotkey bindings in storage.
 * @param {Array} hotkeys
 */
async function setHotkeys(hotkeys) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.HOTKEYS]: hotkeys });
}

/**
 * Adds or updates a single hotkey binding (matched by id).
 * @param {Object} binding
 */
async function upsertHotkey(binding) {
  const hotkeys = await getHotkeys();
  const idx = hotkeys.findIndex((h) => h.id === binding.id);
  if (idx >= 0) {
    hotkeys[idx] = binding;
  } else {
    hotkeys.push(binding);
  }
  await setHotkeys(hotkeys);
}

/**
 * Removes a hotkey binding by id.
 * @param {string} id
 */
async function removeHotkey(id) {
  const hotkeys = await getHotkeys();
  await setHotkeys(hotkeys.filter((h) => h.id !== id));
}

/**
 * Returns extension settings, merged with defaults.
 * @returns {Promise<Object>}
 */
async function getSettings() {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] ?? {}) };
}

/**
 * Updates extension settings (partial update).
 * @param {Object} partial
 */
async function updateSettings(partial) {
  const current = await getSettings();
  await chrome.storage.sync.set({
    [STORAGE_KEYS.SETTINGS]: { ...current, ...partial },
  });
}

/**
 * Returns estimated storage usage in bytes and percentage of 100KB quota.
 * @returns {Promise<{bytes: number, percent: number}>}
 */
async function getStorageUsage() {
  return new Promise((resolve) => {
    chrome.storage.sync.getBytesInUse(null, (bytes) => {
      resolve({ bytes, percent: Math.round((bytes / 102400) * 100) });
    });
  });
}

/**
 * Returns the tracked-tabs map from chrome.storage.session.
 * Keys are bookmarkBinding IDs, values are tabIds.
 * @returns {Promise<Record<string, number>>}
 */
async function getTrackedTabs() {
  const result = await chrome.storage.session.get(STORAGE_KEYS.TRACKED_TABS);
  return result[STORAGE_KEYS.TRACKED_TABS] ?? {};
}

/**
 * Persists the tracked-tabs map to chrome.storage.session.
 * @param {Record<string, number>} map
 */
async function setTrackedTabs(map) {
  await chrome.storage.session.set({ [STORAGE_KEYS.TRACKED_TABS]: map });
}

/**
 * Generates a short UUID-like ID for new bindings.
 * @returns {string}
 */
function generateId() {
  return `loki-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Converts a key event (or stored key object) to a human-readable string.
 * e.g. { meta: true, shift: false, code: 'KeyG' } → "⌘G"
 * @param {Object} key
 * @param {boolean} isMac
 * @returns {string}
 */
function keyToLabel(key, isMac = navigator.platform.includes('Mac')) {
  const parts = [];
  if (key.ctrl) parts.push(isMac ? '⌃' : 'Ctrl');
  if (key.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (key.shift) parts.push(isMac ? '⇧' : 'Shift');
  if (key.meta) parts.push(isMac ? '⌘' : 'Win');
  parts.push(codeToLabel(key.code));
  return parts.join('');
}

/**
 * Converts a KeyboardEvent.code string to a human-readable key label.
 * @param {string} code
 * @returns {string}
 */
function codeToLabel(code) {
  if (code.startsWith('Key')) return code.slice(3); // KeyG → G
  if (code.startsWith('Digit')) return code.slice(5); // Digit1 → 1
  if (code.startsWith('F') && !isNaN(code.slice(1))) return code; // F1-F12
  const MAP = {
    Space: '␣', Enter: '↵', Backspace: '⌫', Escape: 'Esc',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Tab: '⇥', Period: '.', Comma: ',', Slash: '/', Semicolon: ';',
    Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Minus: '-', Equal: '=', Backquote: '`',
  };
  return MAP[code] ?? code;
}

/**
 * Returns true if the given KeyboardEvent matches the stored key object.
 * @param {KeyboardEvent} e
 * @param {Object} key
 * @returns {boolean}
 */
function keyMatches(e, key) {
  return (
    e.code === key.code &&
    !!e.ctrlKey === !!key.ctrl &&
    !!e.altKey === !!key.alt &&
    !!e.shiftKey === !!key.shift &&
    !!e.metaKey === !!key.meta
  );
}
