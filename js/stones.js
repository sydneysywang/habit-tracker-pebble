// Organic stone shapes. Each habit has a numeric seed, so its stone looks the
// same every time it is drawn: in the jar, after a reload, and in the UI chips.

const TAU = Math.PI * 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Radial profile + surface details for a stone, all relative to radius 1. */
export function makeStoneShape(seed) {
  const rnd = mulberry32(seed);
  const n = 9 + Math.floor(rnd() * 3);
  const raw = Array.from({ length: n }, () => 0.86 + rnd() * 0.22);
  // One smoothing pass keeps it pebble-like rather than spiky.
  const radii = raw.map((r, i) => (r * 2 + raw[(i + n - 1) % n] + raw[(i + 1) % n]) / 4);
  const speckles = Array.from({ length: 5 + Math.floor(rnd() * 7) }, () => ({
    a: rnd() * TAU,
    d: rnd() * 0.7,
    s: 0.025 + rnd() * 0.05,
    light: rnd() < 0.45,
  }));
  const vein = rnd() < 0.5 ? { a: rnd() * TAU, bend: (rnd() - 0.5) * 0.8 } : null;
  return {
    radii,
    squash: 0.86 + rnd() * 0.12,
    tint: (rnd() - 0.5) * 0.18,
    speckles,
    vein,
  };
}

/** An irregular CSS border-radius so DOM chips match the jar's organic feel. */
export function chipRadius(seed) {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const p = () => `${Math.round(40 + rnd() * 20)}%`;
  return `${p()} ${p()} ${p()} ${p()} / ${p()} ${p()} ${p()} ${p()}`;
}

function points(shape, r) {
  const n = shape.radii.length;
  return shape.radii.map((k, i) => {
    const a = (i / n) * TAU;
    return [Math.cos(a) * r * k, Math.sin(a) * r * k * shape.squash];
  });
}

export function traceStone(ctx, shape, r) {
  const pts = points(shape, r);
  const n = pts.length;
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  ctx.beginPath();
  const start = mid(pts[n - 1], pts[0]);
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % n]);
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
}

// --- colour helpers -------------------------------------------------------

export function parseColor(str) {
  const s = String(str || '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return m[1].split('').map((c) => parseInt(c + c, 16));
  m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return [120, 120, 120];
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function tinted(base, t) {
  return t >= 0 ? mix(base, [255, 255, 255], t) : mix(base, [0, 0, 0], -t);
}

/**
 * Draw a stone body (x, y, r, angle, shape) in world units. The light comes
 * from the top-left whatever the stone's rotation, while the speckles turn with it.
 */
export function drawStone(ctx, body, baseColor, alpha = 1) {
  const { x, y, angle, shape } = body;
  const r = body.r * 1.06;
  const base = tinted(parseColor(baseColor), shape.tint);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Soft contact shadow
  ctx.save();
  ctx.translate(x + r * 0.05, y + r * 0.12);
  ctx.rotate(angle);
  traceStone(ctx, shape, r);
  ctx.fillStyle = 'rgba(25, 20, 15, 0.2)';
  ctx.fill();
  ctx.restore();

  ctx.translate(x, y);
  ctx.rotate(angle);

  // Fixed light direction: rotate the highlight point back by -angle.
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const lx = -0.38 * r;
  const ly = -0.5 * r;
  const gx = lx * c + ly * s;
  const gy = -lx * s + ly * c;
  const grad = ctx.createRadialGradient(gx, gy, r * 0.06, gx * 0.25, gy * 0.25, r * 1.25);
  grad.addColorStop(0, rgb(mix(base, [255, 255, 255], 0.42)));
  grad.addColorStop(0.45, rgb(base));
  grad.addColorStop(1, rgb(mix(base, [0, 0, 0], 0.35)));

  traceStone(ctx, shape, r);
  ctx.fillStyle = grad;
  ctx.fill();

  // Surface texture, clipped to the stone
  ctx.save();
  ctx.clip();
  if (shape.vein) {
    const a = shape.vein.a;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1);
    ctx.quadraticCurveTo(
      Math.cos(a + Math.PI / 2) * r * shape.vein.bend,
      Math.sin(a + Math.PI / 2) * r * shape.vein.bend,
      Math.cos(a + Math.PI) * r * 1.1,
      Math.sin(a + Math.PI) * r * 1.1,
    );
    ctx.lineWidth = r * 0.07;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.stroke();
  }
  for (const sp of shape.speckles) {
    ctx.beginPath();
    ctx.arc(Math.cos(sp.a) * sp.d * r, Math.sin(sp.a) * sp.d * r * shape.squash, sp.s * r, 0, TAU);
    ctx.fillStyle = sp.light ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.17)';
    ctx.fill();
  }
  ctx.restore();

  traceStone(ctx, shape, r);
  ctx.lineWidth = Math.max(0.2, r * 0.035);
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.stroke();

  ctx.restore();
}
