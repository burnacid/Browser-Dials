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

const STORAGE_KEY_STATE       = 'dials_state';
const STORAGE_KEY_ACTIVE      = 'active_profile_id';
const STORAGE_KEY_OPEN_IN_TAB = 'open_in_new_tab';
const STORAGE_KEY_SYNC_MODE = 'sync_mode';
const STORAGE_KEY_SYNC_SERVER_URL = 'sync_server_url';
const STORAGE_KEY_SYNC_API_KEY = 'sync_api_key';
const STORAGE_KEY_SYNC_USERNAME = 'sync_username';
const STORAGE_KEY_SYNC_PASSWORD = 'sync_password';
const STORAGE_KEY_SYNC_LAST_SUCCESS_AT = 'sync_last_success_at';
const STORAGE_KEY_SYNC_LAST_SNAPSHOT_HASH = 'sync_last_snapshot_hash';
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
const STORAGE_KEY_SPLASH_OPACITY   = 'splash_opacity';
const STORAGE_KEY_SPLASH_OPACITY_UPDATED_AT = 'splash_opacity_updated_at';
const STORAGE_KEY_SPLASH_UNSPLASH_KEY = 'splash_unsplash_access_key';
const STORAGE_KEY_SPLASH_PUBLIC_URL = 'splash_public_cached_url';
const STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH = 'splash_public_last_fetch';

let state = { profiles: [] };
let syncLoggedIn = false;
let syncLoggedUser = '';

function normalizeGridColumns(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  if (n < 2 || n > 12) return null;
  return n;
}

