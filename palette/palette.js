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
let currentTabUrl = '';
let currentTabDomain = '';

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
  updateSearchPlaceholder();
  renderHotkeyMode();

  // Focus the search input
  $search.focus();

  // Query active tab URL & domain
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const activeTab = tabs?.[0];
    if (activeTab && activeTab.url) {
      currentTabUrl = activeTab.url;
      try {
        const urlObj = new URL(activeTab.url);
        currentTabDomain = urlObj.hostname;
      } catch (err) {
        console.warn('[Loki] Could not parse tab URL:', err);
      }
    }
    updateBlocklistButton();
  });
}

function updateSearchPlaceholder() {
  if (allHotkeys.length === 0) {
    $search.placeholder = "No hotkeys defined. Press Shift+Space to bookmark current page.";
  } else {
    $search.placeholder = "Press a hotkey, Space to search, or Shift+Space to bookmark page";
  }
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
  // Intercept Escape key to close active dropdown or edit panel before closing popup
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (activeDropdown) {
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
      } else if (editingBinding) {
        e.preventDefault();
        e.stopPropagation();
        closeEditPanel();
      }
    }
  }, true);

  // Click on backdrop (not palette) → close
  const backdrop = $results.closest('#loki-backdrop');
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) dispatchClose();
  });

  // Search input
  $search.addEventListener('input', onSearchInput);
  $search.addEventListener('keydown', onSearchKeydown);

  // Mode badge click
  $modeBadge.addEventListener('click', toggleMode);

  // Footer hints buttons
  document.getElementById('loki-hint-bookmark')?.addEventListener('click', () => {
    setupHotkeyForCurrentPage();
  });

  document.getElementById('loki-hint-open')?.addEventListener('click', () => {
    const items = getVisibleItems();
    if (items[activeIndex]) {
      activateItem(searchResults[activeIndex]);
    }
  });

  document.getElementById('loki-hint-edit')?.addEventListener('click', () => {
    const items = getVisibleItems();
    if (items[activeIndex] && !capturingKey) {
      openEditPanel(searchResults[activeIndex]);
    }
  });

  document.getElementById('loki-hint-close')?.addEventListener('click', () => {
    dispatchClose();
  });

  document.getElementById('loki-hint-settings')?.addEventListener('click', () => {
    openSettings();
  });

  document.getElementById('loki-hint-blocklist')?.addEventListener('click', () => {
    if (currentTabDomain) {
      chrome.tabs.create({
        url: chrome.runtime.getURL(`options/options.html?blockDomain=${encodeURIComponent(currentTabDomain)}`)
      });
      dispatchClose();
    }
  });

  // Edit form — use shadow root refs (document.getElementById won't find shadow DOM elements)
  $editKeyCapture.addEventListener('click', startKeyCapture);
  $editKeyCapture.addEventListener('keydown', onKeyCaptureKeydown);
  $editKeyCapture.addEventListener('blur', stopKeyCapture);

  $editPanel.querySelector('#loki-edit-cancel')?.addEventListener('click', closeEditPanel);
  $editPanel.querySelector('#loki-edit-save')?.addEventListener('click', saveEdit);
  $empty.querySelector('#loki-open-settings')?.addEventListener('click', openSettings);

  $editPanel.querySelector('#loki-edit-clear-key-btn')?.addEventListener('click', () => {
    capturedKey = null;
    $editKeyCapture.value = '';
    $conflictWarning.style.display = 'none';
  });

  $editPanel.querySelector('#loki-edit-delete-bookmark-btn')?.addEventListener('click', () => {
    if (!editingBinding?.bookmarkId) return;
    const msg = editingBinding.isFolder
      ? 'Are you sure you want to delete this folder and all of its bookmarks?'
      : 'Are you sure you want to delete this bookmark?';
    if (!confirm(msg)) return;

    const callback = () => {
      if (editingBinding.id) {
        removeHotkeyBinding(editingBinding.id);
      } else {
        if (mode === 'search') {
          enterSearchMode();
        } else {
          renderHotkeyMode();
        }
      }
      closeEditPanel();
    };

    if (editingBinding.isFolder) {
      chrome.bookmarks.removeTree(editingBinding.bookmarkId, () => {
        if (chrome.runtime.lastError) console.warn('[Loki] Error removing folder:', chrome.runtime.lastError);
        callback();
      });
    } else {
      chrome.bookmarks.remove(editingBinding.bookmarkId, () => {
        if (chrome.runtime.lastError) console.warn('[Loki] Error removing bookmark:', chrome.runtime.lastError);
        callback();
      });
    }
  });

  // Storage changes live-update bindings
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.hotkeys) {
      allHotkeys = changes.hotkeys.newValue ?? [];
      updateSearchPlaceholder();
      if (mode === 'hotkeys') renderHotkeyMode();
    }
  });
}

