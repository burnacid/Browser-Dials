'use strict';

const STORAGE_KEY_STATE = 'dials_state';
const STORAGE_KEY_ACTIVE = 'active_profile_id';

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sortProfiles(profiles) {
  return [...profiles].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.name || '').localeCompare(String(b.name || '')));
}

function setStatus(message, tone = '') {
  const el = document.getElementById('status');
  el.textContent = message;
  el.classList.remove('ok', 'err');
  if (tone) el.classList.add(tone);
}

function setUrlHint(message, tone = '') {
  const el = document.getElementById('url-hint');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('ok', 'err');
  if (tone) el.classList.add(tone);
}

function setAddButtonEnabled(enabled) {
  const btn = document.getElementById('btn-add');
  if (!(btn instanceof HTMLButtonElement)) return;
  btn.disabled = !enabled;
}

function updateUrlValidationUi() {
  const urlInput = document.getElementById('dial-url');
  if (!(urlInput instanceof HTMLInputElement)) return false;

  const raw = urlInput.value.trim();
  const cleanUrl = normalizeHttpUrl(raw);

  if (!raw) {
    setUrlHint('Enter an http or https URL.', '');
    urlInput.setCustomValidity('');
    setAddButtonEnabled(false);
    return false;
  }

  if (!cleanUrl) {
    setUrlHint('Use a valid http or https URL.', 'err');
    urlInput.setCustomValidity('Please enter a valid http or https URL.');
    setAddButtonEnabled(false);
    return false;
  }

  setUrlHint('URL looks good.', 'ok');
  urlInput.setCustomValidity('');
  setAddButtonEnabled(true);
  return true;
}

function normalizeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const prepared = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(prepared);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function populateProfileSelect(profiles, activeProfileId) {
  const select = document.getElementById('profile-select');
  select.innerHTML = '';

  const ordered = sortProfiles(profiles);
  for (const profile of ordered) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name || 'Profile';
    select.appendChild(option);
  }

  if (ordered.length > 0) {
    const fallback = ordered[0].id;
    select.value = activeProfileId && ordered.some(p => p.id === activeProfileId) ? activeProfileId : fallback;
  }
}

async function initialize() {
  const [stored, tab] = await Promise.all([
    chrome.storage.local.get([STORAGE_KEY_STATE, STORAGE_KEY_ACTIVE]),
    getActiveTab(),
  ]);

  let state = stored[STORAGE_KEY_STATE] || { profiles: [] };
  let activeProfileId = stored[STORAGE_KEY_ACTIVE] || null;

  if (!Array.isArray(state.profiles)) state.profiles = [];

  if (state.profiles.length === 0) {
    const profile = {
      id: uuid(),
      name: 'Default',
      position: 0,
      properties: {},
      dials: [],
    };
    state.profiles.push(profile);
    activeProfileId = profile.id;
    await chrome.storage.local.set({
      [STORAGE_KEY_STATE]: state,
      [STORAGE_KEY_ACTIVE]: activeProfileId,
    });
  }

  populateProfileSelect(state.profiles, activeProfileId);

  const titleInput = document.getElementById('dial-title');
  const urlInput = document.getElementById('dial-url');

  const tabTitle = tab?.title || '';
  const tabUrl = normalizeHttpUrl(tab?.url || '') || '';

  titleInput.value = tabTitle;
  urlInput.value = tabUrl;

  urlInput.addEventListener('input', () => {
    updateUrlValidationUi();
  });

  urlInput.addEventListener('blur', () => {
    updateUrlValidationUi();
  });

  updateUrlValidationUi();

  if (!tabUrl) {
    setStatus('Current tab URL is not addable (non-http/https).', 'err');
  }
}

async function addCurrentTabDial(event) {
  event.preventDefault();

  const titleInput = document.getElementById('dial-title');
  const urlInput = document.getElementById('dial-url');
  const profileSelect = document.getElementById('profile-select');

  const title = titleInput.value.trim();
  const cleanUrl = normalizeHttpUrl(urlInput.value);

  if (!cleanUrl || !updateUrlValidationUi()) {
    setStatus('Please enter a valid http/https URL.', 'err');
    urlInput.reportValidity();
    urlInput.focus();
    return;
  }

  const stored = await chrome.storage.local.get([STORAGE_KEY_STATE, STORAGE_KEY_ACTIVE]);
  const state = stored[STORAGE_KEY_STATE] || { profiles: [] };
  const profiles = Array.isArray(state.profiles) ? state.profiles : [];

  if (profiles.length === 0) {
    setStatus('No profile found. Open Settings and create one.', 'err');
    return;
  }

  const targetProfile = profiles.find(p => p.id === profileSelect.value) || profiles[0];
  if (!Array.isArray(targetProfile.dials)) targetProfile.dials = [];

  const maxPos = targetProfile.dials.reduce((acc, dial) => {
    const pos = Number.isInteger(dial?.position) ? dial.position : -1;
    return Math.max(acc, pos);
  }, -1);

  targetProfile.dials.push({
    id: uuid(),
    profile_id: targetProfile.id,
    type: 'dial',
    title: title || new URL(cleanUrl).hostname,
    url: cleanUrl,
    position: maxPos + 1,
    icon_data: null,
    icon_bg: null,
  });

  await chrome.storage.local.set({ [STORAGE_KEY_STATE]: state });
  setStatus(`Added to ${targetProfile.name}.`, 'ok');

  setTimeout(() => {
    window.close();
  }, 500);
}

document.getElementById('add-tab-form').addEventListener('submit', e => {
  void addCurrentTabDial(e);
});

document.getElementById('btn-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.addEventListener('DOMContentLoaded', () => {
  void initialize();
});
