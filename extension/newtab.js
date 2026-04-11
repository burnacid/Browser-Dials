'use strict';

// ─── Debug Mode ──────────────────────────────────────────────────────────────
// Enable via console: localStorage.setItem('DEBUG_BROWSER_DIALS', 'true')
// Disable via console: localStorage.removeItem('DEBUG_BROWSER_DIALS')
let DEBUG_MODE = localStorage.getItem('DEBUG_BROWSER_DIALS') === 'true';
window.toggleDebug = (enable = !DEBUG_MODE) => {
  DEBUG_MODE = enable;
  if (enable) {
    localStorage.setItem('DEBUG_BROWSER_DIALS', 'true');
    console.log('%c[Browser Dials] Debug mode enabled', 'color: #0f766e; font-weight: bold');
  } else {
    localStorage.removeItem('DEBUG_BROWSER_DIALS');
    console.log('%c[Browser Dials] Debug mode disabled', 'color: #64748b');
  }
};
window.isDebugMode = () => DEBUG_MODE;

function debug(...args) {
  if (DEBUG_MODE) {
    console.log('%c[Browser Dials]', 'color: #0f766e; font-weight: bold', ...args);
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────
const STORAGE_KEY_STATE       = 'dials_state';      // { profiles: […] }
const STORAGE_KEY_ACTIVE      = 'active_profile_id';
const STORAGE_KEY_OPEN_IN_TAB = 'open_in_new_tab';
const STORAGE_KEY_SYNC_MODE = 'sync_mode';
const STORAGE_KEY_SYNC_SERVER_URL = 'sync_server_url';
const STORAGE_KEY_SYNC_API_KEY = 'sync_api_key';
const STORAGE_KEY_SYNC_USERNAME = 'sync_username';
const STORAGE_KEY_SYNC_PASSWORD = 'sync_password';
const STORAGE_KEY_SYNC_LAST_PULL_AT = 'sync_last_pull_at';
const STORAGE_KEY_SEARCH_ENABLED = 'search_enabled';
const STORAGE_KEY_SEARCH_ENGINE  = 'search_engine';
const STORAGE_KEY_SPLASH_DATA = 'splash_bg_data';
const STORAGE_KEY_SPLASH_ON   = 'splash_bg_enabled';
const STORAGE_KEY_SPLASH_PUBLIC_ON = 'splash_public_enabled';
const STORAGE_KEY_SPLASH_PROVIDER  = 'splash_public_provider';
const STORAGE_KEY_SPLASH_QUERY     = 'splash_public_query';
const STORAGE_KEY_SPLASH_REFRESH   = 'splash_public_refresh';
const STORAGE_KEY_SPLASH_OPACITY   = 'splash_opacity';
const STORAGE_KEY_SPLASH_OPACITY_UPDATED_AT = 'splash_opacity_updated_at';
const STORAGE_KEY_SPLASH_UNSPLASH_KEY = 'splash_unsplash_access_key';
const STORAGE_KEY_SPLASH_PUBLIC_URL = 'splash_public_cached_url';
const STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH = 'splash_public_last_fetch';
const SYNC_PULL_INTERVAL_MS = 60 * 60 * 1000;

// Letter-avatar palette (colour per first letter)
const AVATAR_COLOURS = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6',
  '#3b82f6','#8b5cf6','#ec4899','#6366f1','#0ea5e9',
];

// ─── State ────────────────────────────────────────────────────────────────────
let state = { profiles: [] };  // { profiles: [{ id, name, position, dials: [] }] }
let activeProfileId = null;
let openInNewTab = false;
let syncMode = 'local';
let syncServerUrl = '';
let syncApiKey = '';
let syncUsername = '';
let syncPassword = '';
let syncLastPullAt = 0;
let searchEnabled = true;
let searchEngine = 'google';
let splashData = '';
let splashOn   = false;
let splashPublicOn = false;
let splashProvider = 'picsum';
let splashQuery = '';
let splashRefreshToken = 0;
let splashOpacity = 1;
let splashOpacityUpdatedAt = 0;
let splashUnsplashKey = '';
let splashPublicUrl = '';
let splashPublicLastFetch = 0;
let splashFetchPromise = null;
let draggedDialId = null;
let dragHoverDialId = null;
let dragHoverMode = null;
let dragDidMove = false;
let folderDraggedItemId = null;
let folderDragHoverItemId = null;
let folderDragHoverMode = null;
let folderDragDidMove = false;

function normalizeGridColumns(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  if (n < 2 || n > 12) return null;
  return n;
}

function normalizeSplashProvider(value) {
  if (value === 'unsplash' || value === 'usplash') return 'unsplash';
  return 'picsum';
}

function normalizeSplashOpacity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Math.round(n * 100) / 100;
}

function normalizeProfileProperties(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function getProfileProperties(profile) {
  const props = normalizeProfileProperties(profile?.properties);
  // Backward compatibility with older local state snapshots.
  if (props.grid_columns === undefined) {
    const legacy = normalizeGridColumns(profile?.grid_columns);
    if (legacy !== null) props.grid_columns = legacy;
  }
  return props;
}

function getProfileGridColumns(profile) {
  return normalizeGridColumns(getProfileProperties(profile).grid_columns);
}

function buildSyncSettingsPayload() {
  return {
    open_in_new_tab: openInNewTab,
    search: {
      enabled: searchEnabled,
      engine: searchEngine,
    },
    splash: {
      enabled: splashOn,
      public_enabled: splashPublicOn,
      provider: normalizeSplashProvider(splashProvider),
      query: splashQuery || '',
      opacity: normalizeSplashOpacity(splashOpacity),
      opacity_updated_at: Number(splashOpacityUpdatedAt) || 0,
      unsplash_access_key: splashUnsplashKey || '',
      cached_url: splashPublicUrl || '',
      cached_at: Number(splashPublicLastFetch) || 0,
    },
  };
}

async function applyServerSettings(settingsObj) {
  if (!settingsObj || typeof settingsObj !== 'object' || Array.isArray(settingsObj)) return;
  const splash = (settingsObj.splash && typeof settingsObj.splash === 'object' && !Array.isArray(settingsObj.splash))
    ? settingsObj.splash
    : null;
  const search = (settingsObj.search && typeof settingsObj.search === 'object' && !Array.isArray(settingsObj.search))
    ? settingsObj.search
    : null;

  const patch = {};
  if (typeof settingsObj.open_in_new_tab === 'boolean') {
    patch[STORAGE_KEY_OPEN_IN_TAB] = settingsObj.open_in_new_tab;
  }
  if (search) {
    if (typeof search.enabled === 'boolean') patch[STORAGE_KEY_SEARCH_ENABLED] = search.enabled;
    if (typeof search.engine === 'string' && search.engine) patch[STORAGE_KEY_SEARCH_ENGINE] = search.engine;
  }
  if (splash) {
    if (typeof splash.enabled === 'boolean') patch[STORAGE_KEY_SPLASH_ON] = splash.enabled;
    if (typeof splash.public_enabled === 'boolean') patch[STORAGE_KEY_SPLASH_PUBLIC_ON] = splash.public_enabled;
    if (typeof splash.provider === 'string') patch[STORAGE_KEY_SPLASH_PROVIDER] = normalizeSplashProvider(splash.provider);
    if (typeof splash.query === 'string') patch[STORAGE_KEY_SPLASH_QUERY] = splash.query;
    const incomingOpacity = normalizeSplashOpacity(splash.opacity);
    const incomingOpacityUpdatedAt = Number(splash.opacity_updated_at) || 0;
    const localOpacityUpdatedAt = Number(splashOpacityUpdatedAt) || 0;
    if (splash.opacity !== undefined) {
      if (incomingOpacityUpdatedAt > 0) {
        if (incomingOpacityUpdatedAt >= localOpacityUpdatedAt) {
          patch[STORAGE_KEY_SPLASH_OPACITY] = incomingOpacity;
          patch[STORAGE_KEY_SPLASH_OPACITY_UPDATED_AT] = incomingOpacityUpdatedAt;
        }
      } else if (localOpacityUpdatedAt === 0) {
        // Backward compatibility for old servers that did not send a timestamp.
        patch[STORAGE_KEY_SPLASH_OPACITY] = incomingOpacity;
      }
    }
    if (typeof splash.unsplash_access_key === 'string') patch[STORAGE_KEY_SPLASH_UNSPLASH_KEY] = splash.unsplash_access_key;

    const incomingCachedAt = Number(splash.cached_at);
    const localCachedAt = Number(splashPublicLastFetch) || 0;
    const incomingHasCache = Number.isFinite(incomingCachedAt) && incomingCachedAt > 0 && typeof splash.cached_url === 'string' && !!splash.cached_url;
    const localHasCache = localCachedAt > 0 && typeof splashPublicUrl === 'string' && !!splashPublicUrl;

    // Never let stale/empty server cache wipe a newer local cache.
    if (incomingHasCache && (!localHasCache || incomingCachedAt >= localCachedAt)) {
      patch[STORAGE_KEY_SPLASH_PUBLIC_URL] = splash.cached_url;
      patch[STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH] = incomingCachedAt;
    }
  }

  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }
}

// Modal edit context
let editingDialId       = null;   // null → adding new dial
let pendingIconData      = null;   // data URL for icon selected in the modal
let openFolderId         = null;
let addingToFolderId     = null;   // non-null when modal is adding/editing an item inside a folder
let editingFolderItemId  = null;   // non-null when editing an existing folder item

