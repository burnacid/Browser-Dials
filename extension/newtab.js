'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────
const STORAGE_KEY_STATE       = 'dials_state';      // { profiles: […] }
const STORAGE_KEY_ACTIVE      = 'active_profile_id';
const STORAGE_KEY_OPEN_IN_TAB = 'open_in_new_tab';
const STORAGE_KEY_SPLASH_DATA = 'splash_bg_data';
const STORAGE_KEY_SPLASH_ON   = 'splash_bg_enabled';
const STORAGE_KEY_SPLASH_PUBLIC_ON = 'splash_public_enabled';
const STORAGE_KEY_SPLASH_PROVIDER  = 'splash_public_provider';
const STORAGE_KEY_SPLASH_QUERY     = 'splash_public_query';
const STORAGE_KEY_SPLASH_REFRESH   = 'splash_public_refresh';

// Letter-avatar palette (colour per first letter)
const AVATAR_COLOURS = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6',
  '#3b82f6','#8b5cf6','#ec4899','#6366f1','#0ea5e9',
];

// ─── State ────────────────────────────────────────────────────────────────────
let state = { profiles: [] };  // { profiles: [{ id, name, position, dials: [] }] }
let activeProfileId = null;
let openInNewTab = false;
let splashData = '';
let splashOn   = false;
let splashPublicOn = false;
let splashProvider = 'picsum';
let splashQuery = '';
let splashRefreshToken = 0;

// Modal edit context
let editingDialId  = null;   // null → adding new dial
let pendingIconData = null;  // data URL for icon selected in the modal

// ─── Startup ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chromeGet([
    STORAGE_KEY_STATE,
    STORAGE_KEY_ACTIVE,
    STORAGE_KEY_OPEN_IN_TAB,
    STORAGE_KEY_SPLASH_DATA,
    STORAGE_KEY_SPLASH_ON,
    STORAGE_KEY_SPLASH_PUBLIC_ON,
    STORAGE_KEY_SPLASH_PROVIDER,
    STORAGE_KEY_SPLASH_QUERY,
    STORAGE_KEY_SPLASH_REFRESH,
  ]);

  state         = stored[STORAGE_KEY_STATE]       || { profiles: [] };
  activeProfileId = stored[STORAGE_KEY_ACTIVE]    || null;
  openInNewTab  = stored[STORAGE_KEY_OPEN_IN_TAB] ?? false;
  splashData    = stored[STORAGE_KEY_SPLASH_DATA] || '';
  splashOn      = stored[STORAGE_KEY_SPLASH_ON] ?? false;
  splashPublicOn = stored[STORAGE_KEY_SPLASH_PUBLIC_ON] ?? false;
  splashProvider = stored[STORAGE_KEY_SPLASH_PROVIDER] || 'picsum';
  splashQuery = stored[STORAGE_KEY_SPLASH_QUERY] || '';
  splashRefreshToken = stored[STORAGE_KEY_SPLASH_REFRESH] || 0;

  // Default to first profile if active not found
  if (!state.profiles.find(p => p.id === activeProfileId)) {
    activeProfileId = state.profiles[0]?.id ?? null;
  }

  renderAll();
  applySplashBackground();
  setSyncStatus('Local only');
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
  if (changes[STORAGE_KEY_SPLASH_DATA]) {
    splashData = changes[STORAGE_KEY_SPLASH_DATA].newValue || '';
    applySplashBackground();
  }
  if (changes[STORAGE_KEY_SPLASH_ON]) {
    splashOn = changes[STORAGE_KEY_SPLASH_ON].newValue ?? false;
    applySplashBackground();
  }
  if (changes[STORAGE_KEY_SPLASH_PUBLIC_ON]) {
    splashPublicOn = changes[STORAGE_KEY_SPLASH_PUBLIC_ON].newValue ?? false;
    applySplashBackground();
  }
  if (changes[STORAGE_KEY_SPLASH_PROVIDER]) {
    splashProvider = changes[STORAGE_KEY_SPLASH_PROVIDER].newValue || 'picsum';
    applySplashBackground();
  }
  if (changes[STORAGE_KEY_SPLASH_QUERY]) {
    splashQuery = changes[STORAGE_KEY_SPLASH_QUERY].newValue || '';
    applySplashBackground();
  }
  if (changes[STORAGE_KEY_SPLASH_REFRESH]) {
    splashRefreshToken = changes[STORAGE_KEY_SPLASH_REFRESH].newValue || Date.now();
    applySplashBackground();
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

  if (!profile) {
    const msg = document.createElement('div');
    msg.id = 'empty-state';
    msg.innerHTML = '<p>No profiles yet.</p><small>Click the <strong>＋</strong> button above to create one.</small>';
    grid.appendChild(msg);
    return;
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

  // Icon
  const iconEl = buildIcon(dial);
  card.appendChild(iconEl);

  // Title
  const title = document.createElement('span');
  title.className = 'dial-card__title';
  title.textContent = dial.title || hostname(dial.url);
  card.appendChild(title);

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
    if (openInNewTab) {
      window.open(dial.url, '_blank', 'noopener,noreferrer');
    } else {
      window.location.href = dial.url;
    }
  });

  return card;
}

