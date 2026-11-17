# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Pebble** is a minimalist, low-guilt habit tracker. Habits are weighted stones (Tiny Pebble / Smooth Stone / Heavy Boulder) kept in a limited "Daily Pocket". Ticking a habit drops an organically shaped stone into a 2D physics glass jar. There are no streaks: the pocket refills each day, and an empty pocket is the "done" state. The full approved design plan is at `~/.claude/plans/pasted-content-id-c429-plan-a-curried-dewdrop.md`.

## Hard constraints

- **Vanilla HTML, CSS, and JavaScript (ES modules) only.** No React, no Next.js, no other framework or UI library, no npm dependencies, no bundler or build step, and no CDN JS libraries. The physics engine is hand-written. The only allowed external resource is a Google Fonts stylesheet.
- **No server or database.** All state lives in `localStorage` and must survive a reload.
- **Hosted on GitHub Pages** from the repo root. Use relative paths only, keep `index.html` at the root, and keep the `.nojekyll` file.
- **Must be fully usable at 1280px and 375px widths**, with no horizontal page scroll at either size.

## Commands

There is no build, lint, or test tooling. To run locally, serve over HTTP, because ES modules don't load from `file://`:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Verify by hand in the browser, using devtools responsive mode at 1280×800 and 375×667. To test the daily reset, edit the date keys of `localStorage["pebble.v1"].log` in devtools and reload.

Node is not installed on the dev machine. For automated checks, use headless Chrome (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --virtual-time-budget=… --dump-dom <url>`) against a small test page that imports the modules and writes results into the DOM. Gotchas:
- Headless Chrome barely fires `requestAnimationFrame`. Either shim it with `setTimeout` in the test page, or create the jar with `prefersReducedMotion: () => true`, which settles stones synchronously.
- Headless windows can't be narrower than ~500px. Test 375px inside a 375px-wide `<iframe>`.
- `jar.snapshot()` returns body positions and velocities for assertions.

## Architecture

The entry point is `index.html`, which loads `js/app.js` with `<script type="module">`.

- **State is one object** in `localStorage["pebble.v1"]`: `{ version, habits: [{id, name, weight, createdAt, seed}], log: { "YYYY-MM-DD": [habitId, ...] } }`. Treat `log` as the single source of truth for "ticked". The pocket, the jar, and the 7-day grid are all derived from `habits` plus `log`. Nothing else stores tick state.
- **Dates are local-time `YYYY-MM-DD` keys** (`js/dates.js`). The daily reset just means the "today" key changed. It runs on load, on `visibilitychange`, and on a once-a-minute check. The pocket refills and the jar empties, but history stays.
- **Logic is separate from rendering.** `js/habits.js` holds pure state transitions (add, edit, delete, toggle). `js/storage.js` persists state, wrapping every call in try/catch with an in-memory fallback, and trims log entries older than ~60 days. `js/ui.js` renders the DOM. `js/app.js` wires these together, plus the jar.
- **Jar = `js/physics.js` + `js/stones.js` + `js/sound.js`:**
  - Physics uses **circle colliders** (the radius depends on weight) against jar wall and floor line segments. It runs a fixed 60Hz step with an iterative impulse solver, friction-driven rotation, sleeping, and pointer-event drag/throw via a spring to the pointer.
  - Stones are *drawn* as seeded organic blobs (`habit.seed`), so each habit keeps a stable shape. The collision shape stays a circle on purpose, for stability.
  - The physics works in jar-relative units scaled to the canvas size, which a `ResizeObserver` tracks. That keeps stones inside the jar across resizes.
  - The jar is rebuilt on load from `log[today]`.
  - Sound is synthesized with Web Audio (no audio files). It starts on the first user gesture, triggers on collision impulse with throttling, and has a mute toggle saved in localStorage.
- **Pocket budget:** pebble=1, stone=2, boulder=3, max 10. Adding a habit over budget shows a soft message instead of adding it.

## Design language

- Palette tokens live on `:root` in `css/styles.css`: sand, slate, moss, terracotta, paper, ink. Stone colors are pebble = moss, stone = slate, boulder = terracotta. Dark mode uses `prefers-color-scheme`.
- Tone is anti-hustle and guilt-free: no streak counters or punishing copy. With no habits, the page shows the empty jar and a playful prompt. When everything is ticked, it shows "Your pocket is empty".
- Respect `prefers-reduced-motion`: stones appear already settled, with no drop animation.