function isFolder(dial) {
  return dial?.type === 'folder';
}

// ─── Startup ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chromeGet([
    STORAGE_KEY_STATE,
    STORAGE_KEY_ACTIVE,
    STORAGE_KEY_OPEN_IN_TAB,
    STORAGE_KEY_SYNC_MODE,
    STORAGE_KEY_SYNC_SERVER_URL,
    STORAGE_KEY_SYNC_API_KEY,
    STORAGE_KEY_SYNC_USERNAME,
    STORAGE_KEY_SYNC_PASSWORD,
    STORAGE_KEY_SYNC_LAST_PULL_AT,
    STORAGE_KEY_SEARCH_ENABLED,
    STORAGE_KEY_SEARCH_ENGINE,
    STORAGE_KEY_SPLASH_DATA,
    STORAGE_KEY_SPLASH_ON,
    STORAGE_KEY_SPLASH_PUBLIC_ON,
    STORAGE_KEY_SPLASH_PROVIDER,
    STORAGE_KEY_SPLASH_QUERY,
    STORAGE_KEY_SPLASH_REFRESH,
    STORAGE_KEY_SPLASH_OPACITY,
    STORAGE_KEY_SPLASH_OPACITY_UPDATED_AT,
    STORAGE_KEY_SPLASH_UNSPLASH_KEY,
    STORAGE_KEY_SPLASH_PUBLIC_URL,
    STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH,
  ]);

  state         = stored[STORAGE_KEY_STATE]       || { profiles: [] };
  activeProfileId = stored[STORAGE_KEY_ACTIVE]    || null;
  openInNewTab  = stored[STORAGE_KEY_OPEN_IN_TAB] ?? false;
  syncMode = stored[STORAGE_KEY_SYNC_MODE] || 'local';
  syncServerUrl = stored[STORAGE_KEY_SYNC_SERVER_URL] || '';
  syncApiKey = stored[STORAGE_KEY_SYNC_API_KEY] || '';
  syncUsername = stored[STORAGE_KEY_SYNC_USERNAME] || '';
  syncPassword = stored[STORAGE_KEY_SYNC_PASSWORD] || '';
  syncLastPullAt = Number(stored[STORAGE_KEY_SYNC_LAST_PULL_AT]) || 0;
  searchEnabled = stored[STORAGE_KEY_SEARCH_ENABLED] ?? true;
  searchEngine  = stored[STORAGE_KEY_SEARCH_ENGINE] || 'google';
  splashData    = stored[STORAGE_KEY_SPLASH_DATA] || '';
  splashOn      = stored[STORAGE_KEY_SPLASH_ON] ?? false;
  splashPublicOn = stored[STORAGE_KEY_SPLASH_PUBLIC_ON] ?? false;
  splashProvider = normalizeSplashProvider(stored[STORAGE_KEY_SPLASH_PROVIDER]);
  splashQuery = stored[STORAGE_KEY_SPLASH_QUERY] || '';
  splashRefreshToken = stored[STORAGE_KEY_SPLASH_REFRESH] || 0;
  splashOpacity = normalizeSplashOpacity(stored[STORAGE_KEY_SPLASH_OPACITY] ?? 1);
  splashOpacityUpdatedAt = Number(stored[STORAGE_KEY_SPLASH_OPACITY_UPDATED_AT]) || 0;
  splashUnsplashKey = stored[STORAGE_KEY_SPLASH_UNSPLASH_KEY] || '';
  splashPublicUrl = stored[STORAGE_KEY_SPLASH_PUBLIC_URL] || '';
  splashPublicLastFetch = Number(stored[STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH]) || 0;

  await loadInitialState();

  renderAll();
  void applySplashBackground();
  updatePublicSplashRefreshButton();
  applySearchUi();
  setSyncStatus(syncMode === 'server' ? 'Server sync enabled' : 'Local only');
});

// Listen for local setting/state changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[STORAGE_KEY_STATE]) {
    state = changes[STORAGE_KEY_STATE].newValue || { profiles: [] };
    if (!state.profiles.find(p => p.id === activeProfileId)) {
      activeProfileId = state.profiles[0]?.id ?? null;
    }
    renderAll();
  }
  if (changes[STORAGE_KEY_OPEN_IN_TAB]) {
    openInNewTab = changes[STORAGE_KEY_OPEN_IN_TAB].newValue ?? false;
  }
  if (changes[STORAGE_KEY_SYNC_MODE] || changes[STORAGE_KEY_SYNC_SERVER_URL] || changes[STORAGE_KEY_SYNC_API_KEY] || changes[STORAGE_KEY_SYNC_USERNAME] || changes[STORAGE_KEY_SYNC_PASSWORD]) {
    syncMode = (changes[STORAGE_KEY_SYNC_MODE]?.newValue) ?? syncMode;
    syncServerUrl = (changes[STORAGE_KEY_SYNC_SERVER_URL]?.newValue) ?? syncServerUrl;
    syncApiKey = (changes[STORAGE_KEY_SYNC_API_KEY]?.newValue) ?? syncApiKey;
    syncUsername = (changes[STORAGE_KEY_SYNC_USERNAME]?.newValue) ?? syncUsername;
    syncPassword = (changes[STORAGE_KEY_SYNC_PASSWORD]?.newValue) ?? syncPassword;
    loadInitialState(true).then(() => {
      renderAll();
      setSyncStatus(syncMode === 'server' ? 'Server sync enabled' : 'Local only');
    }).catch(err => {
      setSyncStatus(`Sync error: ${err.message}`, true);
    });
  }
  if (changes[STORAGE_KEY_SYNC_LAST_PULL_AT]) {
    syncLastPullAt = Number(changes[STORAGE_KEY_SYNC_LAST_PULL_AT].newValue) || 0;
  }
  if (changes[STORAGE_KEY_SEARCH_ENABLED]) {
    searchEnabled = changes[STORAGE_KEY_SEARCH_ENABLED].newValue ?? true;
    applySearchUi();
  }
  if (changes[STORAGE_KEY_SEARCH_ENGINE]) {
    searchEngine = changes[STORAGE_KEY_SEARCH_ENGINE].newValue || 'google';
  }
  if (changes[STORAGE_KEY_SPLASH_DATA]) {
    splashData = changes[STORAGE_KEY_SPLASH_DATA].newValue || '';
    void applySplashBackground();
  }
  if (changes[STORAGE_KEY_SPLASH_ON]) {
    splashOn = changes[STORAGE_KEY_SPLASH_ON].newValue ?? false;
    void applySplashBackground();
    updatePublicSplashRefreshButton();
  }
  if (changes[STORAGE_KEY_SPLASH_PUBLIC_ON]) {
    splashPublicOn = changes[STORAGE_KEY_SPLASH_PUBLIC_ON].newValue ?? false;
    void applySplashBackground();
    updatePublicSplashRefreshButton();
  }
  if (changes[STORAGE_KEY_SPLASH_PROVIDER]) {
    splashProvider = normalizeSplashProvider(changes[STORAGE_KEY_SPLASH_PROVIDER].newValue);
    void applySplashBackground();
  }
  if (changes[STORAGE_KEY_SPLASH_QUERY]) {
    splashQuery = changes[STORAGE_KEY_SPLASH_QUERY].newValue || '';
    void applySplashBackground();
  }
  if (changes[STORAGE_KEY_SPLASH_REFRESH]) {
    splashRefreshToken = changes[STORAGE_KEY_SPLASH_REFRESH].newValue || Date.now();
    void applySplashBackground();
  }
  if (changes[STORAGE_KEY_SPLASH_OPACITY]) {
    splashOpacity = normalizeSplashOpacity(changes[STORAGE_KEY_SPLASH_OPACITY].newValue ?? 1);
    void applySplashBackground();
  }
  if (changes[STORAGE_KEY_SPLASH_OPACITY_UPDATED_AT]) {
    splashOpacityUpdatedAt = Number(changes[STORAGE_KEY_SPLASH_OPACITY_UPDATED_AT].newValue) || 0;
  }
  if (changes[STORAGE_KEY_SPLASH_UNSPLASH_KEY]) {
    splashUnsplashKey = changes[STORAGE_KEY_SPLASH_UNSPLASH_KEY].newValue || '';
    void applySplashBackground();
  }
  if (changes[STORAGE_KEY_SPLASH_PUBLIC_URL]) {
    splashPublicUrl = changes[STORAGE_KEY_SPLASH_PUBLIC_URL].newValue || '';
    void applySplashBackground();
  }
  if (changes[STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH]) {
    splashPublicLastFetch = Number(changes[STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH].newValue) || 0;
    void applySplashBackground();
  }
});

// ─── Render ───────────────────────────────────────────────────────────────────
function renderAll() {
  renderProfileTabs();
  renderDials();
}