function normalizeProfileProperties(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function getProfileProperties(profile) {
  const props = normalizeProfileProperties(profile?.properties);
  // Backward compatibility with older local state
  if (props.grid_columns === undefined) {
    const legacy = normalizeGridColumns(profile?.grid_columns);
    if (legacy !== null) props.grid_columns = legacy;
  }
  return props;
}

function getProfileGridColumns(profile) {
  return normalizeGridColumns(getProfileProperties(profile).grid_columns);
}

function setProfileGridColumns(profile, value) {
  const props = getProfileProperties(profile);
  const normalized = normalizeGridColumns(value);
  if (normalized === null) {
    delete props.grid_columns;
  } else {
    props.grid_columns = normalized;
  }
  profile.properties = props;
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

function updateSplashOpacityLabel(value) {
  document.getElementById('splash-opacity-value').textContent = normalizeSplashOpacity(value).toFixed(2);
}

async function buildSyncSettingsPayload() {
  const stored = await chromeGet([
    STORAGE_KEY_OPEN_IN_TAB,
    STORAGE_KEY_SEARCH_ENABLED,
    STORAGE_KEY_SEARCH_ENGINE,
    STORAGE_KEY_SPLASH_ON,
    STORAGE_KEY_SPLASH_PUBLIC_ON,
    STORAGE_KEY_SPLASH_PROVIDER,
    STORAGE_KEY_SPLASH_QUERY,
    STORAGE_KEY_SPLASH_UNSPLASH_KEY,
    STORAGE_KEY_SPLASH_PUBLIC_URL,
    STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH,
    STORAGE_KEY_SPLASH_OPACITY,
    STORAGE_KEY_SPLASH_OPACITY_UPDATED_AT,
  ]);

  return {
    open_in_new_tab: stored[STORAGE_KEY_OPEN_IN_TAB] ?? false,
    search: {
      enabled: stored[STORAGE_KEY_SEARCH_ENABLED] ?? true,
      engine: stored[STORAGE_KEY_SEARCH_ENGINE] || 'google',
    },
    splash: {
      enabled: stored[STORAGE_KEY_SPLASH_ON] ?? false,
      public_enabled: stored[STORAGE_KEY_SPLASH_PUBLIC_ON] ?? false,
      provider: normalizeSplashProvider(stored[STORAGE_KEY_SPLASH_PROVIDER]),
      query: stored[STORAGE_KEY_SPLASH_QUERY] || '',
      opacity: normalizeSplashOpacity(stored[STORAGE_KEY_SPLASH_OPACITY] ?? 1),
      opacity_updated_at: Number(stored[STORAGE_KEY_SPLASH_OPACITY_UPDATED_AT]) || 0,
      unsplash_access_key: stored[STORAGE_KEY_SPLASH_UNSPLASH_KEY] || '',
      cached_url: stored[STORAGE_KEY_SPLASH_PUBLIC_URL] || '',
      cached_at: Number(stored[STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH]) || 0,
    },
  };
}

async function syncSettingsToServerIfEnabled() {
  const syncConfig = await getSyncConfig();
  if (!(syncConfig.mode === 'server' && syncConfig.serverUrl && syncConfig.apiKey && syncConfig.username && syncConfig.password)) {
    return;
  }
  const latestState = await getLatestLocalStateForSync();
  const settingsPayload = await buildSyncSettingsPayload();
  const profilesPayload = buildServerProfilesPayload(latestState);
  try {
    const syncedAt = Date.now();
    await pushStateToServer(syncConfig, latestState, settingsPayload);
    await saveLastSyncedSnapshotHash(buildSyncPayloadHash(profilesPayload, settingsPayload));
    await recordLastSyncSuccess(syncedAt);
    setSyncStatus(buildSyncSuccessMessage('Settings synced', syncedAt), 'ok');
  } catch (err) {
    setSyncStatus(`Sync failed: ${err.message}`, 'err');
  }
}

async function forceSyncNow() {
  debug('forceSyncNow called');
  const draft = getDraftSyncConfigFromInputs();
  if (draft.mode !== 'server') {
    debug('Not in server mode');
    setSyncStatus('Switch mode to "Sync to server" to force sync.', 'err');
    return;
  }
  if (!draft.serverUrl) {
    debug('Missing server URL');
    setSyncStatus('Enter a valid server URL to force sync.', 'err');
    return;
  }
  if (!draft.apiKey || !draft.username || !draft.password) {
    debug('Missing sync credentials');
    setSyncStatus('API key, username, and password are required for force sync.', 'err');
    return;
  }

  const btn = document.getElementById('btn-sync-force');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.classList.add('btn-syncing');
  btn.textContent = '⟳ Syncing...';

  debug('Starting force sync', { server: draft.serverUrl });
  setSyncStatus('Force sync in progress...', 'ok');
  try {
    const syncedAt = Date.now();
    let latestState = await getLatestLocalStateForSync();
    const settingsPayload = await buildSyncSettingsPayload();
    const localProfilesPayload = buildServerProfilesPayload(latestState);
    let localHash = buildSyncPayloadHash(localProfilesPayload, settingsPayload);

    const serverBundle = await fetchServerSyncBundle(draft);
    const serverProfilesPayload = buildServerProfilesPayloadFromServerBundle(serverBundle.profiles);
    const serverHash = buildSyncPayloadHash(serverProfilesPayload, serverBundle.settings || {});
    const stored = await chromeGet([STORAGE_KEY_SYNC_LAST_SNAPSHOT_HASH]);
    const lastHash = stored[STORAGE_KEY_SYNC_LAST_SNAPSHOT_HASH] || '';

    const localChangedSinceLast = !!lastHash && localHash !== lastHash;
    const serverChangedSinceLast = !!lastHash && serverHash !== lastHash;
    const divergentNow = localHash !== serverHash;
    const trueConflict = localChangedSinceLast && serverChangedSinceLast && divergentNow;
    const possibleFirstSyncConflict = !lastHash && divergentNow && serverProfilesPayload.length > 0;

    const onlyLocalChanged = localChangedSinceLast && !serverChangedSinceLast && divergentNow;
    const onlyServerChanged = serverChangedSinceLast && !localChangedSinceLast && divergentNow;

    if (trueConflict || possibleFirstSyncConflict) {
      debug('Conflict detected', { trueConflict, possibleFirstSyncConflict });
      const result = await showSyncConflictDialog(trueConflict);
      
      if (!result) {
        debug('Force sync cancelled by user');
        setSyncStatus('Force sync cancelled due to conflict.', 'err');
        btn.disabled = false;
        btn.classList.remove('btn-syncing');
        btn.textContent = originalText;
        return;
      }

      debug('User selected sync strategy', { strategy: result.strategy, precedence: result.precedence });

      try {
        if (result.strategy === 'push') {
          debug('Pushing to server (overwrite server with local)...');
          await pushStateToServer(draft, latestState, settingsPayload);
          localHash = buildSyncPayloadHash(buildServerProfilesPayload(latestState), settingsPayload);
        } else if (result.strategy === 'pull') {
          debug('Pulling from server (overwrite local with server)...');
          const serverState = await pullStateFromServer(draft);
          await chrome.storage.local.set({ [STORAGE_KEY_STATE]: serverState });
          latestState = serverState;
          localHash = buildSyncPayloadHash(buildServerProfilesPayload(serverState), settingsPayload);
        } else if (result.strategy === 'merge') {
          debug('Merging from server...');
          const mergedState = await mergeStateFromServer(draft, latestState, result.precedence);
          await chrome.storage.local.set({ [STORAGE_KEY_STATE]: mergedState });
          latestState = mergedState;
          // Rebuild payload with merged data
          const mergedProfilesPayload = buildServerProfilesPayload(mergedState);
          await pushStateToServer(draft, mergedState, settingsPayload);
          localHash = buildSyncPayloadHash(mergedProfilesPayload, settingsPayload);
        }
      } catch (err) {
        debug(`Sync ${result.strategy} failed:`, err.message);
        setSyncStatus(`Sync failed: ${err.message}`, 'err');
        btn.disabled = false;
        btn.classList.remove('btn-syncing');
        btn.textContent = originalText;
        return;
      }
    } else if (onlyServerChanged) {
      debug('Only server changed since last sync; pulling latest server state...');
      const serverState = await pullStateFromServer(draft);
      await chrome.storage.local.set({ [STORAGE_KEY_STATE]: serverState });
      latestState = serverState;
      localHash = buildSyncPayloadHash(buildServerProfilesPayload(serverState), settingsPayload);
    } else if (onlyLocalChanged) {
      debug('Only local changed since last sync; pushing local state...');
      await pushStateToServer(draft, latestState, settingsPayload);
      localHash = buildSyncPayloadHash(buildServerProfilesPayload(latestState), settingsPayload);
    } else {
      debug('No divergence relative to baseline; normalizing server with local state.');
      await pushStateToServer(draft, latestState, settingsPayload);
      localHash = buildSyncPayloadHash(buildServerProfilesPayload(latestState), settingsPayload);
    }

    await saveLastSyncedSnapshotHash(localHash);
    await recordLastSyncSuccess(syncedAt);
    debug('Force sync completed successfully');
    setSyncStatus(buildSyncSuccessMessage('Force sync completed', syncedAt), 'ok');
  } catch (err) {
    debug('Force sync error:', err.message);
    setSyncStatus(`Force sync failed: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.classList.remove('btn-syncing');
    btn.textContent = originalText;
  }
}

async function pullStateFromServer(syncConfig) {
  debug('Pulling state from server...');
  const serverBundle = await fetchServerSyncBundle(syncConfig);
  const serverProfilesPayload = buildServerProfilesPayloadFromServerBundle(serverBundle.profiles);
  
  // Convert server payload back to local state format
  const newState = {
    profiles: serverProfilesPayload.map(profile => ({
      id: profile.id,
      name: profile.name,
      position: profile.position,
      properties: parsePossiblyJsonObject(profile.properties_json, {}),
      dials: profile.dials.map(dial => {
        const dialSettings = parsePossiblyJsonObject(dial.settings_json, {});
        if (dialSettings._type === 'folder') {
          const rawItems = Array.isArray(dialSettings._items) ? dialSettings._items : [];
          return {
            id: dial.id,
            type: 'folder',
            title: dial.title,
            position: dial.position,
            icon_data: typeof dialSettings.icon_data === 'string' ? dialSettings.icon_data : null,
            icon_bg: typeof dialSettings.icon_bg === 'string' ? dialSettings.icon_bg : null,
            items: rawItems.map(item => ({
              id: String(item.id || ''),
              title: String(item.title || ''),
              url: String(item.url || ''),
              icon_data: typeof item.icon_data === 'string' ? item.icon_data : null,
              icon_bg: typeof item.icon_bg === 'string' ? item.icon_bg : null,
            })),
            settings: Object.fromEntries(Object.entries(dialSettings).filter(([k]) => !k.startsWith('_') && k !== 'icon_data' && k !== 'icon_bg')),
          };
        }
        return {
          id: dial.id,
          title: dial.title,
          url: dial.url,
          position: dial.position,
          icon_data: typeof dialSettings.icon_data === 'string' ? dialSettings.icon_data : null,
          icon_bg: typeof dialSettings.icon_bg === 'string' ? dialSettings.icon_bg : null,
          settings: dialSettings,
        };
      }),
    })),
  };
  
  return newState;
}

async function mergeStateFromServer(syncConfig, localState, precedence = 'local') {
  debug('Merging state from server...', { precedence });
  const serverBundle = await fetchServerSyncBundle(syncConfig);
  const serverProfilesPayload = buildServerProfilesPayloadFromServerBundle(serverBundle.profiles);
  
  // Convert server profiles to local format
  const serverProfiles = serverProfilesPayload.map(profile => ({
    id: profile.id,
    name: profile.name,
    position: profile.position,
    properties: parsePossiblyJsonObject(profile.properties_json, {}),
    dials: profile.dials.map(dial => {
      const dialSettings = parsePossiblyJsonObject(dial.settings_json, {});
      if (dialSettings._type === 'folder') {
        const rawItems = Array.isArray(dialSettings._items) ? dialSettings._items : [];
        return {
          id: dial.id,
          type: 'folder',
          title: dial.title,
          position: dial.position,
          icon_data: typeof dialSettings.icon_data === 'string' ? dialSettings.icon_data : null,
          icon_bg: typeof dialSettings.icon_bg === 'string' ? dialSettings.icon_bg : null,
          items: rawItems.map(item => ({
            id: String(item.id || ''),
            title: String(item.title || ''),
            url: String(item.url || ''),
            icon_data: typeof item.icon_data === 'string' ? item.icon_data : null,
            icon_bg: typeof item.icon_bg === 'string' ? item.icon_bg : null,
          })),
          settings: Object.fromEntries(Object.entries(dialSettings).filter(([k]) => !k.startsWith('_') && k !== 'icon_data' && k !== 'icon_bg')),
        };
      }
      return {
        id: dial.id,
        title: dial.title,
        url: dial.url,
        position: dial.position,
        icon_data: typeof dialSettings.icon_data === 'string' ? dialSettings.icon_data : null,
        icon_bg: typeof dialSettings.icon_bg === 'string' ? dialSettings.icon_bg : null,
        settings: dialSettings,
      };
    }),
  }));

  // Create a map of local profiles by ID for quick lookup
  const localProfilesMap = new Map();
  const localDialsMap = new Map(); // dial.id -> { profile, dial }
  
  (localState.profiles || []).forEach(profile => {
    localProfilesMap.set(profile.id, profile);
    (profile.dials || []).forEach(dial => {
      localDialsMap.set(dial.id, { profile, dial });
    });
  });

  // Start with local profiles
  const mergedProfiles = [];
  const processedProfileIds = new Set();

  // Process all profiles from local state
  (localState.profiles || []).forEach(localProfile => {
    processedProfileIds.add(localProfile.id);
    const serverProfile = serverProfiles.find(p => p.id === localProfile.id);
    
    if (!serverProfile) {
      // Profile only exists locally, keep it
      mergedProfiles.push({ ...localProfile });
    } else {
      // Profile exists on both sides, merge dials
      const mergedDials = [];
      const processedDialIds = new Set();

      // Process all dials from local profile
      (localProfile.dials || []).forEach(localDial => {
        processedDialIds.add(localDial.id);
        const serverDial = serverProfile.dials.find(d => d.id === localDial.id);
        
        if (!serverDial) {
          // Dial only exists locally, keep it
          mergedDials.push({ ...localDial });
        } else {
          // Dial exists on both sides, use precedence to decide
          const dialToUse = precedence === 'server' ? serverDial : localDial;
          mergedDials.push({ ...dialToUse });
        }
      });

      // Add server dials that don't exist locally (never delete)
      (serverProfile.dials || []).forEach(serverDial => {
        if (!processedDialIds.has(serverDial.id)) {
          mergedDials.push({ ...serverDial });
        }
      });

      // Sort by position
      mergedDials.sort((a, b) => {
        const posA = Number.isInteger(a.position) ? a.position : 0;
        const posB = Number.isInteger(b.position) ? b.position : 0;
        return posA - posB;
      });

      mergedProfiles.push({
        ...localProfile,
        name: precedence === 'server' ? serverProfile.name : localProfile.name,
        properties: precedence === 'server'
          ? { ...serverProfile.properties }
          : { ...localProfile.properties },
        dials: mergedDials,
      });
    }
  });

  // Add server profiles that don't exist locally (never delete)
  serverProfiles.forEach(serverProfile => {
    if (!processedProfileIds.has(serverProfile.id)) {
      mergedProfiles.push({ ...serverProfile });
    }
  });

  // Sort by position
  mergedProfiles.sort((a, b) => {
    const posA = Number.isInteger(a.position) ? a.position : 0;
    const posB = Number.isInteger(b.position) ? b.position : 0;
    return posA - posB;
  });

  return { profiles: mergedProfiles };
}

async function showSyncConflictDialog(trueConflict) {
  return new Promise((resolve) => {
    const modal = document.getElementById('sync-conflict-modal');
    const description = document.getElementById('conflict-description');
    const cancelBtn = document.getElementById('btn-conflict-cancel');
    const proceedBtn = document.getElementById('btn-conflict-proceed');
    const strategyRadios = Array.from(document.querySelectorAll('input[name="sync-strategy"]'));
    const mergeOptions = document.querySelector('.merge-options');
    const mergeSelect = document.getElementById('merge-precedence');

    // Set description based on conflict type
    description.textContent = trueConflict
      ? 'Both your local dials and the server data have changed since the last sync. Choose how you want to handle this:'
      : 'The server has data that differs from your local dials, but the sync baseline is empty or missing. Choose an action:';

    const updateMergeOptionsVisibility = () => {
      const selectedStrategy = document.querySelector('input[name="sync-strategy"]:checked')?.value;
      const isMerge = selectedStrategy === 'merge';
      mergeOptions.style.display = isMerge ? 'block' : 'none';
      mergeSelect.disabled = !isMerge;
    };

    strategyRadios.forEach(radio => {
      radio.addEventListener('change', updateMergeOptionsVisibility);
    });
    updateMergeOptionsVisibility();

    const handleClose = (syncStrategy) => {
      modal.classList.add('modal--hidden');
      cancelBtn.removeEventListener('click', handleCancel);
      proceedBtn.removeEventListener('click', handleProceed);
      strategyRadios.forEach(radio => {
        radio.removeEventListener('change', updateMergeOptionsVisibility);
      });
      resolve(syncStrategy);
    };

    const handleCancel = () => handleClose(null);
    const handleProceed = () => {
      const selectedStrategy = document.querySelector('input[name="sync-strategy"]:checked')?.value;
      const precedence = document.getElementById('merge-precedence')?.value || 'local';
      handleClose({ strategy: selectedStrategy, precedence });
    };

    cancelBtn.addEventListener('click', handleCancel);
    proceedBtn.addEventListener('click', handleProceed);

    // Show modal
    modal.classList.remove('modal--hidden');
  });
}

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
    STORAGE_KEY_SYNC_LAST_SUCCESS_AT,
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
    STORAGE_KEY_SPLASH_OPACITY,
    STORAGE_KEY_SPLASH_UNSPLASH_KEY,
  ]);

  state = stored[STORAGE_KEY_STATE] || { profiles: [] };
  document.getElementById('pref-new-tab').checked = stored[STORAGE_KEY_OPEN_IN_TAB] ?? false;
  document.getElementById('sync-mode').value = stored[STORAGE_KEY_SYNC_MODE] || 'local';
  document.getElementById('sync-server-url').value = stored[STORAGE_KEY_SYNC_SERVER_URL] || '';
  document.getElementById('sync-api-key').value = stored[STORAGE_KEY_SYNC_API_KEY] || '';
  document.getElementById('sync-username').value = stored[STORAGE_KEY_SYNC_USERNAME] || '';
  document.getElementById('sync-password').value = stored[STORAGE_KEY_SYNC_PASSWORD] || '';
  updateLastSyncLabel(Number(stored[STORAGE_KEY_SYNC_LAST_SUCCESS_AT]) || 0);
  document.getElementById('sync-auth-view').value = stored[STORAGE_KEY_SYNC_AUTH_VIEW] || 'login';
  syncLoggedIn = stored[STORAGE_KEY_SYNC_LOGGED_IN] ?? false;
  syncLoggedUser = stored[STORAGE_KEY_SYNC_LOGGED_USER] || '';
  document.getElementById('pref-search-enabled').checked = stored[STORAGE_KEY_SEARCH_ENABLED] ?? true;
  document.getElementById('pref-search-engine').value = stored[STORAGE_KEY_SEARCH_ENGINE] || 'google';
  document.getElementById('pref-splash-enabled').checked = stored[STORAGE_KEY_SPLASH_ON] ?? false;
  document.getElementById('pref-splash-public').checked = stored[STORAGE_KEY_SPLASH_PUBLIC_ON] ?? false;
  document.getElementById('splash-provider').value = normalizeSplashProvider(stored[STORAGE_KEY_SPLASH_PROVIDER]);
  document.getElementById('splash-query').value = stored[STORAGE_KEY_SPLASH_QUERY] || '';
  const splashOpacity = normalizeSplashOpacity(stored[STORAGE_KEY_SPLASH_OPACITY] ?? 1);
  document.getElementById('splash-opacity').value = String(splashOpacity);
  updateSplashOpacityLabel(splashOpacity);
  document.getElementById('splash-unsplash-key').value = stored[STORAGE_KEY_SPLASH_UNSPLASH_KEY] || '';

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

    const gridWrap = document.createElement('label');
    gridWrap.className = 'item-grid-setting';
    gridWrap.textContent = 'Grid';
    const gridSelect = document.createElement('select');
    gridSelect.className = 'item-grid-select';
    const autoOpt = document.createElement('option');
    autoOpt.value = '';
    autoOpt.textContent = 'Auto';
    gridSelect.appendChild(autoOpt);
    for (let n = 3; n <= 10; n += 1) {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = String(n);
      gridSelect.appendChild(opt);
    }
    const profileGrid = getProfileGridColumns(profile);
    gridSelect.value = profileGrid !== null ? String(profileGrid) : '';
    gridSelect.addEventListener('change', async () => {
      setProfileGridColumns(profile, gridSelect.value);
      await saveState();
      renderProfiles();
    });
    gridWrap.appendChild(gridSelect);

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
    li.appendChild(gridWrap);
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
    properties: {},
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
  debug('saveSyncSettings called');
  const mode = document.getElementById('sync-mode').value;
  const rawUrl = document.getElementById('sync-server-url').value.trim();
  const apiKey = document.getElementById('sync-api-key').value.trim();
  const username = document.getElementById('sync-username').value.trim();
  const password = document.getElementById('sync-password').value;

  let normalizedUrl = '';
  if (mode === 'server') {
    debug('Server mode - validating settings');
    if (!rawUrl || !apiKey || !username || !password) {
      debug('Missing required credentials');
      setSyncStatus('Server URL, API key, username, and password are required for server mode.', 'err');
      return;
    }
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('bad protocol');
      }
      normalizedUrl = parsed.origin;
      debug('Server URL validated:', normalizedUrl);
    } catch {
      debug('Invalid server URL');
      setSyncStatus('Enter a valid server URL.', 'err');
      return;
    }
  } else {
    debug('Switching to local mode');
  }

  debug('Saving sync settings to storage');
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
    debug('Testing server connection...');
    setSyncStatus('Sync settings saved. Testing connection...', 'ok');
    await testSyncConnection();
    return;
  }

  syncLoggedIn = false;
  syncLoggedUser = '';
  debug('Cleared sync login state');
  await chrome.storage.local.set({
    [STORAGE_KEY_SYNC_LOGGED_IN]: false,
    [STORAGE_KEY_SYNC_LOGGED_USER]: '',
  });
  updateLoginStateUi();
  updateSyncControlState();
  debug('Sync settings saved in local mode');
  setSyncStatus('Sync settings saved (local mode).', 'ok');
}

async function testSyncConnection() {
  debug('testSyncConnection called');
  const mode = document.getElementById('sync-mode').value;
  const rawUrl = document.getElementById('sync-server-url').value.trim();
  const apiKey = document.getElementById('sync-api-key').value.trim();
  const username = document.getElementById('sync-username').value.trim();
  const password = document.getElementById('sync-password').value;

  if (mode !== 'server') {
    debug('Not in server mode');
    setSyncStatus('Connection test is only available in server mode.', 'err');
    return;
  }
  if (!rawUrl || !apiKey || !username || !password) {
    debug('Missing connection test credentials');
    setSyncStatus('Enter server URL, API key, username, and password first.', 'err');
    return;
  }

  let baseUrl = '';
  try {
    const parsed = new URL(rawUrl);
    baseUrl = parsed.origin;
    debug('Testing connection to:', baseUrl);
  } catch {
    debug('Invalid URL format');
    setSyncStatus('Enter a valid server URL.', 'err');
    return;
  }

  setSyncStatus('Testing connection...', 'ok');
  try {
    debug('Sending test request...');
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
      properties: (() => {
        const props = normalizeProfileProperties(profile.properties);
        const legacyGrid = normalizeGridColumns(profile.grid_columns);
        if (legacyGrid !== null && props.grid_columns === undefined) {
          props.grid_columns = legacyGrid;
        }
        return props;
      })(),
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
  updateSplashControlState();
  await syncSettingsToServerIfEnabled();
});

document.getElementById('pref-splash-public').addEventListener('change', async e => {
  await chrome.storage.local.set({ [STORAGE_KEY_SPLASH_PUBLIC_ON]: e.target.checked });
  updateSplashControlState();
  await syncSettingsToServerIfEnabled();
});

document.getElementById('splash-provider').addEventListener('change', async e => {
  await chrome.storage.local.set({
    [STORAGE_KEY_SPLASH_PROVIDER]: normalizeSplashProvider(e.target.value),
    [STORAGE_KEY_SPLASH_PUBLIC_URL]: '',
    [STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH]: 0,
    [STORAGE_KEY_SPLASH_REFRESH]: Date.now(),
  });
  updateSplashControlState();
  await syncSettingsToServerIfEnabled();
});

document.getElementById('splash-query').addEventListener('change', async e => {
  await chrome.storage.local.set({
    [STORAGE_KEY_SPLASH_QUERY]: e.target.value.trim(),
    [STORAGE_KEY_SPLASH_PUBLIC_URL]: '',
    [STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH]: 0,
    [STORAGE_KEY_SPLASH_REFRESH]: Date.now(),
  });
  await syncSettingsToServerIfEnabled();
});

document.getElementById('splash-unsplash-key').addEventListener('change', async e => {
  await chrome.storage.local.set({
    [STORAGE_KEY_SPLASH_UNSPLASH_KEY]: e.target.value.trim(),
    [STORAGE_KEY_SPLASH_PUBLIC_URL]: '',
    [STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH]: 0,
    [STORAGE_KEY_SPLASH_REFRESH]: Date.now(),
  });
  await syncSettingsToServerIfEnabled();
});

document.getElementById('splash-opacity').addEventListener('input', e => {
  updateSplashOpacityLabel(e.target.value);
});

document.getElementById('splash-opacity').addEventListener('change', async e => {
  const value = normalizeSplashOpacity(e.target.value);
  document.getElementById('splash-opacity').value = String(value);
  updateSplashOpacityLabel(value);
  await chrome.storage.local.set({
    [STORAGE_KEY_SPLASH_OPACITY]: value,
    [STORAGE_KEY_SPLASH_OPACITY_UPDATED_AT]: Date.now(),
  });
  await syncSettingsToServerIfEnabled();
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
  await syncSettingsToServerIfEnabled();
}

async function clearSplashImage() {
  await chrome.storage.local.remove([STORAGE_KEY_SPLASH_DATA]);
  const preview = document.getElementById('splash-preview');
  preview.src = '';
  preview.classList.add('hidden');
  setSplashStatus('Splash image cleared.', 'ok');
  await syncSettingsToServerIfEnabled();
}

async function refreshPublicSplash() {
  await chrome.storage.local.set({
    [STORAGE_KEY_SPLASH_REFRESH]: Date.now(),
    [STORAGE_KEY_SPLASH_PUBLIC_URL]: '',
    [STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH]: 0,
  });
  setSplashStatus('Requested a fresh public background.', 'ok');
  await syncSettingsToServerIfEnabled();
}

async function saveSplashSettings() {
  const splashEnabled = document.getElementById('pref-splash-enabled').checked;
  const publicEnabled = document.getElementById('pref-splash-public').checked;
  const provider = normalizeSplashProvider(document.getElementById('splash-provider').value);
  const query = document.getElementById('splash-query').value.trim();
  const unsplashKey = document.getElementById('splash-unsplash-key').value.trim();
  const opacity = normalizeSplashOpacity(document.getElementById('splash-opacity').value);

  if (publicEnabled && provider === 'unsplash' && !unsplashKey) {
    setSplashStatus('Unsplash requires an access key.', 'err');
    document.getElementById('splash-unsplash-key').focus();
    return;
  }

  await chrome.storage.local.set({
    [STORAGE_KEY_SPLASH_ON]: splashEnabled,
    [STORAGE_KEY_SPLASH_PUBLIC_ON]: publicEnabled,
    [STORAGE_KEY_SPLASH_PROVIDER]: provider,
    [STORAGE_KEY_SPLASH_QUERY]: query,
    [STORAGE_KEY_SPLASH_UNSPLASH_KEY]: unsplashKey,
    [STORAGE_KEY_SPLASH_OPACITY]: opacity,
    [STORAGE_KEY_SPLASH_OPACITY_UPDATED_AT]: Date.now(),
    [STORAGE_KEY_SPLASH_PUBLIC_URL]: '',
    [STORAGE_KEY_SPLASH_PUBLIC_LAST_FETCH]: 0,
    [STORAGE_KEY_SPLASH_REFRESH]: Date.now(),
  });

  updateSplashOpacityLabel(opacity);
  updateSplashControlState();
  setSplashStatus('Splash settings saved and applied.', 'ok');
  await syncSettingsToServerIfEnabled();
}

function updateSearchControlState() {
  const enabled = document.getElementById('pref-search-enabled').checked;
  document.getElementById('pref-search-engine').disabled = !enabled;
}

function updateSplashControlState() {
  const usingPublic = document.getElementById('pref-splash-public').checked;
  const splashEnabled = document.getElementById('pref-splash-enabled').checked;
  const provider = normalizeSplashProvider(document.getElementById('splash-provider').value);
  const needsUnsplashKey = usingPublic && provider === 'unsplash';
  document.getElementById('splash-provider').disabled = !usingPublic;
  document.getElementById('splash-query').disabled = !usingPublic;
  document.getElementById('splash-opacity').disabled = !splashEnabled;
  document.getElementById('splash-unsplash-key').disabled = !needsUnsplashKey;
  document.getElementById('splash-unsplash-key-field').style.display = needsUnsplashKey ? 'flex' : 'none';
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
  const forceRow = document.getElementById('sync-force-row');
  serverFields.style.display = disabled ? 'none' : 'block';
  document.getElementById('sync-server-url').disabled = disabled;
  document.getElementById('sync-api-key').disabled = disabled;
  document.getElementById('sync-username').disabled = disabled;
  document.getElementById('sync-password').disabled = disabled;
  document.getElementById('btn-sync-test').disabled = disabled;
  document.getElementById('btn-sync-save').disabled = disabled;
  document.getElementById('btn-sync-force').disabled = false;
  document.getElementById('sync-auth-view').disabled = disabled;
  document.getElementById('btn-sync-logout').disabled = disabled || !syncLoggedIn;

  if (disabled) {
    serverUrlRow.style.display = 'none';
    apiKeyRow.style.display = 'none';
    authViewRow.style.display = 'none';
    loginStateRow.style.display = 'none';
    loginActionsRow.style.display = 'none';
    forceRow.style.display = 'flex';
    loginSection.style.display = 'none';
    registerSection.style.display = 'none';
    return;
  }

  forceRow.style.display = 'flex';

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
      const syncedAt = Date.now();
      const latestState = await getLatestLocalStateForSync();
      const settingsPayload = await buildSyncSettingsPayload();
      const profilesPayload = buildServerProfilesPayload(latestState);
      await pushStateToServer(syncConfig, latestState, settingsPayload);
      await saveLastSyncedSnapshotHash(buildSyncPayloadHash(profilesPayload, settingsPayload));
      await recordLastSyncSuccess(syncedAt);
      setSyncStatus(buildSyncSuccessMessage('Sync completed', syncedAt), 'ok');
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

async function getLatestLocalStateForSync() {
  const stored = await chromeGet([STORAGE_KEY_STATE]);
  const latest = stored[STORAGE_KEY_STATE];
  if (latest && typeof latest === 'object' && Array.isArray(latest.profiles)) {
    state = latest;
    return latest;
  }
  return state;
}

function getDraftSyncConfigFromInputs() {
  const mode = document.getElementById('sync-mode').value || 'local';
  const rawUrl = document.getElementById('sync-server-url').value.trim();
  let serverUrl = '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        serverUrl = parsed.origin;
      }
    } catch {
      serverUrl = '';
    }
  }
  return {
    mode,
    serverUrl,
    apiKey: document.getElementById('sync-api-key').value.trim(),
    username: document.getElementById('sync-username').value.trim(),
    password: document.getElementById('sync-password').value,
  };
}

async function pushStateToServer(syncConfig, localState, settingsPayload = {}) {
  const serverProfiles = buildServerProfilesPayload(localState);

  const resp = await fetch(`${syncConfig.serverUrl}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${syncConfig.apiKey}`,
      'X-Sync-User': syncConfig.username,
      'X-Sync-Password': syncConfig.password,
    },
    body: JSON.stringify({
      profiles: serverProfiles,
      settings: settingsPayload,
    }),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

function buildServerProfilesPayload(localState) {
  return (Array.isArray(localState?.profiles) ? localState.profiles : []).map(profile => ({
    id: String(profile.id),
    name: String(profile.name || 'Profile'),
    position: Number.isInteger(profile.position) ? profile.position : 0,
    properties: getProfileProperties(profile),
    properties_json: JSON.stringify(getProfileProperties(profile)),
    dials: (Array.isArray(profile.dials) ? profile.dials : [])
      .filter(dial => dial?.type === 'folder' || (typeof dial?.url === 'string' && dial.url))
      .map((dial, idx) => {
        if (dial?.type === 'folder') {
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

async function fetchServerSyncBundle(syncConfig) {
  const resp = await fetch(`${syncConfig.serverUrl}/api/sync`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${syncConfig.apiKey}`,
      'X-Sync-User': syncConfig.username,
      'X-Sync-Password': syncConfig.password,
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const body = await resp.json();
  if (Array.isArray(body)) {
    return { profiles: body, settings: {} };
  }
  return {
    profiles: Array.isArray(body?.profiles) ? body.profiles : [],
    settings: (body?.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)) ? body.settings : {},
  };
}

function buildServerProfilesPayloadFromServerBundle(serverProfiles) {
  return (Array.isArray(serverProfiles) ? serverProfiles : []).map(profile => {
    const properties = parsePossiblyJsonObject(profile.properties_json, profile.properties);
    const dials = (Array.isArray(profile.dials) ? profile.dials : []).map((dial, idx) => {
      const dialSettings = parsePossiblyJsonObject(dial.settings_json, dial.settings);
      if (typeof dial.icon_bg === 'string' && dial.icon_bg) {
        dialSettings.icon_bg = dial.icon_bg;
      }
      return {
        id: String(dial.id),
        title: String(dial.title || ''),
        url: String(dial.url || ''),
        position: Number.isInteger(dial.position) ? dial.position : idx,
        settings_json: JSON.stringify(dialSettings),
      };
    });
    return {
      id: String(profile.id),
      name: String(profile.name || 'Profile'),
      position: Number.isInteger(profile.position) ? profile.position : 0,
      properties_json: JSON.stringify(properties),
      dials,
    };
  });
}

function parsePossiblyJsonObject(jsonText, rawObj) {
  let merged = (rawObj && typeof rawObj === 'object' && !Array.isArray(rawObj)) ? { ...rawObj } : {};
  if (typeof jsonText === 'string' && jsonText.trim()) {
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        merged = { ...merged, ...parsed };
      }
    } catch {
      // Ignore malformed JSON and keep other values.
    }
  }
  return merged;
}

function buildSyncPayloadHash(profilesPayload, settingsPayload) {
  const canonical = {
    profiles: (Array.isArray(profilesPayload) ? profilesPayload : [])
      .map(profile => ({
        id: String(profile.id || ''),
        name: String(profile.name || ''),
        position: Number.isInteger(profile.position) ? profile.position : 0,
        properties: parsePossiblyJsonObject(profile.properties_json, profile.properties),
        dials: (Array.isArray(profile.dials) ? profile.dials : [])
          .map((dial, idx) => ({
            id: String(dial.id || ''),
            title: String(dial.title || ''),
            url: String(dial.url || ''),
            position: Number.isInteger(dial.position) ? dial.position : idx,
            settings: parsePossiblyJsonObject(dial.settings_json, dial.settings),
          }))
          .sort((a, b) => a.id.localeCompare(b.id) || a.position - b.position),
      }))
      .sort((a, b) => a.id.localeCompare(b.id) || a.position - b.position),
    settings: parsePossiblyJsonObject('', settingsPayload),
  };
  return stableStringify(canonical);
}

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function saveLastSyncedSnapshotHash(hash) {
  await chrome.storage.local.set({ [STORAGE_KEY_SYNC_LAST_SNAPSHOT_HASH]: hash });
}

function buildDialSettingsPayload(dial) {
  const payload = (dial?.settings && typeof dial.settings === 'object' && !Array.isArray(dial.settings))
    ? { ...dial.settings }
    : {};
  if (typeof dial?.icon_data === 'string' && dial.icon_data) {
    payload.icon_data = dial.icon_data;
  }
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

function buildSyncSuccessMessage(prefix, syncedAt = Date.now()) {
  const nowLabel = new Date(syncedAt).toLocaleTimeString();
  return `${prefix} at ${nowLabel}`;
}

function updateLastSyncLabel(timestamp) {
  const el = document.getElementById('sync-last-success');
  if (!el) return;
  if (!timestamp) {
    el.textContent = 'Last sync: Never';
    return;
  }
  const dt = new Date(timestamp);
  el.textContent = `Last sync: ${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}`;
}

async function recordLastSyncSuccess(timestamp) {
  await chrome.storage.local.set({ [STORAGE_KEY_SYNC_LAST_SUCCESS_AT]: timestamp });
  updateLastSyncLabel(timestamp);
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

document.getElementById('btn-splash-save').addEventListener('click', () => {
  saveSplashSettings().catch(err => setSplashStatus(err.message, 'err'));
});

document.getElementById('btn-sync-save').addEventListener('click', () => {
  saveSyncSettings().catch(err => setSyncStatus(err.message, 'err'));
});

document.getElementById('btn-sync-test').addEventListener('click', () => {
  testSyncConnection().catch(err => setSyncStatus(err.message, 'err'));
});

document.getElementById('btn-sync-force').addEventListener('click', () => {
  forceSyncNow().catch(err => setSyncStatus(err.message, 'err'));
});

document.getElementById('btn-register-account').addEventListener('click', () => {
  registerAccount().catch(err => setSyncStatus(err.message, 'err'));
});

document.getElementById('new-profile-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') addProfile();
});
