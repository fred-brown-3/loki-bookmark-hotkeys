/**
 * palette/palette.js — Loki Command Palette Logic
 *
 * Wrapped in an IIFE so internal variables don't collide with content.js globals.
 * Only initPalette() is exposed on globalThis for content.js to call.
 *
 * Communication: sends messages to background.js via chrome.runtime.sendMessage().
 */

(function () { // ← IIFE start — keeps all vars scoped

/* ─── State ─────────────────────────────────────────────────────────────── */
let allHotkeys = [];      // All stored bindings from chrome.storage.sync
let settings = {};        // Extension settings
let mode = 'hotkeys';     // 'hotkeys' | 'search'
let searchQuery = '';
let activeIndex = 0;
let editingBinding = null; // binding being edited inline
let folderStack = [];      // breadcrumb trail for folder drill-in
let searchResults = [];    // current list of items rendered

// Key capture state for the edit form
let capturingKey = false;
let capturedKey = null;

/* ─── DOM References (populated in init) ──────────────────────────────── */
let $results, $search, $modeBadge, $editPanel, $empty, $breadcrumb;
let $editTitle, $editUrl, $editKeyCapture, $editOpenIn, $editFolderBehavior;
let $editFolderRow, $conflictWarning;

/* ─── Entry Point ────────────────────────────────────────────────────────── */
function initPalette(root, hotkeys, cfg) {
  allHotkeys = hotkeys;
  settings = cfg;

  bindDOMRefs(root);
  attachEventListeners();
  renderHotkeyMode();

  // Focus the search input
  $search.focus();
}

          <span class="loki-hint">
            <kbd class="loki-hint-key">E</kbd> edit
          </span>
          <span class="loki-hint">
            <kbd class="loki-hint-key">Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  `;
}

/* ─── DOM Refs ───────────────────────────────────────────────────────────── */
function bindDOMRefs(root) {
  $results = root.getElementById('loki-results');
  $search = root.getElementById('loki-search');
  $modeBadge = root.getElementById('loki-mode-badge');
  $editPanel = root.getElementById('loki-edit-panel');
  $empty = root.getElementById('loki-empty');
  $breadcrumb = root.getElementById('loki-breadcrumb');
  $editTitle = root.getElementById('loki-edit-title');
  $editUrl = root.getElementById('loki-edit-url');
  $editKeyCapture = root.getElementById('loki-edit-key');
  $editOpenIn = root.getElementById('loki-edit-open-in');
  $editFolderBehavior = root.getElementById('loki-edit-folder-behavior');
  $editFolderRow = root.getElementById('loki-edit-folder-row');
  $conflictWarning = root.getElementById('loki-conflict-warning');
}

/* ─── Event Listeners ────────────────────────────────────────────────────── */
function attachEventListeners() {
  // Click on backdrop (not palette) → close
  const backdrop = $results.closest('#loki-backdrop');
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) dispatchClose();
  });

  // Search input
  $search.addEventListener('input', onSearchInput);
  $search.addEventListener('keydown', onSearchKeydown);

  // Edit form — use shadow root refs (document.getElementById won't find shadow DOM elements)
  $editKeyCapture.addEventListener('click', startKeyCapture);
  $editKeyCapture.addEventListener('keydown', onKeyCaptureKeydown);
  $editKeyCapture.addEventListener('blur', stopKeyCapture);

  $editPanel.querySelector('#loki-edit-cancel')?.addEventListener('click', closeEditPanel);
  $editPanel.querySelector('#loki-edit-save')?.addEventListener('click', saveEdit);
  $editPanel.querySelector('#loki-edit-chrome-btn')?.addEventListener('click', openInChrome);
  $empty.querySelector('#loki-open-settings')?.addEventListener('click', openSettings);

  // Storage changes live-update bindings
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.hotkeys) {
      allHotkeys = changes.hotkeys.newValue ?? [];
      if (mode === 'hotkeys') renderHotkeyMode();
    }
  });
}

/* ─── Search Input Handling ──────────────────────────────────────────────── */
function onSearchInput(e) {
  searchQuery = e.target.value;

  if (searchQuery.length > 0) {
    enterSearchMode();
  } else {
    exitSearchMode();
  }
}

function onSearchKeydown(e) {
  const items = getVisibleItems();

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      updateActiveItem();
      break;

    case 'ArrowUp':
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActiveItem();
      break;

    case 'Enter':
      e.preventDefault();
      if (items[activeIndex]) activateItem(searchResults[activeIndex]);
      break;

    case 'Escape':
      e.preventDefault();
      if (mode === 'search') {
        // If in search mode, go back to hotkey mode
        $search.value = '';
        searchQuery = '';
        exitSearchMode();
      } else if (folderStack.length > 0) {
        folderStack.pop();
        renderHotkeyMode();
      } else {
        dispatchClose();
      }
      break;

    case 'Backspace':
      if (searchQuery === '' && folderStack.length > 0) {
        e.preventDefault();
        folderStack.pop();
        renderHotkeyMode();
      }
      break;

    case 'e':
    case 'E':
      if (mode !== 'search' && items[activeIndex] && !capturingKey) {
        // Only trigger edit shortcut if search is empty
        if (searchQuery === '') {
          e.preventDefault();
          openEditPanel(searchResults[activeIndex]);
        }
      }
      break;

    default:
      // In hotkey mode, check if pressed key matches a binding
      if (mode === 'hotkeys' && !capturingKey && searchQuery === '') {
        const match = findHotkeyMatch(e);
        if (match) {
          e.preventDefault();
          e.stopPropagation();
          activateItem(match);
        }
      }
      break;
  }
}

/* ─── Hotkey Matching ────────────────────────────────────────────────────── */
function findHotkeyMatch(e) {
  // In hotkey mode, only match single keys or Shift+key (no Ctrl/Cmd/Alt)
  if (e.ctrlKey || e.metaKey || e.altKey) return null;

  // Get items currently visible (could be filtered by folder)
  const currentFolder = folderStack[folderStack.length - 1] ?? null;
  const scope = currentFolder
    ? allHotkeys.filter((h) => h.parentFolderId === currentFolder.bookmarkId)
    : allHotkeys.filter((h) => !h.parentFolderId); // top-level

  return scope.find((h) => {
    if (!h.key) return false;
    return e.code === h.key.code && !!e.shiftKey === !!h.key.shift;
  }) ?? null;
}

/* ─── Render: Hotkey Mode ────────────────────────────────────────────────── */
function renderHotkeyMode() {
  mode = 'hotkeys';
  $modeBadge.textContent = 'Hotkeys';
  $modeBadge.classList.remove('search-mode');

  const currentFolder = folderStack[folderStack.length - 1] ?? null;

  let items;
  if (currentFolder) {
    // Show children of the drilled-into folder
    items = allHotkeys.filter((h) => h.parentFolderId === currentFolder.bookmarkId);
  } else {
    // Top-level: show all hotkeys without a parent folder constraint
    items = allHotkeys.filter((h) => !h.parentFolderId);
  }

  searchResults = items;
  renderBreadcrumb();
  renderItems(items, 'Hotkeys');

  // Reset active index
  activeIndex = 0;
  updateActiveItem();
}

/* ─── Render: Search Mode ────────────────────────────────────────────────── */
function enterSearchMode() {
  mode = 'search';
  $modeBadge.textContent = 'Search';
  $modeBadge.classList.add('search-mode');
  folderStack = []; // Reset folder navigation in search mode
  renderBreadcrumb();

  const query = searchQuery.toLowerCase();
  chrome.bookmarks.search({ query: searchQuery }, (results) => {
    // Filter to only bookmark nodes (not folders)
    const bookmarks = (results || []).filter((r) => r.url);

    // Substring match against title and URL
    const filtered = bookmarks.filter((r) => {
      const title = (r.title || '').toLowerCase();
      const url = (r.url || '').toLowerCase();
      return title.includes(query) || url.includes(query);
    });

    // Mark which ones already have a hotkey assigned
    const enriched = filtered.map((r) => {
      const existingBinding = allHotkeys.find((h) => h.bookmarkId === r.id);
      return {
        bookmarkId: r.id,
        title: r.title || 'Untitled',
        url: r.url,
        isFolder: false,
        existingBinding,
        // Used for rendering
        _searchResult: true,
        _query: searchQuery,
      };
    });

    searchResults = enriched;
    renderItems(enriched, `Results for "${searchQuery}"`);
    activeIndex = 0;
    updateActiveItem();
  });
}

function exitSearchMode() {
  renderHotkeyMode();
}

/* ─── Render Items ───────────────────────────────────────────────────────── */
function renderItems(items, sectionLabel) {
  $results.innerHTML = '';

  if (items.length === 0) {
    showEmptyState();
    return;
  }

  hideEmptyState();

  if (sectionLabel) {
    const header = document.createElement('div');
    header.className = 'loki-section-header';
    header.textContent = sectionLabel;
    $results.appendChild(header);
  }

  items.forEach((item, i) => {
    const el = buildItemEl(item, i);
    $results.appendChild(el);
  });
}

function buildItemEl(item, index) {
  const el = document.createElement('div');
  el.className = 'loki-item';
  el.setAttribute('role', 'option');
  el.setAttribute('data-index', index);
  el.setAttribute('tabindex', '-1');

  // Favicon
  const faviconEl = buildFavicon(item);
  el.appendChild(faviconEl);

  // Text
  const textEl = document.createElement('div');
  textEl.className = 'loki-item-text';

  const titleEl = document.createElement('div');
  titleEl.className = 'loki-item-title';
  titleEl.textContent = item.title || 'Untitled';
  textEl.appendChild(titleEl);

  if (item.url) {
    const urlEl = document.createElement('div');
    urlEl.className = 'loki-item-url';
    urlEl.innerHTML = formatUrl(item.url, item._query);
    textEl.appendChild(urlEl);
  }

  el.appendChild(textEl);

  // Folder arrow or key badge
  if (item.isFolder) {
    const arrow = document.createElement('span');
    arrow.className = 'loki-folder-arrow';
    arrow.textContent = '▶';
    el.appendChild(arrow);
  }

  if (item.key) {
    el.appendChild(buildKeyBadge(item.key));
  } else if (item._searchResult) {
    // In search mode: show [+ Assign] button
    const assignBtn = document.createElement('button');
    assignBtn.className = 'loki-action-btn';
    assignBtn.textContent = '+ Assign Key';
    assignBtn.title = 'Assign a hotkey to this bookmark';
    assignBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditPanel(item);
    });
    el.appendChild(assignBtn);
  }

  // Edit/Delete buttons (appear on hover)
  const actions = document.createElement('div');
  actions.className = 'loki-item-actions';

  if (!item._searchResult || item.existingBinding) {
    const editBtn = document.createElement('button');
    editBtn.className = 'loki-action-btn';
    editBtn.textContent = 'Edit';
    editBtn.title = 'Edit this bookmark (E)';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditPanel(item.existingBinding ?? item);
    });
    actions.appendChild(editBtn);

    if (!item._searchResult) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'loki-action-btn danger';
      deleteBtn.textContent = 'Remove';
      deleteBtn.title = 'Remove hotkey assignment';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeHotkeyBinding(item.id);
      });
      actions.appendChild(deleteBtn);
    }
  }

  el.appendChild(actions);

  // Click to activate
  el.addEventListener('mousedown', (e) => {
    e.preventDefault(); // prevent blur on search input
    activeIndex = index;
    updateActiveItem();
    activateItem(item);
  });

  return el;
}

/* ─── Favicon Helper ─────────────────────────────────────────────────────── */
function buildFavicon(item) {
  if (item.isFolder) {
    const el = document.createElement('div');
    el.className = 'loki-favicon-fallback';
    el.textContent = '📁';
    return el;
  }

  const img = document.createElement('img');
  img.className = 'loki-favicon';
  img.alt = '';
  img.loading = 'lazy';

  if (item.url) {
    try {
      const origin = new URL(item.url).origin;
      img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(origin)}&sz=32`;
    } catch {
      img.src = '';
    }
    img.onerror = () => {
      img.style.display = 'none';
      const fallback = document.createElement('div');
      fallback.className = 'loki-favicon-fallback';
      fallback.textContent = '🔖';
      img.parentNode?.insertBefore(fallback, img);
    };
  } else {
    const el = document.createElement('div');
    el.className = 'loki-favicon-fallback';
    el.textContent = '🔖';
    return el;
  }

  return img;
}

