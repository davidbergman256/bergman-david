// Projects are drawn as plates in a drawing set: one ASCII drawing per
// project, animated while it's on screen. Each plate draws into a Sheet,
// which keeps two layers (ink and accent) rendered as stacked <pre>s.

import { animateWhileVisible, measureAdvance, noise2, reducedMotion, typeCouplets } from "./common.js?v=17";

class Sheet {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.clear();
  }

  clear() {
    this.ink = Array.from({ length: this.rows }, () => Array(this.cols).fill(" "));
    this.acc = Array.from({ length: this.rows }, () => Array(this.cols).fill(" "));
  }

  put(x, y, ch, accent = false) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    if (accent) {
      this.acc[y][x] = ch;
      this.ink[y][x] = " ";
    } else {
      this.ink[y][x] = ch;
      this.acc[y][x] = " ";
    }
  }

  get(x, y) {
    return this.ink[y]?.[x] ?? " ";
  }

  text(x, y, str, accent = false) {
    for (let i = 0; i < str.length; i++) if (str[i] !== " ") this.put(x + i, y, str[i], accent);
  }

  hline(x0, x1, y, ch = "-", accent = false) {
    for (let x = x0; x <= x1; x++) this.put(x, y, ch, accent);
  }

  vline(x, y0, y1, ch = "|", accent = false) {
    for (let y = y0; y <= y1; y++) this.put(x, y, ch, accent);
  }

  box(x0, y0, x1, y1) {
    this.hline(x0 + 1, x1 - 1, y0);
    this.hline(x0 + 1, x1 - 1, y1);
    this.vline(x0, y0 + 1, y1 - 1);
    this.vline(x1, y0 + 1, y1 - 1);
    for (const [x, y] of [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ])
      this.put(x, y, "+");
  }

  render() {
    return [this.ink.map((r) => r.join("")).join("\n"), this.acc.map((r) => r.join("")).join("\n")];
  }
}

const COLS = 64;
const ROWS = 17;

// ------------------------------------------------------------------ plates