function renderProfileTabs() {
  const nav    = document.getElementById('profile-tabs');
  const sorted = [...state.profiles].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  nav.innerHTML = '';

  for (const profile of sorted) {
    const btn = document.createElement('button');
    btn.className = 'profile-tab' + (profile.id === activeProfileId ? ' active' : '');
    btn.role = 'tab';
    btn.setAttribute('aria-selected', profile.id === activeProfileId);
    btn.dataset.profileId = profile.id;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = profile.name;

    const renameBtn = document.createElement('button');
    renameBtn.className = 'profile-tab__rename';
    renameBtn.title = 'Rename';
    renameBtn.textContent = '✏';
    renameBtn.addEventListener('click', e => { e.stopPropagation(); promptRenameProfile(profile); });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'profile-tab__delete';
    deleteBtn.title = 'Delete profile';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', e => { e.stopPropagation(); confirmDeleteProfile(profile); });

    btn.appendChild(nameSpan);
    btn.appendChild(renameBtn);
    btn.appendChild(deleteBtn);
    btn.addEventListener('click', () => switchProfile(profile.id));
    nav.appendChild(btn);
  }
}

function renderDials() {
  const grid    = document.getElementById('dial-grid');
  const profile = state.profiles.find(p => p.id === activeProfileId);
  grid.innerHTML = '';
  grid.classList.toggle('dial-grid--dragging', !!draggedDialId);

  if (!grid.dataset.dragBound) {
    grid.addEventListener('dragover', handleGridDragOver);
    grid.addEventListener('drop', handleGridDrop);
    grid.addEventListener('dragleave', handleGridDragLeave);
    grid.dataset.dragBound = 'true';
  }

  if (!profile) {
    grid.style.removeProperty('grid-template-columns');
    const msg = document.createElement('div');
    msg.id = 'empty-state';
    msg.innerHTML = '<p>No profiles yet.</p><small>Click the <strong>＋</strong> button above to create one.</small>';
    grid.appendChild(msg);
    return;
  }

  const gridColumns = getProfileGridColumns(profile);
  if (gridColumns) {
    grid.style.gridTemplateColumns = `repeat(${gridColumns}, minmax(0, 1fr))`;
  } else {
    grid.style.removeProperty('grid-template-columns');
  }

  const sorted = [...(profile.dials || [])].sort((a, b) => a.position - b.position);

  if (sorted.length === 0) {
    const msg = document.createElement('div');
    msg.id = 'empty-state';
    msg.innerHTML = '<p>No dials in this profile.</p><small>Click the card below to add one.</small>';
    grid.appendChild(msg);
  } else {
    for (const dial of sorted) {
      grid.appendChild(buildDialCard(dial, sorted));
    }
  }

  // "Add" card
  const addCard = document.createElement('div');
  addCard.className = 'dial-card dial-card--add';
  addCard.setAttribute('role', 'button');
  addCard.setAttribute('tabindex', '0');
  addCard.innerHTML = '<span class="dial-card__plus">＋</span><span class="dial-card__title">Add dial</span>';
  addCard.addEventListener('click',   () => openAddModal());
  addCard.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openAddModal(); });
  grid.appendChild(addCard);
}

function buildDialCard(dial, allDials) {
  const card = document.createElement('div');
  card.className = 'dial-card';
  card.dataset.dialId = dial.id;
  card.draggable = true;
  const folder = isFolder(dial);

  applyDragVisualState(card, dial.id);

  // Icon
  const iconEl = buildIcon(dial);
  card.appendChild(iconEl);

  // Title
  const title = document.createElement('span');
  title.className = 'dial-card__title';
  title.textContent = dial.title || (folder ? 'Folder' : hostname(dial.url));
  card.appendChild(title);

  if (folder) {
    const meta = document.createElement('span');
    meta.className = 'dial-card__meta';
    const count = Array.isArray(dial.items) ? dial.items.length : 0;
    meta.textContent = `${count} item${count === 1 ? '' : 's'}`;
    card.appendChild(meta);
  }

  // Right-click actions menu
  const actions = document.createElement('div');
  actions.className = 'dial-card__actions';
  actions.addEventListener('click', e => e.stopPropagation());

  const editBtn   = document.createElement('button');
  editBtn.title   = 'Edit';
  editBtn.textContent = '✏';
  editBtn.addEventListener('click', e => { e.stopPropagation(); openEditModal(dial); });

  const deleteBtn   = document.createElement('button');
  deleteBtn.className = 'btn-delete';
  deleteBtn.title   = 'Delete';
  deleteBtn.textContent = '🗑';
  deleteBtn.addEventListener('click', e => { e.stopPropagation(); confirmDeleteDial(dial); });

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);
  card.appendChild(actions);

  card.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    const alreadyOpen = card.classList.contains('context-open');
    closeAllCardMenus();
    if (!alreadyOpen) {
      card.classList.add('context-open');
    }
  });

  card.addEventListener('dragstart', e => handleDialDragStart(e, dial.id));
  card.addEventListener('dragend', handleDialDragEnd);
  card.addEventListener('dragover', e => handleDialDragOver(e, dial.id));
  card.addEventListener('drop', e => handleDialDrop(e, dial.id));
  card.addEventListener('dragleave', e => handleDialDragLeave(e, dial.id));

  // Order buttons
  const orderDiv = document.createElement('div');
  orderDiv.className = 'dial-card__order';

  const idx = allDials.indexOf(dial);

  if (idx > 0) {
    const upBtn = document.createElement('button');
    upBtn.textContent = '◀';
    upBtn.title = 'Move left';
    upBtn.addEventListener('click', e => { e.stopPropagation(); moveDial(dial, -1); });
    orderDiv.appendChild(upBtn);
  }
  if (idx < allDials.length - 1) {
    const downBtn = document.createElement('button');
    downBtn.textContent = '▶';
    downBtn.title = 'Move right';
    downBtn.addEventListener('click', e => { e.stopPropagation(); moveDial(dial, 1); });
    orderDiv.appendChild(downBtn);
  }
  card.appendChild(orderDiv);

  // Navigate on click
  card.addEventListener('click', () => {
    if (dragDidMove) {
      dragDidMove = false;
      return;
    }
    if (folder) {
      openFolderModal(dial.id);
      return;
    }
    if (openInNewTab) {
      window.open(dial.url, '_blank', 'noopener,noreferrer');
    } else {
      window.location.href = dial.url;
    }
  });

  return card;
}

function buildIcon(dial) {
  if (isFolder(dial)) {
    if (dial.icon_data) {
      return buildImgIcon(dial.icon_data, dial.title || 'Folder', dial.icon_bg);
    }
    return buildFolderIcon(dial);
  }
  if (dial.icon_data) {
    return buildImgIcon(dial.icon_data, dial.title || dial.url, dial.icon_bg);
  }
  // Try favicon
  const faviconSrc = faviconUrl(dial.url);
  const img = buildImgIcon(faviconSrc, dial.title || dial.url, dial.icon_bg);
  img.addEventListener('error', () => {
    const avatar = buildAvatar(dial.title || hostname(dial.url));
    img.replaceWith(avatar);
  }, { once: true });
  return img;
}

function buildImgIcon(src, alt, bgColor = null) {
  const img       = document.createElement('img');
  img.className   = 'dial-card__icon';
  img.src         = src;
  img.alt         = alt;
  img.crossOrigin = 'anonymous';
  if (bgColor) {
    img.classList.add('dial-card__icon--with-bg');
    img.style.backgroundColor = bgColor;
  }
  return img;
}

function getModalIconBackground() {
  const enabled = document.getElementById('modal-icon-bg-enabled').checked;
  const color = document.getElementById('modal-icon-bg-color').value;
  if (!enabled) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return '#ffffff';
  return color;
}

function updateIconBgColorUi() {
  const enabled = document.getElementById('modal-icon-bg-enabled').checked;
  document.getElementById('modal-icon-bg-color').disabled = !enabled;
}

function buildAvatar(label) {
  const el          = document.createElement('div');
  el.className      = 'dial-card__avatar';
  const letter      = (label || '?')[0].toUpperCase();
  el.textContent    = letter;
  const code        = letter.charCodeAt(0);
  el.style.background = AVATAR_COLOURS[code % AVATAR_COLOURS.length];
  return el;
}

function buildFolderIcon(dial) {
  const container = document.createElement('div');
  container.className = 'dial-card__folder-grid';

  const items = Array.isArray(dial?.items) ? dial.items.slice(0, 9) : [];
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dial-card__avatar';
    empty.textContent = '📁';
    empty.style.background = '#0f766e';
    return empty;
  }

  const useThreeByThree = items.length > 4;
  container.classList.add(useThreeByThree ? 'dial-card__folder-grid--3' : 'dial-card__folder-grid--2');

  items.forEach(item => {
    const cell = document.createElement('div');
    cell.className = 'dial-card__folder-cell';

    const src = item.icon_data || faviconUrl(item.url);
    const img = document.createElement('img');
    img.className = 'dial-card__folder-cell-img';
    img.src = src;
    img.alt = item.title || item.url || 'Folder item';
    if (item.icon_bg) {
      img.classList.add('dial-card__folder-cell-img--with-bg');
      img.style.backgroundColor = item.icon_bg;
    }
    img.addEventListener('error', () => {
      const letterEl = document.createElement('div');
      letterEl.className = 'dial-card__folder-cell-letter';
      const letter = ((item.title || hostname(item.url)) || '?')[0].toUpperCase();
      letterEl.textContent = letter;
      if (item.icon_bg) {
        letterEl.style.background = item.icon_bg;
      } else {
        const code = letter.charCodeAt(0);
        letterEl.style.background = AVATAR_COLOURS[code % AVATAR_COLOURS.length];
      }
      img.replaceWith(letterEl);
    }, { once: true });

    cell.appendChild(img);
    container.appendChild(cell);
  });

  return container;
}

