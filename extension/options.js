'use strict';

const STORAGE_KEY_STATE       = 'dials_state';
const STORAGE_KEY_ACTIVE      = 'active_profile_id';
const STORAGE_KEY_OPEN_IN_TAB = 'open_in_new_tab';
const STORAGE_KEY_SYNC_MODE = 'sync_mode';
const STORAGE_KEY_SYNC_SERVER_URL = 'sync_server_url';
const STORAGE_KEY_SYNC_API_KEY = 'sync_api_key';
const STORAGE_KEY_SYNC_USERNAME = 'sync_username';
const STORAGE_KEY_SYNC_PASSWORD = 'sync_password';
const STORAGE_KEY_SYNC_AUTH_VIEW = 'sync_auth_view';
const STORAGE_KEY_SYNC_LOGGED_IN = 'sync_logged_in';
const STORAGE_KEY_SYNC_LOGGED_USER = 'sync_logged_user';
const STORAGE_KEY_SEARCH_ENABLED = 'search_enabled';
const STORAGE_KEY_SEARCH_ENGINE  = 'search_engine';
const STORAGE_KEY_SPLASH_DATA = 'splash_bg_data';
const STORAGE_KEY_SPLASH_ON   = 'splash_bg_enabled';
const STORAGE_KEY_SPLASH_PUBLIC_ON = 'splash_public_enabled';
const STORAGE_KEY_SPLASH_PROVIDER  = 'splash_public_provider';
const STORAGE_KEY_SPLASH_QUERY     = 'splash_public_query';
const STORAGE_KEY_SPLASH_REFRESH   = 'splash_public_refresh';

let state = { profiles: [] };
let syncLoggedIn = false;
let syncLoggedUser = '';

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chromeGet([
    STORAGE_KEY_STATE,
    STORAGE_KEY_OPEN_IN_TAB,
    STORAGE_KEY_SYNC_MODE,
    STORAGE_KEY_SYNC_SERVER_URL,
    STORAGE_KEY_SYNC_API_KEY,
    STORAGE_KEY_SYNC_USERNAME,
    STORAGE_KEY_SYNC_PASSWORD,
    STORAGE_KEY_SYNC_AUTH_VIEW,
    STORAGE_KEY_SYNC_LOGGED_IN,
    STORAGE_KEY_SYNC_LOGGED_USER,
    STORAGE_KEY_SEARCH_ENABLED,
    STORAGE_KEY_SEARCH_ENGINE,
    STORAGE_KEY_SPLASH_DATA,
    STORAGE_KEY_SPLASH_ON,
    STORAGE_KEY_SPLASH_PUBLIC_ON,
    STORAGE_KEY_SPLASH_PROVIDER,
    STORAGE_KEY_SPLASH_QUERY,
  ]);

  state = stored[STORAGE_KEY_STATE] || { profiles: [] };
  document.getElementById('pref-new-tab').checked = stored[STORAGE_KEY_OPEN_IN_TAB] ?? false;
  document.getElementById('sync-mode').value = stored[STORAGE_KEY_SYNC_MODE] || 'local';
  document.getElementById('sync-server-url').value = stored[STORAGE_KEY_SYNC_SERVER_URL] || '';
  document.getElementById('sync-api-key').value = stored[STORAGE_KEY_SYNC_API_KEY] || '';
  document.getElementById('sync-username').value = stored[STORAGE_KEY_SYNC_USERNAME] || '';
  document.getElementById('sync-password').value = stored[STORAGE_KEY_SYNC_PASSWORD] || '';
  document.getElementById('sync-auth-view').value = stored[STORAGE_KEY_SYNC_AUTH_VIEW] || 'login';
  syncLoggedIn = stored[STORAGE_KEY_SYNC_LOGGED_IN] ?? false;
  syncLoggedUser = stored[STORAGE_KEY_SYNC_LOGGED_USER] || '';
  document.getElementById('pref-search-enabled').checked = stored[STORAGE_KEY_SEARCH_ENABLED] ?? true;
  document.getElementById('pref-search-engine').value = stored[STORAGE_KEY_SEARCH_ENGINE] || 'google';
  document.getElementById('pref-splash-enabled').checked = stored[STORAGE_KEY_SPLASH_ON] ?? false;
  document.getElementById('pref-splash-public').checked = stored[STORAGE_KEY_SPLASH_PUBLIC_ON] ?? false;
  document.getElementById('splash-provider').value = stored[STORAGE_KEY_SPLASH_PROVIDER] || 'picsum';
  document.getElementById('splash-query').value = stored[STORAGE_KEY_SPLASH_QUERY] || '';

  const splashPreview = document.getElementById('splash-preview');
  const splashData = stored[STORAGE_KEY_SPLASH_DATA] || '';
  if (splashData) {
    splashPreview.src = splashData;
    splashPreview.classList.remove('hidden');
  }

  updateSearchControlState();
  updateSplashControlState();
  updateSyncControlState();
  updateSubtitle();
  updateLoginStateUi();

  renderProfiles();
});

