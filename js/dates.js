// Local-time date helpers. Keys are "YYYY-MM-DD" in the user's own timezone,
// so "today" flips at the user's midnight, not UTC midnight.

export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The last `n` days ending at (and including) `end`, oldest first. */
export function lastNDays(n = 7, end = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    out.push({ key: dateKey(date), date });
  }
  return out;
}

export function longDayLabel(date) {
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}
