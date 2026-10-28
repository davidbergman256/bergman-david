// Photos start as ASCII and develop into the real image, spreading out from
// wherever the cursor enters. Leave, and the characters grow back over it.

import { AsciiCanvas, clamp, cssVar, currentTheme, fontsReady, hexToRgb, onThemeChange, reducedMotion, rgba, typeCouplets } from "./common.js?v=19";

const RAMP = " .,:;-=+*x#%";
const LEVELS = 10;

// Strong colours in a photo tint their characters; everything else is ink.
const HUES = {
  light: ["#b8472f", "#b8692a", "#9c8a2a", "#4f7a3e", "#3f6a96", "#b04a7b"],
  dark: ["#e0705a", "#e39a55", "#e2c766", "#8fbf7a", "#7fa9d6", "#e48fb4"],
};

function hueBucket(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max ? (max - min) / max : 0;
  if (sat < 0.3 || max < 0.18) return -1;
  let h;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  if (h >= 345 || h < 15) return 0;
  if (h < 40) return 1;
  if (h < 70) return 2;
  if (h < 170) return 3;
  if (h < 260) return 4;
  return 5;
}

class Photo {
  constructor(frame) {
    this.frame = frame;
    this.img = frame.querySelector("img");
    this.canvas = frame.querySelector("canvas");
    this.p = 0;
    this.target = 0;
    this.focus = [0.5, 0.5];
    this.raf = 0;
    this.pinned = false;
  }

  async init() {
    try {
      await this.img.decode();
    } catch {
      return;
    }
    this.grid = new AsciiCanvas(this.canvas, { fontSize: 9, lineHeight: 1.0, tracking: 0 });
    this.build();
    this.draw();
    this.frame.classList.add("is-ready");
    this.bind();
    // It may have scrolled into the middle of the screen while loading.
    if (this.inBand) this.develop(1);
  }

  // Sample the image down to one value per character cell.
  build() {
    const g = this.grid;
    g.resize(this.frame.clientWidth, this.frame.clientHeight);
    const { cols, rows } = g;
    const c = document.createElement("canvas");
    c.width = cols;
    c.height = rows;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(this.img, 0, 0, cols, rows);
    const data = x.getImageData(0, 0, cols, rows).data;
    const lum = new Float32Array(cols * rows);
    const hue = new Int8Array(cols * rows);
    for (let i = 0; i < cols * rows; i++) {
      const r = data[i * 4] / 255;
      const g = data[i * 4 + 1] / 255;
      const b = data[i * 4 + 2] / 255;
      lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      hue[i] = hueBucket(r, g, b);
    }
    this.hue = hue;
    // Stretch contrast between the 3rd and 97th percentiles.
    const sorted = Float32Array.from(lum).sort();
    const lo = sorted[Math.floor(sorted.length * 0.03)];
    const hi = sorted[Math.floor(sorted.length * 0.97)];
    for (let i = 0; i < lum.length; i++) lum[i] = clamp((lum[i] - lo) / (hi - lo || 1), 0, 1);
    this.lum = lum;
    this.palette();
  }

  palette() {
    const g = this.grid;
    g.resetColors();
    this.glyphs = [...RAMP].map((ch) => g.glyph(ch));
    const ink = hexToRgb(currentTheme() === "dark" ? "#d5dbd2" : "#1e2622");
    const levels = (rgb) => Array.from({ length: LEVELS + 1 }, (_, l) => g.color(rgba(rgb, Math.max(0.05, l / LEVELS))));
    this.ink = levels(ink);
    this.tints = HUES[currentTheme()].map((hex) => levels(hexToRgb(hex)));
    this.bg = cssVar("--bg");
    this.dark = currentTheme() === "dark";
  }