const PLATES = {
  // Loomplane: agent streams are the warp, shared decisions the weft.
  // Now and then a stream falls behind a decision and is flagged stale.
  loom(s, t, state) {
    const labels = ["api", "ui", "db", "docs", "tests", "infra"];
    const warp = labels.map((_, i) => 7 + i * 10);
    labels.forEach((l, i) => s.text(warp[i] - Math.floor(l.length / 2), 0, l));
    s.hline(2, COLS - 3, 1, "=");
    s.hline(2, COLS - 3, 14, "=");
    const top = 2;
    const count = 6;
    const width = COLS - 6;
    const speed = 30;
    const cycle = count * width + 200;
    const p = Math.floor(t * speed) % cycle;
    const done = Math.floor(p / width);
    const head = p % width;
    // A decision goes stale for one stream: on its own once per cycle, or
    // whenever the drawing is clicked.
    const flag = state.flag && t < state.flag.until ? state.flag : null;
    const stale = flag ? Math.max(0, Math.min(done, count) - 1) : 3;
    const lane = flag ? flag.lane : 1;
    const staleOn = flag || (done > stale && p > (stale + 1) * width + 70);
    for (let y = top; y < top + count * 2; y++) for (const x of warp) s.put(x, y, "|");
    // Each decision is its own thread; it passes over and under the streams.
    const threads = "-=~-=~";
    for (let r = 0; r < count; r++) {
      const y = top + 1 + r * 2;
      if (r > done) continue;
      const end = r < done ? width : head;
      const thread = threads[r];
      for (let k = 0; k < end; k++) {
        const x = 3 + k;
        const wi = warp.indexOf(x);
        const isStale = staleOn && r === stale && x >= warp[lane] - 4 && x <= warp[lane] + 4;
        if (wi >= 0) {
          if ((r + wi) % 2 === 0) s.put(x, y, isStale ? "!" : thread, isStale);
        } else {
          s.put(x, y, isStale ? "~" : thread, isStale);
        }
      }
      if (r === done && done < count) s.text(3 + head, y, "<>", true);
    }
    const version = Math.min(done, count);
    s.text(2, 16, `decision v${version}`);
    if (staleOn) s.text(COLS - 24, 16, `${labels[lane]} hasn't seen v${stale + 1}`.padStart(23), true);
    else s.text(COLS - 24, 16, "every stream is current");
  },

  // BookTr: an English page becomes a Czech page, then a voice.
  book(s, t, state) {
    const en = ["It was a quiet", "morning at the", "pond. The koi", "rose to meet", "the light."];
    const cs = ["Bylo tiché ráno", "u rybníka.", "Kapři stoupali", "vstříc světlu.", ""];
    const L = 3;
    const R = 34;
    s.hline(L + 1, L + 26, 0, "_");
    s.hline(R + 1, R + 26, 0, "_");
    s.put(L, 1, "/");
    s.put(L + 27, 1, "\\");
    s.put(R, 1, "/");
    s.put(R + 27, 1, "\\");
    for (let y = 2; y <= 9; y++) {
      s.put(L - 1, y, "|");
      s.put(R + 28, y, "|");
    }
    s.vline(L + 29, 1, 10, "|");
    s.put(L, 10, "\\");
    s.put(R + 27, 10, "/");
    s.hline(L + 1, L + 27, 10, "_");
    s.hline(R, R + 26, 10, "_");
    en.forEach((line, i) => s.text(L + 3, 3 + i, line));
    const cycle = 11;
    const phase = (t - (state.offset ?? 0) + cycle) % cycle;
    const pool = "abcdeěščřžýáíéůnoprstuvy";
    let k = 0;
    cs.forEach((line, i) => {
      for (let j = 0; j < line.length; j++, k++) {
        const ch = line[j];
        if (ch === " ") continue;
        const at = 0.3 + k * 0.07;
        if (phase < at) continue;
        const settled = phase > at + 0.45;
        const glyph = settled ? ch : pool[Math.floor(noise2(k * 3.1, t * 9) * pool.length)];
        s.put(R + 3 + j, 3 + i, glyph, !settled);
      }
    });
    s.text(L + 3, 12, "en", false);
    s.text(R + 3, 12, "cs", false);
    // Narration: a waveform that wakes once the page is translated.
    const speaking = phase > 4.6 && phase < cycle - 0.6;
    for (let x = 0; x < 52; x++) {
      const n = noise2(x * 0.35, t * 3.2);
      const env = speaking ? Math.sin(Math.min(1, (phase - 4.6) / 0.8) * Math.PI * 0.5) : 0;
      const hgt = Math.round(n * 3 * env);
      const cx = 6 + x;
      if (hgt <= 0) s.put(cx, 15, ".");
      for (let h = 0; h < hgt; h++) s.put(cx, 15 - h, h === hgt - 1 ? ":" : "|", speaking && x % 9 === 0);
    }
    s.text(6, 16, speaking ? "audiokniha, reading aloud" : "audiokniha");
  },

  // SocioAI: chat, a living sheet of deadlines, and a hub of resources.
  socio(s, t, state) {
    s.box(0, 0, 19, 15);
    s.box(22, 0, 43, 15);
    s.box(46, 0, 63, 15);
    s.text(2, 1, "chat");
    s.text(24, 1, "sheet");
    s.text(48, 1, "hub");
    s.hline(1, 18, 2, "-");
    s.hline(23, 42, 2, "-");
    s.hline(47, 62, 2, "-");
    // Chat: bubbles stacking, then the next one typing.
    const bubbles = [
      [9, "~~~~~~~ ~~"],
      [2, "~~~~ ~~~~~~"],
      [2, "~~~~~~ ~~"],
      [9, "~~~~ ~~~~~"],
      [2, "~~~~~~~ ~~~"],
    ];
    const shown = Math.floor(t / 1.6) % (bubbles.length + 2);
    for (let i = 0; i < Math.min(shown, bubbles.length); i++) {
      const [x, txt] = bubbles[i];
      s.text(x, 4 + i * 2, txt, false);
    }
    if (shown < bubbles.length) {
      const dots = ".".repeat(1 + (Math.floor(t * 3) % 3));
      s.text(bubbles[shown][0], 4 + shown * 2, dots, true);
    }
    // Sheet: deadlines fill in and get checked off.
    const rows = [
      ["school a", "nov 1"],
      ["school b", "nov 15"],
      ["school c", "jan 1"],
      ["school d", "jan 5"],
      ["school e", "feb 1"],
    ];
    const ticked = (Math.floor(t / 1.3) + (state.extra ?? 0)) % (rows.length + 3);
    rows.forEach(([name, due], i) => {
      const y = 4 + i * 2;
      s.text(24, y, name);
      s.text(33, y, due);
      s.text(40, y, i < ticked ? "[x]" : "[ ]", i === ticked - 1);
    });
    const progress = Math.round((Math.min(ticked, rows.length) / rows.length) * 18);
    s.text(24, 14, "#".repeat(progress) + ".".repeat(18 - progress));
    // Hub: resources, one highlighted at a time.
    const links = ["essays", "forms", "recs", "aid", "notes"];
    const focus = Math.floor(t / 2.1) % links.length;
    links.forEach((l, i) => s.text(48, 4 + i * 2, (i === focus ? "> " : "- ") + l, i === focus));
  },

  // Globalink: strangers walk the streets to the same corner.
  meet(s, t, state) {
    const streetsY = [2, 8, 14];
    const streetsX = [3, 15, 27, 39, 51, 61];
    for (const y of streetsY) s.hline(0, COLS - 1, y, "-");
    for (const x of streetsX) s.vline(x, 0, ROWS - 1, "|");
    for (const y of streetsY) for (const x of streetsX) s.put(x, y, "+");
    // City blocks: a light hatch inset from the streets, a few left as parks.
    for (let j = 0; j < streetsY.length - 1; j++) {
      for (let i = 0; i < streetsX.length - 1; i++) {
        const park = noise2(i * 1.7, j * 2.3) > 0.62;
        for (let y = streetsY[j] + 2; y <= streetsY[j + 1] - 2; y++) {
          for (let x = streetsX[i] + 2; x <= streetsX[i + 1] - 2; x++) {
            if (park) {
              if ((x * 3 + y * 5) % 7 === 0) s.put(x, y, "*");
            } else if ((x + y) % 2 === 0) s.put(x, y, ".");
          }
        }
      }
    }
    if (!state.people || t > state.until) {
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      const meet = [pick(streetsX.slice(1, -1)), pick(streetsY)];
      state.meet = meet;
      state.start = t;
      state.until = t + 9;
      state.people = Array.from({ length: 4 }, () => {
        const horizontal = Math.random() < 0.5;
        const from = horizontal ? [Math.random() < 0.5 ? 0 : COLS - 1, pick(streetsY)] : [pick(streetsX), Math.random() < 0.5 ? 0 : ROWS - 1];
        // Walk along the street to the meeting street, then turn.
        const corner = horizontal ? [meet[0], from[1]] : [from[0], meet[1]];
        return { path: [from, corner, meet], speed: 7 + Math.random() * 4 };
      });
    }
    const [mx, my] = state.meet;
    let arrived = 0;
    for (const p of state.people) {
      let d = (t - state.start) * p.speed;
      let [x, y] = p.path[0];
      for (let i = 1; i < p.path.length; i++) {
        const [nx, ny] = p.path[i];
        // Rows are about twice as tall as columns are wide.
        const len = Math.abs(nx - x) + 2 * Math.abs(ny - y);
        if (d >= len) {
          d -= len;
          x = nx;
          y = ny;
          continue;
        }
        x += Math.sign(nx - x) * d;
        y += Math.sign(ny - y) * d * 0.5;
        d = 0;
        break;
      }
      p.cur = [x, y];
      if (x === mx && y === my) arrived++;
      else s.put(x, y, "o", true);
    }
    s.put(mx, my, "@", true);
    if (arrived === state.people.length) {
      const ring = Math.floor((t * 4) % 3) + 1;
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        s.put(mx + Math.cos(ang) * ring * 2, my + Math.sin(ang) * ring, ".", true);
      }
      const label = "4 strangers, 1 plan";
      s.text(Math.min(COLS - label.length, mx + 2), my - 1, label, true);
    }
  },

  // Wave House: an elevation, plotted stroke by stroke.
  wave(s, t, state) {
    if (!state.marks) {
      const marks = [];
      const add = (x, y, ch) => marks.push([x, y, ch]);
      // Ground and earth.
      for (let x = 2; x <= 61; x++) add(x, 13, "=");
      for (let x = 3; x <= 60; x += 3) add(x, 14, "/");
      // Walls.
      for (let y = 7; y <= 12; y++) {
        add(10, y, "|");
        add(53, y, "|");
      }
      for (let y = 9; y <= 12; y++) add(32, y, ":");
      // Two wave roofs, each a slab: a crest line with its underside.
      const roof = (x0, x1, base, amp, cycles, phase) => {
        const under = [];
        for (let x = x0; x <= x1; x++) {
          const u = (x - x0) / (x1 - x0);
          const y = base - amp * Math.sin(u * Math.PI * 2 * cycles + phase);
          const fy = Math.floor(y);
          const f = y - fy;
          add(x, fy, f < 0.34 ? "`" : f < 0.67 ? "-" : "_");
          if (x % 2 === 0) under.push([x, fy + 1, "."]);
        }
        for (const m of under) add(...m);
      };
      roof(7, 33, 5.2, 2.3, 0.85, 0.5);
      roof(30, 56, 5.6, 1.9, 0.85, 2.9);
      // Openings and labels.
      for (const [x, y, str] of [
        [14, 10, "[  ]"],
        [44, 9, "[    ]"],
        [26, 11, "|"],
        [26, 12, "|"],
        [29, 11, "|"],
        [29, 12, "|"],
        [15, 12, "living"],
        [40, 12, "studio"],
      ]) {
        for (let i = 0; i < str.length; i++) if (str[i] !== " ") add(x + i, y, str[i]);
      }
      for (const [x, str] of [
        [2, "elevation"],
        [48, "142 sq ft"],
      ])
        for (let i = 0; i < str.length; i++) add(x + i, 16, str[i]);
      state.marks = marks;
    }
    const n = reducedMotion() ? state.marks.length : Math.floor(t * 70);
    const shown = Math.min(n, state.marks.length);
    for (let i = 0; i < shown; i++) {
      const [x, y, ch] = state.marks[i];
      s.put(x, y, ch);
    }
    if (shown < state.marks.length) {
      const [x, y] = state.marks[shown];
      s.put(x, y, "+", true);
    }
  },

  // The common room: furniture in zones, people drifting between them.
  room(s, t, state) {
    s.box(1, 0, 62, 15);
    for (let x = 28; x <= 34; x++) s.put(x, 15, " ");
    s.text(28, 14, "\\");
    s.text(34, 14, "/");
    for (const x0 of [8, 22, 42]) s.hline(x0, x0 + 8, 0, "=");
    // Lounge.
    s.text(4, 3, "[=========]");
    s.vline(4, 4, 6, "[");
    s.text(8, 5, "( )");
    s.text(4, 8, "lounge");
    // Games.
    s.box(44, 3, 54, 7);
    s.text(46, 5, "# # # #");
    s.text(46, 9, "games");
    // Long table with chairs.
    s.text(20, 10, "o  o  o  o  o");
    s.text(19, 11, "[=============]");
    s.text(20, 12, "o  o  o  o  o");
    s.text(37, 11, "table");
    const seats = [
      [7, 4],
      [10, 6],
      [6, 6],
      [47, 4],
      [51, 6],
      [49, 2],
      [23, 10],
      [29, 12],
      [32, 10],
      [26, 12],
    ];
    if (!state.people) {
      state.people = Array.from({ length: 6 }, (_, i) => {
        const s0 = seats[(i * 3) % seats.length];
        return { x: s0[0], y: s0[1], tx: s0[0], ty: s0[1], next: Math.random() * 3 };
      });
    }
    const dt = state.last ? Math.min(0.2, t - state.last) : 0;
    state.last = t;
    for (const p of state.people) {
      if (t > p.next) {
        const seat = seats[Math.floor(Math.random() * seats.length)];
        p.tx = seat[0];
        p.ty = seat[1];
        p.next = t + 3 + Math.random() * 5;
      }
      p.x += Math.sign(p.tx - p.x) * Math.min(Math.abs(p.tx - p.x), dt * 9);
      p.y += Math.sign(p.ty - p.y) * Math.min(Math.abs(p.ty - p.y), dt * 4.5);
      s.put(p.x, p.y, "*", true);
    }
  },
};