function buildIcon(dial) {
  if (dial.icon_data) {
    return buildImgIcon(dial.icon_data, dial.title || dial.url);
  }
  // Try favicon
  const faviconSrc = faviconUrl(dial.url);
  const img = buildImgIcon(faviconSrc, dial.title || dial.url);
  img.addEventListener('error', () => {
    const avatar = buildAvatar(dial.title || hostname(dial.url));
    img.replaceWith(avatar);
  }, { once: true });
  return img;
}

function buildImgIcon(src, alt) {
  const img       = document.createElement('img');
  img.className   = 'dial-card__icon';
  img.src         = src;
  img.alt         = alt;
  img.crossOrigin = 'anonymous';
  return img;
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

function closeAllCardMenus() {
  document.querySelectorAll('.dial-card.context-open').forEach(card => {
    card.classList.remove('context-open');
  });
}

function applySplashBackground() {
  const publicUrl = getPublicSplashUrl();
  const selectedImage = splashPublicOn ? publicUrl : splashData;

  if (splashOn && selectedImage) {
    document.body.classList.add('splash-enabled');
    const safeData = selectedImage.replace(/"/g, '\\"');
    document.documentElement.style.setProperty('--splash-image', `url("${safeData}")`);
  } else {
    document.body.classList.remove('splash-enabled');
    document.documentElement.style.removeProperty('--splash-image');
  }
}

function getPublicSplashUrl() {
  const refresh = splashRefreshToken || Date.now();
  const cleanQuery = encodeURIComponent((splashQuery || '').trim());

  if (splashProvider === 'unsplash') {
    const queryPart = cleanQuery ? `?${cleanQuery}&` : '?';
    return `https://source.unsplash.com/1920x1080/${queryPart}sig=${refresh}`;
  }

  // Default: picsum
  if (cleanQuery) {
    return `https://picsum.photos/seed/${cleanQuery}-${refresh}/1920/1080`;
  }
  return `https://picsum.photos/1920/1080?random=${refresh}`;
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
function openAddModal() {
  editingDialId   = null;
  pendingIconData = null;
  document.getElementById('modal-title').textContent       = 'Add Dial';
  document.getElementById('modal-save').textContent        = 'Add';
  document.getElementById('modal-title-input').value       = '';
  document.getElementById('modal-url-input').value         = '';
  document.getElementById('modal-icon-input').value        = '';
  document.getElementById('modal-icon-preview').classList.add('hidden');
  document.getElementById('modal-icon-remove').classList.add('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-url-input').focus();
}

function openEditModal(dial) {
  editingDialId   = dial.id;
  pendingIconData = null;
  document.getElementById('modal-title').textContent       = 'Edit Dial';
  document.getElementById('modal-save').textContent        = 'Save';
  document.getElementById('modal-title-input').value       = dial.title || '';
  document.getElementById('modal-url-input').value         = dial.url   || '';
  document.getElementById('modal-icon-input').value        = '';

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
}

async function saveDial() {
  const titleEl = document.getElementById('modal-title-input');
  const urlEl   = document.getElementById('modal-url-input');
  const title   = titleEl.value.trim();
  const rawUrl  = urlEl.value.trim();

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

  const profile = state.profiles.find(p => p.id === activeProfileId);
  if (!profile) return;

  if (editingDialId) {
    // Edit existing
    const dial = profile.dials.find(d => d.id === editingDialId);
    if (!dial) return;
    dial.title = title;
    dial.url   = cleanUrl;
  } else {
    // Add new
    const newDial = {
      id:        uuid(),
      profile_id: profile.id,
      title,
      url:       cleanUrl,
      position:  profile.dials.length,
      icon_data: null,
    };
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
  await chrome.storage.local.set({
    [STORAGE_KEY_STATE]:  state,
    [STORAGE_KEY_ACTIVE]: activeProfileId,
  });
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function setSyncStatus(msg, isError = false) {
  const el = document.getElementById('sync-status');
  el.textContent = msg;
  el.className   = isError ? 'error' : '';
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

// Dial modal
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-save').addEventListener('click', saveDial);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

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
  if (dialId) handleRemoveIcon(dialId);
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

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeAllCardMenus();
    closeModal();
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
