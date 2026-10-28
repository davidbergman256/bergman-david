// The pond: koi drawn in characters, swimming over a wave simulation.
//
// Each koi is a chain of spine points that follows its head, so turns bend
// the whole body. Every frame the pond rasterizes koi, lily pads, food and
// drifting leaves into a character grid with a depth buffer, then draws the
// water (ripples from a damped wave equation) into whatever cells are left.
// Ripples also refract what's beneath them.

import {
  AsciiCanvas,
  animateWhileVisible,
  clamp,
  currentTheme,
  fontsReady,
  hash2,
  lerp,
  noise2,
  onThemeChange,
  onMotionChange,
  reducedMotion,
  rgba,
  hexToRgb,
  typeCouplets,
} from "./common.js";

const TAU = Math.PI * 2;
const LEVELS = 12;

const PALETTES = {
  light: {
    shiro: "#848f89",
    hi: "#c4522c",
    sumi: "#262e2a",
    ki: "#bb8a27",
    ai: "#52748a",
    cha: "#85623f",
    fin: "#88948d",
    eye: "#1b2320",
    water: "#56766d",
    shadow: "#1e2622",
    pad: "#5a7a4b",
    padRim: "#3b5532",
    lotus: "#cc7690",
    lotusCore: "#c99a2e",
    pellet: "#6f4722",
    mote: "#24302b",
    leaf0: "#b0512b",
    leaf1: "#c48728",
    leaf2: "#8c4b2b",
    moon: "#ffffff",
    letter: "#1e2622",
    snow: "#8fa2ab",
    petal: "#d4869c",
    firefly: "#b8902f",
  },
  dark: {
    shiro: "#e8e4d9",
    hi: "#ea6b3d",
    sumi: "#3b4642",
    ki: "#e6b34c",
    ai: "#86a5ba",
    cha: "#ba9061",
    fin: "#d3dad1",
    eye: "#0f1715",
    water: "#7faea3",
    shadow: "#000000",
    pad: "#4d7142",
    padRim: "#89ad76",
    lotus: "#e79ab0",
    lotusCore: "#ebbd52",
    pellet: "#cf9a5e",
    mote: "#d7e6e0",
    leaf0: "#d4683a",
    leaf1: "#dfa641",
    leaf2: "#b56340",
    moon: "#f1ead0",
    letter: "#e3e8df",
    snow: "#e2ebef",
    petal: "#eeaabd",
    firefly: "#f3d77e",
  },
};

// Body glyphs by band, from the back out to the flanks; the second of each
// pair is the occasional scale.
const BODY = ["@#", "#%", "*+"];

const VARIETIES = [
  { name: "kohaku", note: "white, with red markings", fin: "shiro", curious: 1 },
  { name: "tancho", note: "a single red crown", fin: "shiro", curious: 1 },
  { name: "showa", note: "black, red and white", fin: "sumi", curious: 0.9 },
  { name: "sanke", note: "red and white, ink spots", fin: "shiro", curious: 1 },
  { name: "ogon", note: "one metallic color", fin: "ki", curious: 1.1 },
  { name: "asagi", note: "blue net, orange belly", fin: "hi", curious: 0.8 },
  { name: "chagoi", note: "tea-brown, always first to say hi", fin: "cha", curious: 2.2 },
];

const SEASON = (() => {
  const m = new Date().getMonth();
  if (m >= 8 && m <= 10) return "autumn";
  if (m === 11 || m <= 1) return "winter";
  if (m >= 2 && m <= 4) return "spring";
  return "summer";
})();

const rand = (a, b) => a + Math.random() * (b - a);
const angleDiff = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

// Half-width of a koi body at t (0 = snout, 1 = start of the tail fin),
// as a fraction of its widest point.
function bodyWidth(t) {
  if (t < 0.3) return 0.52 + 0.48 * Math.sin((t / 0.3) * (Math.PI / 2));
  const k = (t - 0.3) / 0.7;
  return Math.max(0.2, Math.pow(1 - k, 1.2));
}

function storageGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// ------------------------------------------------------------------- sound

// Off until asked for. Koi pluck notes from a pentatonic scale when they
// eat, pizzicato, lower for bigger fish; food lands with a small plip.
class Sound {
  constructor() {
    this.on = false;
    this.ctx = null;
  }

  toggle() {
    this.on = !this.on;
    if (this.on && !this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return (this.on = false);
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.5;
      this.out.connect(this.ctx.destination);
    }
    if (this.on) this.ctx.resume();
    return this.on;
  }

  pluck(freq) {
    if (!this.on) return;
    const c = this.ctx;
    const t = c.currentTime;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(freq * 6, t);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.4);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    filter.connect(gain).connect(this.out);
    for (const [type, detune, level] of [
      ["triangle", 0, 1],
      ["sawtooth", 6, 0.18],
    ]) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      g.gain.value = level;
      o.connect(g).connect(filter);
      o.start(t);
      o.stop(t + 1);
    }
  }

  plip(strength = 1) {
    if (!this.on) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(1100 + Math.random() * 300, t);
    o.frequency.exponentialRampToValueAtTime(320, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09 * strength, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.2);
  }
}

// D major pentatonic, two octaves.
const SCALE = [293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25, 739.99, 880];

// ------------------------------------------------------------------- koi

