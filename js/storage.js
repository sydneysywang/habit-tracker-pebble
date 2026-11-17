// localStorage persistence. Every access is guarded: in private windows or
// with storage blocked we fall back to an in-memory copy for the session.

import { dateKey } from './dates.js';

const KEY = 'pebble.v1';
const PREF_PREFIX = 'pebble.pref.';
const KEEP_DAYS = 60;
const WEIGHT_KEYS = ['pebble', 'stone', 'boulder'];

let memory = null;

export function emptyState() {
  return { version: 1, habits: [], log: {} };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function sanitize(raw) {
  const state = emptyState();
  if (!raw || typeof raw !== 'object') return state;

  const ids = new Set();
  if (Array.isArray(raw.habits)) {
    for (const h of raw.habits) {
      if (!h || typeof h.id !== 'string' || ids.has(h.id)) continue;
      if (typeof h.name !== 'string' || !h.name.trim()) continue;
      ids.add(h.id);
      state.habits.push({
        id: h.id,
        name: h.name.trim().slice(0, 40),
        weight: WEIGHT_KEYS.includes(h.weight) ? h.weight : 'pebble',
        createdAt: Number(h.createdAt) || Date.now(),
        seed: Number.isFinite(h.seed) ? h.seed >>> 0 : hashString(h.id),
      });
    }
  }

  if (raw.log && typeof raw.log === 'object') {
    for (const [key, list] of Object.entries(raw.log)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Array.isArray(list)) continue;
      const clean = [...new Set(list.filter((id) => ids.has(id)))];
      if (clean.length) state.log[key] = clean;
    }
  }
  return state;
}

function trimLog(state) {
  const cutoff = dateKey(new Date(Date.now() - KEEP_DAYS * 86400000));
  const log = {};
  for (const [key, list] of Object.entries(state.log)) {
    if (key >= cutoff) log[key] = list; // YYYY-MM-DD sorts lexically
  }
  return { ...state, log };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return memory ? sanitize(memory) : emptyState();
    return sanitize(JSON.parse(raw));
  } catch {
    return memory ? sanitize(memory) : emptyState();
  }
}

export function save(state) {
  const trimmed = trimLog(state);
  memory = trimmed;
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* storage unavailable or full: keep the in-memory copy */
  }
  return trimmed;
}

export const STORAGE_KEY = KEY;

export function loadPref(name, fallback) {
  try {
    const raw = localStorage.getItem(PREF_PREFIX + name);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function savePref(name, value) {
  try {
    localStorage.setItem(PREF_PREFIX + name, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
