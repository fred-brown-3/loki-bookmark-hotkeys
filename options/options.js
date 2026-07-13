/**
 * options/options.js — Loki Settings Page Logic
 */

const DEFAULT_SETTINGS = {
  leaderKey: { ctrl: false, alt: false, shift: true, meta: true, code: 'KeyL' },
  enabled: true,
  blockedDomains: [],
  theme: 'auto',
};

let settings = { ...DEFAULT_SETTINGS };
let hotkeys = [];

// Add-form / Edit-form state
let addSelectedBookmark = null;
let addCapturedKey = null;
let addCapturing = false;
let editingBinding = null;
let liveTrackedTabs = new Set();

/* ─── Init ───────────────────────────────────────────────────────────────── */
async function init() {
  const result = await chrome.storage.sync.get(['hotkeys', 'settings']);
  hotkeys = result.hotkeys ?? [];
  settings = { ...DEFAULT_SETTINGS, ...(result.settings ?? {}) };

  // Load live tracked tabs from session storage and validate which are active
  try {
    const sessionData = await chrome.storage.session.get('lokiTrackedTabs');
    const trackedTabs = sessionData.lokiTrackedTabs ?? {};
    const bindingIds = Object.keys(trackedTabs);

    if (bindingIds.length > 0) {
      const urlByBindingId = {};
      hotkeys.forEach((h) => { if (h.id && h.url) urlByBindingId[h.id] = h.url; });

      await Promise.all(bindingIds.map((bindingId) => new Promise((resolve) => {
        const tabId = trackedTabs[bindingId];
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError || !tab) { resolve(); return; }
          const bmUrl = urlByBindingId[bindingId];
          if (!bmUrl) { resolve(); return; }
          try {
            const bmHost = new URL(bmUrl).hostname;
            const tabHost = new URL(tab.url || '').hostname;
            if (bmHost && tabHost && bmHost === tabHost) liveTrackedTabs.add(bindingId);
          } catch { /* invalid URL */ }
          resolve();
        });
      })));
    }
  } catch (err) {
    console.warn('[Loki Options] Could not load tracked tabs:', err);
  }

  setupNav();
  renderHotkeyList();
  renderStorageUsage();
  renderLeaderKey();
  setupAddForm();
  // About version
  const manifest = chrome.runtime.getManifest();
  document.getElementById('about-version').textContent = `Version ${manifest.version}`;
}

/* ─── Navigation ─────────────────────────────────────────────────────────── */
function setupNav() {
  document.querySelectorAll('.nav-item[data-section]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const section = btn.getAttribute('data-section');
      activateSection(section);
    });
  });
}

function activateSection(sectionId) {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
  document.querySelector(`[data-section="${sectionId}"]`)?.classList.add('active');
  document.getElementById(`section-${sectionId}`)?.classList.add('active');
}

