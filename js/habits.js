// Pure state transitions. Nothing here touches the DOM or storage:
// every function takes a state and returns a new one.

// `radius` is the stone's size in jar units (the jar is 100 × 126).
export const WEIGHTS = {
  pebble: { label: 'Tiny Pebble', short: 'Pebble', radius: 5.6 },
  stone: { label: 'Smooth Stone', short: 'Stone', radius: 8 },
  boulder: { label: 'Heavy Boulder', short: 'Boulder', radius: 10.6 },
};
export const WEIGHT_KEYS = Object.keys(WEIGHTS);
export const NAME_MAX = 40;

// --- Jar capacity -----------------------------------------------------------
// A stone takes room ∝ its area (radius²). Measured in the physics simulation:
// a settled pile first rises past the jar's shoulder at Σr² ≈ 1540 (rim ≈ 1910),
// so 1500 keeps every possible set of ticked stones below the shoulder.
// That is roughly 47 pebbles, 23 stones or 13 boulders.
export const JAR_CAPACITY = 1500;
export const JAR_WARN_RATIO = 0.8;

export function stoneRoom(weight) {
  return (WEIGHTS[weight] || WEIGHTS.pebble).radius ** 2;
}

/** Room taken if every habit were ticked (optionally ignoring one habit). */
export function jarLoad(habits, excludeId = null) {
  return habits.reduce((sum, h) => (h.id === excludeId ? sum : sum + stoneRoom(h.weight)), 0);
}

/** Room taken by the stones actually in the jar on `key`. */
export function tickedLoad(state, key) {
  const ids = new Set(state.log[key] || []);
  return jarLoad(state.habits.filter((h) => ids.has(h.id)));
}

export function isJarNearlyFull(state, key) {
  return tickedLoad(state, key) >= JAR_CAPACITY * JAR_WARN_RATIO;
}

/** How many more tiny pebbles could still be added as new habits. */
export function pebblesOfRoomLeft(habits) {
  return Math.max(0, Math.floor((JAR_CAPACITY - jarLoad(habits) + 1e-9) / stoneRoom('pebble')));
}

function fitsInJar(habits, weight, excludeId = null) {
  return jarLoad(habits, excludeId) + stoneRoom(weight) <= JAR_CAPACITY + 1e-9;
}

export function cleanName(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
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

/**
 * A habit can only be created if ticking every habit, including the new one,
 * would still fit in the jar.
 * @returns {{state, habit?, error?: 'empty'|'duplicate'|'jar-full'}}
 */
export function addHabit(state, rawName, weight) {
  const name = cleanName(rawName);
  if (!name) return { state, error: 'empty' };
  if (!WEIGHTS[weight]) weight = 'pebble';
  if (isDuplicate(state.habits, name)) return { state, error: 'duplicate' };
  if (!fitsInJar(state.habits, weight)) return { state, error: 'jar-full' };
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
  if (!fitsInJar(state.habits, weight, id)) return { state, error: 'jar-full' };
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
