// A small hand-written 2D physics simulation for the glass jar.
//
// - The world is measured in jar units (WORLD_W × WORLD_H) and scaled to fit
//   the canvas, so resizing never moves stones out of the jar.
// - Stones collide as circles, which keeps stacking stable, but are drawn as
//   organic blobs (see stones.js).
// - Each frame runs a fixed 60 Hz step split into substeps, with an iterative
//   impulse solver, Coulomb friction (which makes stones roll), and positional
//   correction.
// - The loop stops once everything has settled and restarts on any change.

import { makeStoneShape, drawStone } from './stones.js';

// The jar is designed in a 100 × 126 box and shrunk by JAR_SCALE in the
// physics world, while stone radii stay fixed. A smaller JAR_SCALE means the
// same stones fill more of the jar (and draw larger on screen). It is tuned so
// a full pocket (POCKET_BUDGET in habits.js) fills the jar to about its shoulder.
export const JAR_SCALE = 0.69;
const S = JAR_SCALE;

export const WORLD_W = 100 * S;
export const WORLD_H = 126 * S;
export const RADIUS = { pebble: 5.6, stone: 8, boulder: 10.6 };
const DENSITY = { pebble: 1, stone: 1.05, boulder: 1.2 };

// Inner outline of the jar in design units, as an open polyline from the left
// lip round to the right lip. JAR_PTS is the same outline in world units.
const JAR_DESIGN = [
  [18, 5], [18, 14], [10, 24], [10, 109], [12.5, 116], [19, 119.5],
  [81, 119.5], [87.5, 116], [90, 109], [90, 24], [82, 14], [82, 5],
];
const JAR_PTS = JAR_DESIGN.map(([x, y]) => [x * S, y * S]);
const SEGMENTS = JAR_PTS.slice(0, -1).map(([ax, ay], i) => {
  const [bx, by] = JAR_PTS[i + 1];
  return { ax, ay, bx, by };
});
const FLOOR_Y = 119.5 * S;
const LEFT_X = 10 * S;
const RIGHT_X = 90 * S;
const NECK_L = 18 * S;
const NECK_R = 82 * S;
const NECK_Y = 14 * S;
const SHOULDER_Y = 24 * S;
const PAD = 0.9 * S; // half the glass thickness