function toggleMode() {
  if (mode === 'hotkeys') {
    $search.value = ' ';
    searchQuery = ' ';
    enterSearchMode();
    $search.focus();
  } else {
    $search.value = '';
    searchQuery = '';
    exitSearchMode();
    $search.focus();
  }
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
      if (e.shiftKey) {
        if (items[activeIndex] && !capturingKey) {
          openEditPanel(searchResults[activeIndex]);
        }
      } else {
        if (items[activeIndex]) activateItem(searchResults[activeIndex]);
      }
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

    case ' ':
      if (e.shiftKey && mode === 'hotkeys' && !editingBinding) {
        e.preventDefault();
        e.stopPropagation();
        setupHotkeyForCurrentPage();
      }
      break;

    default:
      // If we are in hotkeys mode
      if (mode === 'hotkeys' && !capturingKey) {
        // 1. If it's a Space key, let it pass (it will type space, trigger onSearchInput, and enter search mode)
        if (e.key === ' ' || e.code === 'Space') {
          return;
        }

        // 2. If it's a hotkey, run it
        const matches = findHotkeyMatches(e);
        if (matches.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          activateMultipleItems(matches);
          return;
        }

        // 3. Prevent typing other character keys
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
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
    // Top-level: show all hotkeys whose parent folder is not also a hotkey folder in our list
    items = allHotkeys.filter((h) => {
      return !allHotkeys.some((folder) => folder.isFolder && folder.bookmarkId === h.parentFolderId);
    });
  }

  // Sort list by hotkey alphabetically
  try {
    items.sort((a, b) => {
      const getSortKey = (h) => {
        if (!h.key || !h.key.code) return 'zzzzz';
        const label = codeToLabel(h.key.code).toLowerCase();
        const shiftPart = h.key.shift ? '2' : '1';
        return `${label}_${shiftPart}`;
      };
      return getSortKey(a).localeCompare(getSortKey(b));
    });
  } catch (err) {
    console.error('[Loki] Error sorting hotkeys:', err);
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

  const queryStr = searchQuery.startsWith(' ') ? searchQuery.slice(1) : searchQuery;
  const query = queryStr.toLowerCase();

  const handleSearchResults = (results) => {
    // Keep both bookmarks and folders
    const filtered = (results || []).filter((r) => {
      const title = (r.title || '').toLowerCase();
      const url = (r.url || '').toLowerCase();
      return title.includes(query) || url.includes(query);
    });

    // Mark which ones already have a hotkey assigned
    const enriched = filtered.map((r) => {
      const existingBinding = allHotkeys.find((h) => h.bookmarkId === r.id);
      if (existingBinding) {
        return {
          ...existingBinding,
          _searchResult: true,
          _query: queryStr,
          existingBinding,
        };
      }
      return {
        bookmarkId: r.id,
        title: r.title || 'Untitled',
        url: r.url,
        isFolder: !r.url,
        _searchResult: true,
        _query: queryStr,
      };
    });

    searchResults = enriched;
    renderItems(enriched, queryStr ? `Results for "${queryStr}"` : 'Recent Bookmarks');
    activeIndex = 0;
    updateActiveItem();
  };

  if (queryStr === '') {
    chrome.bookmarks.getRecent(50, handleSearchResults);
  } else {
    chrome.bookmarks.search({ query: queryStr }, handleSearchResults);
  }
}

function exitSearchMode() {
  $search.value = '';
  searchQuery = '';
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

  // Key badge or placeholder on the left
  if (item.key) {
    el.appendChild(buildKeyBadge(item.key));
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'loki-key-badge-placeholder';
    el.appendChild(placeholder);
  }

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

  // Folder arrow on the right
  if (item.isFolder) {
    const arrow = document.createElement('span');
    arrow.className = 'loki-folder-arrow';
    arrow.textContent = '▶';
    el.appendChild(arrow);
  }

  // Hamburger Menu button
  const menuBtn = document.createElement('button');
  menuBtn.className = 'loki-menu-btn';
  menuBtn.innerHTML = '⋮';
  menuBtn.title = 'Actions';
  menuBtn.addEventListener('mousedown', (e) => {
    openDropdownMenu(e, item, menuBtn);
  });
  el.appendChild(menuBtn);

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
  if (!key) return wrapper;

  if (key.shift) {
    const k = document.createElement('span');
    k.className = 'loki-key';
    k.textContent = '⇧';
    wrapper.appendChild(k);
  }

  if (key.code) {
    const k = document.createElement('span');
    k.className = 'loki-key';
    k.textContent = codeToLabel(key.code);
    wrapper.appendChild(k);
  }

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
    capturedKey = item.key;
  } else {
    capturedKey = getRecommendedKey(item.title);
  }

  $editKeyCapture.value = capturedKey ? keyToLabel(capturedKey) : '';

  if (item.isFolder) {
    $editFolderRow.style.display = '';
    $editFolderBehavior.value = item.folderBehavior ?? 'drill_in';
  } else {
    $editFolderRow.style.display = 'none';
  }

  $editPanel.classList.add('visible');
  $editTitle.focus();
  checkConflict();
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

  if (!capturedKey) {
    let bookmarkId = editingBinding.bookmarkId;
    if (!bookmarkId) {
      try {
        const newBm = await new Promise((resolve, reject) => {
          chrome.bookmarks.create({ title, url: url || undefined }, (result) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(result);
          });
        });
        bookmarkId = newBm.id;
      } catch (err) {
        console.warn('[Loki] Could not create bookmark:', err);
      }
    } else {
      try {
        await chrome.bookmarks.update(bookmarkId, { title, url: url || undefined });
      } catch (err) {
        console.warn('[Loki] Could not update bookmark:', err);
      }
    }

    if (editingBinding.id) {
      const result = await chrome.storage.sync.get('hotkeys');
      const hotkeys = (result.hotkeys ?? []).filter((h) => h.id !== editingBinding.id);
      await chrome.storage.sync.set({ hotkeys });
      allHotkeys = hotkeys;
    }
    closeEditPanel();
    if (mode === 'search') {
      enterSearchMode();
    } else {
      renderHotkeyMode();
    }
    return;
  }

  // Update or create bookmark via chrome.bookmarks API
  let bookmarkId = editingBinding.bookmarkId;
  if (!bookmarkId) {
    try {
      const newBm = await new Promise((resolve, reject) => {
        chrome.bookmarks.create({ title, url: url || undefined }, (result) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(result);
        });
      });
      bookmarkId = newBm.id;
    } catch (err) {
      console.warn('[Loki] Could not create bookmark:', err);
      return;
    }
  } else {
    try {
      await chrome.bookmarks.update(bookmarkId, { title, url: url || undefined });
    } catch (err) {
      console.warn('[Loki] Could not update bookmark:', err);
    }
  }

  // Build updated binding
  const updatedBinding = {
    ...editingBinding,
    bookmarkId,
    id: editingBinding.id ?? generateId(),
    title,
    url,
    key: capturedKey,
    openIn: $editOpenIn.value,
    folderBehavior: editingBinding.isFolder ? $editFolderBehavior.value : undefined,
  };

  // Save to storage
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
  if (mode === 'search') {
    enterSearchMode();
  } else {
    renderHotkeyMode();
  }
}