class Koi {
  constructor(pond, variety, { x, y, length, butterfly = false, z = rand(0.3, 0.9) }) {
    this.pond = pond;
    this.variety = variety;
    this.butterfly = butterfly;
    this.seed = Math.random() * 1000;
    this.L = length;
    this.W = length * 0.155;
    this.N = 14;
    this.seg = length / (this.N - 1);
    this.heading = rand(0, TAU);
    this.speed = rand(18, 34);
    this.beat = rand(0, TAU);
    this.z = z;
    this.zTarget = z;
    this.fade = 1;
    this.mode = "cruise";
    this.modeTime = 0;
    this.nextGulp = pond.time + rand(6, 22);
    this.nextWake = 0;
    this.pts = new Float32Array(this.N * 2);
    this.rnd = new Float32Array(this.N * 2);
    this.widths = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) {
      this.pts[i * 2] = x - Math.cos(this.heading) * this.seg * i;
      this.pts[i * 2 + 1] = y - Math.sin(this.heading) * this.seg * i;
      this.widths[i] = bodyWidth(i / (this.N - 1)) * this.W;
    }
    this.fins = [];
  }

  get x() {
    return this.pts[0];
  }

  get y() {
    return this.pts[1];
  }

  update(dt) {
    const p = this.pond;
    const t = p.time;
    const scale = this.L / 190;
    this.modeTime += dt;

    let sx = Math.cos(this.heading);
    let sy = Math.sin(this.heading);
    let targetSpeed = (16 + 26 * noise2(t * 0.06, this.seed)) * scale;
    let turn = 1.15;

    // Wander: a slowly changing pull to one side.
    const wander = (noise2(t * 0.09 + this.seed, this.seed * 3.1) - 0.5) * 2.4;
    sx += Math.cos(this.heading + wander) * 0.8;
    sy += Math.sin(this.heading + wander) * 0.8;

    // Keep to the water, softly. Koi may slip past the edge a little.
    const m = Math.min(p.w, p.h) * 0.1 + this.L * 0.25;
    const hx = this.x;
    const hy = this.y;
    let ex = 0;
    let ey = 0;
    if (hx < m) ex += (m - hx) / m;
    if (hx > p.w - m) ex -= (hx - (p.w - m)) / m;
    if (hy < m) ey += (m - hy) / m;
    if (hy > p.h - m) ey -= (hy - (p.h - m)) / m;
    sx += ex * 3;
    sy += ey * 3;
    if (ex || ey) turn = 1.6;

    // Drift out from under the text rather than linger there.
    const calm = p.calm;
    if (hx > calm.x0 && hx < calm.x1 && hy > calm.y0 && hy < calm.y1) {
      const cx = (calm.x0 + calm.x1) / 2;
      const cy = (calm.y0 + calm.y1) / 2;
      const ax = (hx - cx) / (calm.x1 - calm.x0);
      const ay = (hy - cy) / (calm.y1 - calm.y0);
      const al = Math.hypot(ax, ay) || 1;
      sx += (ax / al) * 1.4;
      sy += (ay / al) * 1.4;
    }

    // Give each other room when swimming at a similar depth.
    for (const o of p.koi) {
      if (o === this) continue;
      const dx = hx - o.x;
      const dy = hy - o.y;
      const d = Math.hypot(dx, dy);
      const r = (this.L + o.L) * 0.42;
      if (d > 1 && d < r && Math.abs(this.z - o.z) < 0.3) {
        const f = ((r - d) / r) * 1.6;
        sx += (dx / d) * f;
        sy += (dy / d) * f;
      }
    }

    // Moods, strongest first.
    const ptr = p.pointer;
    const pd = Math.hypot(ptr.x - hx, ptr.y - hy);
    if (ptr.speed > 900 && pd < 150 + this.L * 0.4 && this.mode !== "flee") {
      this.mode = "flee";
      this.modeTime = 0;
      this.zTarget = Math.max(0.15, this.z - 0.4);
    }

    let food = null;
    if (this.mode !== "flee") {
      let best = 360 * Math.max(1, scale);
      for (const f of p.pellets) {
        if (f.eaten) continue;
        const d = Math.hypot(f.x - hx, f.y - hy);
        if (d < best) {
          best = d;
          food = f;
        }
      }
    }

    if (this.mode === "flee") {
      const ax = hx - ptr.x;
      const ay = hy - ptr.y;
      const d = Math.hypot(ax, ay) || 1;
      sx += (ax / d) * 5;
      sy += (ay / d) * 5;
      targetSpeed = 230 * scale;
      turn = 4;
      if (this.modeTime > 1.4) {
        this.mode = "cruise";
        this.zTarget = rand(0.3, 0.8);
      }
    } else if (food) {
      this.mode = "feed";
      const dx = food.x - hx;
      const dy = food.y - hy;
      const d = Math.hypot(dx, dy) || 1;
      sx += (dx / d) * 4;
      sy += (dy / d) * 4;
      targetSpeed = clamp(d * 1.1, 40, 125) * scale;
      turn = 2.6;
      this.zTarget = 0.95;
      if (d < this.L * 0.075 + 6) {
        food.eaten = true;
        p.eat(this, food);
      }
    } else if (ptr.inside && ptr.still > 1.1 && pd < 300 * this.variety.curious) {
      // Curious: drift up to a cursor that's been resting on the water.
      this.mode = "curious";
      const dx = ptr.x - hx;
      const dy = ptr.y - hy;
      const d = Math.hypot(dx, dy) || 1;
      const pull = d > 46 ? 2.4 : -0.6;
      sx += (dx / d) * pull;
      sy += (dy / d) * pull;
      targetSpeed = d > 46 ? clamp(d * 0.4, 14, 60) * scale : 6;
      turn = 1.8;
      this.zTarget = 0.9;
      if (d < 70 && t > this.nextGulp - 8) {
        p.disturb(hx + Math.cos(this.heading) * 6, hy + Math.sin(this.heading) * 6, 1.1, 7);
        this.nextGulp = t + rand(1.4, 3.2) + 8;
      }
    } else {
      this.mode = "cruise";
      if (Math.random() < dt * 0.05) this.zTarget = rand(0.22, 0.92);
      // Koi often trail one another in loose processions.
      if (this.leader && (t > this.followUntil || this.leader.mode !== "cruise")) this.leader = null;
      if (!this.leader && Math.random() < dt * 0.04) {
        const options = p.koi.filter((o) => o !== this && o.leader !== this && o.fade > 0.5);
        if (options.length) {
          this.leader = options[Math.floor(Math.random() * options.length)];
          this.followUntil = t + rand(8, 20);
        }
      }
      if (this.leader) {
        const o = this.leader;
        const tx = o.pts[(o.N - 1) * 2] - Math.cos(o.heading) * o.L * 0.25;
        const ty = o.pts[(o.N - 1) * 2 + 1] - Math.sin(o.heading) * o.L * 0.25;
        const dx = tx - hx;
        const dy = ty - hy;
        const d = Math.hypot(dx, dy) || 1;
        sx += (dx / d) * 1.3;
        sy += (dy / d) * 1.3;
        targetSpeed = clamp(o.speed * (d > this.L ? 1.25 : 0.9), 12 * scale, 70 * scale);
        this.zTarget = lerp(this.zTarget, o.z, 0.02);
      }
    }

    const desired = Math.atan2(sy, sx);
    const dh = angleDiff(this.heading, desired);
    // A koi can't turn tighter than about a third of its length.
    const maxTurn = Math.min(turn, this.speed / (this.L * 0.32) + 0.16) * dt;
    this.heading += clamp(dh, -maxTurn, maxTurn);
    this.speed = lerp(this.speed, targetSpeed, 1 - Math.exp(-dt * (this.mode === "flee" ? 4 : 1.2)));
    this.z = lerp(this.z, this.zTarget, 1 - Math.exp(-dt * 0.5));
    this.beat += dt * (3.1 + (this.speed / scale) * 0.045);

    // Head moves; the rest of the spine follows at fixed spacing.
    const P = this.pts;
    P[0] += Math.cos(this.heading) * this.speed * dt;
    P[1] += Math.sin(this.heading) * this.speed * dt;
    let prevAng = this.heading;
    for (let i = 1; i < this.N; i++) {
      let ang = Math.atan2(P[i * 2 - 1] - P[i * 2 + 1], P[i * 2 - 2] - P[i * 2]);
      // Each joint bends only so far, so the body curves instead of folding.
      const bend = angleDiff(prevAng, ang);
      if (bend > 0.125) ang = prevAng + 0.125;
      else if (bend < -0.125) ang = prevAng - 0.125;
      P[i * 2] = P[i * 2 - 2] - Math.cos(ang) * this.seg;
      P[i * 2 + 1] = P[i * 2 - 1] - Math.sin(ang) * this.seg;
      prevAng = ang;
    }

    // Surface life: the odd gulp, and a faint wake when shallow and quick.
    if (this.z > 0.72 && t > this.nextGulp && this.mode === "cruise") {
      p.disturb(hx + Math.cos(this.heading) * 4, hy + Math.sin(this.heading) * 4, 1.0, 7);
      this.nextGulp = t + rand(12, 30);
    }
    if (this.z > 0.6 && this.speed > 55 && t > this.nextWake) {
      p.disturb(P[4], P[5], 0.08 + this.speed * 0.0012, 9);
      this.nextWake = t + 0.09;
    }
  }

  // Spine with the swimming wave applied, plus fin geometry.
  pose() {
    const P = this.pts;
    const R = this.rnd;
    const N = this.N;
    const amp = this.W * (0.55 + Math.min(1, this.speed / (90 * (this.L / 190))) * 0.5);
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(N - 1, i + 1);
      let tx = P[a * 2] - P[b * 2];
      let ty = P[a * 2 + 1] - P[b * 2 + 1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const k = i / (N - 1);
      const off = amp * Math.pow(k, 1.8) * Math.sin(this.beat - i * 0.42);
      R[i * 2] = P[i * 2] - ty * off;
      R[i * 2 + 1] = P[i * 2 + 1] + tx * off;
    }

    const fins = [];
    const L = this.L;
    const lobe = this.butterfly ? 0.46 : 0.31;
    // Tail: two lobes fanning back from the last spine point.
    const ex = R[(N - 1) * 2];
    const ey = R[(N - 1) * 2 + 1];
    const back = Math.atan2(ey - R[(N - 2) * 2 + 1], ex - R[(N - 2) * 2]);
    const sway = Math.sin(this.beat - N * 0.42) * 0.42;
    for (const side of [-1, 1]) {
      const a1 = back + side * 0.3 + sway * 0.6;
      const a2 = back + side * (this.butterfly ? 0.52 : 0.46) + sway;
      const mx = ex + Math.cos(a1) * L * lobe * 0.5;
      const my = ey + Math.sin(a1) * L * lobe * 0.5;
      fins.push({
        pts: [ex, ey, mx, my, mx + Math.cos(a2) * L * lobe * 0.5, my + Math.sin(a2) * L * lobe * 0.5],
        w: L * (this.butterfly ? 0.075 : 0.065),
        tail: true,
      });
    }
    // Pectoral fins: out from the shoulders, sculling slowly.
    const si = 3;
    const sxp = R[si * 2];
    const syp = R[si * 2 + 1];
    const fwd = Math.atan2(R[(si - 1) * 2 + 1] - R[(si + 1) * 2 + 1], R[(si - 1) * 2] - R[(si + 1) * 2]);
    const pec = this.butterfly ? 0.27 : 0.17;
    const scull = Math.sin(this.pond.time * 1.7 + this.seed) * 0.22;
    for (const side of [-1, 1]) {
      const nx = Math.cos(fwd + (side * Math.PI) / 2);
      const ny = Math.sin(fwd + (side * Math.PI) / 2);
      const bx = sxp + nx * this.widths[si] * 0.7;
      const by = syp + ny * this.widths[si] * 0.7;
      const a1 = fwd + side * (2.0 + scull);
      const a2 = fwd + side * (2.35 + scull * 1.4);
      const mx = bx + Math.cos(a1) * L * pec * 0.55;
      const my = by + Math.sin(a1) * L * pec * 0.55;
      fins.push({
        pts: [bx, by, mx, my, mx + Math.cos(a2) * L * pec * 0.45, my + Math.sin(a2) * L * pec * 0.45],
        w: L * (this.butterfly ? 0.055 : 0.045),
        tail: false,
      });
    }
    this.fins = fins;
  }

  // Which colour a point of skin is, by variety. t runs snout to tail,
  // s is -1..1 across the body.
  skin(t, s) {
    const k = this.seed;
    const L = this.L;
    const u = (t * L) / 34;
    const v = (s * this.W) / 22;
    const n = noise2(u + k, v + k * 1.7);
    switch (this.variety.name) {
      case "kohaku": {
        if (t < 0.15 && Math.abs(s) < 0.62 && hash2(k | 0, 7) > 0.35) return "hi";
        return t < 0.88 && n > 0.5 - 0.12 * (1 - Math.abs(s)) ? "hi" : "shiro";
      }
      case "tancho": {
        const dt = (t - 0.13) * L;
        const ds = s * this.W * bodyWidth(t);
        return dt * dt + ds * ds < (L * 0.075) ** 2 ? "hi" : "shiro";
      }
      case "showa": {
        if (n > 0.56) return "hi";
        const n2 = noise2(u * 1.3 - k, v * 1.3 + 4);
        return n2 > 0.58 ? "shiro" : "sumi";
      }
      case "sanke": {
        const n3 = noise2(u * 2.6 + 9, v * 2.6 - k);
        if (t > 0.2 && t < 0.85 && Math.abs(s) < 0.75 && n3 > 0.72) return "sumi";
        return t < 0.86 && n > 0.52 ? "hi" : "shiro";
      }
      case "ogon":
        return "ki";
      case "asagi":
        if (Math.abs(s) > 0.66 || t > 0.9) return "hi";
        return t < 0.14 ? "shiro" : "ai";
      default:
        return "cha";
    }
  }

  // Scale net (asagi, chagoi) and metallic glints (ogon) change the glyph.
  sheen(t, s) {
    const name = this.variety.name;
    if (name === "ogon") {
      const g = Math.sin(this.pond.time * 1.3 + t * 9 - s * 2 + this.seed);
      return g > 0.86 ? 0.25 : 0;
    }
    if (name === "asagi" || name === "chagoi") {
      const a = (t * this.L) / 9 + s * 1.2;
      const b = (t * this.L) / 9 - s * 1.2;
      const net = Math.min(Math.abs(a - Math.round(a)), Math.abs(b - Math.round(b)));
      return net < 0.12 ? -0.28 : 0;
    }
    return 0;
  }

  raster() {
    if (this.fade < 0.02) return;
    const p = this.pond;
    const { cw, ch, cols, rows } = p.grid;
    const R = this.rnd;
    const N = this.N;
    const alpha = clamp((0.5 + 0.5 * this.z) * this.fade, 0, 1);
    const zz = this.z;

    // Bounds of body and fins, in cells.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < N; i++) {
      minX = Math.min(minX, R[i * 2]);
      maxX = Math.max(maxX, R[i * 2]);
      minY = Math.min(minY, R[i * 2 + 1]);
      maxY = Math.max(maxY, R[i * 2 + 1]);
    }
    for (const f of this.fins) {
      for (let j = 0; j < 6; j += 2) {
        minX = Math.min(minX, f.pts[j]);
        maxX = Math.max(maxX, f.pts[j]);
        minY = Math.min(minY, f.pts[j + 1]);
        maxY = Math.max(maxY, f.pts[j + 1]);
      }
    }
    const pad = this.W + 4;
    const c0 = Math.max(0, Math.floor((minX - pad) / cw));
    const c1 = Math.min(cols - 1, Math.ceil((maxX + pad) / cw));
    const r0 = Math.max(0, Math.floor((minY - pad) / ch));
    const r1 = Math.min(rows - 1, Math.ceil((maxY + pad) / ch));
    if (c0 > c1 || r0 > r1) return;

    // Light comes from the upper left.
    const lx = -0.6;
    const ly = -0.8;
    const shadowDx = Math.round((5 + 16 * zz) / cw);
    const shadowDy = Math.round((8 + 22 * zz) / ch);

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const idx = r * cols + c;
        const px = (c + 0.5) * cw + p.offX[idx];
        const py = (r + 0.5) * ch + p.offY[idx];

        // Nearest point on the spine.
        let best = Infinity;
        let bt = 0;
        let side = 0;
        let nx = 0;
        let ny = 0;
        for (let i = 0; i < N - 1; i++) {
          const ax = R[i * 2];
          const ay = R[i * 2 + 1];
          const bx = R[i * 2 + 2];
          const by = R[i * 2 + 3];
          const vx = bx - ax;
          const vy = by - ay;
          const ll = vx * vx + vy * vy || 1;
          let u = ((px - ax) * vx + (py - ay) * vy) / ll;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const qx = ax + vx * u - px;
          const qy = ay + vy * u - py;
          const d2 = qx * qx + qy * qy;
          if (d2 < best) {
            best = d2;
            bt = (i + u) / (N - 1);
            side = vx * (py - ay) - vy * (px - ax);
            const l = Math.sqrt(ll);
            nx = -vy / l;
            ny = vx / l;
          }
        }
        const dist = Math.sqrt(best);
        const w = bodyWidth(bt) * this.W;

        if (dist < w) {
          const s = (side < 0 ? -1 : 1) * (dist / w);
          const as = Math.abs(s);
          const dome = Math.sqrt(1 - as * as);
          const facing = (side < 0 ? -1 : 1) * (nx * lx + ny * ly);
          const sheen = this.sheen(bt, s);
          let shade = 0.3 + 0.62 * dome + 0.16 * facing * as + sheen;
          shade = clamp(shade, 0.05, 1);
          const hue = this.skin(bt, s);
          // Bands that run along the body: a dense ridge, lighter flanks, a
          // soft edge. Glints and the scale net nudge a cell a band over.
          let band = as < 0.38 ? 0 : as < 0.7 ? 1 : 2;
          if (sheen > 0) band = Math.max(0, band - 1);
          if (sheen < 0) band = Math.min(2, band + 1);
          const scale = hash2(Math.floor((bt * this.L) / 7 + this.seed), Math.floor(s * 3) + 50) < 0.22;
          // The outermost cells trace the outline with strokes along the body;
          // a dorsal ridge runs down the middle of the back.
          const edge = as > 0.84 && bt > 0.06;
          const ridge = !edge && as < 0.13 && bt > 0.3 && bt < 0.66;
          const glyph = edge || ridge ? p.stroke(Math.atan2(ny, nx) + Math.PI / 2) : p.gBody[band][scale ? 1 : 0];
          const a = Math.round(LEVELS * alpha * (edge ? 0.6 : ridge ? 0.5 : 0.42 + 0.58 * shade));
          p.put(idx, glyph, p.pal[hue][clamp(a, 1, LEVELS)], zz);
          // Shadow on the floor.
          const sr = r + shadowDy;
          const sc = c + shadowDx;
          if (sr < rows && sc < cols && zz > 0.25) {
            p.put(sr * cols + sc, p.gShadow, p.pal.shadow[Math.max(1, Math.round(1.6 * this.fade))], 0.02);
          }
          continue;
        }

        // Fins: translucent, drawn with strokes along the fin.
        for (const f of this.fins) {
          const F = f.pts;
          for (let j = 0; j < 4; j += 2) {
            const ax = F[j];
            const ay = F[j + 1];
            const vx = F[j + 2] - ax;
            const vy = F[j + 3] - ay;
            const ll = vx * vx + vy * vy || 1;
            let u = ((px - ax) * vx + (py - ay) * vy) / ll;
            if (u < 0 || u > 1) continue;
            const qx = ax + vx * u - px;
            const qy = ay + vy * u - py;
            const along = (j / 2 + u) / 2;
            const fw = f.w * Math.pow(Math.sin(Math.PI * Math.min(0.98, along * 0.85 + 0.12)), 0.7);
            const fd2 = qx * qx + qy * qy;
            if (fd2 < fw * fw) {
              // Fins are drawn as their rays: strokes along the fin, fading
              // toward the tips, with a fainter membrane at the margins.
              const ray = fd2 < fw * fw * 0.3;
              const fa = Math.round(LEVELS * alpha * (ray ? 0.58 : 0.26) * (1 - along * 0.45));
              const glyph = ray ? p.stroke(Math.atan2(vy, vx)) : p.gFin;
              p.put(idx, glyph, p.pal[this.variety.fin][clamp(fa, 1, LEVELS)], zz - 0.001);
              j = 4;
            }
          }
        }
      }
    }

    // Eyes, and the two barbels at the mouth.
    const ex = R[0];
    const ey = R[1];
    const fwd = Math.atan2(R[1] - R[3], R[0] - R[2]);
    for (const sd of [-1, 1]) {
      const a = fwd + sd * 0.55 + Math.sin(p.time * 2 + this.seed + sd) * 0.15;
      const reach = bodyWidth(0) * this.W + 5;
      const bx = ex + Math.cos(a) * reach;
      const by = ey + Math.sin(a) * reach;
      const c = Math.floor(bx / cw);
      const r = Math.floor(by / ch);
      if (c >= 0 && r >= 0 && c < cols && r < rows) {
        p.put(r * cols + c, p.stroke(a), p.pal[this.variety.fin][clamp(Math.round(LEVELS * alpha * 0.45), 1, LEVELS)], zz - 0.002);
      }
    }
    for (const sd of [-1, 1]) {
      const a = fwd + (sd * Math.PI) / 2;
      const px = ex + Math.cos(fwd) * -this.L * 0.035 + Math.cos(a) * this.W * 0.42;
      const py = ey + Math.sin(fwd) * -this.L * 0.035 + Math.sin(a) * this.W * 0.42;
      const c = Math.floor(px / cw);
      const r = Math.floor(py / ch);
      if (c >= 0 && r >= 0 && c < cols && r < rows) {
        p.put(r * cols + c, p.gEye, p.pal.eye[clamp(Math.round(LEVELS * alpha), 1, LEVELS)], zz + 0.002);
      }
    }
  }

  // Rough hit test for the hover label.
  contains(x, y) {
    if (this.fade < 0.4) return false;
    const R = this.rnd;
    for (let i = 0; i < this.N; i++) {
      const d = Math.hypot(R[i * 2] - x, R[i * 2 + 1] - y);
      if (d < this.widths[i] + 6) return true;
    }
    return false;
  }
}

