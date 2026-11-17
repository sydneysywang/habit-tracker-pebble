// Wires together state, storage, rendering, the jar and sound.

import { load, save, loadPref, savePref, STORAGE_KEY } from './storage.js';
import { dateKey } from './dates.js';
import { WEIGHTS, NAME_MAX, addHabit, editHabit, deleteHabit, toggleDone, isDone } from './habits.js';
import { createJar } from './physics.js';
import * as sound from './sound.js';
import { renderApp, PLACEHOLDERS } from './ui.js';

const $ = (id) => document.getElementById(id);
const refs = {
  form: $('add-form'),
  input: $('habit-name'),
  formMsg: $('form-msg'),
  pocketList: $('pocket-list'),
  doneList: $('done-list'),
  doneWrap: $('done-wrap'),
  pocketState: $('pocket-state'),
  pocketMeter: $('pocket-meter'),
  pocketCard: $('pocket-card'),
  editModeBtn: $('edit-mode-btn'),
  budgetBtn: $('budget-btn'),
  budgetLoad: $('budget-load'),
  budgetMax: [$('budget-max'), $('budget-max-2')],
  weekWrap: $('week-wrap'),
  jarCanvas: $('jar-canvas'),
  jarEmpty: $('jar-empty'),
  jarHint: $('jar-hint'),
  todayLabel: $('today-label'),
  live: $('live'),
  mute: $('mute-btn'),
  theme: $('theme-btn'),
};

const ERRORS = {
  empty: 'Give your stone a name first, even a tiny one.',
  duplicate: 'That one is already in your pocket.',
  full: 'Your pocket is full, and that’s plenty for one day. Maybe swap a boulder for a pebble?',
};

let state = load();
let today = dateKey();
const ui = { editMode: false, editingId: null, editError: null, confirmingId: null, pendingFocus: null };

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const jar = createJar(refs.jarCanvas, {
  onImpact: (speed, weight, glass) => sound.clack(speed, weight, glass),
  prefersReducedMotion: () => reducedMotion.matches,
});

// ------------------------------------------------------------------ core

function render(opts) {
  renderApp(refs, state, today, ui);
  jar.sync(state.habits.filter((x) => isDone(state, x.id, today)), opts);
}

function commit(next) {
  state = save(next);
  render();
}

function announce(msg) {
  refs.live.textContent = '';
  // A fresh text node makes screen readers announce repeated messages too.
  requestAnimationFrame(() => (refs.live.textContent = msg));
}

function habitById(id) {
  return state.habits.find((x) => x.id === id);
}

function setFormMsg(msg) {
  refs.formMsg.textContent = msg || '';
}

function shufflePlaceholder() {
  refs.input.placeholder = PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)];
}

function toggle(id) {
  const habit = habitById(id);
  if (!habit) return;
  const wasDone = isDone(state, id, today);
  commit(toggleDone(state, id, today));
  if (wasDone) {
    announce(`“${habit.name}” is back in your pocket.`);
  } else {
    const allDone = state.habits.every((x) => isDone(state, x.id, today));
    announce(
      `${WEIGHTS[habit.weight].label} “${habit.name}” dropped into the jar.` +
        (allDone ? ' Your pocket is empty. Nothing left to carry today.' : ''),
    );
  }
}

// ------------------------------------------------------------------ add

refs.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const weight = new FormData(refs.form).get('weight');
  const result = addHabit(state, refs.input.value, weight);
  if (result.error) {
    setFormMsg(ERRORS[result.error]);
    refs.input.focus();
    return;
  }
  refs.input.value = '';
  setFormMsg('');
  shufflePlaceholder();
  ui.pendingFocus = 'add';
  commit(result.state);
  announce(`${WEIGHTS[result.habit.weight].label} “${result.habit.name}” is in your pocket.`);
});

refs.input.addEventListener('input', () => setFormMsg(''));

// ------------------------------------------------------------------ pocket

refs.pocketCard.addEventListener('change', (e) => {
  const input = e.target.closest('input[data-action="toggle"]');
  if (input) {
    ui.pendingFocus = `toggle:${input.dataset.id}`;
    toggle(input.dataset.id);
  }
});

refs.pocketCard.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  switch (action) {
    case 'edit':
      startEdit(id);
      break;
    case 'cancel-edit':
      cancelEdit();
      break;
    case 'delete':
      ui.editingId = null;
      ui.confirmingId = id;
      ui.pendingFocus = `confirm-no:${id}`;
      render();
      break;
    case 'cancel-delete':
      ui.confirmingId = null;
      ui.pendingFocus = `delete:${id}`;
      render();
      break;
    case 'confirm-delete': {
      const habit = habitById(id);
      ui.confirmingId = null;
      ui.pendingFocus = state.habits.length > 1 ? 'edit-mode' : 'add';
      commit(deleteHabit(state, id));
      if (habit) announce(`Let go of “${habit.name}”.`);
      break;
    }
  }
});

