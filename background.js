/**
 * background.js — Loki Service Worker
 *
 * Handles opening and focusing bookmarks asynchronously to prevent popup closure race conditions.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'open_bookmark') {
    handleOpenBookmarkInBackground(message.binding);
  }
});

async function handleOpenBookmarkInBackground(binding) {
  const { url, openIn, refocusIfOpen, id: bindingId } = binding;
  if (!url) return;

  // Refocus check
  if (refocusIfOpen !== false && bindingId && openIn !== 'current_tab') {
    try {
      const sessionData = await chrome.storage.session.get('lokiTrackedTabs');
      const trackedTabsMap = sessionData.lokiTrackedTabs ?? {};
      const tabId = trackedTabsMap[bindingId];

      if (tabId != null) {
        const tab = await new Promise((resolve) => {
          chrome.tabs.get(tabId, (t) => {
            if (chrome.runtime.lastError) resolve(null);
            else resolve(t);
          });
        });

        if (tab) {
          // Domain check
          let bookmarkHostname;
          try { bookmarkHostname = new URL(url).hostname; } catch { bookmarkHostname = null; }
          let tabHostname;
          try { tabHostname = new URL(tab.url || '').hostname; } catch { tabHostname = null; }

          if (bookmarkHostname && tabHostname && bookmarkHostname === tabHostname) {
            // Tab is alive and still on the same domain — focus it and its window
            chrome.tabs.update(tabId, { active: true }, () => {
              chrome.windows.update(tab.windowId, { focused: true });
            });
            return;
          }
        }
      }
    } catch (err) {
      console.error('[Loki SW] Refocus error:', err);
    }
  }

  // Standard opening fallback behavior
  if (openIn === 'current_tab') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([tab]) => {
      if (tab) {
        chrome.tabs.update(tab.id, { url });
      }
    });
  } else if (openIn === 'new_window') {
    chrome.windows.create({ url }, async (win) => {
      const tabId = win?.tabs?.[0]?.id;
      if (tabId != null && bindingId) {
        await recordTrackedTabInBackground(bindingId, tabId);
      }
    });
  } else if (openIn === 'new_incognito') {
    chrome.windows.create({ url, incognito: true }, async (win) => {
      if (chrome.runtime.lastError) {
        console.warn('[Loki SW] Failed to open incognito window, falling back to regular window:', chrome.runtime.lastError.message);
        chrome.windows.create({ url }, async (fallbackWin) => {
          const tabId = fallbackWin?.tabs?.[0]?.id;
          if (tabId != null && bindingId) {
            await recordTrackedTabInBackground(bindingId, tabId);
          }
        });
        return;
      }
      const tabId = win?.tabs?.[0]?.id;
      if (tabId != null && bindingId) {
        await recordTrackedTabInBackground(bindingId, tabId);
      }
    });
  } else {
    // new_tab or default
    chrome.tabs.create({ url }, async (tab) => {
      if (tab?.id != null && bindingId) {
        await recordTrackedTabInBackground(bindingId, tab.id);
      }
    });
  }
}

async function recordTrackedTabInBackground(bindingId, tabId) {
  try {
    const sessionData = await chrome.storage.session.get('lokiTrackedTabs');
    const trackedTabsMap = sessionData.lokiTrackedTabs ?? {};
    trackedTabsMap[bindingId] = tabId;
    await chrome.storage.session.set({ lokiTrackedTabs: trackedTabsMap });
  } catch (err) {
    console.error('[Loki SW] Record tab error:', err);
  }
}
