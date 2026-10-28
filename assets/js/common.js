// Shared pieces for every page: theme, motion preference, fonts, the typed
// couplet, and AsciiCanvas, a glyph-atlas renderer for character grids.

export const FONT_FAMILY = '"Spline Sans Mono", ui-monospace, monospace';

const root = document.documentElement;
const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");

export const reducedMotion = () => motionQuery.matches;

export function onMotionChange(fn) {
  motionQuery.addEventListener("change", fn);
}

// ---------------------------------------------------------------- theme

export function currentTheme() {
  return root.dataset.theme === "dark" ? "dark" : "light";
}

export function onThemeChange(fn) {
  addEventListener("themechange", fn);
}

function setTheme(theme, persist) {
  root.dataset.theme = theme;
  if (persist) {
    try {
      localStorage.setItem("theme", theme);
    } catch {}
  }
  const button = document.querySelector("[data-theme-toggle]");
  if (button) {
    const next = theme === "dark" ? "light" : "dark";
    button.setAttribute("aria-label", `Switch to ${next} mode`);
    button.setAttribute("title", next === "dark" ? "night" : "day");
  }
  dispatchEvent(new CustomEvent("themechange", { detail: theme }));
}

function initTheme() {
  const button = document.querySelector("[data-theme-toggle]");
  setTheme(currentTheme(), false);
  button?.addEventListener("click", () => {
    setTheme(currentTheme() === "dark" ? "light" : "dark", true);
  });
  // Follow the system only while the visitor hasn't picked a side.
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    let stored = null;
    try {
      stored = localStorage.getItem("theme");
    } catch {}
    if (!stored) setTheme(e.matches ? "dark" : "light", false);
  });
}

export function cssVar(name) {
  return getComputedStyle(root).getPropertyValue(name).trim();
}

// ---------------------------------------------------------------- fonts