function closeAllCardMenus() {
  document.querySelectorAll('.dial-card.context-open').forEach(card => {
    card.classList.remove('context-open');
  });
}

function handleDialDragStart(event, dialId) {
  draggedDialId = dialId;
  dragHoverDialId = null;
  dragHoverMode = null;
  dragDidMove = false;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dialId);
  requestAnimationFrame(() => {
    const card = event.currentTarget;
    if (card instanceof HTMLElement) {
      card.classList.add('dial-card--dragging');
    }
    document.getElementById('dial-grid')?.classList.add('dial-grid--dragging');
  });
}

function handleDialDragEnd(event) {
  const card = event.currentTarget;
  if (card instanceof HTMLElement) {
    card.classList.remove('dial-card--dragging');
  }
  clearDialDragState();
}

function handleDialDragOver(event, targetDialId) {
  if (!draggedDialId || draggedDialId === targetDialId) return;
  event.preventDefault();
  event.stopPropagation();
  const mode = getDropMode(event);
  dragHoverDialId = targetDialId;
  dragHoverMode = mode;
  applyDragVisualState(event.currentTarget, targetDialId);
  event.dataTransfer.dropEffect = 'move';
}

function handleDialDrop(event, targetDialId) {
  if (!draggedDialId || draggedDialId === targetDialId) return;
  event.preventDefault();
  event.stopPropagation();
  const mode = getDropMode(event);
  void handleDialDropAction(draggedDialId, targetDialId, mode);
}

function handleDialDragLeave(event, targetDialId) {
  const related = event.relatedTarget;
  if (related instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(related)) {
    return;
  }
  if (dragHoverDialId === targetDialId) {
    dragHoverDialId = null;
    dragHoverMode = null;
    applyDragVisualState(event.currentTarget, targetDialId);
  }
}

function handleGridDragOver(event) {
  if (!draggedDialId) return;
  event.preventDefault();
  if (event.target === event.currentTarget) {
    dragHoverDialId = null;
    dragHoverMode = 'append';
    event.currentTarget.classList.add('dial-grid--append');
  }
  event.dataTransfer.dropEffect = 'move';
}

function handleGridDrop(event) {
  if (!draggedDialId) return;
  if (event.target !== event.currentTarget) return;
  event.preventDefault();
  void appendDialToEnd(draggedDialId);
}

function handleGridDragLeave(event) {
  const related = event.relatedTarget;
  if (related instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(related)) {
    return;
  }
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.classList.remove('dial-grid--append');
  }
}

function applyDragVisualState(card, dialId) {
  if (!(card instanceof HTMLElement)) return;
  card.classList.remove('dial-card--drop-before', 'dial-card--drop-after', 'dial-card--drop-merge');
  if (dragHoverDialId !== dialId) return;
  if (dragHoverMode === 'before') card.classList.add('dial-card--drop-before');
  if (dragHoverMode === 'after') card.classList.add('dial-card--drop-after');
  if (dragHoverMode === 'merge') card.classList.add('dial-card--drop-merge');
}

function getDropMode(event) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return 'after';
  const rect = target.getBoundingClientRect();
  const relativeX = event.clientX - rect.left;
  const ratio = rect.width > 0 ? relativeX / rect.width : 0.5;
  if (ratio < 0.25) return 'before';
  if (ratio > 0.75) return 'after';
  return 'merge';
}

async function handleDialDropAction(sourceDialId, targetDialId, mode) {
  try {
    if (mode === 'before' || mode === 'after') {
      await moveDialToTarget(sourceDialId, targetDialId, mode);
    } else {
      await mergeDialsIntoFolder(sourceDialId, targetDialId);
    }
    dragDidMove = true;
  } finally {
    clearDialDragState();
  }
}

function clearDialDragState() {
  draggedDialId = null;
  dragHoverDialId = null;
  dragHoverMode = null;
  const grid = document.getElementById('dial-grid');
  grid?.classList.remove('dial-grid--dragging', 'dial-grid--append');
  document.querySelectorAll('.dial-card--dragging, .dial-card--drop-before, .dial-card--drop-after, .dial-card--drop-merge').forEach(card => {
    card.classList.remove('dial-card--dragging', 'dial-card--drop-before', 'dial-card--drop-after', 'dial-card--drop-merge');
  });
}

async function appendDialToEnd(dialId) {
  const profile = getActiveProfile();
  if (!profile) return;
  const sorted = [...profile.dials].sort((a, b) => a.position - b.position);
  const sourceIndex = sorted.findIndex(d => d.id === dialId);
  if (sourceIndex < 0 || sourceIndex === sorted.length - 1) {
    clearDialDragState();
    return;
  }
  const [sourceDial] = sorted.splice(sourceIndex, 1);
  sorted.push(sourceDial);
  profile.dials = sorted.map((dial, index) => ({ ...dial, position: index }));
  dragDidMove = true;
  await saveLocal();
  renderAll();
  clearDialDragState();
}

async function moveDialToTarget(sourceDialId, targetDialId, mode) {
  const profile = getActiveProfile();
  if (!profile) return;
  const sorted = [...profile.dials].sort((a, b) => a.position - b.position);
  const sourceIndex = sorted.findIndex(d => d.id === sourceDialId);
  const targetIndex = sorted.findIndex(d => d.id === targetDialId);
  if (sourceIndex < 0 || targetIndex < 0) return;

  const [sourceDial] = sorted.splice(sourceIndex, 1);
  let insertIndex = sorted.findIndex(d => d.id === targetDialId);
  if (insertIndex < 0) {
    sorted.push(sourceDial);
  } else {
    if (mode === 'after') insertIndex += 1;
    sorted.splice(insertIndex, 0, sourceDial);
  }

  profile.dials = sorted.map((dial, index) => ({ ...dial, position: index }));
  await saveLocal();
  renderAll();
}

async function mergeDialsIntoFolder(sourceDialId, targetDialId) {
  const profile = getActiveProfile();
  if (!profile) return;
  const sourceDial = profile.dials.find(d => d.id === sourceDialId);
  const targetDial = profile.dials.find(d => d.id === targetDialId);
  if (!sourceDial || !targetDial) return;

  if (isFolder(sourceDial) && isFolder(targetDial)) {
    return;
  }

  if (isFolder(targetDial)) {
    if (isFolder(sourceDial)) return;
    if (!Array.isArray(targetDial.items)) targetDial.items = [];
    targetDial.items.push(convertDialToFolderItem(sourceDial));
    profile.dials = profile.dials.filter(d => d.id !== sourceDial.id);
  } else if (isFolder(sourceDial)) {
    if (!Array.isArray(sourceDial.items)) sourceDial.items = [];
    sourceDial.items.push(convertDialToFolderItem(targetDial));
    profile.dials = profile.dials.filter(d => d.id !== targetDial.id);
    sourceDial.position = targetDial.position;
  } else {
    const folderDial = {
      id: uuid(),
      profile_id: profile.id,
      type: 'folder',
      title: targetDial.title || sourceDial.title || 'Folder',
      url: '',
      position: Math.min(sourceDial.position, targetDial.position),
      icon_data: null,
      icon_bg: null,
      items: [convertDialToFolderItem(targetDial), convertDialToFolderItem(sourceDial)],
    };
    profile.dials = profile.dials.filter(d => d.id !== sourceDial.id && d.id !== targetDial.id);
    profile.dials.push(folderDial);
  }

  profile.dials = [...profile.dials]
    .sort((a, b) => a.position - b.position)
    .map((dial, index) => ({ ...dial, position: index }));

  if (openFolderId === sourceDialId || openFolderId === targetDialId) {
    openFolderId = null;
  }

  await saveLocal();
  renderAll();
}

function convertDialToFolderItem(dial) {
  return {
    id: dial.id,
    title: dial.title || '',
    url: dial.url,
    icon_data: dial.icon_data || null,
    icon_bg: dial.icon_bg || null,
  };
}

function getActiveProfile() {
  return state.profiles.find(p => p.id === activeProfileId) || null;
}

function openFolderModal(folderId) {
  openFolderId = folderId;
  renderFolderItems();
  document.getElementById('folder-modal-overlay').classList.remove('hidden');
}

function closeFolderModal() {
  clearFolderDragState();
  const modal = document.querySelector('#folder-modal-overlay .modal--folder');
  modal?.classList.remove('folder-modal--drop-out');
  openFolderId = null;
  document.getElementById('folder-modal-overlay').classList.add('hidden');
}

function clearFolderDragState() {
  folderDraggedItemId = null;
  folderDragHoverItemId = null;
  folderDragHoverMode = null;
  const root = document.getElementById('folder-items');
  root?.querySelectorAll('.folder-tile').forEach(c => {
    c.classList.remove('folder-tile--dragging', 'folder-tile--drop-before', 'folder-tile--drop-after');
  });
  const modal = document.querySelector('#folder-modal-overlay .modal--folder');
  modal?.classList.remove('folder-modal--drop-out');
}

