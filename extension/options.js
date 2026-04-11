'use strict';

const STORAGE_KEY_STATE       = 'dials_state';
const STORAGE_KEY_ACTIVE      = 'active_profile_id';
const STORAGE_KEY_OPEN_IN_TAB = 'open_in_new_tab';

let state = { profiles: [] };

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chromeGet([
    STORAGE_KEY_STATE,
    STORAGE_KEY_OPEN_IN_TAB,
  ]);

  state = stored[STORAGE_KEY_STATE] || { profiles: [] };
  document.getElementById('pref-new-tab').checked = stored[STORAGE_KEY_OPEN_IN_TAB] ?? false;

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
        title: String(dial.title || ''),
        url: String(dial.url || 'https://example.com'),
        position: Number.isInteger(dial.position) ? dial.position : dIdx,
        icon_data: typeof dial.icon_data === 'string' ? dial.icon_data : null,
      })),
    };
  });
  return { profiles };
}

// ─── Preferences ─────────────────────────────────────────────────────────────
document.getElementById('pref-new-tab').addEventListener('change', async e => {
  await chrome.storage.local.set({ [STORAGE_KEY_OPEN_IN_TAB]: e.target.checked });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function saveState() {
  await chrome.storage.local.set({ [STORAGE_KEY_STATE]: state });
}

function setBackupStatus(msg, type) {
  const el  = document.getElementById('backup-status');
  el.textContent = msg;
  el.className   = type;
}

function uuid() {
  return crypto.randomUUID();
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

document.getElementById('new-profile-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') addProfile();
});