const STEP = 1 / 60;
const SUB = 4;
const ITER = 3;
const GRAVITY = 950;
const RESTITUTION = 0.22;
const BOUNCE_MIN = 25;
const FRICTION = 0.45;
const POS_PERCENT = 0.7;
const SLOP = 0.03;
const LIN_DAMP = 0.9985;
const ANG_DAMP = 0.996;
const MAX_SPEED = 700;
const DRAG_K = 22;
const IMPACT_MIN = 45;
const TAU = Math.PI * 2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createJar(canvas, { onImpact = () => {}, prefersReducedMotion = () => false } = {}) {
  const ctx = canvas.getContext('2d');
  const bodies = [];
  let fading = [];
  let queue = [];
  const view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
  let colors = readColors();
  let running = false;
  let last = 0;
  let acc = 0;
  let calm = 0;
  let drag = null;
  let silent = false;
  let nextId = 1;

  function readColors() {
    const cs = getComputedStyle(canvas);
    const v = (name, fb) => cs.getPropertyValue(name).trim() || fb;
    return {
      pebble: v('--stone-pebble', '#7A8B5C'),
      stone: v('--stone-stone', '#66727D'),
      boulder: v('--stone-boulder', '#C46A4A'),
      glassStroke: v('--glass-stroke', 'rgba(74,85,96,0.5)'),
      glassFill: v('--glass-fill', 'rgba(255,255,255,0.35)'),
      glassShine: v('--glass-shine', 'rgba(255,255,255,0.75)'),
      jarShadow: v('--jar-shadow', 'rgba(60,45,30,0.16)'),
    };
  }

  // ---------------------------------------------------------------- bodies

  function makeBody(habit) {
    const r = RADIUS[habit.weight] || RADIUS.pebble;
    const m = r * r * (DENSITY[habit.weight] || 1);
    const x = (30 + Math.random() * 40) * S;
    let y = -r - 2;
    // Stack above any stone that is still up near the spawn point.
    for (let pass = 0; pass < 2; pass++) {
      for (const b of bodies) {
        if (Math.abs(b.x - x) < b.r + r && b.y - b.r - r - 2 < y) y = b.y - b.r - r - 2;
      }
    }
    return {
      id: nextId++,
      habitId: habit.id,
      weight: habit.weight,
      seed: habit.seed,
      r,
      im: 1 / m,
      ii: 1 / (0.5 * m * r * r),
      x,
      y,
      vx: (Math.random() - 0.5) * 30,
      vy: 60,
      angle: Math.random() * TAU,
      av: (Math.random() - 0.5) * 5,
      shape: makeStoneShape(habit.seed),
      dragged: false,
    };
  }

  function addBody(habit) {
    bodies.push(makeBody(habit));
  }

  function removeBody(b) {
    const i = bodies.indexOf(b);
    if (i >= 0) bodies.splice(i, 1);
    if (drag?.body === b) drag = null;
    b.fade = 1;
    fading.push(b);
  }

  /** Make the jar hold exactly one stone per habit in `habits`. */
  function sync(habits, { initial = false } = {}) {
    const want = new Map(habits.map((h) => [h.id, h]));
    for (const b of [...bodies]) {
      const h = want.get(b.habitId);
      if (!h || h.weight !== b.weight || h.seed !== b.seed) removeBody(b);
    }
    queue = queue.filter((q) => want.get(q.habit.id)?.weight === q.habit.weight);
    const present = new Set([...bodies.map((b) => b.habitId), ...queue.map((q) => q.habit.id)]);
    const toAdd = habits.filter((h) => !present.has(h.id));

    if (prefersReducedMotion()) {
      queue.forEach((q) => addBody(q.habit));
      queue = [];
      toAdd.forEach(addBody);
      if (toAdd.length) settleNow();
      fading = [];
      render();
      return;
    }

    const now = performance.now();
    toAdd.forEach((h, i) => queue.push({ habit: h, at: now + (initial ? 300 + i * 220 : i * 160) }));
    queue.sort((a, b) => a.at - b.at);
    if (toAdd.length || fading.length) wake();
  }

  /** Run the simulation silently until everything rests (reduced motion). */
  function settleNow() {
    silent = true;
    for (let i = 0; i < 900; i++) step(STEP);
    silent = false;
    for (const b of bodies) {
      b.vx = b.vy = b.av = 0;
    }
  }

  // ---------------------------------------------------------------- solver

  function solvePair(a, b, first) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const rs = a.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rs * rs || d2 === 0) return;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    const ima = a.dragged ? 0 : a.im;
    const imb = b.dragged ? 0 : b.im;
    const imSum = ima + imb;
    if (imSum === 0) return;

    const corr = (Math.max(rs - d - SLOP, 0) * POS_PERCENT) / imSum;
    a.x -= nx * corr * ima;
    a.y -= ny * corr * ima;
    b.x += nx * corr * imb;
    b.y += ny * corr * imb;

    // Contact-point velocities (v + ω × r)
    const rax = nx * a.r, ray = ny * a.r;
    const rbx = -nx * b.r, rby = -ny * b.r;
    const rvx = b.vx - b.av * rby - (a.vx - a.av * ray);
    const rvy = b.vy + b.av * rbx - (a.vy + a.av * rax);
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return;

    if (first && !silent && vn < -IMPACT_MIN) onImpact(-vn, a.r > b.r ? a.weight : b.weight, false);

    const e = vn < -BOUNCE_MIN ? RESTITUTION : 0;
    const jn = (-(1 + e) * vn) / imSum;
    a.vx -= nx * jn * ima;
    a.vy -= ny * jn * ima;
    b.vx += nx * jn * imb;
    b.vy += ny * jn * imb;

    // Friction along the tangent; r × t is +r for a and -r for b.
    const tx = -ny, ty = nx;
    const vt = rvx * tx + rvy * ty;
    const iia = a.dragged ? 0 : a.ii;
    const iib = b.dragged ? 0 : b.ii;
    const k = imSum + a.r * a.r * iia + b.r * b.r * iib;
    const jt = clamp(-vt / k, -FRICTION * jn, FRICTION * jn);
    a.vx -= tx * jt * ima;
    a.vy -= ty * jt * ima;
    a.av -= a.r * jt * iia;
    b.vx += tx * jt * imb;
    b.vy += ty * jt * imb;
    b.av -= b.r * jt * iib;
  }

  function solveSegment(b, s, first) {
    const ex = s.bx - s.ax, ey = s.by - s.ay;
    const t = clamp(((b.x - s.ax) * ex + (b.y - s.ay) * ey) / (ex * ex + ey * ey), 0, 1);
    const dx = b.x - (s.ax + ex * t);
    const dy = b.y - (s.ay + ey * t);
    const rr = b.r + PAD;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr || d2 === 0) return;
    const d = Math.sqrt(d2);
    const nx = dx / d, ny = dy / d;
    b.x += nx * (rr - d);
    b.y += ny * (rr - d);

    const rx = -nx * b.r, ry = -ny * b.r;
    const vcx = b.vx - b.av * ry;
    const vcy = b.vy + b.av * rx;
    const vn = vcx * nx + vcy * ny;
    if (vn >= 0) return;

    if (first && !silent && !b.dragged && vn < -IMPACT_MIN) onImpact(-vn, b.weight, true);

    const e = vn < -BOUNCE_MIN ? RESTITUTION : 0;
    const jn = (-(1 + e) * vn) / b.im;
    b.vx += nx * jn * b.im;
    b.vy += ny * jn * b.im;

    const tx = -ny, ty = nx;
    const vt = vcx * tx + vcy * ty;
    const k = b.im + b.r * b.r * b.ii;
    const jt = clamp(-vt / k, -FRICTION * jn, FRICTION * jn);
    b.vx += tx * jt * b.im;
    b.vy += ty * jt * b.im;
    b.av -= b.r * jt * b.ii;
  }

  /** Last-resort containment in case a fast stone tunnels through the glass. */
  function contain(b) {
    const m = b.r + PAD;
    if (b.y > FLOOR_Y - m) {
      b.y = FLOOR_Y - m;
      if (b.vy > 0) b.vy = 0;
    }
    if (b.y > SHOULDER_Y) {
      if (b.x < LEFT_X + m) { b.x = LEFT_X + m; if (b.vx < 0) b.vx = 0; }
      if (b.x > RIGHT_X - m) { b.x = RIGHT_X - m; if (b.vx > 0) b.vx = 0; }
    } else if (b.y < NECK_Y) {
      if (b.x < NECK_L + m) { b.x = NECK_L + m; if (b.vx < 0) b.vx = 0; }
      if (b.x > NECK_R - m) { b.x = NECK_R - m; if (b.vx > 0) b.vx = 0; }
    }
    if (b.y < -60) b.y = -60;
  }

  function step(dt) {
    const h = dt / SUB;
    for (let s = 0; s < SUB; s++) {
      for (const b of bodies) {
        if (b.dragged && drag) {
          b.vx = clamp((drag.tx - b.x) * DRAG_K, -MAX_SPEED, MAX_SPEED);
          b.vy = clamp((drag.ty - b.y) * DRAG_K, -MAX_SPEED, MAX_SPEED);
          b.av *= 0.9;
        } else {
          b.vy += GRAVITY * h;
        }
        b.vx *= LIN_DAMP;
        b.vy *= LIN_DAMP;
        b.av *= ANG_DAMP;
        b.x += b.vx * h;
        b.y += b.vy * h;
        b.angle += b.av * h;
      }
      for (let it = 0; it < ITER; it++) {
        const first = it === 0;
        for (let i = 0; i < bodies.length; i++) {
          for (let j = i + 1; j < bodies.length; j++) solvePair(bodies[i], bodies[j], first);
        }
        for (const b of bodies) {
          for (const seg of SEGMENTS) solveSegment(b, seg, first);
        }
      }
      for (const b of bodies) contain(b);
    }
  }

  // ---------------------------------------------------------------- loop

  function frame(now) {
    if (!running) return;
    const dtMs = Math.min(now - last, 100);
    last = now;
    acc += dtMs / 1000;

    while (queue.length && queue[0].at <= now) addBody(queue.shift().habit);

    let steps = 0;
    while (acc >= STEP && steps < 6) {
      step(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === 6) acc = 0;

    for (const f of fading) f.fade -= dtMs / 320;
    fading = fading.filter((f) => f.fade > 0);

    render();

    let maxV = 0;
    for (const b of bodies) maxV = Math.max(maxV, Math.hypot(b.vx, b.vy), Math.abs(b.av) * b.r);
    calm = maxV < 1.5 && !drag && !queue.length && !fading.length ? calm + 1 : 0;
    if (calm > 40) {
      running = false;
      return;
    }
    requestAnimationFrame(frame);
  }

  function wake() {
    calm = 0;
    if (running) return;
    running = true;
    last = performance.now();
    acc = 0;
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- drawing

  // The jar is drawn in design units: callers wrap these in ctx.scale(S, S).
  function jarPath() {
    ctx.beginPath();
    ctx.moveTo(JAR_DESIGN[0][0], JAR_DESIGN[0][1]);
    for (let i = 1; i < JAR_DESIGN.length - 1; i++) {
      const [x1, y1] = JAR_DESIGN[i];
      const [x2, y2] = JAR_DESIGN[i + 1];
      ctx.arcTo(x1, y1, x2, y2, 4);
    }
    const lastPt = JAR_DESIGN[JAR_DESIGN.length - 1];
    ctx.lineTo(lastPt[0], lastPt[1]);
  }

  function drawJarBack() {
    ctx.save();
    ctx.scale(S, S);
    ctx.beginPath();
    ctx.ellipse(50, 122.5, 40, 2.6, 0, 0, TAU);
    ctx.fillStyle = colors.jarShadow;
    ctx.fill();

    jarPath();
    ctx.closePath();
    const g = ctx.createLinearGradient(10, 0, 90, 0);
    g.addColorStop(0, colors.glassFill);
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, colors.glassFill);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  function drawJarFront() {
    ctx.save();
    ctx.scale(S, S);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    jarPath();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = colors.glassStroke;
    ctx.stroke();

    // Lip
    ctx.beginPath();
    ctx.moveTo(15.5, 4.6);
    ctx.lineTo(84.5, 4.6);
    ctx.lineWidth = 2.6;
    ctx.stroke();

    // Highlights
    ctx.strokeStyle = colors.glassShine;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(15, 36);
    ctx.lineTo(15, 92);
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(15, 98);
    ctx.lineTo(15, 102);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(85, 40);
    ctx.lineTo(85, 56);
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const k = view.scale * view.dpr;
    ctx.setTransform(k, 0, 0, k, view.ox * view.dpr, view.oy * view.dpr);
    drawJarBack();
    for (const b of bodies) drawStone(ctx, b, colors[b.weight]);
    for (const f of fading) drawStone(ctx, f, colors[f.weight], Math.max(0, f.fade));
    drawJarFront();
  }

  // ---------------------------------------------------------------- sizing

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(rect.width * view.dpr);
    canvas.height = Math.round(rect.height * view.dpr);
    view.scale = Math.min(rect.width / WORLD_W, rect.height / WORLD_H);
    view.ox = (rect.width - WORLD_W * view.scale) / 2;
    view.oy = (rect.height - WORLD_H * view.scale) / 2;
    render();
  }

  new ResizeObserver(resize).observe(canvas);

  // ---------------------------------------------------------------- input

  function toWorld(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - view.ox) / view.scale,
      y: (e.clientY - rect.top - view.oy) / view.scale,
    };
  }

  function pick(p) {
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      if (Math.hypot(b.x - p.x, b.y - p.y) <= b.r * 1.15) return b;
    }
    return null;
  }

  function setTarget(p) {
    const b = drag.body;
    const m = b.r + PAD + 0.5;
    let x = p.x + drag.ox;
    const y = clamp(p.y + drag.oy, -20, FLOOR_Y - m);
    x = y < SHOULDER_Y ? clamp(x, NECK_L + m, NECK_R - m) : clamp(x, LEFT_X + m, RIGHT_X - m);
    drag.tx = x;
    drag.ty = y;
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = toWorld(e);
    const b = pick(p);
    if (!b) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drag = { body: b, pointerId: e.pointerId, ox: b.x - p.x, oy: b.y - p.y, tx: b.x, ty: b.y };
    b.dragged = true;
    canvas.style.cursor = 'grabbing';
    wake();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = toWorld(e);
    if (drag && e.pointerId === drag.pointerId) {
      setTarget(p);
      wake();
    } else if (e.pointerType === 'mouse') {
      canvas.style.cursor = pick(p) ? 'grab' : 'default';
    }
  });

  function release(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const b = drag.body;
    b.dragged = false;
    b.vx = clamp(b.vx, -MAX_SPEED, MAX_SPEED);
    b.vy = clamp(b.vy, -MAX_SPEED, MAX_SPEED);
    drag = null;
    canvas.style.cursor = 'grab';
    wake();
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // On touch screens, stop the page from scrolling only when the touch starts on a stone.
  canvas.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      if (t && pick(toWorld(t))) e.preventDefault();
    },
    { passive: false },
  );

  return {
    sync,
    count: () => bodies.length,
    /** Read-only view of the bodies, in world units (handy for debugging/tests). */
    snapshot: () => bodies.map(({ habitId, weight, x, y, r, vx, vy }) => ({ habitId, weight, x, y, r, vx, vy })),
    refreshColors() {
      colors = readColors();
      render();
    },
  };
}