// ─── Profiles list ────────────────────────────────────────────────────────────
function renderProfiles() {
  const list   = document.getElementById('profile-list');
  const sorted = [...state.profiles].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  list.innerHTML = '';

  if (sorted.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No profiles yet.';
    li.style.color = 'var(--text-muted)';
    li.style.fontSize = '13px';
    list.appendChild(li);
    return;
  }

  for (const profile of sorted) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = `${profile.name} (${(profile.dials || []).length} dials)`;

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'btn-secondary btn-sm';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => renameProfile(profile));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger btn-sm';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteProfile(profile));

    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    li.appendChild(name);
    li.appendChild(actions);
    list.appendChild(li);
  }
}

async function renameProfile(profile) {
  const name = prompt('Rename profile:', profile.name);
  if (!name || !name.trim() || name.trim() === profile.name) return;
  profile.name = name.trim();
  await saveState();
  renderProfiles();
}

async function deleteProfile(profile) {
  if (!confirm(`Delete profile "${profile.name}" and all its dials?`)) return;
  const activeId = (await chromeGet([STORAGE_KEY_ACTIVE]))[STORAGE_KEY_ACTIVE];
  state.profiles = state.profiles.filter(p => p.id !== profile.id);
  if (activeId === profile.id) {
    await chrome.storage.local.set({ [STORAGE_KEY_ACTIVE]: state.profiles[0]?.id ?? null });
  }
  await saveState();
  renderProfiles();
}

async function addProfile() {
  const input = document.getElementById('new-profile-name');
  const name = input.value.trim();
  if (!name) {
    input.focus();
    return;
  }

  state.profiles.push({
    id: uuid(),
    name,
    position: state.profiles.length,
    dials: [],
  });
  input.value = '';
  await saveState();
  renderProfiles();
}

async function clearLocal() {
  if (!confirm('Clear all locally cached dial data from this browser?')) return;
  await chrome.storage.local.remove([STORAGE_KEY_STATE, STORAGE_KEY_ACTIVE]);
  state = { profiles: [] };
  renderProfiles();
  setBackupStatus('Local data cleared.', 'ok');
}

// ─── Sync settings ────────────────────────────────────────────────────────────
async function saveSyncSettings() {
  const mode = document.getElementById('sync-mode').value;
  const rawUrl = document.getElementById('sync-server-url').value.trim();
  const apiKey = document.getElementById('sync-api-key').value.trim();
  const username = document.getElementById('sync-username').value.trim();
  const password = document.getElementById('sync-password').value;

  let normalizedUrl = '';
  if (mode === 'server') {
    if (!rawUrl || !apiKey || !username || !password) {
      setSyncStatus('Server URL, API key, username, and password are required for server mode.', 'err');
      return;
    }
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('bad protocol');
      }
      normalizedUrl = parsed.origin;
    } catch {
      setSyncStatus('Enter a valid server URL.', 'err');
      return;
    }
  }

  await chrome.storage.local.set({
    [STORAGE_KEY_SYNC_MODE]: mode,
    [STORAGE_KEY_SYNC_SERVER_URL]: normalizedUrl,
    [STORAGE_KEY_SYNC_API_KEY]: apiKey,
    [STORAGE_KEY_SYNC_USERNAME]: username,
    [STORAGE_KEY_SYNC_PASSWORD]: password,
    [STORAGE_KEY_SYNC_AUTH_VIEW]: document.getElementById('sync-auth-view').value,
  });

  updateSubtitle();

  if (mode === 'server') {
    setSyncStatus('Sync settings saved. Testing connection...', 'ok');
    await testSyncConnection();
    return;
  }

  syncLoggedIn = false;
  syncLoggedUser = '';
  await chrome.storage.local.set({
    [STORAGE_KEY_SYNC_LOGGED_IN]: false,
    [STORAGE_KEY_SYNC_LOGGED_USER]: '',
  });
  updateLoginStateUi();
  updateSyncControlState();
  setSyncStatus('Sync settings saved (local mode).', 'ok');
}