// ------------------------------------------------------------------- pond

class Pond {
  constructor(canvas) {
    this.canvas = canvas;
    this.time = 0;
    this.koi = [];
    this.pellets = [];
    this.letters = [];
    this.pads = [];
    this.drifters = [];
    this.motes = [];
    this.pointer = { x: -1e4, y: -1e4, fx: -1e4, fy: -1e4, speed: 0, still: 0, inside: false, type: "mouse" };
    this.fedTotal = storageGet("pond.fed", 0);
    this.fedNow = 0;
    this.nextDrip = rand(3, 7);
    this.nextDrifter = rand(4, 9);
    this.simAcc = 0;
    this.hud = {
      koi: document.querySelector("[data-koi-count]"),
      fed: document.querySelector("[data-fed-count]"),
    };
    this.label = document.querySelector("[data-koi-label]");
    this.sound = new Sound();
    const soundButton = document.querySelector("[data-sound]");
    soundButton?.addEventListener("click", () => {
      const on = this.sound.toggle();
      soundButton.textContent = on ? "on" : "off";
      soundButton.setAttribute("aria-pressed", String(on));
      if (on) this.sound.pluck(SCALE[4]);
    });
    this.grid = new AsciiCanvas(canvas, { fontSize: 10, lineHeight: 0.9, tracking: 0 });
    this.layout();
    this.palette();
    this.populate();
    this.bind();
  }