export const fontsReady = (async () => {
  try {
    await Promise.race([
      document.fonts.load(`400 16px ${FONT_FAMILY}`),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {}
})();

// The advance width of one character as a fraction of the font size, so CSS
// can size <pre> drawings to fit their container exactly.
export async function measureAdvance() {
  await fontsReady;
  const c = document.createElement("canvas").getContext("2d");
  c.font = `100px ${FONT_FAMILY}`;
  const adv = c.measureText("MMMMMMMMMM").width / 1000;
  root.style.setProperty("--adv", adv.toFixed(4));
  return adv;
}

// ---------------------------------------------------------------- couplet

// Types each couplet, holds, erases, moves on. Lines are separated by "\n".
export function typeCouplets(el, couplets, { hold = 7000, speed = 52 } = {}) {
  if (!el || !couplets.length) return;
  const text = el.querySelector("[data-couplet-text]") ?? el;
  if (reducedMotion()) {
    text.textContent = couplets[0];
    return;
  }
  let index = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  text.textContent = "";
  (async () => {
    await sleep(500);
    // A single line types once and stays.
    if (couplets.length === 1) {
      const line = couplets[0];
      for (let i = 1; i <= line.length; i++) {
        text.textContent = line.slice(0, i);
        await sleep(speed + Math.random() * 46);
      }
      el.classList.add("is-resting");
      return;
    }
    for (;;) {
      const line = couplets[index % couplets.length];
      for (let i = 1; i <= line.length; i++) {
        text.textContent = line.slice(0, i);
        const ch = line[i - 1];
        await sleep(ch === "\n" ? 380 : ch === "," ? 240 : speed + Math.random() * 46);
      }
      el.classList.add("is-resting");
      await sleep(hold);
      el.classList.remove("is-resting");
      for (let i = line.length; i >= 0; i--) {
        text.textContent = line.slice(0, i);
        await sleep(18);
      }
      await sleep(600);
      index++;
    }
  })();
}

// ---------------------------------------------------------------- AsciiCanvas

// Draws a grid of characters onto a canvas. Every (glyph, color) pair is
// rendered once into an offscreen atlas and then blitted, which keeps a few
// thousand characters per frame cheap.
export class AsciiCanvas {
  constructor(canvas, { fontSize = 12, lineHeight = 1.18, tracking = 0, maxDpr = 2 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
    this.fontSize = fontSize;
    this.lineHeight = lineHeight;
    this.tracking = tracking;
    this.maxDpr = maxDpr;
    this.glyphs = [];
    this.glyphIds = new Map();
    this.colors = [];
    this.colorIds = new Map();
    this.resize();
  }

  resize(width = this.canvas.clientWidth, height = this.canvas.clientHeight) {
    const dpr = Math.min(devicePixelRatio || 1, this.maxDpr);
    this.dpr = dpr;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    const m = this.ctx;
    m.font = `${this.fontSize}px ${FONT_FAMILY}`;
    const advance = m.measureText("MMMMMMMMMM").width / 10;
    this.cw = Math.max(4, Math.round(advance) + this.tracking);
    this.ch = Math.max(6, Math.round(this.fontSize * this.lineHeight));
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);
    this.sw = Math.ceil(this.cw * dpr);
    this.sh = Math.ceil(this.ch * dpr);
    this.resetAtlas();
  }

  resetAtlas() {
    this.perRow = 64;
    this.atlas = document.createElement("canvas");
    this.atlas.width = this.perRow * this.sw;
    this.atlas.height = this.sh * 8;
    this.actx = this.atlas.getContext("2d");
    this.slots = 0;
    this.cache = new Int32Array(256 * 1024).fill(-1);
  }

  glyph(ch) {
    let id = this.glyphIds.get(ch);
    if (id === undefined) {
      id = this.glyphs.length;
      this.glyphs.push(ch);
      this.glyphIds.set(ch, id);
    }
    return id;
  }

  color(css) {
    let id = this.colorIds.get(css);
    if (id === undefined) {
      id = this.colors.length;
      this.colors.push(css);
      this.colorIds.set(css, id);
    }
    return id;
  }

  // Forget registered colors (on theme change) and their baked glyphs.
  resetColors() {
    this.colors = [];
    this.colorIds = new Map();
    this.resetAtlas();
  }

  slot(g, c) {
    const key = g * 1024 + c;
    let s = this.cache[key];
    if (s >= 0) return s;
    s = this.slots++;
    const row = Math.floor(s / this.perRow);
    if ((row + 1) * this.sh > this.atlas.height) {
      const bigger = document.createElement("canvas");
      bigger.width = this.atlas.width;
      bigger.height = this.atlas.height * 2;
      bigger.getContext("2d").drawImage(this.atlas, 0, 0);
      this.atlas = bigger;
      this.actx = bigger.getContext("2d");
    }
    const a = this.actx;
    const x = (s % this.perRow) * this.sw;
    const y = row * this.sh;
    a.font = `${this.fontSize * this.dpr}px ${FONT_FAMILY}`;
    a.textAlign = "center";
    a.textBaseline = "middle";
    a.fillStyle = this.colors[c];
    a.fillText(this.glyphs[g], x + this.sw / 2, y + this.sh / 2 + this.dpr * 0.5);
    this.cache[key] = s;
    return s;
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(g, c, col, row) {
    const s = this.slot(g, c);
    const sx = (s % this.perRow) * this.sw;
    const sy = Math.floor(s / this.perRow) * this.sh;
    this.ctx.drawImage(
      this.atlas,
      sx,
      sy,
      this.sw,
      this.sh,
      Math.round(col * this.cw * this.dpr),
      Math.round(row * this.ch * this.dpr),
      this.sw,
      this.sh,
    );
  }
}

// ---------------------------------------------------------------- helpers

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(rgb, a) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`;
}

// Small, fast, deterministic noise (value noise with smooth interpolation).
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function noise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export { hash2 };

// Run fn every animation frame while the element is on screen and the tab
// is visible. fn receives (dt seconds, t seconds). maxFps skips frames.
export function animateWhileVisible(el, fn, { maxFps = 0 } = {}) {
  let visible = true;
  let raf = 0;
  let last = 0;
  const minStep = maxFps ? 1 / maxFps - 0.002 : 0;
  const tick = (now) => {
    raf = 0;
    const t = now / 1000;
    if (last && t - last < minStep) return schedule();
    const dt = last ? Math.min(0.05, t - last) : 1 / 60;
    last = t;
    fn(dt, t);
    schedule();
  };
  const schedule = () => {
    if (!raf && visible && !document.hidden && !reducedMotion()) {
      raf = requestAnimationFrame(tick);
    }
  };
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) {
      last = 0;
      schedule();
    }
  });
  io.observe(el);
  document.addEventListener("visibilitychange", () => {
    last = 0;
    schedule();
  });
  onMotionChange(() => {
    last = 0;
    schedule();
  });
  schedule();
  return {
    stop() {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}

initTheme();
