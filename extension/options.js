'use strict';

const STORAGE_KEY_STATE       = 'dials_state';
const STORAGE_KEY_ACTIVE      = 'active_profile_id';
const STORAGE_KEY_OPEN_IN_TAB = 'open_in_new_tab';
const STORAGE_KEY_SEARCH_ENABLED = 'search_enabled';
const STORAGE_KEY_SEARCH_ENGINE  = 'search_engine';
const STORAGE_KEY_SPLASH_DATA = 'splash_bg_data';
const STORAGE_KEY_SPLASH_ON   = 'splash_bg_enabled';
const STORAGE_KEY_SPLASH_PUBLIC_ON = 'splash_public_enabled';
const STORAGE_KEY_SPLASH_PROVIDER  = 'splash_public_provider';
const STORAGE_KEY_SPLASH_QUERY     = 'splash_public_query';
const STORAGE_KEY_SPLASH_REFRESH   = 'splash_public_refresh';

let state = { profiles: [] };

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chromeGet([
    STORAGE_KEY_STATE,
    STORAGE_KEY_OPEN_IN_TAB,
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
    const li    = document.createElement('li');
    const name  = document.createElement('span');
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
  const input   = document.getElementById('new-profile-name');
  const name    = input.value.trim();
  if (!name) { input.focus(); return; }

  const newProfile = {
    id:       uuid(),
    name,
    position: state.profiles.length,
    dials:    [],
  };
  state.profiles.push(newProfile);
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
        items: dial.type === 'folder'
          ? (Array.isArray(dial.items) ? dial.items : []).map(item => ({
              id: String(item.id || crypto.randomUUID()),
              title: String(item.title || ''),
              url: String(item.url || 'https://example.com'),
              icon_data: typeof item.icon_data === 'string' ? item.icon_data : null,
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function saveState() {
  await chrome.storage.local.set({ [STORAGE_KEY_STATE]: state });
}

function setBackupStatus(msg, type) {
  const el  = document.getElementById('backup-status');
  el.textContent = msg;
  el.className   = type;
}

function setSplashStatus(msg, type) {
  const el  = document.getElementById('splash-status');
  el.textContent = msg;
  el.className   = type;
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
  if (file) {
    importJson(file);
  }
  e.target.value = '';
});

document.getElementById('btn-splash-upload').addEventListener('click', () => {
  document.getElementById('splash-file').click();
});

document.getElementById('splash-file').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (file) {
    uploadSplashImage(file).catch(err => setSplashStatus(err.message, 'err'));
  }
  e.target.value = '';
});

document.getElementById('btn-splash-clear').addEventListener('click', () => {
  clearSplashImage().catch(err => setSplashStatus(err.message, 'err'));
});

document.getElementById('btn-splash-refresh').addEventListener('click', () => {
  refreshPublicSplash().catch(err => setSplashStatus(err.message, 'err'));
});

document.getElementById('new-profile-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') addProfile();
});