  layout() {
    const w = innerWidth;
    const h = innerHeight;
    const oldW = this.w;
    const oldH = this.h;
    this.w = w;
    this.h = h;
    this.grid.fontSize = w < 640 ? 9 : 10;
    this.grid.resize(w, h);
    const n = this.grid.cols * this.grid.rows;
    this.gBuf = new Int16Array(n);
    this.cBuf = new Int16Array(n);
    this.zBuf = new Float32Array(n);
    this.cur = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.offX = new Float32Array(n);
    this.offY = new Float32Array(n);
    // A sparse scatter of pebbles, fixed to the grid.
    this.pebbles = [];
    for (let i = 0; i < n; i++) if (hash2(i % this.grid.cols, (i / this.grid.cols) | 0) < 0.005) this.pebbles.push(i);
    this.glyphs();
    this.haze = new Uint8Array(n);
    this.measureCalm();
    if (oldW && (oldW !== w || oldH !== h)) {
      for (const k of this.koi) {
        const sx = w / oldW;
        const sy = h / oldH;
        for (let i = 0; i < k.N; i++) {
          k.pts[i * 2] *= sx;
          k.pts[i * 2 + 1] *= sy;
        }
      }
      for (const pad of this.pads) {
        pad.ax *= w / oldW;
        pad.ay *= h / oldH;
      }
    }
  }

  // Where the text sits. Koi drift out from under it, and the water there
  // is hazy: whatever passes is drawn faintly, with a softer band around
  // the edge (haze 1 = band, 2 = under the text).
  measureCalm() {
    const r = document.querySelector(".intro")?.getBoundingClientRect();
    this.calm = r
      ? { x0: r.left - 30, y0: r.top - 30, x1: r.right + 30, y1: r.bottom + 30 }
      : { x0: 0, y0: 0, x1: 0, y1: 0 };
    this.haze.fill(0);
    const { cols, rows, cw, ch } = this.grid;
    // The nav and the counts get the same courtesy, with a tighter margin.
    const areas = [
      [r, 10, 34],
      [document.querySelector(".nav")?.getBoundingClientRect(), 2, 14],
      [document.querySelector(".pond-hud")?.getBoundingClientRect(), 2, 14],
    ];
    for (const [rect, inner, outer] of areas) {
      if (!rect) continue;
      const c0 = Math.max(0, Math.floor((rect.left - outer) / cw));
      const c1 = Math.min(cols - 1, Math.ceil((rect.right + outer) / cw));
      const r0 = Math.max(0, Math.floor((rect.top - outer) / ch));
      const r1 = Math.min(rows - 1, Math.ceil((rect.bottom + outer) / ch));
      for (let row = r0; row <= r1; row++) {
        for (let c = c0; c <= c1; c++) {
          const x = (c + 0.5) * cw;
          const y = (row + 0.5) * ch;
          const dx = Math.max(rect.left - x, 0, x - rect.right);
          const dy = Math.max(rect.top - y, 0, y - rect.bottom);
          const d = Math.max(dx, dy * 1.4);
          const i = row * cols + c;
          this.haze[i] = Math.max(this.haze[i], d < inner ? 2 : d < outer ? 1 : 0);
        }
      }
    }
  }