/* ─── Hotkey List ────────────────────────────────────────────────────────── */
function renderHotkeyList() {
  const container = document.getElementById('hotkeys-list');
  const countLabel = document.getElementById('hotkey-count-label');
  countLabel.textContent = `${hotkeys.length} hotkey${hotkeys.length !== 1 ? 's' : ''} assigned`;

  if (hotkeys.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🐾</div>
        <div class="empty-state-title">No hotkeys yet</div>
        <div class="empty-state-sub">Click "+ Add Hotkey" to assign your first bookmark shortcut</div>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  hotkeys.forEach((binding) => {
    const row = document.createElement('div');
    row.className = 'hotkey-row';

    // Key badge on the left (matches popup)
    if (binding.key) {
      row.appendChild(buildKeyBadgeEl(binding.key));
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'key-badge-placeholder';
      row.appendChild(placeholder);
    }

    // Favicon or folder icon
    if (binding.url) {
      const favicon = document.createElement('img');
      favicon.className = 'hotkey-favicon';
      favicon.alt = '';
      try {
        const origin = new URL(binding.url).origin;
        favicon.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(origin)}&sz=32`;
      } catch { favicon.src = ''; }
      favicon.onerror = () => { favicon.style.display = 'none'; };
      row.appendChild(favicon);
    } else {
      const folderIcon = document.createElement('span');
      folderIcon.textContent = '📁';
      folderIcon.style.cssText = 'font-size: 14px; flex-shrink: 0;';
      row.appendChild(folderIcon);
    }

    // Open-in / refocus indicator immediately to the right of favicon
    const indicator = buildOpenMethodIndicatorEl(binding);
    if (indicator) {
      row.appendChild(indicator);
    }

    // Text column (Title on top, URL on bottom — matches popup double-row layout)
    const textCol = document.createElement('div');
    textCol.style.cssText = 'flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;';

    const title = document.createElement('div');
    title.className = 'hotkey-title';
    title.textContent = binding.title || 'Untitled';
    title.title = binding.title;
    title.style.cssText = 'font-size: 13.5px; font-weight: 600; color: var(--text-primary); margin: 0; padding: 0; text-align: left;';
    textCol.appendChild(title);

    if (binding.url) {
      const url = document.createElement('div');
      url.className = 'hotkey-url';
      url.textContent = truncateUrl(binding.url);
      url.title = binding.url;
      url.style.cssText = 'font-size: 11px; color: var(--text-secondary); margin: 0; padding: 0; text-align: left;';
      textCol.appendChild(url);
    }
    row.appendChild(textCol);

    // Actions on the right
    const actions = document.createElement('div');
    actions.className = 'row-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn sm';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openEditModal(binding));
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn sm danger';
    delBtn.textContent = 'Remove';
    delBtn.addEventListener('click', () => deleteHotkey(binding.id));
    actions.appendChild(delBtn);

    row.appendChild(actions);
    container.appendChild(row);
  });
}

function buildOpenMethodIndicatorEl(item) {
  if (item.isFolder || !item.url) {
    return null;
  }

  const indicator = document.createElement('span');
  const openIn = item.openIn ?? 'new_tab';
  const refocusEnabled = item.refocusIfOpen !== false && openIn !== 'current_tab' && item.id;
  const isLive = refocusEnabled && liveTrackedTabs.has(item.id);

  let className = 'loki-refocus-indicator';
  if (refocusEnabled) {
    className += ' refocus-on';
    className += isLive ? ' live' : ' idle';
  } else {
    className += ' refocus-off';
  }
  indicator.className = className;

  if (refocusEnabled) {
    indicator.title = isLive
      ? `Open in: ${openIn === 'new_window' ? 'New Window' : openIn === 'new_incognito' ? 'Incognito' : 'New Tab'} (Refocus expected: tab is open)`
      : `Open in: ${openIn === 'new_window' ? 'New Window' : openIn === 'new_incognito' ? 'Incognito' : 'New Tab'} (Refocus active, but no open tab)`;
  } else {
    indicator.title = `Open in: ${openIn === 'current_tab' ? 'Current Tab' : openIn === 'new_window' ? 'New Window' : openIn === 'new_incognito' ? 'Incognito Window' : 'New Tab'}`;
  }

  const strokeWidth = refocusEnabled ? '2.5' : '1.8';

  const tabSvg = `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
      <path d="M2.5 4.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z"/>
      <path d="M5.5 2.5h7a1 1 0 0 1 1 1v7"/>
    </svg>
  `;

  const winSvg = `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5"/>
      <line x1="2" y1="5.5" x2="14" y2="5.5"/>
    </svg>
  `;

  const currentSvg = `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
      <path d="M13.5 8a5.5 5.5 0 1 1-5.5-5.5h2.5"/>
      <path d="M8.5 5l2.5-2.5L8.5 0"/>
    </svg>
  `;

  const incognitoSvg = `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
      <path d="M2 13h12"/>
      <circle cx="5.5" cy="11.5" r="2"/>
      <circle cx="10.5" cy="11.5" r="2"/>
      <path d="M7.5 11.5h1"/>
      <path d="M3.5 8L5.5 3.5h5L12.5 8"/>
    </svg>
  `;

  if (openIn === 'new_window') {
    indicator.innerHTML = winSvg;
  } else if (openIn === 'current_tab') {
    indicator.innerHTML = currentSvg;
  } else if (openIn === 'new_incognito') {
    indicator.innerHTML = incognitoSvg;
  } else {
    indicator.innerHTML = tabSvg;
  }

  return indicator;
}

function buildKeyBadgeEl(key) {
  const badge = document.createElement('div');
  badge.className = 'key-badge';
  if (key.shift) {
    const k = document.createElement('span');
    k.className = 'key-cap';
    k.textContent = '⇧';
    badge.appendChild(k);
  }
  const k = document.createElement('span');
  k.className = 'key-cap';
  k.textContent = codeToLabel(key.code);
  badge.appendChild(k);
  return badge;
}

async function deleteHotkey(id) {
  if (!confirm('Remove this hotkey assignment?')) return;
  hotkeys = hotkeys.filter((h) => h.id !== id);
  await chrome.storage.sync.set({ hotkeys });
  renderHotkeyList();
  renderStorageUsage();
}

/* ─── Add Hotkey Form ────────────────────────────────────────────────────── */
function setupAddForm() {
  const addBtn = document.getElementById('add-hotkey-btn');
  const wrapper = document.getElementById('add-form-wrapper');
  const cancelBtn = document.getElementById('add-cancel-btn');
  const saveBtn = document.getElementById('add-save-btn');
  const bmSearch = document.getElementById('bm-search');
  const keyInput = document.getElementById('add-key-input');
  const openInSelect = document.getElementById('add-open-in');

  addBtn.addEventListener('click', () => {
    editingBinding = null;
    wrapper.classList.add('open');
    addBtn.style.display = 'none';
    bmSearch.focus();
    resetAddForm();
  });

  cancelBtn.addEventListener('click', () => {
    wrapper.classList.remove('open');
    addBtn.style.display = '';
    resetAddForm();
  });

  saveBtn.addEventListener('click', saveNewHotkey);

  // Bookmark search
  bmSearch.addEventListener('input', debounce(onBmSearch, 250));

  // Key capture
  keyInput.addEventListener('click', () => {
    addCapturing = true;
    keyInput.value = 'Press any key…';
    keyInput.style.color = 'var(--accent)';
  });
  keyInput.addEventListener('blur', () => {
    addCapturing = false;
    if (!addCapturedKey) keyInput.value = '';
    keyInput.style.color = '';
  });
  keyInput.addEventListener('keydown', onAddKeyCaptureDown);

  // Open-in change listener to show/hide refocus setting & check incognito warning
  openInSelect.addEventListener('change', () => {
    const isFolder = editingBinding ? editingBinding.isFolder : (addSelectedBookmark ? !addSelectedBookmark.url : false);
    const refocusRow = document.getElementById('add-refocus-row');
    if (refocusRow) {
      refocusRow.style.display = (isFolder || openInSelect.value === 'current_tab') ? 'none' : '';
    }
    checkIncognitoWarningOptions(openInSelect.value);
  });
}

function resetAddForm() {
  addSelectedBookmark = null;
  addCapturedKey = null;
  addCapturing = false;
  editingBinding = null;
  document.getElementById('add-form-title').textContent = 'Add New Hotkey';
  document.getElementById('bm-search-row').style.display = '';
  document.getElementById('bm-search').value = '';
  document.getElementById('bm-results').style.display = 'none';
  document.getElementById('bm-results').innerHTML = '';
  
  const label = document.getElementById('bm-selected-label');
  label.style.display = 'none';
  document.getElementById('bm-selected-title').textContent = '';
  document.getElementById('bm-selected-url').textContent = '';
  document.getElementById('bm-selected-link').href = '#';
  document.getElementById('bm-selected-link').style.display = 'none';

  document.getElementById('add-key-input').value = '';
  document.getElementById('add-open-in').value = 'new_tab';
  document.getElementById('add-folder-row').style.display = 'none';
  document.getElementById('add-refocus-row').style.display = '';
  document.getElementById('add-refocus').checked = true;
  document.getElementById('add-conflict-msg').style.display = 'none';
}

async function onBmSearch() {
  const q = document.getElementById('bm-search').value.trim();
  if (!q) {
    document.getElementById('bm-results').style.display = 'none';
    return;
  }

  chrome.bookmarks.search({ query: q }, (results) => {
    const filtered = (results ?? []).filter((r) => r.url || !r.url); // include folders
    const container = document.getElementById('bm-results');
    container.innerHTML = '';

    if (filtered.length === 0) {
      container.innerHTML = `<div style="padding:12px;font-size:13px;color:var(--text-muted);">No bookmarks found</div>`;
      container.style.display = '';
      return;
    }

    filtered.slice(0, 20).forEach((bm) => {
      const item = document.createElement('div');
      item.className = 'bookmark-pick-item';
      if (addSelectedBookmark?.id === bm.id) item.classList.add('selected');

      // Favicon or folder icon
      if (bm.url) {
        const img = document.createElement('img');
        img.style.cssText = 'width:16px;height:16px;border-radius:3px;flex-shrink:0;';
        try {
          img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(bm.url).origin)}&sz=32`;
        } catch { img.src = ''; }
        item.appendChild(img);
      } else {
        const icon = document.createElement('span');
        icon.textContent = '📁';
        icon.style.fontSize = '14px';
        item.appendChild(icon);
      }

      const text = document.createElement('div');
      text.style.cssText = 'flex:1;min-width:0;';
      const titleEl = document.createElement('div');
      titleEl.className = 'bpi-title';
      titleEl.textContent = bm.title || 'Untitled';
      text.appendChild(titleEl);

      if (bm.url) {
        const urlEl = document.createElement('div');
        urlEl.className = 'bpi-url';
        urlEl.textContent = truncateUrl(bm.url);
        text.appendChild(urlEl);
      }

      item.appendChild(text);

      item.addEventListener('click', () => {
        selectBookmark(bm);
        container.querySelectorAll('.bookmark-pick-item').forEach((el) => el.classList.remove('selected'));
        item.classList.add('selected');
      });

      container.appendChild(item);
    });

    container.style.display = '';
  });
}