  bind() {
    const f = this.frame;
    const point = (e) => {
      const r = f.getBoundingClientRect();
      this.focus = [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
    };
    f.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "touch") return;
      point(e);
      this.develop(1);
    });
    f.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "touch" || this.pinned) return;
      point(e);
      this.develop(0);
    });
    f.addEventListener("click", (e) => {
      point(e);
      this.pinned = this.target === 0 || !this.pinned;
      this.develop(this.pinned ? 1 : 0);
    });
    f.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      this.focus = [0.5, 0.5];
      this.pinned = this.target === 0;
      this.develop(this.pinned ? 1 : 0);
    });
  }

  develop(target) {
    this.target = target;
    this.frame.setAttribute("aria-pressed", String(target === 1));
    if (reducedMotion()) {
      this.p = target;
      this.draw();
      return;
    }
    if (!this.raf) {
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const speed = this.target > this.p ? 0.95 : 0.7;
        this.p += clamp(this.target - this.p, -dt * speed, dt * speed);
        this.draw();
        this.raf = Math.abs(this.target - this.p) > 0.001 ? requestAnimationFrame(tick) : 0;
      };
      this.raf = requestAnimationFrame(tick);
    }
  }

  draw() {
    const g = this.grid;
    if (!g) return;
    const { cols, rows, cw, ch, dpr } = g;
    const ctx = g.ctx;
    g.clear();
    if (this.p >= 1) return;
    const [fx, fy] = this.focus;
    const W = cols * cw;
    const H = rows * ch;
    // Farthest corner from the focus, so the front sweeps the whole frame.
    const far = Math.max(
      Math.hypot(fx * W, fy * H),
      Math.hypot((1 - fx) * W, fy * H),
      Math.hypot(fx * W, (1 - fy) * H),
      Math.hypot((1 - fx) * W, (1 - fy) * H),
    );
    const band = 0.16;
    const front = this.p * (1 + band);
    const bg = this.bg;
    ctx.fillStyle = bg;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const d = Math.hypot((c + 0.5) * cw - fx * W, (r + 0.5) * ch - fy * H) / far;
        // 0 inside the developed area, 1 where it's still all characters.
        const k = clamp((d - front + band) / band, 0, 1);
        if (k <= 0) continue;
        ctx.globalAlpha = k;
        ctx.fillRect(Math.floor(c * cw * dpr), Math.floor(r * ch * dpr), Math.ceil(cw * dpr) + 1, Math.ceil(ch * dpr) + 1);
        ctx.globalAlpha = 1;
        const v = this.lum[r * cols + c];
        // A gentle curve keeps most of the frame light; only the deepest
        // tones reach the heavy glyphs.
        const density = Math.pow(this.dark ? v : 1 - v, 1.35);
        const gi = Math.round(density * (RAMP.length - 1));
        if (gi === 0) continue;
        const level = clamp(Math.round((0.28 + 0.62 * density) * LEVELS * k), 1, LEVELS);
        const tint = this.hue[r * cols + c];
        g.draw(this.glyphs[gi], (tint >= 0 ? this.tints[tint] : this.ink)[level], c, r);
      }
    }
  }

  rebuild() {
    if (!this.grid) return;
    this.build();
    this.draw();
  }
}

typeCouplets(document.querySelector("[data-couplet]"), ["things i noticed."]);

await fontsReady;
const photos = [...document.querySelectorAll("[data-photo]")].map((f) => new Photo(f));
photos.forEach((p) => p.init());
if (location.search.includes("debug")) window.__photos = photos;

onThemeChange(() => {
  for (const p of photos) {
    if (!p.grid) continue;
    p.palette();
    p.draw();
  }
});

let resizeTimer = 0;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => photos.forEach((p) => p.rebuild()), 150);
});

// Without hover, a photo develops as it scrolls to the middle of the
// screen and returns to characters as it leaves. A tap still pins it.
if (matchMedia("(hover: none)").matches) {
  const byFrame = new Map(photos.map((p) => [p.frame, p]));
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const p = byFrame.get(e.target);
        if (!p) continue;
        p.inBand = e.isIntersecting;
        if (!p.grid || p.pinned) continue;
        p.focus = [0.5, 0.5];
        p.develop(e.isIntersecting ? 1 : 0);
      }
    },
    { rootMargin: "-35% 0px -35% 0px" },
  );
  photos.forEach((p) => io.observe(p.frame));
}

const all = document.querySelector("[data-develop-all]");
all?.addEventListener("click", () => {
  const on = all.getAttribute("aria-pressed") !== "true";
  all.setAttribute("aria-pressed", String(on));
  all.textContent = on ? "back to ascii" : "develop all";
  for (const p of photos) {
    p.focus = [0.5, 0.5];
    p.pinned = on;
    p.develop(on ? 1 : 0);
  }
});