// What a click does on each plate. (col, row) is the character clicked.
const CLICKS = {
  loom(state, col, row, t) {
    state.flag = { lane: Math.floor(Math.random() * 6), until: t + 3.5 };
  },
  book(state, col, row, t) {
    state.offset = t;
  },
  socio(state) {
    state.extra = (state.extra ?? 0) + 1;
  },
  // Pick the corner nearest the click; everyone reroutes from where they are.
  meet(state, col, row, t) {
    if (!state.people) return;
    const streetsY = [2, 8, 14];
    const streetsX = [3, 15, 27, 39, 51, 61];
    const nearest = (list, v) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
    const meet = [nearest(streetsX, col), nearest(streetsY, row)];
    state.meet = meet;
    state.start = t;
    state.until = t + 9;
    for (const p of state.people) {
      const [x, y] = p.cur ?? p.path[0];
      const onRow = streetsY.some((sy) => Math.abs(sy - y) < 0.01);
      const corner = onRow ? [meet[0], y] : [x, meet[1]];
      p.path = [[x, y], corner, meet];
    }
  },
  room(state, col, row, t) {
    if (!state.people || state.people.length >= 12) return;
    state.people.push({ x: 31, y: 14, tx: 31, ty: 11, next: t + 1.5 });
  },
};

