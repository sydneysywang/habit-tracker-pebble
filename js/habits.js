// Pure state transitions. Nothing here touches the DOM or storage:
// every function takes a state and returns a new one.

export const WEIGHTS = {
  pebble: { label: 'Tiny Pebble', short: 'Pebble', cost: 1 },
  stone: { label: 'Smooth Stone', short: 'Stone', cost: 2 },
  boulder: { label: 'Heavy Boulder', short: 'Boulder', cost: 3 },
};
export const WEIGHT_KEYS = Object.keys(WEIGHTS);
export const POCKET_BUDGET = 20;
export const NAME_MAX = 40;

export function cleanName(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export function pocketLoad(habits, excludeId = null) {
  return habits.reduce((sum, h) => (h.id === excludeId ? sum : sum + WEIGHTS[h.weight].cost), 0);
}

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

function isDuplicate(habits, name, excludeId = null) {
  const lower = name.toLowerCase();
  return habits.some((h) => h.id !== excludeId && h.name.toLowerCase() === lower);
}

/** @returns {{state, habit?, error?: 'empty'|'duplicate'|'full'}} */
export function addHabit(state, rawName, weight) {
  const name = cleanName(rawName);
  if (!name) return { state, error: 'empty' };
  if (!WEIGHTS[weight]) weight = 'pebble';
  if (isDuplicate(state.habits, name)) return { state, error: 'duplicate' };
  if (pocketLoad(state.habits) + WEIGHTS[weight].cost > POCKET_BUDGET) return { state, error: 'full' };
  const habit = { id: newId(), name, weight, createdAt: Date.now(), seed: randomSeed() };
  return { state: { ...state, habits: [...state.habits, habit] }, habit };
}

export function editHabit(state, id, { name: rawName, weight }) {
  const current = state.habits.find((h) => h.id === id);
  if (!current) return { state };
  const name = cleanName(rawName);
  if (!name) return { state, error: 'empty' };
  if (!WEIGHTS[weight]) weight = current.weight;
  if (isDuplicate(state.habits, name, id)) return { state, error: 'duplicate' };
  if (pocketLoad(state.habits, id) + WEIGHTS[weight].cost > POCKET_BUDGET) return { state, error: 'full' };
  const habits = state.habits.map((h) => (h.id === id ? { ...h, name, weight } : h));
  return { state: { ...state, habits } };
}

export function deleteHabit(state, id) {
  const habits = state.habits.filter((h) => h.id !== id);
  const log = {};
  for (const [key, ids] of Object.entries(state.log)) {
    const kept = ids.filter((x) => x !== id);
    if (kept.length) log[key] = kept;
  }
  return { ...state, habits, log };
}

export function isDone(state, id, key) {
  return (state.log[key] || []).includes(id);
}

export function toggleDone(state, id, key) {
  const ids = state.log[key] || [];
  const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  const log = { ...state.log };
  if (next.length) log[key] = next;
  else delete log[key];
  return { ...state, log };
}