function selectBookmark(bm) {
  addSelectedBookmark = bm;
  const label = document.getElementById('bm-selected-label');
  const titleEl = document.getElementById('bm-selected-title');
  const urlEl = document.getElementById('bm-selected-url');
  const linkEl = document.getElementById('bm-selected-link');

  label.style.display = 'flex';
  titleEl.textContent = bm.title || 'Untitled';

  if (bm.url) {
    urlEl.textContent = bm.url;
    urlEl.style.display = '';
    linkEl.href = bm.url;
    linkEl.style.display = 'inline';
    document.getElementById('add-folder-row').style.display = 'none';
  } else {
    urlEl.textContent = '';
    urlEl.style.display = 'none';
    linkEl.href = '#';
    linkEl.style.display = 'none';
    document.getElementById('add-folder-row').style.display = '';
  }

  document.getElementById('bm-results').style.display = 'none';
}

function onAddKeyCaptureDown(e) {
  if (!addCapturing) return;
  e.preventDefault();
  e.stopPropagation();

  if (['Control', 'Alt', 'Shift', 'Meta', 'CapsLock'].includes(e.key)) return;

  const isLetter = /^Key[A-Z]$/.test(e.code);
  const isDigit = /^Digit[0-9]$/.test(e.code);
  const isFn = /^F([1-9]|1[0-2])$/.test(e.code);

  const conflictMsg = document.getElementById('add-conflict-msg');

  if (!isLetter && !isDigit && !isFn) {
    document.getElementById('add-key-input').value = '⚠ Use a letter, digit, or F1–F12';
    return;
  }

  if (e.ctrlKey || e.metaKey || e.altKey) {
    document.getElementById('add-key-input').value = '⚠ Only Shift modifier is allowed';
    return;
  }

  addCapturedKey = { code: e.code, shift: e.shiftKey, ctrl: false, alt: false, meta: false };
  document.getElementById('add-key-input').value = keyToLabel(addCapturedKey);
  addCapturing = false;

  // Check conflict and incognito warnings
  checkIncognitoWarningOptions(document.getElementById('add-open-in').value);
}