/* ─── URL Formatter ──────────────────────────────────────────────────────── */
function formatUrl(url, highlight) {
  let display = url;
  try {
    const u = new URL(url);
    display = u.hostname + u.pathname;
  } catch { /* keep raw */ }

  // Truncate long URLs
  if (display.length > 55) display = display.slice(0, 52) + '…';

  if (!highlight) return escapeHtml(display);

  // Highlight substring matches
  const idx = display.toLowerCase().indexOf(highlight.toLowerCase());
  if (idx >= 0) {
    return (
      escapeHtml(display.slice(0, idx)) +
      `<mark class="loki-mark">${escapeHtml(display.slice(idx, idx + highlight.length))}</mark>` +
      escapeHtml(display.slice(idx + highlight.length))
    );
  }

  return escapeHtml(display);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ─── Key Badge ──────────────────────────────────────────────────────────── */
function buildKeyBadge(key) {
  const wrapper = document.createElement('div');
  wrapper.className = 'loki-key-badge';

  if (key.shift) {
    const k = document.createElement('span');
    k.className = 'loki-key';
    k.textContent = '⇧';
    wrapper.appendChild(k);
  }

  const k = document.createElement('span');
  k.className = 'loki-key';
  k.textContent = codeToLabel(key.code);
  wrapper.appendChild(k);

  return wrapper;
}

/* ─── Activate Item ──────────────────────────────────────────────────────── */
function activateItem(item) {
  if (!item) return;

  if (item.isFolder) {
    handleFolderActivation(item);
    return;
  }

  // Navigate to bookmark
  const binding = item.existingBinding ?? item;
  handleOpenBookmark(binding);
  dispatchClose();
}

function handleOpenBookmark(binding) {
  const { url, openIn } = binding;
  if (!url) return;

  switch (openIn) {
    case 'current_tab':
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab) chrome.tabs.update(tab.id, { url });
      });
      break;

    case 'new_window':
      chrome.windows.create({ url });
      break;

    case 'new_tab':
    default:
      chrome.tabs.create({ url });
      break;
  }
}

