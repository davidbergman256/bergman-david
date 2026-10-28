// The blog isn't written yet, so for now: a stone resting at the waterline,
// its reflection trembling below. Click the water to drop a pebble.

import {
  AsciiCanvas,
  animateWhileVisible,
  clamp,
  currentTheme,
  fontsReady,
  hexToRgb,
  noise2,
  onThemeChange,
  reducedMotion,
  rgba,
  typeCouplets,
} from "./common.js?v=17";

const LEVELS = 12;
const STONE = " .:-=+*#%@";
const REFLECT = " .-~=";

const COLORS = {
  light: { stone: "#2a332f", water: "#56766d", drop: "#56766d", koi: "#c4522c" },
  dark: { stone: "#d9ddd3", water: "#7faea3", drop: "#9cc3b9", koi: "#ea6b3d" },
};

// Where the stone sits in the photo, as fractions of its width and height.
const CROP = { x0: 0.16, x1: 0.8, y0: 0.19, y1: 0.84 };

class Stillwater {
  constructor(canvas, img) {
    this.canvas = canvas;
    this.img = img;
    this.grid = new AsciiCanvas(canvas, { fontSize: 10, lineHeight: 0.95, tracking: 0 });
    this.rings = [];
    this.time = 0;
    this.nextDrop = 2.5;
    this.fish = null;
    this.nextFish = 6;
    this.layout();
    this.palette();
    canvas.addEventListener("pointerdown", (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = Math.max(e.clientY - r.top, this.waterY * this.grid.ch + 6);
      this.drop(x, y);
    });
  }