async function testSyncConnection() {
  const mode = document.getElementById('sync-mode').value;
  const rawUrl = document.getElementById('sync-server-url').value.trim();
  const apiKey = document.getElementById('sync-api-key').value.trim();
  const username = document.getElementById('sync-username').value.trim();
  const password = document.getElementById('sync-password').value;

  if (mode !== 'server') {
    setSyncStatus('Connection test is only available in server mode.', 'err');
    return;
  }
  if (!rawUrl || !apiKey || !username || !password) {
    setSyncStatus('Enter server URL, API key, username, and password first.', 'err');
    return;
  }

  let baseUrl = '';
  try {
    const parsed = new URL(rawUrl);
    baseUrl = parsed.origin;
  } catch {
    setSyncStatus('Enter a valid server URL.', 'err');
    return;
  }

  setSyncStatus('Testing connection...', 'ok');
  try {
    const resp = await fetch(`${baseUrl}/api/sync`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Sync-User': username,
        'X-Sync-Password': password,
      },
    });

    if (resp.ok) {
      syncLoggedIn = true;
      syncLoggedUser = username;
      await chrome.storage.local.set({
        [STORAGE_KEY_SYNC_LOGGED_IN]: true,
        [STORAGE_KEY_SYNC_LOGGED_USER]: username,
      });
      updateLoginStateUi();
      updateSyncControlState();
      setSyncStatus('Connection successful.', 'ok');
      return;
    }
    if (resp.status === 401 || resp.status === 403) {
      syncLoggedIn = false;
      syncLoggedUser = '';
      await chrome.storage.local.set({
        [STORAGE_KEY_SYNC_LOGGED_IN]: false,
        [STORAGE_KEY_SYNC_LOGGED_USER]: '',
      });
      updateLoginStateUi();
      updateSyncControlState();
      setSyncStatus('Connection failed: invalid credentials.', 'err');
      return;
    }
    setSyncStatus(`Connection failed: HTTP ${resp.status}.`, 'err');
  } catch (err) {
    setSyncStatus(`Connection failed: ${err.message}`, 'err');
  }
}

async function registerAccount() {
  const rawUrl = document.getElementById('sync-server-url').value.trim();
  const apiKey = document.getElementById('sync-api-key').value.trim();
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;

  if (!rawUrl || !apiKey) {
    setSyncStatus('Enter server URL and API key before registering.', 'err');
    return;
  }
  if (!username || !password) {
    setSyncStatus('Enter username and password to register.', 'err');
    return;
  }

  let baseUrl = '';
  try {
    const parsed = new URL(rawUrl);
    baseUrl = parsed.origin;
  } catch {
    setSyncStatus('Enter a valid server URL.', 'err');
    return;
  }

  setSyncStatus('Registering account...', 'ok');
  try {
    const resp = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ username, password }),
    });

    if (resp.status === 201) {
      document.getElementById('sync-username').value = username;
      document.getElementById('sync-password').value = password;
      document.getElementById('register-password').value = '';
      document.getElementById('sync-auth-view').value = 'login';
      await chrome.storage.local.set({ [STORAGE_KEY_SYNC_AUTH_VIEW]: 'login' });
      updateSyncControlState();
      setSyncStatus('Account registered. Credentials copied to sync login fields.', 'ok');
      return;
    }

    if (resp.status === 409) {
      setSyncStatus('Username already exists.', 'err');
      return;
    }

    if (resp.status === 401 || resp.status === 403) {
      setSyncStatus('Invalid API key.', 'err');
      return;
    }

    const body = await resp.json().catch(() => ({}));
    setSyncStatus(body.error ? `Register failed: ${body.error}` : `Register failed: HTTP ${resp.status}`, 'err');
  } catch (err) {
    setSyncStatus(`Register failed: ${err.message}`, 'err');
  }
}