async function moveFolderItemOut(folderId, itemId) {
  const profile = getActiveProfile();
  if (!profile) return;
  const folder = profile.dials.find(d => d.id === folderId && isFolder(d));
  if (!folder || !Array.isArray(folder.items)) return;

  const itemIndex = folder.items.findIndex(i => i.id === itemId);
  if (itemIndex < 0) return;

  const [item] = folder.items.splice(itemIndex, 1);
  const maxPosition = profile.dials.reduce((max, dial) => {
    const pos = Number.isInteger(dial.position) ? dial.position : 0;
    return Math.max(max, pos);
  }, -1);

  profile.dials.push({
    id: String(item.id || uuid()),
    profile_id: profile.id,
    type: 'dial',
    title: String(item.title || ''),
    url: String(item.url || 'https://example.com'),
    position: maxPosition + 1,
    icon_data: item.icon_data || null,
    icon_bg: item.icon_bg || null,
  });

  folderDragDidMove = true;
  await saveLocal();
  renderAll();
  renderFolderItems();
}

function renderFolderItems() {
  const profile = getActiveProfile();
  if (!profile) return;
  const folder = profile.dials.find(d => d.id === openFolderId && isFolder(d));
  if (!folder) return;

  const items = Array.isArray(folder.items) ? folder.items : [];
  document.getElementById('folder-modal-title').textContent = folder.title || 'Folder';

  const root = document.getElementById('folder-items');
  root.innerHTML = '';

  if (!root.dataset.bound) {
    // Close open menus on background click
    root.addEventListener('click', e => {
      if (e.target === root) closeFolderTileMenus();
    });
    root.dataset.bound = 'true';
  }

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'folder-tile-empty';
    empty.textContent = 'No links yet. Click "Add link".';
    root.appendChild(empty);
    return;
  }

  function applyFolderTileState(card, itemId) {
    card.classList.remove('folder-tile--drop-before', 'folder-tile--drop-after');
    if (folderDragHoverItemId !== itemId) return;
    if (folderDragHoverMode === 'before') card.classList.add('folder-tile--drop-before');
    if (folderDragHoverMode === 'after')  card.classList.add('folder-tile--drop-after');
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'folder-tile';
    card.dataset.itemId = item.id;
    card.draggable = true;

    // Icon
    const iconSrc = item.icon_data || faviconUrl(item.url);
    const img = buildImgIcon(iconSrc, item.title || item.url, item.icon_bg || null);
    img.className = 'folder-tile__icon' + (item.icon_bg ? ' folder-tile__icon--with-bg' : '');
    img.addEventListener('error', () => {
      const av = document.createElement('div');
      av.className = 'folder-tile__avatar';
      const letter = ((item.title || hostname(item.url)) || '?')[0].toUpperCase();
      av.textContent = letter;
      if (item.icon_bg) {
        av.style.background = item.icon_bg;
      } else {
        const code = letter.charCodeAt(0);
        av.style.background = AVATAR_COLOURS[code % AVATAR_COLOURS.length];
      }
      img.replaceWith(av);
    }, { once: true });
    card.appendChild(img);

    // Title
    const titleEl = document.createElement('span');
    titleEl.className = 'folder-tile__title';
    titleEl.textContent = item.title || hostname(item.url);
    card.appendChild(titleEl);

    // Right-click delete menu
    // Right-click actions menu (edit + delete)
    const actions = document.createElement('div');
    actions.className = 'folder-tile__actions';
    actions.addEventListener('click', e => e.stopPropagation());

    const editBtn = document.createElement('button');
    editBtn.title = 'Edit';
    editBtn.textContent = '✏';
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeFolderTileMenus();
      openEditFolderItemModal(folder, item);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete';
    delBtn.title = 'Delete';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', async e => {
      e.stopPropagation();
      folder.items = folder.items.filter(i => i.id !== item.id);
      await saveLocal();
      renderFolderItems();
      renderAll();
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    card.appendChild(actions);

    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      const already = card.classList.contains('context-open');
      closeFolderTileMenus();
      if (!already) card.classList.add('context-open');
    });

    // Click to navigate
    card.addEventListener('click', () => {
      if (folderDragDidMove) { folderDragDidMove = false; return; }
      closeFolderTileMenus();
      if (openInNewTab) {
        window.open(item.url, '_blank', 'noopener,noreferrer');
      } else {
        window.location.href = item.url;
      }
    });

    // Drag-and-drop reordering
    card.addEventListener('dragstart', e => {
      folderDraggedItemId = item.id;
      folderDragHoverItemId = null;
      folderDragHoverMode = null;
      folderDragDidMove = false;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.id);
      e.dataTransfer.setData('application/x-browser-dials-folder-item', item.id);
      requestAnimationFrame(() => card.classList.add('folder-tile--dragging'));
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('folder-tile--dragging');
      clearFolderDragState();
    });

    card.addEventListener('dragover', e => {
      if (!folderDraggedItemId || folderDraggedItemId === item.id) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = card.getBoundingClientRect();
      const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
      folderDragHoverItemId = item.id;
      folderDragHoverMode = ratio < 0.5 ? 'before' : 'after';
      applyFolderTileState(card, item.id);
      e.dataTransfer.dropEffect = 'move';
    });

    card.addEventListener('dragleave', e => {
      const related = e.relatedTarget;
      if (related instanceof Node && card.contains(related)) return;
      if (folderDragHoverItemId === item.id) {
        folderDragHoverItemId = null;
        folderDragHoverMode = null;
        applyFolderTileState(card, item.id);
      }
    });

    card.addEventListener('drop', async e => {
      if (!folderDraggedItemId || folderDraggedItemId === item.id) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = card.getBoundingClientRect();
      const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
      const mode = ratio < 0.5 ? 'before' : 'after';

      const currentItems = Array.isArray(folder.items) ? [...folder.items] : [];
      const fromIdx = currentItems.findIndex(i => i.id === folderDraggedItemId);
      const toIdx   = currentItems.findIndex(i => i.id === item.id);
      if (fromIdx < 0 || toIdx < 0) { clearFolderDragState(); return; }

      const [moved] = currentItems.splice(fromIdx, 1);
      const insertAt = currentItems.findIndex(i => i.id === item.id);
      currentItems.splice(mode === 'before' ? insertAt : insertAt + 1, 0, moved);
      folder.items = currentItems;
      folderDragDidMove = true;

      await saveLocal();
      renderFolderItems();
      renderAll();
      clearFolderDragState();
    });

    root.appendChild(card);
  });
}

function closeFolderTileMenus() {
  document.querySelectorAll('.folder-tile.context-open').forEach(c => c.classList.remove('context-open'));
}

function openEditFolderItemModal(folder, item) {
  addingToFolderId    = folder.id;
  editingFolderItemId = item.id;
  pendingIconData     = null;

  document.getElementById('modal-title').textContent       = 'Edit Link';
  document.getElementById('modal-save').textContent        = 'Save';
  document.getElementById('modal-title-input').value       = item.title || '';
  document.getElementById('modal-is-folder').checked       = false;
  document.getElementById('modal-url-input').value         = item.url || '';
  document.getElementById('modal-icon-input').value        = '';
  document.getElementById('modal-icon-bg-enabled').checked = !!item.icon_bg;
  document.getElementById('modal-icon-bg-color').value     = item.icon_bg || '#ffffff';
  document.getElementById('modal-folder-row').style.display = 'none';
  updateIconBgColorUi();
  updateDialModalTypeUi();

  const preview   = document.getElementById('modal-icon-preview');
  const removeBtn = document.getElementById('modal-icon-remove');
  if (item.icon_data) {
    preview.src = item.icon_data;
    preview.classList.remove('hidden');
    removeBtn.classList.remove('hidden');
    removeBtn.dataset.dialId = '';
  } else {
    preview.classList.add('hidden');
    removeBtn.classList.add('hidden');
  }

  closeFolderModal();
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-title-input').focus();
}

function addLinkToOpenFolder() {
  if (!openFolderId) return;
  openAddModal(openFolderId);
}