  glyphs() {
    const g = this.grid;
    this.gBody = BODY.map((pair) => [...pair].map((c) => g.glyph(c)));
    this.gFin = g.glyph(":");
    this.gStroke = ["-", "\\", "|", "/"].map((c) => g.glyph(c));
    this.gShadow = g.glyph(".");
    this.gEye = g.glyph("o");
    this.gDot = g.glyph(".");
    this.gTick = g.glyph("`");
    this.gComma = g.glyph(",");
    this.gTilde = g.glyph("~");
    this.gPellet = g.glyph("o");
    this.gPadFill = g.glyph(".");
    this.gPebble = [..."o.,.'.,"].map((c) => g.glyph(c));
    this.gMoon = [..." .:-=+"].map((c) => g.glyph(c));
    this.gPadCore = g.glyph("+");
    this.gLotus = [..."*@o"].map((c) => g.glyph(c));
    this.gLeaf = g.glyph("%");
    this.gPetal = g.glyph("*");
    this.gStar = g.glyph("*");
  }

  palette() {
    const theme = currentTheme();
    const src = PALETTES[theme];
    this.theme = theme;
    this.grid.resetColors();
    this.pal = {};
    for (const [name, hex] of Object.entries(src)) {
      const rgb = hexToRgb(hex);
      const levels = new Int16Array(LEVELS + 1);
      for (let l = 1; l <= LEVELS; l++) levels[l] = this.grid.color(rgba(rgb, l / LEVELS));
      this.pal[name] = levels;
    }
    // For each colour, the same hue fainter: once for the haze's edge,
    // more for under the text.
    const count = this.grid.colors.length;
    this.hazeMap = [null, new Int16Array(count), new Int16Array(count)];
    for (const levels of Object.values(this.pal)) {
      for (let l = 1; l <= LEVELS; l++) {
        this.hazeMap[1][levels[l]] = levels[Math.max(1, Math.round(l * 0.5))];
        this.hazeMap[2][levels[l]] = levels[Math.max(1, Math.round(l * 0.2))];
      }
    }
  }

  stroke(angle) {
    // Map a direction to the character that draws it (screen y points down).
    let a = angle % Math.PI;
    if (a < 0) a += Math.PI;
    const i = Math.round(a / (Math.PI / 4)) % 4;
    return this.gStroke[i];
  }

  // ------------------------------------------------------------- setup

  baseCount() {
    return clamp(Math.round((this.w * this.h) / 230000), 3, 6);
  }

  populate() {
    const area = this.w * this.h;
    const small = this.w < 640;
    const base = this.baseCount();
    this.target = base + Math.min(3, Math.floor(this.fedTotal / 12));
    const order = [0, 1, 4, 2, 6, 3, 5];
    for (let i = 0; i < this.target; i++) this.spawn(VARIETIES[order[i % order.length]], i === 2);
    this.makePads(small);
    const motes = Math.round(area / 26000);
    for (let i = 0; i < motes; i++) {
      this.motes.push({ x: rand(0, this.w), y: rand(0, this.h), s: Math.random() });
    }
    this.updateHud();
  }

  spawn(variety, butterfly = false, fadeIn = false) {
    const unit = clamp(Math.min(this.w, this.h * 1.5) * 0.21, 140, 270);
    const len = unit * rand(0.78, 1.12) * (variety.name === "chagoi" ? 1.12 : 1);
    const x = rand(this.w * 0.12, this.w * 0.88);
    const y = rand(this.h * 0.15, this.h * 0.85);
    const k = new Koi(this, variety, { x, y, length: len, butterfly });
    if (fadeIn) {
      k.z = 0.05;
      k.zTarget = 0.7;
      k.fade = 0;
    }
    this.koi.push(k);
    return k;
  }

  makePads(small) {
    const count = small ? 2 : 3;
    const tries = 60;
    const unit = clamp(Math.min(this.w, this.h * 1.5) * 0.21, 140, 270);
    for (let n = 0; n < count; n++) {
      for (let t = 0; t < tries; t++) {
        const r = clamp(unit * rand(0.13, 0.19), 20, 54);
        const x = rand(r + 20, this.w - r - 20);
        const y = rand(r + 60, this.h - r - 40);
        const c = this.calm;
        if (x > c.x0 - r && x < c.x1 + r && y > c.y0 - r && y < c.y1 + r) continue;
        if (this.pads.some((p) => Math.hypot(p.ax - x, p.ay - y) < p.r + r + 60)) continue;
        if (x > this.w - 180 && y < 120) continue;
        this.pads.push({
          ax: x,
          ay: y,
          x,
          y,
          vx: 0,
          vy: 0,
          r,
          rot: rand(0, TAU),
          spin: rand(-0.04, 0.04),
          lotus: n === 0,
        });
        break;
      }
    }
  }

  // ------------------------------------------------------------- water