function removeHotkeyBinding(id) {
  if (!id) return;
  chrome.storage.sync.get('hotkeys', ({ hotkeys = [] }) => {
    const updated = hotkeys.filter((h) => h.id !== id);
    chrome.storage.sync.set({ hotkeys: updated }, () => {
      allHotkeys = updated;
      if (mode === 'search') {
        enterSearchMode();
      } else {
        renderHotkeyMode();
      }
    });
  });
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

  checkConflict();
}

let activeDropdown = null;
let activeDropdownCleanup = null;

function closeDropdown() {
  if (activeDropdown) {
    activeDropdown.remove();
    activeDropdown = null;
  }
  if (activeDropdownCleanup) {
    activeDropdownCleanup();
    activeDropdownCleanup = null;
  }
}

function openDropdownMenu(e, item, btn) {
  e.preventDefault();
  e.stopPropagation();

  closeDropdown();

  const rect = btn.getBoundingClientRect();
  const dropdown = document.createElement('div');
  dropdown.className = 'loki-dropdown-menu';

  // Open options: New Tab, Current Tab, New Window
  if (item.url) {
    const newTab = document.createElement('div');
    newTab.className = 'loki-dropdown-item';
    newTab.textContent = 'Open in New Tab';
    newTab.addEventListener('mousedown', (evt) => {
      evt.stopPropagation();
      handleOpenBookmark({ url: item.url, openIn: 'new_tab' });
      closeDropdown();
      dispatchClose();
    });
    dropdown.appendChild(newTab);

    const currentTab = document.createElement('div');
    currentTab.className = 'loki-dropdown-item';
    currentTab.textContent = 'Open in Current Tab';
    currentTab.addEventListener('mousedown', (evt) => {
      evt.stopPropagation();
      handleOpenBookmark({ url: item.url, openIn: 'current_tab' });
      closeDropdown();
      dispatchClose();
    });
    dropdown.appendChild(currentTab);

    const newWindow = document.createElement('div');
    newWindow.className = 'loki-dropdown-item';
    newWindow.textContent = 'Open in New Window';
    newWindow.addEventListener('mousedown', (evt) => {
      evt.stopPropagation();
      handleOpenBookmark({ url: item.url, openIn: 'new_window' });
      closeDropdown();
      dispatchClose();
    });
    dropdown.appendChild(newWindow);

    // Divider line
    const divider = document.createElement('div');
    divider.className = 'loki-dropdown-divider';
    dropdown.appendChild(divider);
  }

  // Edit / Assign option
  const editOpt = document.createElement('div');
  editOpt.className = 'loki-dropdown-item';
  editOpt.textContent = (item._searchResult && !item.existingBinding) ? 'Assign Hotkey' : 'Edit Bookmark';
  editOpt.addEventListener('mousedown', (evt) => {
    evt.stopPropagation();
    closeDropdown();
    openEditPanel(item.existingBinding ?? item);
  });
  dropdown.appendChild(editOpt);

  // Copy Option
  const copyOpt = document.createElement('div');
  copyOpt.className = 'loki-dropdown-item';
  copyOpt.textContent = item.isFolder ? 'Copy Folder' : 'Copy Bookmark';
  copyOpt.addEventListener('mousedown', (evt) => {
    evt.stopPropagation();
    if (!item.bookmarkId) return;
    chrome.bookmarks.get(item.bookmarkId, (results) => {
      const node = results?.[0];
      if (!node) return;
      cloneBookmarkNode(node, node.parentId, true, () => {
        closeDropdown();
        if (mode === 'search') {
          enterSearchMode();
        } else {
          renderHotkeyMode();
        }
      });
    });
  });
  dropdown.appendChild(copyOpt);

  // Remove option (only if it has a hotkey)
  const isBinding = !item._searchResult || item.existingBinding;
  if (isBinding) {
    const removeOpt = document.createElement('div');
    removeOpt.className = 'loki-dropdown-item danger';
    removeOpt.textContent = 'Clear Hotkey';
    removeOpt.addEventListener('mousedown', (evt) => {
      evt.stopPropagation();
      closeDropdown();
      removeHotkeyBinding(item.id);
    });
    dropdown.appendChild(removeOpt);
  }

  // Position and append
  dropdown.style.position = 'absolute';
  dropdown.style.zIndex = '99999';
  
  // Right-aligned
  dropdown.style.right = `${600 - rect.right - 6}px`;

  const spaceBelow = 400 - rect.bottom;
  if (spaceBelow < 180) {
    dropdown.style.bottom = `${400 - rect.top + 4}px`;
  } else {
    dropdown.style.top = `${rect.bottom + 4}px`;
  }

  const backdrop = document.getElementById('loki-backdrop');
  if (backdrop) {
    backdrop.appendChild(dropdown);
  } else {
    document.body.appendChild(dropdown);
  }
  activeDropdown = dropdown;

  const onOutsideClick = (evt) => {
    if (activeDropdown && !activeDropdown.contains(evt.target)) {
      closeDropdown();
    }
  };

  const onScroll = () => {
    closeDropdown();
  };

  // Add click-outside and scroll listeners to auto-dismiss
  setTimeout(() => {
    document.addEventListener('mousedown', onOutsideClick);
    $results.addEventListener('scroll', onScroll);
    activeDropdownCleanup = () => {
      document.removeEventListener('mousedown', onOutsideClick);
      $results.removeEventListener('scroll', onScroll);
    };
  }, 0);
}