refs.editModeBtn.addEventListener('click', () => {
  ui.editMode = !ui.editMode;
  ui.editingId = ui.confirmingId = null;
  ui.editError = null;
  ui.pendingFocus = 'edit-mode';
  render();
});

refs.pocketCard.addEventListener('submit', (e) => {
  const form = e.target.closest('.edit-form');
  if (!form) return;
  e.preventDefault();
  const id = form.dataset.id;
  const data = new FormData(form);
  const result = editHabit(state, id, { name: data.get('name'), weight: data.get('weight') });
  if (result.error) {
    ui.editError = ERRORS[result.error];
    ui.pendingFocus = `editname:${id}`;
    render();
    return;
  }
  ui.editingId = null;
  ui.editError = null;
  ui.pendingFocus = `edit:${id}`;
  commit(result.state);
  announce('Saved.');
});

// ------------------------------------------------------------------ budget hint

const hintOpen = () => refs.budgetBtn.getAttribute('aria-expanded') === 'true';
function setHint(open) {
  refs.budgetBtn.setAttribute('aria-expanded', String(open));
}
refs.budgetBtn.addEventListener('click', () => setHint(!hintOpen()));
document.addEventListener('click', (e) => {
  if (hintOpen() && !e.target.closest('.add-head')) setHint(false);
});

refs.pocketCard.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (hintOpen()) {
    setHint(false);
    refs.budgetBtn.focus();
  } else if (ui.editingId) cancelEdit();
  else if (ui.confirmingId) {
    ui.pendingFocus = `delete:${ui.confirmingId}`;
    ui.confirmingId = null;
    render();
  } else if (ui.editMode) {
    ui.editMode = false;
    ui.pendingFocus = 'edit-mode';
    render();
  }
});

function startEdit(id) {
  ui.confirmingId = null;
  ui.editingId = id;
  ui.editError = null;
  ui.pendingFocus = `editname:${id}`;
  render();
}

function cancelEdit() {
  const id = ui.editingId;
  ui.editingId = null;
  ui.editError = null;
  ui.pendingFocus = id ? `edit:${id}` : null;
  render();
}

// ------------------------------------------------------------------ week

refs.weekWrap.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action="toggle-today"]');
  if (!btn) return;
  ui.pendingFocus = `week:${btn.dataset.id}`;
  toggle(btn.dataset.id);
});

// ------------------------------------------------------------------ sound

sound.setMuted(loadPref('muted', false));
function renderMute() {
  const muted = sound.isMuted();
  refs.mute.setAttribute('aria-pressed', String(muted));
  refs.mute.classList.toggle('is-muted', muted);
  refs.mute.title = muted ? 'Sound is off' : 'Sound is on';
}
refs.mute.addEventListener('click', () => {
  sound.setMuted(!sound.isMuted());
  savePref('muted', sound.isMuted());
  renderMute();
});
renderMute();

// Browsers only allow audio after a user gesture.
document.addEventListener('pointerdown', sound.unlock, { capture: true });
document.addEventListener('keydown', sound.unlock, { capture: true });

// ------------------------------------------------------------------ daily reset

function checkDay() {
  const now = dateKey();
  if (now === today) return;
  today = now;
  ui.editMode = false;
  ui.editingId = ui.confirmingId = null;
  render();
  announce('A fresh day. Your pocket is full again.');
}
setInterval(checkDay, 60_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkDay();
});
window.addEventListener('focus', checkDay);

// Keep several open tabs in step.
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  state = load();
  render();
});

// ------------------------------------------------------------------ theme

// The inline script in index.html sets data-theme before first paint. Until the
// user picks a theme with the toggle, follow the system preference.
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const THEME_COLOR = { light: '#F6F1E7', dark: '#1F2428' };

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  const dark = theme === 'dark';
  refs.theme.setAttribute('aria-pressed', String(dark));
  refs.theme.title = dark ? 'Dark mode is on' : 'Dark mode is off';
  // Jar colours come from CSS custom properties, so redraw it.
  jar.refreshColors();
}
refs.theme.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  savePref('theme', next);
  applyTheme(next);
});
systemDark.addEventListener('change', (e) => {
  const saved = loadPref('theme', null);
  if (saved !== 'light' && saved !== 'dark') applyTheme(e.matches ? 'dark' : 'light');
});
// Another tab flipped the toggle.
window.addEventListener('storage', (e) => {
  if (e.key === 'pebble.pref.theme') applyTheme(loadPref('theme', null) === 'dark' ? 'dark' : 'light');
});
applyTheme(currentTheme());

// ------------------------------------------------------------------ boot

refs.input.maxLength = NAME_MAX; // keep the add input in sync with the limit in habits.js
shufflePlaceholder();
render({ initial: true });
if (!state.habits.length && window.matchMedia('(pointer: fine)').matches) {
  refs.input.focus({ preventScroll: true });
}