function handleFolderActivation(item) {
  const behavior = item.folderBehavior ?? 'drill_in';

  if (behavior === 'open_all') {
    // Collect all bookmarks in this folder from allHotkeys
    const children = allHotkeys.filter((h) => h.parentFolderId === item.bookmarkId && h.url);
    children.forEach((child) => chrome.tabs.create({ url: child.url, active: false }));
    dispatchClose();
  } else if (behavior === 'flat_list') {
    folderStack.push(item);
    renderHotkeyMode();
  } else {
    // drill_in (default)
    folderStack.push(item);
    renderHotkeyMode();
  }
}

/* ─── Breadcrumb ─────────────────────────────────────────────────────────── */
function renderBreadcrumb() {
  $breadcrumb.innerHTML = '';

  if (folderStack.length === 0) {
    $breadcrumb.classList.remove('visible');
    return;
  }

  $breadcrumb.classList.add('visible');

  // Home crumb
  const home = document.createElement('span');
  home.className = 'loki-breadcrumb-item';
  home.textContent = '🏠 Home';
  home.addEventListener('click', () => {
    folderStack = [];
    renderHotkeyMode();
  });
  $breadcrumb.appendChild(home);

  folderStack.forEach((folder, i) => {
    const sep = document.createElement('span');
    sep.className = 'loki-breadcrumb-sep';
    sep.textContent = ' › ';
    $breadcrumb.appendChild(sep);

    const crumb = document.createElement('span');
    crumb.className = 'loki-breadcrumb-item';
    crumb.textContent = folder.title;
    crumb.addEventListener('click', () => {
      folderStack = folderStack.slice(0, i + 1);
      renderHotkeyMode();
    });
    $breadcrumb.appendChild(crumb);
  });
}