/* ─── Utilities ──────────────────────────────────────────────────────────── */
function keyToLabel(key) {
  if (!key) return '';
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const parts = [];
  if (key.ctrl) parts.push(isMac ? '⌃' : 'Ctrl+');
  if (key.alt) parts.push(isMac ? '⌥' : 'Alt+');
  if (key.shift) parts.push(isMac ? '⇧' : 'Shift+');
  if (key.meta) parts.push(isMac ? '⌘' : 'Win+');
  if (key.code) parts.push(codeToLabel(key.code));
  return parts.join('');
}

function codeToLabel(code) {
  if (!code || typeof code !== 'string') return '';
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

function cloneBookmarkNode(node, targetParentId, isRoot, callback) {
  const newTitle = isRoot ? `${node.title || 'Untitled'} (copy)` : (node.title || 'Untitled');
  if (!node.url) {
    // Folder
    chrome.bookmarks.create({
      parentId: targetParentId,
      title: newTitle
    }, (newFolder) => {
      chrome.bookmarks.getChildren(node.id, (children) => {
        if (!children || children.length === 0) {
          if (callback) callback();
          return;
        }
        let remaining = children.length;
        children.forEach((child) => {
          cloneBookmarkNode(child, newFolder.id, false, () => {
            remaining--;
            if (remaining === 0 && callback) callback();
          });
        });
      });
    });
  } else {
    // Bookmark
    chrome.bookmarks.create({
      parentId: targetParentId,
      title: newTitle,
      url: node.url
    }, () => {
      if (callback) callback();
    });
  }
}

function checkConflict() {
  if (!capturedKey) {
    $conflictWarning.textContent = '';
    $conflictWarning.style.display = 'none';
    return;
  }
  const matches = allHotkeys.filter(
    (h) => h.id !== editingBinding?.id &&
           h.key?.code === capturedKey.code &&
           !!h.key?.shift === !!capturedKey.shift &&
           (h.parentFolderId ?? null) === (editingBinding?.parentFolderId ?? null)
  );
  if (matches.length > 0) {
    const count = matches.length;
    const names = matches.map((m) => `"${m.title}"`).join(', ');
    $conflictWarning.textContent = `⚠ In use by ${count} other${count > 1 ? 's' : ''} (${names})`;
    $conflictWarning.style.display = 'block';
  } else {
    $conflictWarning.textContent = '';
    $conflictWarning.style.display = 'none';
  }
}

function getRecommendedKey(title) {
  if (!title) return null;
  const words = title.split(/\s+/).map(w => w.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean);
  const candidates = words.slice(0, 5).map(w => w[0].toUpperCase());
  
  for (const char of candidates) {
    let code = '';
    if (/[A-Z]/.test(char)) {
      code = `Key${char}`;
    } else if (/[0-9]/.test(char)) {
      code = `Digit${char}`;
    } else {
      continue;
    }
    
    // Check if this code is already in use (without Shift)
    const inUse = allHotkeys.some((h) => h.key?.code === code && !h.key?.shift);
    if (!inUse) {
      return { code, shift: false, ctrl: false, alt: false, meta: false };
    }
  }
  
  if (candidates.length > 0) {
    const char = candidates[0];
    if (/[A-Z]/.test(char)) return { code: `Key${char}`, shift: false, ctrl: false, alt: false, meta: false };
    if (/[0-9]/.test(char)) return { code: `Digit${char}`, shift: false, ctrl: false, alt: false, meta: false };
  }
  return null;
}

async function setupHotkeyForCurrentPage() {
  if (editingBinding) return; // Edit panel already open

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const activeTab = tabs?.[0];
    if (!activeTab || !activeTab.url) return;

    chrome.bookmarks.search({ url: activeTab.url }, (results) => {
      const existingBookmark = results?.[0];
      const existingBinding = existingBookmark ? allHotkeys.find((h) => h.bookmarkId === existingBookmark.id) : null;

      const binding = {
        ...(existingBinding ?? {}),
        bookmarkId: existingBookmark ? existingBookmark.id : null,
        title: existingBinding ? existingBinding.title : (existingBookmark ? existingBookmark.title : activeTab.title),
        url: activeTab.url,
        key: existingBinding ? existingBinding.key : null,
        openIn: existingBinding ? existingBinding.openIn : 'new_tab',
      };

      openEditPanel(binding);
    });
  });
}