  disturb(x, y, amp, radius) {
    const { cw, ch, cols, rows } = this.grid;
    const c0 = Math.max(1, Math.floor((x - radius * 2) / cw));
    const c1 = Math.min(cols - 2, Math.ceil((x + radius * 2) / cw));
    const r0 = Math.max(1, Math.floor((y - radius * 2) / ch));
    const r1 = Math.min(rows - 2, Math.ceil((y + radius * 2) / ch));
    const inv = 1 / (radius * radius);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * cw - x;
        const dy = (r + 0.5) * ch - y;
        const f = Math.exp(-(dx * dx + dy * dy) * inv);
        if (f > 0.01) this.cur[r * cols + c] += amp * f;
      }
    }
  }

  stepWater() {
    const { cols, rows, cw, ch } = this.grid;
    const cur = this.cur;
    const prev = this.prev;
    const ry = (cw / ch) ** 2;
    const c2 = 0.42;
    const damp = 0.968;
    for (let r = 1; r < rows - 1; r++) {
      let i = r * cols + 1;
      for (let c = 1; c < cols - 1; c++, i++) {
        const v = cur[i];
        const lap = cur[i - 1] + cur[i + 1] - 2 * v + ry * (cur[i - cols] + cur[i + cols] - 2 * v);
        prev[i] = (2 * v - prev[i] + c2 * lap) * damp;
      }
    }
    this.cur = prev;
    this.prev = cur;
  }

  // Refraction: whatever lies under a sloped surface appears shifted.
  computeOffsets() {
    const { cols, rows } = this.grid;
    const h = this.cur;
    const ox = this.offX;
    const oy = this.offY;
    const k = 5.5;
    ox.fill(0);
    oy.fill(0);
    for (let r = 1; r < rows - 1; r++) {
      let i = r * cols + 1;
      for (let c = 1; c < cols - 1; c++, i++) {
        const gx = h[i + 1] - h[i - 1];
        const gy = h[i + cols] - h[i - cols];
        if (gx || gy) {
          ox[i] = gx * k;
          oy[i] = gy * k;
        }
      }
    }
  }

  // ------------------------------------------------------------- events

  bind() {
    const ptr = this.pointer;
    let lastT = performance.now();
    const move = (e) => {
      const now = performance.now();
      const dt = Math.max(1, now - lastT) / 1000;
      lastT = now;
      const dx = e.clientX - ptr.x;
      const dy = e.clientY - ptr.y;
      const inst = ptr.x < -1e3 ? 0 : Math.hypot(dx, dy) / dt;
      ptr.speed = lerp(ptr.speed, Math.min(inst, 4000), 0.35);
      ptr.fx = ptr.x;
      ptr.fy = ptr.y;
      ptr.x = e.clientX;
      ptr.y = e.clientY;
      ptr.inside = true;
      ptr.still = 0;
      ptr.type = e.pointerType;
      ptr.moved = (ptr.moved || 0) + Math.hypot(dx, dy);
    };
    addEventListener("pointermove", move, { passive: true });
    addEventListener("pointerdown", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", () => {
      ptr.inside = false;
      ptr.x = ptr.y = -1e4;
      this.hideLabel();
    });
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const pad = this.pads.find((p) => Math.hypot(p.x - e.clientX, p.y - e.clientY) < p.r);
      if (pad) {
        pad.vx += rand(-40, 40);
        pad.vy += rand(-40, 40);
        this.disturb(e.clientX, e.clientY, 2.2, 14);
        return;
      }
      this.feed(e.clientX, e.clientY);
    });
    // Typing writes on the water; Enter scatters food.
    addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (target instanceof HTMLElement && target.closest("a, button, input, textarea, [contenteditable]")) return;
      if (e.key === "Enter") {
        const x = ptr.inside ? ptr.x : rand(this.w * 0.45, this.w * 0.85);
        const y = ptr.inside ? ptr.y : rand(this.h * 0.25, this.h * 0.7);
        this.feed(x, y);
        return;
      }
      if (e.key.length !== 1 || e.repeat) return;
      this.write(e.key);
    });
    // On short screens the text can scroll; the haze follows it.
    let scrollQueued = false;
    addEventListener(
      "scroll",
      () => {
        if (scrollQueued) return;
        scrollQueued = true;
        requestAnimationFrame(() => {
          scrollQueued = false;
          this.measureCalm();
        });
      },
      { passive: true },
    );
    let resizeTimer = 0;
    addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this.layout();
        this.palette();
        if (reducedMotion()) this.frame(0);
      }, 120);
    });
  }

  // Letters land where the cursor rests (or somewhere open), one after
  // another like a line of type, then float off and dissolve.
  write(ch) {
    const { cw, ch: rowH } = this.grid;
    const ptr = this.pointer;
    const pen = this.pen;
    const fresh = !pen || this.time - pen.last > 1.8 || (ptr.inside && Math.hypot(ptr.x - pen.ox, ptr.y - pen.oy) > 4);
    if (fresh) {
      let x = ptr.inside ? ptr.x + 14 : rand(this.w * 0.5, this.w * 0.75);
      let y = ptr.inside ? ptr.y : rand(this.h * 0.2, this.h * 0.4);
      const c = this.calm;
      if (x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1) {
        x = c.x1 + 40;
        y = clamp(y, 80, this.h - 80);
      }
      this.pen = { x, y, x0: x, ox: ptr.x, oy: ptr.y, last: this.time };
    }
    const p = this.pen;
    p.last = this.time;
    if (ch === " ") {
      p.x += cw * 2.2;
      return;
    }
    if (p.x > this.w - 40) {
      p.x = p.x0;
      p.y += rowH * 3;
    }
    const glyph = this.grid.glyph(ch);
    if (glyph > 220) return;
    this.letters.push({ glyph, x: p.x, y: p.y, vx: 0, vy: 0, age: 0, life: rand(8, 11) });
    this.disturb(p.x, p.y, 0.9, 6);
    this.sound.plip(0.25);
    p.x += cw * 1.7;
    if (reducedMotion()) this.frame(0);
  }

  feed(x, y) {
    const n = Math.round(rand(3, 5));
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const d = rand(2, 16);
      this.pellets.push({
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        vx: Math.cos(a) * rand(4, 12),
        vy: Math.sin(a) * rand(4, 12),
        age: 0,
        eaten: false,
      });
    }
    this.disturb(x, y, 3.2, 11);
    this.sound.plip();
    if (reducedMotion()) this.frame(0);
  }

  eat(koi, pellet) {
    this.disturb(pellet.x, pellet.y, 1.4, 7);
    koi.beat += 1.2;
    // Each koi keeps to its own register: the bigger, the lower.
    const lengths = this.koi.map((k) => k.L).sort((a, b) => b - a);
    const rank = lengths.indexOf(koi.L) / Math.max(1, lengths.length - 1);
    const step = Math.round(rank * 5) + Math.floor(Math.random() * 3);
    this.sound.pluck(SCALE[clamp(step, 0, SCALE.length - 1)]);
    this.fedNow++;
    this.fedTotal++;
    storageSet("pond.fed", this.fedTotal);
    const earned = Math.min(3, Math.floor(this.fedTotal / 12));
    if (this.baseCount() + earned > this.koi.length) {
      const v = VARIETIES[(this.koi.length * 3) % VARIETIES.length];
      this.spawn(v, Math.random() < 0.4, true);
    }
    this.updateHud();
  }

  // The page opens on still water; the koi rise into view one at a time.
  entrance() {
    this.koi.forEach((k, i) => {
      k.fade = 0;
      k.delay = 0.4 + i * 0.55;
      k.z = 0.05;
    });
    this.updateHud();
  }

  updateHud() {
    const seen = this.koi.filter((k) => !(k.delay > 0)).length;
    if (this.hud.koi) this.hud.koi.textContent = String(seen);
    if (this.hud.fed) this.hud.fed.textContent = String(this.fedNow);
  }

  hideLabel() {
    this.label?.classList.remove("is-visible");
    this.labelKoi = null;
  }

  updateLabel() {
    const ptr = this.pointer;
    if (!this.label || !ptr.inside || ptr.type === "touch") return this.hideLabel();
    // Only when the cursor is over open water, not over the text.
    const el = document.elementFromPoint(ptr.x, ptr.y);
    if (el !== this.canvas) return this.hideLabel();
    const hit = [...this.koi].sort((a, b) => b.z - a.z).find((k) => k.contains(ptr.x, ptr.y));
    if (!hit) return this.hideLabel();
    if (hit !== this.labelKoi) {
      this.labelKoi = hit;
      const name = hit.butterfly ? `butterfly ${hit.variety.name}` : hit.variety.name;
      this.label.innerHTML = `${name}<span>${hit.variety.note}</span>`;
    }
    this.label.style.transform = `translate(${Math.round(ptr.x + 16)}px, ${Math.round(ptr.y + 14)}px)`;
    this.label.classList.add("is-visible");
  }

  // ------------------------------------------------------------- frame

  put(i, g, c, z) {
    if (z > this.zBuf[i]) {
      this.zBuf[i] = z;
      this.gBuf[i] = g;
      this.cBuf[i] = c;
    }
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const ptr = this.pointer;
    ptr.still += dt;
    ptr.speed *= Math.exp(-dt * 6);

    // A moving cursor stirs the surface.
    if (ptr.inside && ptr.moved > 0) {
      const amp = Math.min(0.75, ptr.moved * 0.006);
      if (amp > 0.06) this.disturb(ptr.x, ptr.y, amp, 8);
      ptr.moved = 0;
    }

    // The pond's own small events.
    if (t > this.nextDrip) {
      const c = this.calm;
      for (let i = 0; i < 8; i++) {
        const x = rand(40, this.w - 40);
        const y = rand(80, this.h - 40);
        if (x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1) continue;
        this.disturb(x, y, 1.6, 6);
        this.sound.plip(0.3);
        break;
      }
      this.nextDrip = t + rand(5, 12);
    }

    this.simAcc += dt;
    let steps = 0;
    while (this.simAcc > 1 / 45 && steps < 3) {
      this.stepWater();
      this.simAcc -= 1 / 45;
      steps++;
    }
    if (steps === 3) this.simAcc = 0;

    let rising = false;
    for (const k of this.koi) {
      k.update(dt);
      if (k.delay > 0) {
        k.delay -= dt;
        k.z = 0.05;
        if (k.delay <= 0) rising = true;
      } else if (k.fade < 1) {
        k.fade = Math.min(1, k.fade + dt * 0.3);
      }
    }
    if (rising) this.updateHud();

    // Food floats, drifts, and eventually sinks.
    for (const f of this.pellets) {
      f.age += dt;
      f.vx *= Math.exp(-dt * 2);
      f.vy *= Math.exp(-dt * 2);
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    this.pellets = this.pellets.filter((f) => !f.eaten && f.age < 40);

    // Written letters ride the ripples, and koi near the surface nibble them.
    const { cw, ch, cols } = this.grid;
    for (const l of this.letters) {
      l.age += dt;
      const i = Math.floor(l.y / ch) * cols + Math.floor(l.x / cw);
      if (i > cols && i < this.cur.length - cols) {
        l.vx -= (this.cur[i + 1] - this.cur[i - 1]) * 30 * dt;
        l.vy -= (this.cur[i + cols] - this.cur[i - cols]) * 30 * dt;
      }
      l.vx = l.vx * Math.exp(-dt * 0.8) + 1.6 * dt;
      l.vy *= Math.exp(-dt * 0.8);
      l.x += l.vx * dt;
      l.y += l.vy * dt;
      for (const k of this.koi) {
        if (k.z > 0.55 && k.fade > 0.5 && Math.hypot(k.x - l.x, k.y - l.y) < k.L * 0.08 + 6) {
          l.eaten = true;
          this.disturb(l.x, l.y, 1.2, 6);
          break;
        }
      }
      if (l.age > l.life) this.disturb(l.x, l.y, 0.5, 6);
    }
    this.letters = this.letters.filter((l) => !l.eaten && l.age <= l.life);

    // Lily pads sway on their stems.
    for (const p of this.pads) {
      p.vx += (p.ax - p.x) * 0.6 * dt;
      p.vy += (p.ay - p.y) * 0.6 * dt;
      p.vx += (noise2(t * 0.05, p.ax) - 0.5) * 6 * dt;
      p.vy += (noise2(p.ay, t * 0.05) - 0.5) * 6 * dt;
      p.vx *= Math.exp(-dt * 0.9);
      p.vy *= Math.exp(-dt * 0.9);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt + p.vx * 0.0006;
    }

    // Motes on the surface follow a slow current.
    for (const m of this.motes) {
      m.x += ((noise2(m.x * 0.003, t * 0.04) - 0.5) * 14 + 3) * dt;
      m.y += (noise2(t * 0.04, m.y * 0.003) - 0.5) * 10 * dt;
      if (m.x > this.w + 5) m.x = -5;
      if (m.x < -5) m.x = this.w + 5;
      if (m.y > this.h + 5) m.y = -5;
      if (m.y < -5) m.y = this.h + 5;
    }

    this.updateDrifters(dt);
  }

  updateDrifters(dt) {
    const t = this.time;
    const dark = this.theme === "dark";
    if (t > this.nextDrifter) {
      const active = this.drifters.length;
      if (SEASON === "summer") {
        if (dark && active < 7) this.drifters.push({ kind: "firefly", x: rand(0, this.w), y: rand(0, this.h), age: 0, seed: rand(0, 99) });
        this.nextDrifter = t + rand(1, 3);
      } else {
        if (active < (SEASON === "winter" ? 9 : 4)) {
          const kind = SEASON === "autumn" ? "leaf" : SEASON === "winter" ? "snow" : "petal";
          this.drifters.push({
            kind,
            x: rand(this.w * 0.05, this.w * 0.95),
            y: rand(this.h * 0.1, this.h * 0.9),
            hgt: 1,
            fall: kind === "snow" ? rand(5, 8) : rand(6, 10),
            age: 0,
            rot: rand(0, TAU),
            seed: rand(0, 99),
            hue: Math.floor(rand(0, 3)),
            vx: 0,
            vy: 0,
          });
        }
        this.nextDrifter = t + (SEASON === "winter" ? rand(1.5, 4) : rand(9, 20));
      }
    }
    for (const d of this.drifters) {
      d.age += dt;
      if (d.kind === "firefly") {
        d.x += (noise2(t * 0.3, d.seed) - 0.5) * 30 * dt;
        d.y += (noise2(d.seed, t * 0.3) - 0.5) * 30 * dt;
        continue;
      }
      if (d.hgt > 0) {
        d.hgt = Math.max(0, d.hgt - dt / d.fall);
        d.rot += Math.sin(t * 1.3 + d.seed) * dt * 1.2;
        if (d.hgt === 0) this.disturb(d.x, d.y, d.kind === "snow" ? 0.7 : 1.5, 7);
      } else {
        // Float with the current and the ripples.
        const { cw, ch, cols } = this.grid;
        const c = Math.floor(d.x / cw);
        const r = Math.floor(d.y / ch);
        const i = r * cols + c;
        if (i > cols && i < this.cur.length - cols) {
          d.vx -= (this.cur[i + 1] - this.cur[i - 1]) * 40 * dt;
          d.vy -= (this.cur[i + cols] - this.cur[i - cols]) * 40 * dt;
        }
        d.vx = d.vx * Math.exp(-dt) + 2.5 * dt;
        d.vy *= Math.exp(-dt);
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.rot += d.vx * 0.004;
      }
    }
    const life = { leaf: 70, petal: 60, snow: 9, firefly: 14 };
    this.drifters = this.drifters.filter((d) => d.age < (life[d.kind] ?? 40) && d.x > -40 && d.x < this.w + 40);
  }

  render() {
    const g = this.grid;
    const { cols, rows, cw, ch } = g;
    const n = cols * rows;
    this.zBuf.fill(-1);
    this.computeOffsets();

    for (const k of this.koi) k.pose();
    for (const k of this.koi) k.raster();

    this.drawPads();
    this.drawPellets();
    this.drawDrifters();
    for (const l of this.letters) {
      const c = Math.floor(l.x / cw);
      const r = Math.floor(l.y / ch);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const a = Math.min(1, l.age * 4) * clamp((l.life - l.age) / 3, 0, 1);
      this.put(r * cols + c, l.glyph, this.pal.letter[clamp(Math.round(a * LEVELS), 1, LEVELS)], 1.25);
    }

    // Pebbles on the floor, seen through the water: ripples make them sway.
    for (const i of this.pebbles) {
      const c = (i % cols) + Math.round((this.offX[i] * 1.6) / cw);
      const r = ((i / cols) | 0) + Math.round((this.offY[i] * 1.6) / ch);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      this.put(r * cols + c, this.gPebble[i % 7], this.pal.mote[1], 0.005);
    }

    // Motes: faint specks on the surface.
    for (const m of this.motes) {
      const c = Math.floor(m.x / cw);
      const r = Math.floor(m.y / ch);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const tw = 0.5 + 0.5 * Math.sin(this.time * 0.7 + m.s * 40);
      const a = Math.round(1 + tw * 1.4);
      this.put(r * cols + c, m.s > 0.5 ? this.gDot : this.gTick, this.pal.mote[a], 0.01);
    }

    if (this.theme === "dark") this.drawMoon();

    // Water fills whatever is still empty.
    const h = this.cur;
    const water = this.pal.water;
    for (let r = 1; r < rows - 1; r++) {
      let i = r * cols + 1;
      for (let c = 1; c < cols - 1; c++, i++) {
        if (this.zBuf[i] > 0.015) continue;
        const v = h[i];
        const a = v < 0 ? -v : v;
        if (a < 0.11) continue;
        let glyph;
        if (a < 0.2) {
          if (v < 0) continue;
          glyph = this.gDot;
        } else if (v > 0) {
          const gx = (h[i + 1] - h[i - 1]) / cw;
          const gy = (h[i + cols] - h[i - cols]) / ch;
          glyph = gx || gy ? this.stroke(Math.atan2(gy, gx) + Math.PI / 2) : this.gTilde;
        } else {
          glyph = this.gComma;
        }
        const level = clamp(Math.round(a * 8 - 0.4), 1, LEVELS);
        this.put(i, glyph, water[level], 0.016);
      }
    }

    g.clear();
    const haze = this.haze;
    for (let i = 0; i < n; i++) {
      if (this.zBuf[i] < 0) continue;
      const c = haze[i] ? this.hazeMap[haze[i]][this.cBuf[i]] : this.cBuf[i];
      g.draw(this.gBuf[i], c, i % cols, (i / cols) | 0);
    }
  }

  drawPads() {
    const { cols, rows, cw, ch } = this.grid;
    for (const p of this.pads) {
      const c0 = Math.max(0, Math.floor((p.x - p.r) / cw));
      const c1 = Math.min(cols - 1, Math.ceil((p.x + p.r) / cw));
      const r0 = Math.max(0, Math.floor((p.y - p.r) / ch));
      const r1 = Math.min(rows - 1, Math.ceil((p.y + p.r) / ch));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * cols + c;
          const dx = (c + 0.5) * cw - p.x;
          const dy = (r + 0.5) * ch - p.y;
          const d = Math.hypot(dx, dy);
          if (d > p.r) continue;
          const ang = Math.atan2(dy, dx);
          const local = angleDiff(p.rot, ang);
          // The slit runs from the rim to the centre; its edges are drawn too.
          const slit = Math.abs(local);
          if (slit < 0.16 && d > p.r * 0.1) continue;
          let glyph;
          let color;
          const rim = d > p.r - Math.max(5, p.r * 0.16);
          if (rim || (slit < 0.3 && d > p.r * 0.12)) {
            // Outline: strokes along the edge, like a pen around a coin.
            glyph = rim ? this.stroke(ang + Math.PI / 2) : this.stroke(ang);
            color = this.pal.padRim[rim ? 11 : 9];
          } else if (d < p.r * 0.13) {
            glyph = this.gPadCore;
            color = this.pal.padRim[10];
          } else {
            const vein = Math.abs(((local / TAU) * 11 + 0.5) % 1 - 0.5) < 0.09;
            glyph = vein ? this.stroke(ang) : this.gPadFill;
            color = this.pal.pad[vein ? 9 : 5];
          }
          this.put(i, glyph, color, 1.2);
        }
      }
      if (p.lotus) {
        const fx = p.x + Math.cos(p.rot + Math.PI) * p.r * 0.35;
        const fy = p.y + Math.sin(p.rot + Math.PI) * p.r * 0.35;
        const fc = Math.floor(fx / cw);
        const fr = Math.floor(fy / ch);
        const petals = [
          [0, 0, 1, "lotusCore"],
          [-1, 0, 0, "lotus"],
          [1, 0, 0, "lotus"],
          [0, -1, 0, "lotus"],
          [0, 1, 2, "lotus"],
          [-2, 0, 2, "lotus"],
          [2, 0, 2, "lotus"],
        ];
        for (const [dc, dr, gi, hue] of petals) {
          const c = fc + dc;
          const r = fr + dr;
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          this.put(r * cols + c, this.gLotus[gi], this.pal[hue][gi === 2 ? 8 : 12], 1.3);
        }
      }
    }
  }

  // At night the moon lies on the water. Ripples bend it and break it up.
  drawMoon() {
    const { cols, rows, cw, ch } = this.grid;
    const R = clamp(this.w * 0.032, 24, 44);
    const mx = this.w * 0.8;
    const my = this.h * 0.26;
    const c0 = Math.max(1, Math.floor((mx - R * 1.6) / cw));
    const c1 = Math.min(cols - 2, Math.ceil((mx + R * 1.6) / cw));
    const r0 = Math.max(1, Math.floor((my - R * 1.6) / ch));
    const r1 = Math.min(rows - 2, Math.ceil((my + R * 1.6) / ch));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        const px = (c + 0.5) * cw + this.offX[i] * 3.5;
        const py = (r + 0.5) * ch + this.offY[i] * 3.5;
        const d = Math.hypot(px - mx, py - my) / R;
        if (d > 1) continue;
        const streak = noise2(c * 0.45, r * 1.4 + this.time * 0.25);
        const b = Math.sqrt(1 - d * d) * (0.55 + 0.45 * streak);
        if (b < 0.12) continue;
        this.put(i, this.gMoon[clamp(Math.round(b * 5.4), 1, 5)], this.pal.moon[clamp(Math.round(1 + b * 7), 1, LEVELS)], 0.014);
      }
    }
  }

  drawPellets() {
    const { cols, rows, cw, ch } = this.grid;
    for (const f of this.pellets) {
      const c = Math.floor(f.x / cw);
      const r = Math.floor(f.y / ch);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const a = f.age > 32 ? Math.max(1, Math.round((40 - f.age) * 1.4)) : LEVELS;
      this.put(r * cols + c, this.gPellet, this.pal.pellet[a], 1.1);
    }
  }

  drawDrifters() {
    const { cols, rows, cw, ch } = this.grid;
    const at = (x, y, glyph, color, z) => {
      const c = Math.floor(x / cw);
      const r = Math.floor(y / ch);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return;
      this.put(r * cols + c, glyph, color, z);
    };
    for (const d of this.drifters) {
      if (d.kind === "firefly") {
        const blink = Math.sin(this.time * 2.2 + d.seed * 7);
        if (blink > 0.2) at(d.x, d.y, blink > 0.8 ? this.gStar : this.gDot, this.pal.firefly[clamp(Math.round(blink * 12), 1, 12)], 2);
        continue;
      }
      const life = d.kind === "snow" ? 9 : d.kind === "leaf" ? 70 : 60;
      const fadeOut = clamp((life - d.age) / 6, 0, 1);
      // While falling, the drifter hangs above its own shadow.
      const lift = d.hgt;
      const x = d.x - lift * 46 + Math.sin(this.time * 1.4 + d.seed) * 14 * lift;
      const y = d.y - lift * 70;
      if (lift > 0) at(d.x, d.y, this.gDot, this.pal.shadow[2], 0.03);
      if (d.kind === "snow") {
        const a = Math.round(LEVELS * (lift > 0 ? 1 : clamp(1 - d.age / life, 0, 1)));
        at(x, y, lift > 0 ? this.gStar : this.gDot, this.pal.snow[clamp(a, 1, LEVELS)], 1.4);
        continue;
      }
      const hue = d.kind === "petal" ? "petal" : `leaf${d.hue}`;
      const a = clamp(Math.round(LEVELS * fadeOut), 1, LEVELS);
      if (d.kind === "petal") {
        at(x, y, this.gPetal, this.pal[hue][a], 1.4);
        continue;
      }
      // A leaf: a small outlined ellipse with a midrib and a stem, a little
      // larger while it's still in the air.
      const len = 15 + lift * 6;
      const wid = 6.5 + lift * 2.5;
      const ux = Math.cos(d.rot);
      const uy = Math.sin(d.rot);
      const c0 = Math.floor((x - len) / cw);
      const c1 = Math.ceil((x + len) / cw);
      const r0 = Math.floor((y - len) / ch);
      const r1 = Math.ceil((y + len) / ch);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const px = (c + 0.5) * cw - x;
          const py = (r + 0.5) * ch - y;
          const u = (px * ux + py * uy) / len;
          const v = (-px * uy + py * ux) / wid;
          const e = u * u + v * v;
          if (e > 1) continue;
          const glyph = e > 0.55 ? this.stroke(d.rot + (v > 0 ? 0.35 : -0.35) * Math.sign(u || 1)) : Math.abs(v) < 0.3 ? this.stroke(d.rot) : this.gLeaf;
          at((c + 0.5) * cw, (r + 0.5) * ch, glyph, this.pal[hue][a], 1.4);
        }
      }
      at(x - ux * (len + 4), y - uy * (len + 4), this.stroke(d.rot + 0.4), this.pal[hue][Math.max(1, a - 3)], 1.39);
    }
  }

  frame(dt) {
    if (dt > 0) this.update(dt);
    this.render();
    this.updateLabel();
  }
}

// ------------------------------------------------------------------- boot

const canvas = document.querySelector("[data-pond]");

typeCouplets(document.querySelector("[data-couplet]"), [
  "every ripple is\na sum of sines",
  "slow water\ncarves the stone",
  "scatter some food,\nthey'll come",
]);

if (canvas) {
  await fontsReady;
  const pond = new Pond(canvas);
  if (location.search.includes("debug")) window.__pond = pond;
  // Settle the koi into natural curves before the first frame.
  for (let i = 0; i < 90; i++) pond.update(1 / 30);
  pond.time = 0;
  pond.nextDrip = 2.5;
  if (!reducedMotion()) pond.entrance();
  pond.frame(0);
  onThemeChange(() => {
    pond.palette();
    pond.frame(0);
  });
  onMotionChange(() => pond.frame(0));
  // Phones get half the frames; slow koi look the same and batteries last.
  const coarse = matchMedia("(pointer: coarse)").matches;
  animateWhileVisible(canvas, (dt) => pond.frame(dt), { maxFps: coarse ? 30 : 0 });
}