async function applySplashBackground() {
  const publicUrl = await getPublicSplashUrl();
  const selectedImage = splashPublicOn ? publicUrl : splashData;

  if (splashOn && selectedImage) {
    document.body.classList.add('splash-enabled');
    const safeData = selectedImage.replace(/"/g, '\\"');
    document.documentElement.style.setProperty('--splash-image', `url("${safeData}")`);
    const opacity = String(normalizeSplashOpacity(splashOpacity));
    document.documentElement.style.setProperty('--splash-opacity', opacity);
    document.body.style.setProperty('--splash-opacity', opacity);
  } else {
    document.body.classList.remove('splash-enabled');
    document.documentElement.style.removeProperty('--splash-image');
    document.documentElement.style.removeProperty('--splash-opacity');
    document.body.style.removeProperty('--splash-opacity');
  }
}

function updatePublicSplashRefreshButton() {
  const btn = document.getElementById('btn-splash-refresh-tab');
  if (!btn) return;
  const show = splashOn && splashPublicOn;
  btn.classList.toggle('hidden', !show);
}

async function refreshPublicSplashFromNewTab() {
  const now = Date.now();
  await chrome.storage.local.set({
    [STORAGE_KEY_SPLASH_REFRESH]: now,
    [STORAGE_KEY_SPLASH_PUBLIC_URL]: '',
    [STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH]: 0,
  });
  setSyncStatus('Refreshing background...', false);
}

async function getPublicSplashUrl() {
  if (!splashPublicOn) return '';

  const refresh = splashRefreshToken || Date.now();
  const cleanQuery = (splashQuery || '').trim().replace(/\s+/g, ',');
  const encodedQuery = encodeURIComponent(cleanQuery);
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const forceRefresh = (splashRefreshToken || 0) > (splashPublicLastFetch || 0);
  const cacheIsFresh = !!splashPublicUrl && (now - splashPublicLastFetch) < oneDayMs;

  if (!forceRefresh && cacheIsFresh) {
    return splashPublicUrl;
  }

  if (splashProvider !== 'unsplash') {
    // Picsum: generate once and cache for a day.
    let url;
    if (encodedQuery) {
      url = `https://picsum.photos/seed/${encodedQuery}-${now}/1920/1080`;
    } else {
      url = `https://picsum.photos/1920/1080?random=${now}`;
    }
    splashPublicUrl = url;
    splashPublicLastFetch = now;
    await chrome.storage.local.set({
      [STORAGE_KEY_SPLASH_PUBLIC_URL]: url,
      [STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH]: now,
    });
    return url;
  }

  if (!splashUnsplashKey) {
    setSyncStatus('Unsplash access key required', true);
    return splashPublicUrl || '';
  }

  if (!splashFetchPromise) {
    splashFetchPromise = (async () => {
      const endpoint = `https://api.unsplash.com/photos/random?query=${encodedQuery || 'random'}&client_id=${encodeURIComponent(splashUnsplashKey)}`;
      const resp = await fetch(endpoint, { method: 'GET' });
      if (!resp.ok) {
        throw new Error(`Unsplash HTTP ${resp.status}`);
      }
      const body = await resp.json();
      const url = body?.urls?.regular || body?.urls?.full || body?.urls?.raw || '';
      if (!url) throw new Error('Unsplash response missing image URL');

      splashPublicUrl = url;
      splashPublicLastFetch = now;
      await chrome.storage.local.set({
        [STORAGE_KEY_SPLASH_PUBLIC_URL]: url,
        [STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH]: now,
      });
      return url;
    })()
      .catch(err => {
        setSyncStatus(`Unsplash failed: ${err.message}`, true);
        return splashPublicUrl || '';
      })
      .finally(() => {
        splashFetchPromise = null;
      });
  }

  return splashFetchPromise;
}

// ─── Profile actions ──────────────────────────────────────────────────────────
function switchProfile(id) {
  activeProfileId = id;
  chrome.storage.local.set({ [STORAGE_KEY_ACTIVE]: id });
  renderAll();
}

function openAddProfileModal() {
  document.getElementById('profile-name-input').value = '';
  document.getElementById('profile-modal-overlay').classList.remove('hidden');
  document.getElementById('profile-name-input').focus();
}

async function createProfile(name) {
  const trimmed = name.trim();
  if (!trimmed) return;

  const newProfile = {
    id:       uuid(),
    name:     trimmed,
    position: state.profiles.length,
    properties: {},
    dials:    [],
  };

  state.profiles.push(newProfile);
  activeProfileId = newProfile.id;
  await saveLocal();
  renderAll();
}

async function promptRenameProfile(profile) {
  const name = prompt('Rename profile:', profile.name);
  if (!name || !name.trim() || name.trim() === profile.name) return;
  profile.name = name.trim();
  await saveLocal();
  renderAll();
}

async function confirmDeleteProfile(profile) {
  if (!confirm(`Delete profile "${profile.name}" and all its dials?`)) return;
  state.profiles = state.profiles.filter(p => p.id !== profile.id);
  if (activeProfileId === profile.id) {
    activeProfileId = state.profiles[0]?.id ?? null;
  }
  await saveLocal();
  renderAll();
}

// ─── Dial actions ─────────────────────────────────────────────────────────────
function openAddModal(folderId = null) {
  editingDialId    = null;
  addingToFolderId = folderId || null;
  pendingIconData  = null;
  document.getElementById('modal-title').textContent       = folderId ? 'Add Link' : 'Add Dial';
  document.getElementById('modal-save').textContent        = 'Add';
  document.getElementById('modal-title-input').value       = '';
  document.getElementById('modal-is-folder').checked       = false;
  document.getElementById('modal-url-input').value         = '';
  document.getElementById('modal-icon-input').value        = '';
  document.getElementById('modal-icon-bg-enabled').checked = false;
  document.getElementById('modal-icon-bg-color').value     = '#ffffff';
  document.getElementById('modal-icon-preview').classList.add('hidden');
  document.getElementById('modal-icon-remove').classList.add('hidden');
  // Hide the "Create as folder" row when adding an item inside a folder
  document.getElementById('modal-folder-row').style.display = folderId ? 'none' : '';
  updateIconBgColorUi();
  updateDialModalTypeUi();
  if (folderId) closeFolderModal();
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-url-input').focus();
}

function openEditModal(dial) {
  editingDialId   = dial.id;
  pendingIconData = null;
  document.getElementById('modal-title').textContent       = 'Edit Dial';
  document.getElementById('modal-save').textContent        = 'Save';
  document.getElementById('modal-title-input').value       = dial.title || '';
  document.getElementById('modal-is-folder').checked       = isFolder(dial);
  document.getElementById('modal-url-input').value         = dial.url || '';
  document.getElementById('modal-icon-input').value        = '';
  document.getElementById('modal-icon-bg-enabled').checked = !!dial.icon_bg;
  document.getElementById('modal-icon-bg-color').value = dial.icon_bg || '#ffffff';
  updateIconBgColorUi();
  updateDialModalTypeUi();

  const preview = document.getElementById('modal-icon-preview');
  const removeBtn = document.getElementById('modal-icon-remove');
  if (dial.icon_data) {
    preview.src = dial.icon_data;
    preview.classList.remove('hidden');
    removeBtn.classList.remove('hidden');
    removeBtn.dataset.dialId = dial.id;
  } else {
    preview.classList.add('hidden');
    removeBtn.classList.add('hidden');
  }

  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-title-input').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  editingDialId   = null;
  pendingIconData = null;
  editingFolderItemId = null;
  document.getElementById('modal-folder-row').style.display = '';
  const wasAddingToFolder = addingToFolderId;
  addingToFolderId = null;
  if (wasAddingToFolder) openFolderModal(wasAddingToFolder);
}

function updateDialModalTypeUi() {
  const folderMode = document.getElementById('modal-is-folder').checked;
  document.getElementById('modal-url-group').style.display = folderMode ? 'none' : 'block';
}

async function saveDial() {
  // ── Adding a link inside a folder ─────────────────────────────────────────
  if (addingToFolderId) {
    const urlEl  = document.getElementById('modal-url-input');
    const rawUrl = urlEl.value.trim();
    if (!rawUrl) { urlEl.focus(); return; }
    let cleanUrl;
    try {
      const u = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
      cleanUrl = u.href;
    } catch {
      urlEl.setCustomValidity('Enter a valid http/https URL');
      urlEl.reportValidity();
      return;
    }
    urlEl.setCustomValidity('');

    const title        = document.getElementById('modal-title-input').value.trim();
    const iconBgColor  = getModalIconBackground();
    const iconDataForSave = pendingIconData;
    const profile      = getActiveProfile();
    if (!profile) return;
    const folder = profile.dials.find(d => d.id === addingToFolderId && isFolder(d));
    if (!folder) { closeModal(); return; }
    if (!Array.isArray(folder.items)) folder.items = [];

    if (editingFolderItemId) {
      // Edit existing folder item
      const item = folder.items.find(i => i.id === editingFolderItemId);
      if (item) {
        item.title   = title;
        item.url     = cleanUrl;
        item.icon_bg = iconBgColor;
        // null  → no change; ''    → explicitly removed; string → new image
        if (iconDataForSave === '') item.icon_data = null;
        else if (iconDataForSave !== null) item.icon_data = iconDataForSave;
      }
    } else {
      // Add new folder item
      folder.items.push({
        id:        uuid(),
        title,
        url:       cleanUrl,
        icon_data: iconDataForSave,
        icon_bg:   iconBgColor,
      });
    }

    closeModal(); // reopens the folder modal
    await saveLocal();
    renderAll();
    return;
  }

  // ── Normal dial / folder dial ──────────────────────────────────────────────
  const titleEl = document.getElementById('modal-title-input');
  const urlEl   = document.getElementById('modal-url-input');
  const iconBgColor = getModalIconBackground();
  const folderMode = document.getElementById('modal-is-folder').checked;
  const title   = titleEl.value.trim();
  const rawUrl  = urlEl.value.trim();

  let cleanUrl;
  if (!folderMode) {
    if (!rawUrl) { urlEl.focus(); return; }
    try {
      const u = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
      cleanUrl = u.href;
    } catch {
      urlEl.setCustomValidity('Enter a valid http/https URL');
      urlEl.reportValidity();
      return;
    }
  }
  urlEl.setCustomValidity('');

  const profile = state.profiles.find(p => p.id === activeProfileId);
  if (!profile) return;

  if (editingDialId) {
    // Edit existing
    const dial = profile.dials.find(d => d.id === editingDialId);
    if (!dial) return;
    dial.type = folderMode ? 'folder' : 'dial';
    dial.title = title;
    dial.icon_bg = iconBgColor;
    if (folderMode) {
      dial.url = '';
      if (!Array.isArray(dial.items)) dial.items = [];
    } else {
      dial.url = cleanUrl;
      delete dial.items;
    }
  } else {
    // Add new
    const newDial = {
      id:        uuid(),
      profile_id: profile.id,
      type:      folderMode ? 'folder' : 'dial',
      title,
      url:       folderMode ? '' : cleanUrl,
      position:  profile.dials.length,
      icon_data: null,
      icon_bg: iconBgColor,
    };
    if (folderMode) {
      newDial.items = [];
    }
    profile.dials.push(newDial);
    editingDialId = newDial.id;
  }

  const dialIdForIcon = editingDialId;
  const iconDataForSave = pendingIconData;
  closeModal();

  if (iconDataForSave && dialIdForIcon) {
    for (const profileItem of state.profiles) {
      const dial = profileItem.dials.find(d => d.id === dialIdForIcon);
      if (dial) {
        dial.icon_data = iconDataForSave;
        break;
      }
    }
  }

  await saveLocal();
  renderAll();
}

async function confirmDeleteDial(dial) {
  if (!confirm(`Delete "${dial.title || dial.url}"?`)) return;
  const profile = state.profiles.find(p => p.id === activeProfileId);
  if (!profile) return;
  profile.dials = profile.dials.filter(d => d.id !== dial.id);
  await saveLocal();
  renderAll();
}

async function moveDial(dial, direction) {
  const profile = state.profiles.find(p => p.id === activeProfileId);
  if (!profile) return;
  const sorted = [...profile.dials].sort((a, b) => a.position - b.position);
  const idx    = sorted.findIndex(d => d.id === dial.id);
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= sorted.length) return;

  // Swap positions
  const tmp            = sorted[idx].position;
  sorted[idx].position = sorted[newIdx].position;
  sorted[newIdx].position = tmp;

  // Make positions unique if equal
  sorted.forEach((d, i) => { d.position = i; });

  await saveLocal();
  renderAll();
}