  layout() {
    const g = this.grid;
    g.resize(this.canvas.clientWidth, this.canvas.clientHeight);
    const { cols, rows } = g;
    this.waterY = Math.round(rows * 0.56);
    // The stone: sampled from the photo, sunk a little below the waterline.
    const sw = Math.round(cols * 0.5);
    const aspect = ((CROP.x1 - CROP.x0) * this.img.naturalWidth) / ((CROP.y1 - CROP.y0) * this.img.naturalHeight);
    const sh = Math.round((sw / aspect) * (g.cw / g.ch));
    const c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    const x = c.getContext("2d", { willReadFrequently: true });
    const iw = this.img.naturalWidth;
    const ih = this.img.naturalHeight;
    x.drawImage(this.img, CROP.x0 * iw, CROP.y0 * ih, (CROP.x1 - CROP.x0) * iw, (CROP.y1 - CROP.y0) * ih, 0, 0, sw, sh);
    const d = x.getImageData(0, 0, sw, sh).data;
    const lum = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    // The backdrop is pale; the stone is dark. Keep only the stone.
    const mask = new Float32Array(sw * sh);
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < lum.length; i++) {
      mask[i] = clamp((0.6 - lum[i]) / 0.12, 0, 1);
      if (mask[i] > 0.5) {
        lo = Math.min(lo, lum[i]);
        hi = Math.max(hi, lum[i]);
      }
    }
    this.stone = { w: sw, h: sh, lum, mask, lo, hi };
    this.sx = Math.round((cols - sw) / 2);
    this.sy = this.waterY - Math.round(sh * 0.86);
  }

  palette() {
    const g = this.grid;
    g.resetColors();
    const theme = COLORS[currentTheme()];
    this.dark = currentTheme() === "dark";
    this.pal = {};
    for (const [name, hex] of Object.entries(theme)) {
      const rgb = hexToRgb(hex);
      this.pal[name] = Array.from({ length: LEVELS + 1 }, (_, l) => g.color(rgba(rgb, Math.max(l, 1) / LEVELS)));
    }
    this.gStone = [...STONE].map((ch) => g.glyph(ch));
    this.gReflect = [...REFLECT].map((ch) => g.glyph(ch));
    this.gStroke = ["-", "\\", "|", "/"].map((ch) => g.glyph(ch));
    this.gDot = g.glyph(".");
    this.gTilde = g.glyph("~");
    this.gDash = g.glyph("-");
    this.gUnder = g.glyph("_");
    this.gQuote = g.glyph("'");
    this.gEq = g.glyph("=");
    this.gTailRight = g.glyph(">");
    this.gTailLeft = g.glyph("<");
  }

  // Density of the stone at a stone-local cell, or -1 outside it.
  stoneAt(c, r) {
    const s = this.stone;
    if (c < 0 || r < 0 || c >= s.w || r >= s.h) return -1;
    const i = r * s.w + c;
    if (s.mask[i] < 0.5) return -1;
    const v = clamp((s.lum[i] - s.lo) / (s.hi - s.lo || 1), 0, 1);
    return this.dark ? 0.3 + 0.7 * v : 0.3 + 0.7 * (1 - v);
  }

  drop(x, y) {
    this.rings.push({ x, y, age: 0 });
    if (reducedMotion()) this.render();
  }

  // Now and then a koi passes below, seen from the side through the water:
  // 1 = body, 2 = its edge, 3 = tail, 0 = not there.
  fishAt(px, py) {
    const f = this.fish;
    if (!f) return 0;
    const dx = (px - f.x) * f.dir;
    const wave = Math.sin(dx * 0.09 + this.time * 5) * Math.min(1, Math.max(0, -dx / 30)) * 2.5;
    const dy = py - f.y - wave;
    const e = (dx / 34) ** 2 + (dy / 7) ** 2;
    if (e < 1) return e > 0.55 ? 2 : 1;
    if (dx < -30 && dx > -50 && Math.abs(dy) < (-30 - dx) * 0.6) return 3;
    return 0;
  }

  update(dt) {
    this.time += dt;
    if (this.time > this.nextDrop) {
      const g = this.grid;
      const x = (0.12 + Math.random() * 0.76) * g.cols * g.cw;
      const y = (this.waterY + 3 + Math.random() * (g.rows - this.waterY - 5)) * g.ch;
      // Don't drop straight onto the stone's reflection; it's the quiet part.
      if (Math.abs(x / g.cw - g.cols / 2) > this.stone.w * 0.32) this.drop(x, y);
      this.nextDrop = this.time + 3.5 + Math.random() * 5;
    }
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < 5);

    const g = this.grid;
    const width = g.cols * g.cw;
    if (!this.fish && this.time > this.nextFish) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const depth = this.waterY + 4 + Math.random() * Math.max(1, g.rows - this.waterY - 8);
      this.fish = { dir, x: dir > 0 ? -60 : width + 60, y: depth * g.ch };
    }
    if (this.fish) {
      this.fish.x += this.fish.dir * 34 * dt;
      if (this.fish.x < -80 || this.fish.x > width + 80) {
        this.fish = null;
        this.nextFish = this.time + 18 + Math.random() * 20;
      }
    }
  }

  // Horizontal sway of the reflection on row r, plus the pull of any ring.
  sway(c, r) {
    const depth = r - this.waterY;
    const t = this.time;
    let dx = Math.sin(depth * 0.9 + t * 1.3) * 0.35 * Math.min(1, depth / 3) + (noise2(depth * 0.4, t * 0.6) - 0.5) * 0.9;
    const { cw, ch } = this.grid;
    for (const ring of this.rings) {
      const ex = (c * cw - ring.x) / 1;
      const ey = (r * ch - ring.y) * 3.2;
      const d = Math.hypot(ex, ey);
      const front = ring.age * 70;
      const k = Math.exp(-((d - front) ** 2) / 300) * Math.exp(-ring.age * 0.7);
      dx += k * 2.4 * Math.sign(ex || 1);
    }
    return dx;
  }

  render() {
    const g = this.grid;
    const { cols, rows, cw, ch } = g;
    const s = this.stone;
    g.clear();

    // Stone above the water.
    for (let r = Math.max(0, this.sy); r < this.waterY; r++) {
      for (let c = 0; c < s.w; c++) {
        const v = this.stoneAt(c, r - this.sy);
        if (v < 0) continue;
        const gi = clamp(Math.round(v * (STONE.length - 1)), 1, STONE.length - 1);
        g.draw(this.gStone[gi], this.pal.stone[clamp(Math.round(v * LEVELS + 1), 2, LEVELS)], this.sx + c, r);
      }
    }

    // The waterline, gently moving.
    for (let c = 0; c < cols; c++) {
      const n = noise2(c * 0.15 - this.time * 0.4, 3);
      const inStone = this.stoneAt(c - this.sx, this.waterY - this.sy) >= 0;
      const glyph = inStone ? this.gUnder : n > 0.62 ? this.gTilde : n > 0.38 ? this.gDash : this.gDot;
      const edge = Math.min(c, cols - 1 - c) / (cols * 0.18);
      const a = Math.round(clamp(edge, 0, 1) * (inStone ? 10 : 7));
      if (a > 0) g.draw(glyph, this.pal.water[a], c, this.waterY);
    }

    // Reflection: the stone mirrored, stretched into streaks, swaying.
    for (let r = this.waterY + 1; r < rows; r++) {
      const depth = r - this.waterY;
      const src = this.waterY - depth * 1.05;
      const fade = clamp(1 - depth / (rows - this.waterY), 0, 1);
      for (let c = 0; c < cols; c++) {
        const under = this.fishAt((c + 0.5) * cw, (r + 0.5) * ch);
        if (under) {
          // Like ><> swimming right and <>< swimming left.
          const tail = this.fish.dir > 0 ? this.gTailRight : this.gTailLeft;
          g.draw(under === 1 ? this.gEq : under === 2 ? this.gDash : tail, this.pal.koi[under === 1 ? 4 : 3], c, r);
          continue;
        }
        const dx = this.sway(c, r);
        const sc = Math.round(c - this.sx + dx);
        const v = this.stoneAt(sc, Math.round(src - this.sy));
        if (v >= 0 && noise2(c * 0.55, r * 0.8 + this.time * 0.4) > 0.24) {
          const gi = clamp(Math.round(v * (REFLECT.length - 1)), 1, REFLECT.length - 1);
          const a = Math.round(v * fade * 9);
          if (a > 0) g.draw(this.gReflect[gi], this.pal.stone[a], c, r);
          continue;
        }
        // Open water: faint streaks drifting sideways.
        const n = noise2(c * 0.09 + this.time * 0.25 * (depth % 2 ? 1 : -1), r * 0.7);
        if (n > 0.74) g.draw(this.gDash, this.pal.water[clamp(Math.round((n - 0.74) * 20 * fade), 1, 5)], c, r);
      }
    }

    // Rings: flattened by perspective, drawn as strokes.
    for (const ring of this.rings) {
      const rad = ring.age * 70;
      const alpha = clamp(1 - ring.age / 5, 0, 1);
      const steps = Math.max(16, Math.round(rad * 0.7));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = ring.x + Math.cos(a) * rad;
        const y = ring.y + Math.sin(a) * rad * 0.28;
        const c = Math.floor(x / cw);
        const r = Math.floor(y / ch);
        if (c < 0 || c >= cols || r <= this.waterY || r >= rows) continue;
        const tangent = Math.atan2(Math.cos(a) * 0.28, -Math.sin(a));
        let k = tangent % Math.PI;
        if (k < 0) k += Math.PI;
        const glyph = Math.abs(Math.sin(a)) > 0.92 ? this.gDash : this.gStroke[Math.round(k / (Math.PI / 4)) % 4];
        g.draw(glyph, this.pal.drop[clamp(Math.round(alpha * 9), 1, LEVELS)], c, r);
      }
      // The first instant: a splash above the surface.
      if (ring.age < 0.35) {
        const c = Math.floor(ring.x / cw);
        const r = Math.floor(ring.y / ch) - 1;
        g.draw(this.gQuote, this.pal.drop[LEVELS], c, r);
      }
    }
  }
}

typeCouplets(document.querySelector("[data-couplet]"), ["coming soon."]);

const canvas = document.querySelector("[data-stillwater]");
const img = new Image();
img.src = "/assets/photos/stone.jpg";

if (canvas) {
  await Promise.all([fontsReady, img.decode().catch(() => {})]);
  if (img.naturalWidth) {
    const scene = new Stillwater(canvas, img);
    scene.render();
    onThemeChange(() => {
      scene.palette();
      scene.render();
    });
    let timer = 0;
    addEventListener("resize", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        scene.layout();
        scene.palette();
        scene.render();
      }, 150);
    });
    animateWhileVisible(canvas, (dt) => {
      scene.update(dt);
      scene.render();
    });
    if (location.search.includes("debug")) window.__stone = scene;
  }
}