/* ─── Active Item Highlight ──────────────────────────────────────────────── */
function getVisibleItems() {
  return Array.from($results.querySelectorAll('.loki-item'));
}

function updateActiveItem() {
  const items = getVisibleItems();
  items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
  if (items[activeIndex]) {
    items[activeIndex].scrollIntoView({ block: 'nearest' });
  }
}

/* ─── Empty State ────────────────────────────────────────────────────────── */
function showEmptyState() {
  $results.style.display = 'none';
  $empty.classList.add('visible');

  if (mode === 'search') {
    $empty.querySelector('#loki-empty-title').textContent = 'No bookmarks found';
    $empty.querySelector('#loki-empty-sub').textContent = `No results for "${searchQuery}"`;
    $empty.querySelector('#loki-open-settings').style.display = 'none';
  } else {
    $empty.querySelector('#loki-empty-title').textContent = 'No hotkeys assigned yet';
    $empty.querySelector('#loki-empty-sub').textContent = 'Open Settings to assign shortcuts to your bookmarks';
    $empty.querySelector('#loki-open-settings').style.display = '';
  }
}

function hideEmptyState() {
  $results.style.display = '';
  $empty.classList.remove('visible');
}

/* ─── Inline Edit Panel ──────────────────────────────────────────────────── */
function openEditPanel(item) {
  if (!item) return;
  editingBinding = item;

  $editPanel.querySelector('#loki-edit-panel-title').textContent =
    item._searchResult && !item.existingBinding ? 'Assign Hotkey' : 'Edit Bookmark';

  $editTitle.value = item.title ?? '';
  $editUrl.value = item.url ?? '';
  $editOpenIn.value = item.openIn ?? 'new_tab';
  $conflictWarning.textContent = '';

  if (item.key) {
    $editKeyCapture.value = keyToLabel(item.key);
    capturedKey = item.key;
  } else {
    $editKeyCapture.value = '';
    capturedKey = null;
  }

  if (item.isFolder) {
    $editFolderRow.style.display = '';
    $editFolderBehavior.value = item.folderBehavior ?? 'drill_in';
  } else {
    $editFolderRow.style.display = 'none';
  }

  $editPanel.classList.add('visible');
  $editTitle.focus();
}

