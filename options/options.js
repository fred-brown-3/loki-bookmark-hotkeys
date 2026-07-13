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

// Add-form state
let addSelectedBookmark = null;
let addCapturedKey = null;
let addCapturing = false;

// Leader key capture state
let leaderCapturing = false;
let leaderCaptured = null;

/* ─── Init ───────────────────────────────────────────────────────────────── */
async function init() {
  const result = await chrome.storage.sync.get(['hotkeys', 'settings']);
  hotkeys = result.hotkeys ?? [];
  settings = { ...DEFAULT_SETTINGS, ...(result.settings ?? {}) };

  setupNav();
  renderHotkeyList();
  renderStorageUsage();
  renderLeaderKey();
  setupAddForm();
  setupLeaderKeyCapture();
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

    // Favicon
    const favicon = document.createElement('img');
    favicon.className = 'hotkey-favicon';
    favicon.alt = '';
    if (binding.url) {
      try {
        const origin = new URL(binding.url).origin;
        favicon.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(origin)}&sz=32`;
      } catch { favicon.src = ''; }
      favicon.onerror = () => { favicon.style.display = 'none'; };
    } else {
      favicon.textContent = '📁';
    }
    row.appendChild(favicon);

    // Title
    const title = document.createElement('div');
    title.className = 'hotkey-title';
    title.textContent = binding.title || 'Untitled';
    title.title = binding.title;
    row.appendChild(title);

    // URL (truncated)
    if (binding.url) {
      const url = document.createElement('div');
      url.className = 'hotkey-url';
      url.textContent = truncateUrl(binding.url);
      url.title = binding.url;
      row.appendChild(url);
    }

    // Open-in
    const openIn = document.createElement('div');
    openIn.className = 'hotkey-open-in';
    openIn.textContent = { new_tab: 'New tab', current_tab: 'Current tab', new_window: 'New window' }[binding.openIn] ?? '';
    row.appendChild(openIn);

    // Key badge
    if (binding.key) {
      row.appendChild(buildKeyBadgeEl(binding.key));
    }

    // Actions
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

  addBtn.addEventListener('click', () => {
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
}

function resetAddForm() {
  addSelectedBookmark = null;
  addCapturedKey = null;
  addCapturing = false;
  document.getElementById('bm-search').value = '';
  document.getElementById('bm-results').style.display = 'none';
  document.getElementById('bm-results').innerHTML = '';
  document.getElementById('bm-selected-label').style.display = 'none';
  document.getElementById('add-key-input').value = '';
  document.getElementById('add-open-in').value = 'new_tab';
  document.getElementById('add-folder-row').style.display = 'none';
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
  document.getElementById('bm-selected-label').style.display = '';
  document.getElementById('bm-selected-title').textContent = bm.title || 'Untitled';
  document.getElementById('add-folder-row').style.display = bm.url ? 'none' : '';
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

  // Check conflict
  const conflict = hotkeys.find(
    (h) => h.key?.code === addCapturedKey.code && !!h.key?.shift === !!addCapturedKey.shift
  );
  if (conflict) {
    conflictMsg.textContent = `⚠ Conflict with "${conflict.title}"`;
    conflictMsg.style.display = '';
  } else {
    conflictMsg.style.display = 'none';
  }
}

async function saveNewHotkey() {
  if (!addSelectedBookmark) {
    alert('Please select a bookmark first.');
    return;
  }
  if (!addCapturedKey) {
    alert('Please assign a hotkey first.');
    return;
  }

  const conflict = hotkeys.find(
    (h) => h.key?.code === addCapturedKey.code && !!h.key?.shift === !!addCapturedKey.shift
  );
  if (conflict) {
    if (!confirm(`This key conflicts with "${conflict.title}". Overwrite?`)) return;
    hotkeys = hotkeys.filter((h) => h.id !== conflict.id);
  }

  const binding = {
    id: generateId(),
    bookmarkId: addSelectedBookmark.id,
    title: addSelectedBookmark.title || 'Untitled',
    url: addSelectedBookmark.url ?? null,
    isFolder: !addSelectedBookmark.url,
    folderBehavior: !addSelectedBookmark.url ? document.getElementById('add-folder-behavior').value : null,
    key: addCapturedKey,
    openIn: document.getElementById('add-open-in').value,
  };

  hotkeys.push(binding);
  await chrome.storage.sync.set({ hotkeys });

  document.getElementById('add-form-wrapper').classList.remove('open');
  document.getElementById('add-hotkey-btn').style.display = '';
  resetAddForm();
  renderHotkeyList();
  renderStorageUsage();
}

/* ─── Edit Modal (simple inline) ────────────────────────────────────────── */
function openEditModal(binding) {
  // For simplicity, scroll to and highlight the row,
  // then open the add-form in edit mode
  // A full modal could be added in V2; for now we use a confirm-style flow
  const title = prompt('Edit title:', binding.title ?? '');
  if (title === null) return;

  const url = prompt('Edit URL:', binding.url ?? '');
  if (url === null) return;

  const idx = hotkeys.findIndex((h) => h.id === binding.id);
  if (idx < 0) return;

  // Update bookmark in Chrome as well
  if (binding.bookmarkId) {
    chrome.bookmarks.update(binding.bookmarkId, {
      title: title.trim() || binding.title,
      url: url.trim() || binding.url,
    }).catch(console.warn);
  }

  hotkeys[idx] = { ...hotkeys[idx], title: title.trim() || binding.title, url: url.trim() || binding.url };
  chrome.storage.sync.set({ hotkeys });
  renderHotkeyList();
}

/* ─── Leader Key Section ─────────────────────────────────────────────────── */
function renderLeaderKey() {
  const input = document.getElementById('leader-key-input');
  input.value = keyToLabel(settings.leaderKey);
  leaderCaptured = { ...settings.leaderKey };
}

function setupLeaderKeyCapture() {
  const input = document.getElementById('leader-key-input');
  const saveBtn = document.getElementById('leader-save-btn');
  const resetBtn = document.getElementById('leader-reset-btn');

  input.addEventListener('click', () => {
    leaderCapturing = true;
    input.value = 'Press your desired combination…';
  });

  input.addEventListener('blur', () => {
    leaderCapturing = false;
    if (!leaderCaptured) input.value = '';
  });

  input.addEventListener('keydown', (e) => {
    if (!leaderCapturing) return;
    e.preventDefault();
    if (['CapsLock'].includes(e.key)) return;
    // Must have at least one modifier
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      document.getElementById('leader-conflict-msg').textContent = '⚠ Must include at least one modifier (Ctrl, Cmd, Alt, or Shift)';
      document.getElementById('leader-conflict-msg').style.display = '';
      return;
    }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

    leaderCaptured = {
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
      code: e.code,
    };
    input.value = keyToLabel(leaderCaptured);
    leaderCapturing = false;
    document.getElementById('leader-conflict-msg').style.display = 'none';
  });

  saveBtn.addEventListener('click', async () => {
    if (!leaderCaptured) return;
    settings.leaderKey = leaderCaptured;
    await chrome.storage.sync.set({ settings });
    renderLeaderKey();
    showToast('Leader key saved!');
  });

  resetBtn.addEventListener('click', async () => {
    leaderCaptured = DEFAULT_SETTINGS.leaderKey;
    renderLeaderKey();
    settings.leaderKey = leaderCaptured;
    await chrome.storage.sync.set({ settings });
    showToast('Reset to default');
  });

  const shortcutsBtn = document.getElementById('open-chrome-shortcuts-btn');
  shortcutsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
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

/* ─── Start ──────────────────────────────────────────────────────────────── */
init().catch(console.error);