async function handleRemoveIcon(dialId) {
  const profile = state.profiles.find(p => p.id === activeProfileId);
  if (!profile) return;
  const dial = profile.dials.find(d => d.id === dialId);
  if (!dial) return;

  dial.icon_data = null;
  await saveLocal();
  closeModal();
  renderAll();
}

async function saveLocal() {
  debug('saveLocal called', { syncMode, dials: state.profiles.reduce((sum, p) => sum + p.dials.length, 0) });
  if (syncMode === 'server') {
    try {
      debug('Pushing state to server...');
      await pushStateToServer();
      debug('State pushed to server successfully');
    } catch (err) {
      debug('Server push failed:', err.message);
      setSyncStatus(`Sync failed: ${err.message}`, true);
    }
  }
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY_STATE]:  state,
      [STORAGE_KEY_ACTIVE]: activeProfileId,
    });
    debug('State saved to local storage');
  } catch (err) {
    debug('Local save failed:', err.message);
    setSyncStatus(`Failed to save: ${err.message}`, true);
  }
}

async function loadInitialState(forcePull = false) {
  debug('loadInitialState called', { forcePull, syncMode, syncLastPullAt });
  if (syncMode === 'server') {
    if (!syncServerUrl || !syncApiKey || !syncUsername || !syncPassword) {
      debug('Server mode incomplete - missing credentials');
      setSyncStatus('Server mode requires URL, API key, username, and password.', true);
      return;
    }
    const now = Date.now();
    const shouldPull = forcePull || !syncLastPullAt || (now - syncLastPullAt) >= SYNC_PULL_INTERVAL_MS;
    debug('Server sync check', { forcePull, shouldPull, timeSinceLastPull: now - syncLastPullAt, interval: SYNC_PULL_INTERVAL_MS });
    if (!shouldPull) {
      if (!state.profiles.find(p => p.id === activeProfileId)) {
        activeProfileId = state.profiles[0]?.id ?? null;
      }
      return;
    }
    try {
      debug('Fetching state from server...');
      const syncBundle = await fetchServerState();
      debug('Server state received', { profileCount: syncBundle.profiles?.length, hasSettings: !!syncBundle.settings });
      const serverProfiles = Array.isArray(syncBundle?.profiles) ? syncBundle.profiles : [];
      state = normalizeServerProfiles(serverProfiles);
      await applyServerSettings(syncBundle?.settings);
      syncLastPullAt = now;
      debug('State updated from server', { profiles: state.profiles.length });
      if (!state.profiles.find(p => p.id === activeProfileId)) {
        activeProfileId = state.profiles[0]?.id ?? null;
      }
      await chrome.storage.local.set({
        [STORAGE_KEY_STATE]: state,
        [STORAGE_KEY_ACTIVE]: activeProfileId,
        [STORAGE_KEY_SYNC_LAST_PULL_AT]: syncLastPullAt,
      });
      return;
    } catch (err) {
      debug('Server sync failed, using cache:', err.message);
      setSyncStatus(`Sync unavailable, using cache: ${err.message}`, true);
    }
  } else {
    debug('Local mode - skipping server sync');
  }

  if (!state.profiles.find(p => p.id === activeProfileId)) {
    activeProfileId = state.profiles[0]?.id ?? null;
  }
}

function normalizeServerProfiles(rawProfiles) {
  if (!Array.isArray(rawProfiles)) return { profiles: [] };
  return {
    profiles: rawProfiles.map((profile, pIdx) => {
      const profileId = String(profile.id || uuid());
      const dials = Array.isArray(profile.dials) ? profile.dials : [];
      return {
        id: profileId,
        name: String(profile.name || 'Profile'),
        position: Number.isInteger(profile.position) ? profile.position : pIdx,
        properties: (() => {
          const fromServer = normalizeProfileProperties(profile.properties);
          if (typeof profile.properties_json === 'string' && profile.properties_json.trim()) {
            try {
              const parsed = JSON.parse(profile.properties_json);
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                Object.assign(fromServer, parsed);
              }
            } catch {
              // Ignore malformed server properties_json.
            }
          }
          const localProfile = state.profiles.find(p => p.id === profileId);
          const localProps = getProfileProperties(localProfile);
          const merged = { ...localProps, ...fromServer };
          const legacyGrid = normalizeGridColumns(profile.grid_columns);
          if (legacyGrid !== null && merged.grid_columns === undefined) {
            merged.grid_columns = legacyGrid;
          }
          return merged;
        })(),
        dials: dials.map((dial, dIdx) => {
          const settings = parseDialSettings(dial.settings_json, dial.settings);
          const iconBg = typeof settings.icon_bg === 'string' ? settings.icon_bg : null;
          const dialId = String(dial.id || uuid());
          // Icons are stored locally only (not synced to server), so preserve
          // any icon_data that was saved in the local state for this dial.
          let localIconData = null;
          for (const localProfile of state.profiles) {
            const localDial = localProfile.dials?.find(d => d.id === dialId);
            if (localDial?.icon_data) {
              localIconData = localDial.icon_data;
              break;
            }
          }

          // Reconstruct folders that were encoded with a sentinel URL on push.
          if (settings._type === 'folder') {
            const rawItems = Array.isArray(settings._items) ? settings._items : [];
            const folderIconData = (typeof settings.icon_data === 'string' && settings.icon_data)
              ? settings.icon_data
              : localIconData;
            const localFolder = (() => {
              for (const lp of state.profiles) {
                const f = lp.dials?.find(d => d.id === dialId && isFolder(d));
                if (f) return f;
              }
              return null;
            })();
            return {
              id: dialId,
              profile_id: profileId,
              type: 'folder',
              title: String(dial.title || ''),
              url: '',
              position: Number.isInteger(dial.position) ? dial.position : dIdx,
              icon_data: folderIconData,
              icon_bg: typeof settings.icon_bg === 'string' ? settings.icon_bg : null,
              items: rawItems.map(item => {
                const itemId = String(item.id || uuid());
                // Preserve locally stored icon_data for folder items
                const localItem = localFolder?.items?.find(i => i.id === itemId);
                const incomingItemIconData = (typeof item.icon_data === 'string' && item.icon_data)
                  ? item.icon_data
                  : null;
                return {
                  id: itemId,
                  title: String(item.title || ''),
                  url: String(item.url || 'https://example.com'),
                  icon_data: incomingItemIconData || localItem?.icon_data || null,
                  icon_bg: item.icon_bg || null,
                };
              }),
            };
          }

          const dialIconData = (typeof settings.icon_data === 'string' && settings.icon_data)
            ? settings.icon_data
            : localIconData;

          return {
            id: dialId,
            profile_id: profileId,
            type: 'dial',
            title: String(dial.title || ''),
            url: String(dial.url || 'https://example.com'),
            position: Number.isInteger(dial.position) ? dial.position : dIdx,
            icon_data: dialIconData,
            icon_bg: iconBg,
            settings,
          };
        }),
      };
    }),
  };
}