// ─── Backup / restore ─────────────────────────────────────────────────────────
function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `browser-dials-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setBackupStatus('Backup exported.', 'ok');
}

async function importJson(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.profiles)) {
      throw new Error('Invalid backup format');
    }
    state = normalizeState(parsed);
    await saveState();
    if (!(await chromeGet([STORAGE_KEY_ACTIVE]))[STORAGE_KEY_ACTIVE] && state.profiles[0]) {
      await chrome.storage.local.set({ [STORAGE_KEY_ACTIVE]: state.profiles[0].id });
    }
    renderProfiles();
    setBackupStatus('Backup imported.', 'ok');
  } catch (err) {
    setBackupStatus(`Import failed: ${err.message}`, 'err');
  }
}

function normalizeState(raw) {
  const profiles = raw.profiles.map((profile, pIdx) => {
    const profileId = String(profile.id || crypto.randomUUID());
    const dials = Array.isArray(profile.dials) ? profile.dials : [];
    return {
      id: profileId,
      name: String(profile.name || 'Profile'),
      position: Number.isInteger(profile.position) ? profile.position : pIdx,
      dials: dials.map((dial, dIdx) => ({
        id: String(dial.id || crypto.randomUUID()),
        profile_id: profileId,
        type: dial.type === 'folder' ? 'folder' : 'dial',
        title: String(dial.title || ''),
        url: dial.type === 'folder' ? '' : String(dial.url || 'https://example.com'),
        position: Number.isInteger(dial.position) ? dial.position : dIdx,
        icon_data: typeof dial.icon_data === 'string' ? dial.icon_data : null,
        icon_bg: typeof dial.icon_bg === 'string' ? dial.icon_bg : null,
        items: dial.type === 'folder'
          ? (Array.isArray(dial.items) ? dial.items : []).map(item => ({
              id: String(item.id || crypto.randomUUID()),
              title: String(item.title || ''),
              url: String(item.url || 'https://example.com'),
              icon_data: typeof item.icon_data === 'string' ? item.icon_data : null,
              icon_bg: typeof item.icon_bg === 'string' ? item.icon_bg : null,
            }))
          : undefined,
      })),
    };
  });
  return { profiles };
}

// ─── Preferences ─────────────────────────────────────────────────────────────
document.getElementById('pref-new-tab').addEventListener('change', async e => {
  await chrome.storage.local.set({ [STORAGE_KEY_OPEN_IN_TAB]: e.target.checked });
});

document.getElementById('pref-search-enabled').addEventListener('change', async e => {
  await chrome.storage.local.set({ [STORAGE_KEY_SEARCH_ENABLED]: e.target.checked });
  updateSearchControlState();
});

document.getElementById('pref-search-engine').addEventListener('change', async e => {
  await chrome.storage.local.set({ [STORAGE_KEY_SEARCH_ENGINE]: e.target.value });
});

document.getElementById('pref-splash-enabled').addEventListener('change', async e => {
  await chrome.storage.local.set({ [STORAGE_KEY_SPLASH_ON]: e.target.checked });
});

document.getElementById('pref-splash-public').addEventListener('change', async e => {
  await chrome.storage.local.set({ [STORAGE_KEY_SPLASH_PUBLIC_ON]: e.target.checked });
  updateSplashControlState();
});

document.getElementById('splash-provider').addEventListener('change', async e => {
  await chrome.storage.local.set({ [STORAGE_KEY_SPLASH_PROVIDER]: e.target.value });
});

document.getElementById('splash-query').addEventListener('change', async e => {
  await chrome.storage.local.set({ [STORAGE_KEY_SPLASH_QUERY]: e.target.value.trim() });
});

document.getElementById('sync-mode').addEventListener('change', () => {
  updateSyncControlState();
  updateSubtitle();
  setSyncStatus('', 'ok');
});

document.getElementById('sync-auth-view').addEventListener('change', async e => {
  await chrome.storage.local.set({ [STORAGE_KEY_SYNC_AUTH_VIEW]: e.target.value });
  updateSyncControlState();
});

document.getElementById('btn-sync-logout').addEventListener('click', async () => {
  syncLoggedIn = false;
  syncLoggedUser = '';
  await chrome.storage.local.set({
    [STORAGE_KEY_SYNC_LOGGED_IN]: false,
    [STORAGE_KEY_SYNC_LOGGED_USER]: '',
  });
  updateLoginStateUi();
  updateSyncControlState();
  setSyncStatus('Logged out. You can log on with another account.', 'ok');
});

['sync-server-url', 'sync-api-key', 'sync-username', 'sync-password'].forEach(id => {
  document.getElementById(id).addEventListener('input', async () => {
    if (!syncLoggedIn) return;
    syncLoggedIn = false;
    syncLoggedUser = '';
    await chrome.storage.local.set({
      [STORAGE_KEY_SYNC_LOGGED_IN]: false,
      [STORAGE_KEY_SYNC_LOGGED_USER]: '',
    });
    updateLoginStateUi();
    updateSyncControlState();
  });
});

async function uploadSplashImage(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    setSplashStatus('Image too large (max 2 MB).', 'err');
    return;
  }

  const data = await readFileAsDataUrl(file);
  await chrome.storage.local.set({
    [STORAGE_KEY_SPLASH_DATA]: data,
    [STORAGE_KEY_SPLASH_ON]: true,
  });

  const preview = document.getElementById('splash-preview');
  preview.src = data;
  preview.classList.remove('hidden');
  document.getElementById('pref-splash-enabled').checked = true;
  setSplashStatus('Splash image saved.', 'ok');
}

async function clearSplashImage() {
  await chrome.storage.local.remove([STORAGE_KEY_SPLASH_DATA]);
  const preview = document.getElementById('splash-preview');
  preview.src = '';
  preview.classList.add('hidden');
  setSplashStatus('Splash image cleared.', 'ok');
}

async function refreshPublicSplash() {
  await chrome.storage.local.set({ [STORAGE_KEY_SPLASH_REFRESH]: Date.now() });
  setSplashStatus('Requested a fresh public background.', 'ok');
}

function updateSearchControlState() {
  const enabled = document.getElementById('pref-search-enabled').checked;
  document.getElementById('pref-search-engine').disabled = !enabled;
}

function updateSplashControlState() {
  const usingPublic = document.getElementById('pref-splash-public').checked;
  document.getElementById('splash-provider').disabled = !usingPublic;
  document.getElementById('splash-query').disabled = !usingPublic;
  document.getElementById('btn-splash-refresh').disabled = !usingPublic;
  document.getElementById('btn-splash-upload').disabled = usingPublic;
  document.getElementById('btn-splash-clear').disabled = usingPublic;
}

function updateSyncControlState() {
  const mode = document.getElementById('sync-mode').value;
  const disabled = mode !== 'server';
  const serverFields = document.getElementById('sync-server-fields');
  const authView = document.getElementById('sync-auth-view').value;
  const loginSection = document.getElementById('sync-login-section');
  const registerSection = document.getElementById('sync-register-section');
  const serverUrlRow = document.getElementById('sync-server-url-row');
  const apiKeyRow = document.getElementById('sync-api-key-row');
  const authViewRow = document.getElementById('sync-auth-view-row');
  const loginStateRow = document.getElementById('sync-login-state-row');
  const loginActionsRow = document.getElementById('sync-login-actions-row');
  serverFields.style.display = disabled ? 'none' : 'block';
  document.getElementById('sync-server-url').disabled = disabled;
  document.getElementById('sync-api-key').disabled = disabled;
  document.getElementById('sync-username').disabled = disabled;
  document.getElementById('sync-password').disabled = disabled;
  document.getElementById('btn-sync-test').disabled = disabled;
  document.getElementById('btn-sync-save').disabled = disabled;
  document.getElementById('sync-auth-view').disabled = disabled;
  document.getElementById('btn-sync-logout').disabled = disabled || !syncLoggedIn;

  if (disabled) {
    serverUrlRow.style.display = 'none';
    apiKeyRow.style.display = 'none';
    authViewRow.style.display = 'none';
    loginStateRow.style.display = 'none';
    loginActionsRow.style.display = 'none';
    loginSection.style.display = 'none';
    registerSection.style.display = 'none';
    return;
  }

  if (syncLoggedIn) {
    serverUrlRow.style.display = 'none';
    apiKeyRow.style.display = 'none';
    authViewRow.style.display = 'none';
    loginStateRow.style.display = 'flex';
    loginSection.style.display = 'none';
    loginActionsRow.style.display = 'none';
    registerSection.style.display = 'none';
    return;
  }

  serverUrlRow.style.display = 'flex';
  apiKeyRow.style.display = 'flex';
  authViewRow.style.display = 'flex';
  loginStateRow.style.display = 'none';
  loginActionsRow.style.display = 'flex';

  loginSection.style.display = authView === 'login' ? 'block' : 'none';
  registerSection.style.display = (!syncLoggedIn && authView === 'register') ? 'block' : 'none';
}

function updateLoginStateUi() {
  const el = document.getElementById('sync-login-state');
  el.textContent = syncLoggedIn
    ? `Logged in as ${syncLoggedUser}`
    : 'Not logged in';
}

function updateSubtitle() {
  const mode = document.getElementById('sync-mode').value;
  const subtitle = document.getElementById('settings-subtitle');
  subtitle.textContent = mode === 'server' ? 'Settings (Server Sync)' : 'Settings (Local Only)';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function saveState() {
  const syncConfig = await getSyncConfig();
  if (syncConfig.mode === 'server' && syncConfig.serverUrl && syncConfig.apiKey && syncConfig.username && syncConfig.password) {
    try {
      await pushStateToServer(syncConfig, state);
    } catch (err) {
      setSyncStatus(`Sync failed: ${err.message}`, 'err');
    }
  }
  await chrome.storage.local.set({ [STORAGE_KEY_STATE]: state });
}

async function getSyncConfig() {
  const stored = await chromeGet([
    STORAGE_KEY_SYNC_MODE,
    STORAGE_KEY_SYNC_SERVER_URL,
    STORAGE_KEY_SYNC_API_KEY,
    STORAGE_KEY_SYNC_USERNAME,
    STORAGE_KEY_SYNC_PASSWORD,
  ]);
  return {
    mode: stored[STORAGE_KEY_SYNC_MODE] || 'local',
    serverUrl: stored[STORAGE_KEY_SYNC_SERVER_URL] || '',
    apiKey: stored[STORAGE_KEY_SYNC_API_KEY] || '',
    username: stored[STORAGE_KEY_SYNC_USERNAME] || '',
    password: stored[STORAGE_KEY_SYNC_PASSWORD] || '',
  };
}

async function pushStateToServer(syncConfig, localState) {
  const serverProfiles = (Array.isArray(localState?.profiles) ? localState.profiles : []).map(profile => ({
    id: String(profile.id),
    name: String(profile.name || 'Profile'),
    position: Number.isInteger(profile.position) ? profile.position : 0,
    dials: (Array.isArray(profile.dials) ? profile.dials : [])
      .filter(dial => dial?.type !== 'folder' && typeof dial?.url === 'string' && dial.url)
      .map((dial, idx) => ({
        id: String(dial.id),
        title: String(dial.title || ''),
        url: String(dial.url),
        position: Number.isInteger(dial.position) ? dial.position : idx,
        settings_json: JSON.stringify(buildDialSettingsPayload(dial)),
      })),
  }));

  const resp = await fetch(`${syncConfig.serverUrl}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${syncConfig.apiKey}`,
      'X-Sync-User': syncConfig.username,
      'X-Sync-Password': syncConfig.password,
    },
    body: JSON.stringify(serverProfiles),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

function buildDialSettingsPayload(dial) {
  const payload = (dial?.settings && typeof dial.settings === 'object' && !Array.isArray(dial.settings))
    ? { ...dial.settings }
    : {};
  if (typeof dial?.icon_bg === 'string' && dial.icon_bg) {
    payload.icon_bg = dial.icon_bg;
  }
  return payload;
}

function setBackupStatus(msg, type) {
  const el = document.getElementById('backup-status');
  el.textContent = msg;
  el.className = type;
}

function setSplashStatus(msg, type) {
  const el = document.getElementById('splash-status');
  el.textContent = msg;
  el.className = type;
}

function setSyncStatus(msg, type) {
  const el = document.getElementById('sync-status');
  el.textContent = msg;
  el.className = type;
}

function uuid() {
  return crypto.randomUUID();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

async function chromeGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

// ─── Event wiring ─────────────────────────────────────────────────────────────
document.getElementById('btn-add-profile').addEventListener('click', addProfile);
document.getElementById('btn-clear-local').addEventListener('click', clearLocal);
document.getElementById('btn-export').addEventListener('click', exportJson);
document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('import-file').click();
});
document.getElementById('import-file').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (file) importJson(file);
  e.target.value = '';
});

document.getElementById('btn-splash-upload').addEventListener('click', () => {
  document.getElementById('splash-file').click();
});

document.getElementById('splash-file').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (file) uploadSplashImage(file).catch(err => setSplashStatus(err.message, 'err'));
  e.target.value = '';
});

document.getElementById('btn-splash-clear').addEventListener('click', () => {
  clearSplashImage().catch(err => setSplashStatus(err.message, 'err'));
});

document.getElementById('btn-splash-refresh').addEventListener('click', () => {
  refreshPublicSplash().catch(err => setSplashStatus(err.message, 'err'));
});

document.getElementById('btn-sync-save').addEventListener('click', () => {
  saveSyncSettings().catch(err => setSyncStatus(err.message, 'err'));
});

document.getElementById('btn-sync-test').addEventListener('click', () => {
  testSyncConnection().catch(err => setSyncStatus(err.message, 'err'));
});

document.getElementById('btn-register-account').addEventListener('click', () => {
  registerAccount().catch(err => setSyncStatus(err.message, 'err'));
});

document.getElementById('new-profile-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') addProfile();
});