async function saveNewHotkey() {
  const openIn = document.getElementById('add-open-in').value;
  const refocusInput = document.getElementById('add-refocus');

  if (editingBinding) {
    // Edit mode saving
    if (!addCapturedKey) {
      alert('Please assign a hotkey first.');
      return;
    }

    const idx = hotkeys.findIndex((h) => h.id === editingBinding.id);
    if (idx >= 0) {
      hotkeys[idx] = {
        ...hotkeys[idx],
        openIn,
        folderBehavior: hotkeys[idx].isFolder ? document.getElementById('add-folder-behavior').value : null,
        key: addCapturedKey,
        refocusIfOpen: hotkeys[idx].isFolder ? undefined : refocusInput.checked,
      };
      await chrome.storage.sync.set({ hotkeys });
    }

    editingBinding = null;
  } else {
    // Add mode saving
    if (!addSelectedBookmark) {
      alert('Please select a bookmark first.');
      return;
    }
    if (!addCapturedKey) {
      alert('Please assign a hotkey first.');
      return;
    }

    const binding = {
      id: generateId(),
      bookmarkId: addSelectedBookmark.id,
      title: addSelectedBookmark.title || 'Untitled',
      url: addSelectedBookmark.url ?? null,
      isFolder: !addSelectedBookmark.url,
      folderBehavior: !addSelectedBookmark.url ? document.getElementById('add-folder-behavior').value : null,
      key: addCapturedKey,
      openIn,
      refocusIfOpen: !addSelectedBookmark.url ? refocusInput.checked : undefined,
    };

    hotkeys.push(binding);
    await chrome.storage.sync.set({ hotkeys });
  }

  document.getElementById('add-form-wrapper').classList.remove('open');
  document.getElementById('add-hotkey-btn').style.display = '';
  resetAddForm();
  renderHotkeyList();
  renderStorageUsage();
}