function toServerProfiles(localState) {
  const profiles = Array.isArray(localState?.profiles) ? localState.profiles : [];
  return profiles.map(profile => ({
    id: String(profile.id),
    name: String(profile.name || 'Profile'),
    position: Number.isInteger(profile.position) ? profile.position : 0,
    properties: getProfileProperties(profile),
    properties_json: JSON.stringify(getProfileProperties(profile)),
    dials: (Array.isArray(profile.dials) ? profile.dials : [])
      .filter(dial => isFolder(dial) || (typeof dial.url === 'string' && dial.url))
      .map((dial, idx) => {
        if (isFolder(dial)) {
          // Encode folders using a sentinel URL so the server stores them.
          // The full folder data lives in settings_json and is restored on pull.
          const items = Array.isArray(dial.items) ? dial.items : [];
          return {
            id: String(dial.id),
            title: String(dial.title || ''),
            url: 'https://folder.placeholder/',
            position: Number.isInteger(dial.position) ? dial.position : idx,
            settings_json: JSON.stringify({
              ...buildDialSettingsPayload(dial),
              _type: 'folder',
              _items: items.map(item => ({
                id: String(item.id),
                title: String(item.title || ''),
                url: String(item.url || ''),
                icon_data: (typeof item.icon_data === 'string' && item.icon_data) ? item.icon_data : null,
                icon_bg: item.icon_bg || null,
              })),
            }),
          };
        }
        return {
          id: String(dial.id),
          title: String(dial.title || ''),
          url: String(dial.url),
          position: Number.isInteger(dial.position) ? dial.position : idx,
          settings_json: JSON.stringify(buildDialSettingsPayload(dial)),
        };
      }),
  }));
}

function parseDialSettings(settingsJson, settingsObj) {
  const fromObj = (settingsObj && typeof settingsObj === 'object' && !Array.isArray(settingsObj))
    ? { ...settingsObj }
    : {};
  if (typeof settingsJson !== 'string' || !settingsJson.trim()) {
    return fromObj;
  }
  try {
    const parsed = JSON.parse(settingsJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...fromObj, ...parsed };
    }
  } catch {
    // Ignore malformed settings_json and keep defaults.
  }
  return fromObj;
}

function buildDialSettingsPayload(dial) {
  const payload = (dial.settings && typeof dial.settings === 'object' && !Array.isArray(dial.settings))
    ? { ...dial.settings }
    : {};
  if (typeof dial.icon_data === 'string' && dial.icon_data) {
    payload.icon_data = dial.icon_data;
  }
  if (typeof dial.icon_bg === 'string' && dial.icon_bg) {
    payload.icon_bg = dial.icon_bg;
  }
  return payload;
}

async function fetchServerState() {
  debug('fetchServerState - connecting to', syncServerUrl);
  const resp = await fetch(`${syncServerUrl}/api/sync`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${syncApiKey}`,
      'X-Sync-User': syncUsername,
      'X-Sync-Password': syncPassword,
    },
  });
  if (!resp.ok) {
    debug('Server returned HTTP', resp.status);
    throw new Error(`HTTP ${resp.status}`);
  }
  const body = await resp.json();
  if (Array.isArray(body)) {
    // Backward-compatible shape from older servers
    debug('Server returned legacy array format');
    return { profiles: body, settings: null };
  }
  debug('Server returned new format');
  return {
    profiles: Array.isArray(body?.profiles) ? body.profiles : [],
    settings: (body?.settings && typeof body.settings === 'object' && !Array.isArray(body.settings))
      ? body.settings
      : null,
  };
}

async function pushStateToServer() {
  const payload = {
    profiles: toServerProfiles(state),
    settings: buildSyncSettingsPayload(),
  };
  const resp = await fetch(`${syncServerUrl}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${syncApiKey}`,
      'X-Sync-User': syncUsername,
      'X-Sync-Password': syncPassword,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  setSyncStatus('Synced', false);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function setSyncStatus(msg, isError = false) {
  const el = document.getElementById('sync-status');
  el.textContent = msg;
  el.className   = isError ? 'error' : '';
}

function applySearchUi() {
  const shell = document.getElementById('search-shell');
  if (!shell) return;
  shell.style.display = searchEnabled ? 'block' : 'none';
}

function getSearchTargetUrl(query) {
  const q = encodeURIComponent(query.trim());
  if (searchEngine === 'bing') {
    return `https://www.bing.com/search?q=${q}`;
  }
  if (searchEngine === 'duckduckgo') {
    return `https://duckduckgo.com/?q=${q}`;
  }
  if (searchEngine === 'brave') {
    return `https://search.brave.com/search?q=${q}`;
  }
  return `https://www.google.com/search?q=${q}`;
}

function hostname(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function faviconUrl(url) {
  try { return new URL(url).origin + '/favicon.ico'; } catch { return ''; }
}

function uuid() {
  // crypto.randomUUID is available in extension pages (MV3)
  return crypto.randomUUID();
}

async function chromeGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

// ─── Event listeners ──────────────────────────────────────────────────────────
document.getElementById('btn-add-profile').addEventListener('click', openAddProfileModal);
document.getElementById('btn-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('btn-splash-refresh-tab').addEventListener('click', () => {
  refreshPublicSplashFromNewTab().catch(err => setSyncStatus(`Background refresh failed: ${err.message}`, true));
});

document.getElementById('search-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('search-input');
  const query = input.value.trim();
  if (!query) return;
  const url = getSearchTargetUrl(query);
  if (openInNewTab) {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    window.location.href = url;
  }
});

// Dial modal
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-save').addEventListener('click', saveDial);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});
document.getElementById('modal-is-folder').addEventListener('change', updateDialModalTypeUi);
document.getElementById('modal-icon-bg-enabled').addEventListener('change', updateIconBgColorUi);

document.getElementById('modal-icon-input').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 1024 * 1024) {
    alert('Icon file is too large. Maximum size is 1 MB.');
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    pendingIconData = String(reader.result || '');
    const preview = document.getElementById('modal-icon-preview');
    preview.src = pendingIconData;
    preview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
});

document.getElementById('modal-icon-remove').addEventListener('click', e => {
  const dialId = e.target.dataset.dialId;
  if (dialId) {
    handleRemoveIcon(dialId);
  } else if (editingFolderItemId) {
    // Clear icon for a folder item — mark as explicitly removed
    pendingIconData = '';
    const preview = document.getElementById('modal-icon-preview');
    preview.src = '';
    preview.classList.add('hidden');
    document.getElementById('modal-icon-remove').classList.add('hidden');
  }
});

// Profile modal
document.getElementById('profile-modal-cancel').addEventListener('click', () => {
  document.getElementById('profile-modal-overlay').classList.add('hidden');
});
document.getElementById('profile-modal-save').addEventListener('click', () => {
  const name = document.getElementById('profile-name-input').value;
  document.getElementById('profile-modal-overlay').classList.add('hidden');
  createProfile(name);
});
document.getElementById('profile-modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) {
    document.getElementById('profile-modal-overlay').classList.add('hidden');
  }
});

// Folder modal
document.getElementById('folder-close').addEventListener('click', closeFolderModal);
document.getElementById('folder-add-link').addEventListener('click', () => {
  addLinkToOpenFolder();
});
const folderModalOverlay = document.getElementById('folder-modal-overlay');
folderModalOverlay.addEventListener('click', e => {
  if (e.target === e.currentTarget) {
    closeFolderModal();
  }
});

const folderModalShell = document.querySelector('#folder-modal-overlay .modal--folder');
folderModalOverlay.addEventListener('dragover', e => {
  if (!folderDraggedItemId || !openFolderId) return;
  const inGrid = e.target instanceof Element && !!e.target.closest('#folder-items');
  if (inGrid) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  folderModalShell?.classList.add('folder-modal--drop-out');
});
folderModalOverlay.addEventListener('dragleave', e => {
  if (!folderDraggedItemId) return;
  const related = e.relatedTarget;
  if (related instanceof Node && folderModalOverlay.contains(related)) return;
  folderModalShell?.classList.remove('folder-modal--drop-out');
});
folderModalOverlay.addEventListener('drop', e => {
  if (!folderDraggedItemId || !openFolderId) return;
  const inGrid = e.target instanceof Element && !!e.target.closest('#folder-items');
  if (inGrid) return;
  e.preventDefault();
  folderModalShell?.classList.remove('folder-modal--drop-out');
  void moveFolderItemOut(openFolderId, folderDraggedItemId).finally(() => {
    clearFolderDragState();
  });
});

folderModalShell?.addEventListener('dragover', e => {
  if (!folderDraggedItemId || !openFolderId) return;
  const inGrid = e.target instanceof Element && !!e.target.closest('#folder-items');
  if (inGrid) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  folderModalShell.classList.add('folder-modal--drop-out');
});
folderModalShell?.addEventListener('dragleave', e => {
  if (!folderDraggedItemId) return;
  const related = e.relatedTarget;
  if (related instanceof Node && folderModalShell.contains(related)) return;
  folderModalShell.classList.remove('folder-modal--drop-out');
});
folderModalShell?.addEventListener('drop', e => {
  if (!folderDraggedItemId || !openFolderId) return;
  const inGrid = e.target instanceof Element && !!e.target.closest('#folder-items');
  if (inGrid) return;
  e.preventDefault();
  folderModalShell.classList.remove('folder-modal--drop-out');
  void moveFolderItemOut(openFolderId, folderDraggedItemId).finally(() => {
    clearFolderDragState();
  });
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeAllCardMenus();
    closeModal();
    closeFolderModal();
    document.getElementById('profile-modal-overlay').classList.add('hidden');
  }
});

document.addEventListener('click', () => {
  closeAllCardMenus();
});

document.addEventListener('contextmenu', e => {
  if (!e.target.closest('.dial-card')) {
    closeAllCardMenus();
  }
});