function closeEditPanel() {
  editingBinding = null;
  capturedKey = null;
  capturingKey = false;
  $editPanel.classList.remove('visible');
  $search.focus();
}

async function saveEdit() {
  if (!editingBinding) return;

  const title = $editTitle.value.trim();
  const url = $editUrl.value.trim();

  // Validate conflict
  if (capturedKey) {
    const conflict = allHotkeys.find(
      (h) => h.id !== editingBinding.id &&
             h.key?.code === capturedKey.code &&
             !!h.key?.shift === !!capturedKey.shift &&
             (h.parentFolderId ?? null) === (editingBinding.parentFolderId ?? null)
    );
    if (conflict) {
      $conflictWarning.textContent = `⚠ Conflict with "${conflict.title}"`;
      return;
    }
  }

  // Update bookmark title/URL via chrome.bookmarks API
  if (editingBinding.bookmarkId && !editingBinding._searchResult) {
    try {
      await chrome.bookmarks.update(editingBinding.bookmarkId, { title, url: url || undefined });
    } catch (err) {
      console.warn('[Loki] Could not update bookmark:', err);
    }
  }

  // Build updated binding
  const updatedBinding = {
    ...editingBinding,
    id: editingBinding.id ?? generateId(),
    title,
    url,
    key: capturedKey ?? editingBinding.key,
    openIn: $editOpenIn.value,
    folderBehavior: editingBinding.isFolder ? $editFolderBehavior.value : undefined,
  };

  // Save to storage via message (background can't do sync in MV3 content scripts)
  // We use chrome.storage.sync directly here since this runs in a content script context
  const result = await chrome.storage.sync.get('hotkeys');
  const hotkeys = result.hotkeys ?? [];
  const idx = hotkeys.findIndex((h) => h.id === updatedBinding.id);
  if (idx >= 0) {
    hotkeys[idx] = updatedBinding;
  } else {
    hotkeys.push(updatedBinding);
  }
  await chrome.storage.sync.set({ hotkeys });

  allHotkeys = hotkeys;
  closeEditPanel();
  renderHotkeyMode();
}