// ------------------------------------------------------------------- boot

typeCouplets(document.querySelector("[data-couplet]"), ["things i've made."]);

await measureAdvance();

for (const plate of document.querySelectorAll("[data-plate]")) {
  const draw = PLATES[plate.dataset.plate];
  if (!draw) continue;
  const [ink, acc] = plate.querySelectorAll("pre");
  const sheet = new Sheet(COLS, ROWS);
  const state = {};
  let local = 0;
  let acc_ = 0;
  const paint = (t) => {
    sheet.clear();
    draw(sheet, t, state);
    const [a, b] = sheet.render();
    ink.textContent = a;
    acc.textContent = b;
  };
  // A still frame that shows each drawing at its most telling moment.
  paint(reducedMotion() ? 8 : 0);
  if (location.search.includes("debug")) (window.__plates ??= []).push({ name: plate.dataset.plate, paint });
  animateWhileVisible(plate, (dt) => {
    local += dt;
    acc_ += dt;
    if (acc_ < 1 / 14) return;
    acc_ = 0;
    paint(local);
  });
  plate.addEventListener("pointerenter", () => {
    if (plate.dataset.plate === "wave") {
      state.marks = null;
      local = 0;
    }
  });
  const click = CLICKS[plate.dataset.plate];
  const drawing = plate.querySelector(".drawing");
  if (click && drawing) {
    drawing.classList.add("is-interactive");
    drawing.addEventListener("click", (e) => {
      const r = ink.getBoundingClientRect();
      const col = Math.floor(((e.clientX - r.left) / r.width) * COLS);
      const row = Math.floor(((e.clientY - r.top) / r.height) * ROWS);
      const now = reducedMotion() ? 8 : local;
      click(state, col, row, now);
      paint(now);
    });
  }
}
