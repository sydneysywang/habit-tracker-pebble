// Stone "clack" sounds made with Web Audio: a filtered noise burst plus a short
// low "tock". No audio files. Browsers only allow audio after a user gesture,
// so call unlock() from a pointer or key handler.

let ctx = null;
let noise = null;
let muted = false;
let lastAt = 0;

const FREQ = { pebble: 3400, stone: 2500, boulder: 1600 };

export function setMuted(value) {
  muted = !!value;
}

export function isMuted() {
  return muted;
}

export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const len = Math.floor(ctx.sampleRate * 0.12);
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

/**
 * @param {number} speed  impact speed in world units/second
 * @param {string} weight 'pebble' | 'stone' | 'boulder'
 * @param {boolean} glass whether the stone hit the jar wall (adds a faint ring)
 */
export function clack(speed, weight = 'stone', glass = false) {
  if (muted || !ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (now - lastAt < 0.045) return;
  const vol = Math.min(1, (speed - 40) / 380) * 0.5;
  if (vol <= 0.02) return;
  lastAt = now;

  const f = (FREQ[weight] || 2500) * (0.88 + Math.random() * 0.24);

  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = f;
  band.Q.value = 3.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(Math.min(1, vol * 2.2), now + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  src.connect(band).connect(g).connect(ctx.destination);
  src.start(now);
  src.stop(now + 0.12);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f * 0.3, now);
  osc.frequency.exponentialRampToValueAtTime(f * 0.2, now + 0.05);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, now);
  og.gain.exponentialRampToValueAtTime(vol * 0.5, now + 0.002);
  og.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
  osc.connect(og).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.08);

  if (glass) {
    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.value = 4800 + Math.random() * 900;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, now);
    rg.gain.exponentialRampToValueAtTime(vol * 0.12, now + 0.003);
    rg.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    ring.connect(rg).connect(ctx.destination);
    ring.start(now);
    ring.stop(now + 0.27);
  }
}