/* ─── Edit Form Activation ──────────────────────────────────────────────── */
function openEditModal(binding) {
  editingBinding = binding;
  const wrapper = document.getElementById('add-form-wrapper');
  const addBtn = document.getElementById('add-hotkey-btn');
  const addTitle = document.getElementById('add-form-title');

  addTitle.textContent = 'Edit Hotkey';
  wrapper.classList.add('open');
  addBtn.style.display = 'none';

  // Hide bookmark search row and selection picker results
  document.getElementById('bm-search-row').style.display = 'none';
  document.getElementById('bm-results').style.display = 'none';

  // Show selected bookmark title and URL (with test link)
  const label = document.getElementById('bm-selected-label');
  const titleEl = document.getElementById('bm-selected-title');
  const urlEl = document.getElementById('bm-selected-url');
  const linkEl = document.getElementById('bm-selected-link');

  label.style.display = 'flex';
  titleEl.textContent = binding.title || 'Untitled';

  if (binding.url) {
    urlEl.textContent = binding.url;
    urlEl.style.display = '';
    linkEl.href = binding.url;
    linkEl.style.display = 'inline';
    document.getElementById('add-folder-row').style.display = 'none';
  } else {
    urlEl.textContent = '';
    urlEl.style.display = 'none';
    linkEl.href = '#';
    linkEl.style.display = 'none';
    document.getElementById('add-folder-row').style.display = '';
  }

  // Populate key and options
  addCapturedKey = binding.key;
  document.getElementById('add-key-input').value = keyToLabel(addCapturedKey);

  const openInSelect = document.getElementById('add-open-in');
  openInSelect.value = binding.openIn ?? 'new_tab';

  const refocusRow = document.getElementById('add-refocus-row');
  const refocusInput = document.getElementById('add-refocus');

  if (binding.isFolder) {
    document.getElementById('add-folder-row').style.display = '';
    document.getElementById('add-folder-behavior').value = binding.folderBehavior ?? 'drill_in';
    refocusRow.style.display = 'none';
  } else {
    document.getElementById('add-folder-row').style.display = 'none';
    refocusRow.style.display = openInSelect.value === 'current_tab' ? 'none' : '';
    refocusInput.checked = binding.refocusIfOpen !== false;
  }

  document.getElementById('add-conflict-msg').style.display = 'none';
  checkIncognitoWarningOptions(openInSelect.value);
}