function removeHotkeyBinding(id) {
  if (!id) return;
  chrome.storage.sync.get('hotkeys', ({ hotkeys = [] }) => {
    const updated = hotkeys.filter((h) => h.id !== id);
    chrome.storage.sync.set({ hotkeys: updated }, () => {
      allHotkeys = updated;
      renderHotkeyMode();
    });
  });
}

function openInChrome() {
  if (!editingBinding?.bookmarkId) return;
  chrome.tabs.create({
    url: `chrome://bookmarks/?id=${editingBinding.bookmarkId}`,
  });
  dispatchClose();
}

function openSettings() {
  chrome.runtime.openOptionsPage();
  dispatchClose();
}

/* ─── Key Capture ────────────────────────────────────────────────────────── */
function startKeyCapture() {
  capturingKey = true;
  $editKeyCapture.value = 'Press any key…';
  $editKeyCapture.style.color = 'var(--accent)';
}

function stopKeyCapture() {
  capturingKey = false;
  if (!capturedKey) {
    $editKeyCapture.value = '';
  }
  $editKeyCapture.style.color = '';
}

function onKeyCaptureKeydown(e) {
  if (!capturingKey) return;
  e.preventDefault();
  e.stopPropagation();

  // Ignore pure modifier keys
  if (['Control', 'Alt', 'Shift', 'Meta', 'CapsLock'].includes(e.key)) return;

  // Only accept: letters, digits, F1-F12, with optional Shift
  const isLetter = /^Key[A-Z]$/.test(e.code);
  const isDigit = /^Digit[0-9]$/.test(e.code);
  const isFn = /^F([1-9]|1[0-2])$/.test(e.code);

  if (!isLetter && !isDigit && !isFn) {
    $editKeyCapture.value = '⚠ Use a letter, digit, or F1–F12 key';
    return;
  }

  // Reject Ctrl/Meta/Alt modifiers inside palette (reserved for leader key)
  if (e.ctrlKey || e.metaKey || e.altKey) {
    $editKeyCapture.value = '⚠ Only Shift modifier is allowed here';
    return;
  }

  capturedKey = {
    code: e.code,
    shift: e.shiftKey,
    ctrl: false,
    alt: false,
    meta: false,
  };

  $editKeyCapture.value = keyToLabel(capturedKey);
  capturingKey = false;

  // Check for conflict immediately
  const conflict = allHotkeys.find(
    (h) => h.id !== editingBinding?.id &&
           h.key?.code === capturedKey.code &&
           !!h.key?.shift === !!capturedKey.shift &&
           (h.parentFolderId ?? null) === (editingBinding?.parentFolderId ?? null)
  );
  $conflictWarning.textContent = conflict ? `⚠ Conflict with "${conflict.title}"` : '';
}

/* ─── Utilities ──────────────────────────────────────────────────────────── */
function keyToLabel(key) {
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const parts = [];
  if (key.ctrl) parts.push(isMac ? '⌃' : 'Ctrl+');
  if (key.alt) parts.push(isMac ? '⌥' : 'Alt+');
  if (key.shift) parts.push(isMac ? '⇧' : 'Shift+');
  if (key.meta) parts.push(isMac ? '⌘' : 'Win+');
  parts.push(codeToLabel(key.code));
  return parts.join('');
}

function codeToLabel(code) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  const MAP = {
    Space: '␣', Enter: '↵', Backspace: '⌫', Escape: 'Esc',
    Period: '.', Comma: ',', Slash: '/', Semicolon: ';',
    Minus: '-', Equal: '=',
  };
  return MAP[code] ?? code;
}

function generateId() {
  return `loki-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function dispatchClose() {
  window.close();
}

// Automatically initialize Loki command palette once the document is loaded
document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.sync.get(['hotkeys', 'settings']);
  const hotkeys = result.hotkeys ?? [];
  const settings = {
    leaderKey: { ctrl: false, alt: false, shift: true, meta: true, code: 'KeyL' },
    enabled: true,
    blockedDomains: [],
    theme: 'auto',
    ...(result.settings ?? {}),
  };

  initPalette(document, hotkeys, settings);
});

}()); // ← IIFE end