function findHotkeyMatches(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return [];

  const currentFolder = folderStack[folderStack.length - 1] ?? null;
  const scope = currentFolder
    ? allHotkeys.filter((h) => h.parentFolderId === currentFolder.bookmarkId)
    : allHotkeys.filter((h) => !h.parentFolderId);

  return scope.filter((h) => {
    if (!h.key) return false;
    return e.code === h.key.code && !!e.shiftKey === !!h.key.shift;
  });
}

function activateMultipleItems(items) {
  if (items.length === 0) return;
  if (items.length === 1) {
    activateItem(items[0]);
    return;
  }
  items.forEach((item) => {
    if (item.isFolder) {
      handleFolderActivation(item);
    } else {
      const binding = item.existingBinding ?? item;
      handleOpenBookmark(binding);
    }
  });
  dispatchClose();
}

function updateBlocklistButton() {
  const btn = document.getElementById('loki-hint-blocklist');
  if (!btn) return;

  if (!currentTabDomain || !currentTabUrl.startsWith('http')) {
    btn.style.display = 'none';
    return;
  }

  btn.style.display = '';
  const isBlocked = (settings.blockedDomains ?? []).includes(currentTabDomain);
  if (isBlocked) {
    btn.textContent = '🚫 Blocked';
    btn.title = `This domain (${currentTabDomain}) is already blocked. Click to manage.`;
    btn.classList.add('blocked');
  } else {
    btn.textContent = '🚫 Block Domain';
    btn.title = `Block Loki on this domain (${currentTabDomain})`;
    btn.classList.remove('blocked');
  }
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