/* ─── Leader Key Section ─────────────────────────────────────────────────── */
function renderLeaderKey() {
  chrome.commands.getAll((commands) => {
    const actionCmd = commands.find((c) => c.name === '_execute_action');
    const label = document.getElementById('current-shortcut-label');
    if (label) {
      label.textContent = (actionCmd && actionCmd.shortcut) ? actionCmd.shortcut : 'Not set';
    }
  });

  const shortcutsBtn = document.getElementById('open-chrome-shortcuts-btn');
  if (shortcutsBtn && !shortcutsBtn.hasAttribute('data-bound')) {
    shortcutsBtn.setAttribute('data-bound', 'true');
    shortcutsBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
  }
}



/* ─── Storage Usage ──────────────────────────────────────────────────────── */
async function renderStorageUsage() {
  chrome.storage.sync.getBytesInUse(null, (bytes) => {
    const pct = Math.round((bytes / 102400) * 100);
    const kb = (bytes / 1024).toFixed(1);
    document.getElementById('storage-label').textContent = `${kb} KB / 100 KB (${pct}%)`;
    const fill = document.getElementById('storage-fill');
    fill.style.width = `${Math.min(pct, 100)}%`;
    fill.className = 'storage-meter-fill' + (pct > 90 ? ' danger' : pct > 70 ? ' warn' : '');
  });
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
  parts.push(codeToLabel(key.code));
  return parts.join('');
}

function codeToLabel(code) {
  if (!code) return '';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  const MAP = { Space: '␣', Enter: '↵', Backspace: '⌫', Escape: 'Esc', Period: '.', Comma: ',', Slash: '/', Minus: '-', Equal: '=' };
  return MAP[code] ?? code;
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    let display = u.hostname + u.pathname;
    if (display.length > 50) display = display.slice(0, 47) + '…';
    return display;
  } catch {
    return url.length > 50 ? url.slice(0, 47) + '…' : url;
  }
}

function generateId() {
  return `loki-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = `
    position:fixed; bottom:20px; left:50%; transform:translateX(-50%);
    background:var(--accent); color:var(--accent-text);
    padding:8px 20px; border-radius:20px; font-size:13px; font-weight:600;
    animation:fadeIn 0.2s ease; z-index:9999;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

function checkConflictOptions() {
  const conflictMsg = document.getElementById('add-conflict-msg');
  if (!addCapturedKey) {
    conflictMsg.style.display = 'none';
    return;
  }
  const matches = hotkeys.filter(
    (h) => h.id !== (editingBinding?.id ?? null) &&
           h.key?.code === addCapturedKey.code &&
           !!h.key?.shift === !!addCapturedKey.shift
  );
  if (matches.length > 0) {
    const count = matches.length;
    const names = matches.map((m) => `"${m.title}"`).join(', ');
    conflictMsg.textContent = `⚠ In use by ${count} other${count > 1 ? 's' : ''} (${names})`;
    conflictMsg.style.display = 'block';
  } else {
    conflictMsg.style.display = 'none';
  }
}

function checkIncognitoWarningOptions(openIn) {
  const conflictMsg = document.getElementById('add-conflict-msg');
  if (openIn === 'new_incognito') {
    chrome.extension.isAllowedIncognitoAccess((isAllowed) => {
      if (!isAllowed) {
        conflictMsg.textContent = '⚠ Enable "Allow in Incognito" in Loki Extension details to open bookmarks incognito.';
        conflictMsg.style.display = 'block';
      } else {
        // Fall back to standard key conflict warning
        checkConflictOptions();
      }
    });
  } else {
    checkConflictOptions();
  }
}

/* ─── Start ──────────────────────────────────────────────────────────────── */
init().catch(console.error);
