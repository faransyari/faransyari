// Draws every picture in the profile README, once per GitHub theme.
//   node scripts/draw.mjs
// Everything is seeded, so a run redraws the same mountains until a seed changes.

import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../assets/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const SANS = `Inter, 'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, Menlo, monospace`;

// Far to near, the way the site stacks its ridges. The sky stays transparent so
// the page's own background shows through.
const THEMES = {
  light: {
    far: "#ebebeb", mid: "#dedede", near: "#cfcfcf", city: "#c2c2c2", ground: "#b5b5b5",
    tree: "#949494", monas: "#9c9c9c", flame: "#c9a64b", moon: "#d6d6d6", star: "#bdbdbd",
    ink: "#111111", soft: "#6b6b6b", faint: "#9a9a9a", rule: "#e3e3e3", box: "#f5f5f5", boxLine: "#e6e6e6",
    mark: "#2b2b2b", stars: false,
  },
  dark: {
    far: "#171a1e", mid: "#1e2226", near: "#262a2f", city: "#2e3339", ground: "#353b41",
    tree: "#444b52", monas: "#58606a", flame: "#e2bc5c", moon: "#e9e9e9", star: "#ffffff",
    ink: "#f0f0f0", soft: "#9ba3ab", faint: "#6e7680", rule: "#262b31", box: "#12161b", boxLine: "#242a31",
    mark: "#dcdcdc", stars: true,
  },
};

// mulberry32: small, seedable, good enough for mountains.
function rng(seed) {
  let a = [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761), 1779033703) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n) => Math.round(n * 10) / 10;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A jagged ridge: alternating peaks and valleys, with the slopes between them
// serrated so they read as rock rather than as triangles. `damp` flattens it
// over a stretch of x, which is how the header keeps the name clear.
function ridge(seed, { W, H, base, amp, minW, maxW, jag = 4, damp = () => 1 }) {
  const r = rng(seed);
  const keys = [[-20, base - amp * r() * 0.2]];
  let x = -20;
  while (x < W + 20) {
    const w = minW + r() * (maxW - minW);
    const px = x + w * (0.3 + r() * 0.4);
    keys.push([px, base - amp * (0.35 + r() * 0.65) * damp(px)]);
    x += w;
    keys.push([x, base - amp * r() * 0.3 * damp(x)]);
  }
  const pts = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const [ax, ay] = keys[i], [bx, by] = keys[i + 1];
    const steps = 2 + Math.floor(r() * 3);
    pts.push([ax, ay]);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      pts.push([ax + (bx - ax) * t, ay + (by - ay) * t + (r() - 0.5) * jag * 2]);
    }
  }
  pts.push(keys.at(-1));
  return `M-20 ${H} ` + pts.map(([px, py]) => `L${r1(px)} ${r1(py)}`).join(" ") + ` L${W + 20} ${H} Z`;
}

// Three stacked tiers and a stub of trunk.
function pine(x, y, h) {
  const w = h * 0.42;
  const tiers = [0, 0.3, 0.56].map((o, i) => {
    const top = y - h + o * h * 0.9;
    const bot = y - h * 0.12 - (2 - i) * h * 0.2;
    const hw = w * (0.55 + i * 0.22);
    return `M${r1(x)} ${r1(top)} L${r1(x + hw)} ${r1(bot)} L${r1(x - hw)} ${r1(bot)} Z`;
  });
  return tiers.join(" ") + ` M${r1(x - h * 0.03)} ${r1(y - h * 0.14)} h${r1(h * 0.06)} v${r1(h * 0.14)} h${r1(-h * 0.06)} Z`;
}

// Monas, standing where the ground is at `g`. Platform, the cup, the obelisk,
// and the flame, which is the one bit of colour on the whole page.
function monas(cx, g, s, t) {
  const p = (x, y) => `${r1(cx + x * s)} ${r1(g - y * s)}`;
  const body = [
    `M${p(-40, 0)} L${p(40, 0)} L${p(40, 5)} L${p(-40, 5)} Z`,
    `M${p(-27, 5)} L${p(27, 5)} L${p(19, 17)} L${p(-19, 17)} Z`,
    `M${p(-23, 17)} L${p(23, 17)} L${p(23, 20)} L${p(-23, 20)} Z`,
    `M${p(-5, 20)} L${p(5, 20)} L${p(2.8, 112)} L${p(-2.8, 112)} Z`,
    `M${p(-5, 112)} L${p(5, 112)} L${p(3, 116)} L${p(-3, 116)} Z`,
  ].join(" ");
  const flame = `M${p(0, 128)} C${p(3.4, 123)} ${p(4, 118)} ${p(0, 116)} C${p(-4, 118)} ${p(-3.4, 123)} ${p(0, 128)} Z`;
  return `<path d="${body}" fill="${t.monas}"/><path class="flame" d="${flame}" fill="${t.flame}"/>`;
}

function stars(seed, n, { W, H, avoid = () => false }, t) {
  if (!t.stars) return "";
  const r = rng(seed);
  let out = "";
  for (let i = 0; i < n; i++) {
    const x = r() * W, y = r() * H;
    if (avoid(x, y)) continue;
    const d = (r() * 6).toFixed(2), rad = (0.6 + r() * 1.1).toFixed(2);
    out += `<circle class="tw" cx="${r1(x)}" cy="${r1(y)}" r="${rad}" fill="${t.star}" style="animation-delay:-${d}s"/>`;
  }
  return out;
}

function moon(cx, cy, rad, t, id) {
  return `<mask id="${id}"><rect x="${cx - rad - 2}" y="${cy - rad - 2}" width="${rad * 2 + 4}" height="${rad * 2 + 4}" fill="#fff"/><circle cx="${cx + rad * 0.45}" cy="${cy - rad * 0.3}" r="${rad * 0.92}" fill="#000"/></mask><circle cx="${cx}" cy="${cy}" r="${rad}" fill="${t.moon}" mask="url(#${id})"/>`;
}

function shootingStar(t, { x, y, len = 90, dx = 260, dy = 110, every = 11 }) {
  if (!t.stars) return "";
  const a = Math.atan2(dy, dx) * 180 / Math.PI;
  return `<g class="shoot" style="--dx:${dx}px;--dy:${dy}px;animation-duration:${every}s"><line x1="${x}" y1="${y}" x2="${r1(x + len * Math.cos(a * Math.PI / 180))}" y2="${r1(y + len * Math.sin(a * Math.PI / 180))}" stroke="url(#tail)" stroke-width="1.6" stroke-linecap="round"/></g>`;
}

const STYLE = `<style>
.tw{animation:tw 5s ease-in-out infinite}
@keyframes tw{0%,100%{opacity:.9}50%{opacity:.2}}
.shoot{opacity:0;animation:shoot 11s linear infinite}
@keyframes shoot{0%,86%{opacity:0;transform:translate(0,0)}88%{opacity:1}96%{opacity:0;transform:translate(var(--dx),var(--dy))}100%{opacity:0}}
.flame{animation:fl 3.2s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 100%}
@keyframes fl{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.12)}}
.fan{animation:spin 2.4s linear infinite;transform-box:fill-box;transform-origin:center}
@keyframes spin{to{transform:rotate(360deg)}}
.steam{animation:steam 3.6s ease-in-out infinite;opacity:0}
@keyframes steam{0%{opacity:0;transform:translateY(6px)}40%{opacity:.8}100%{opacity:0;transform:translateY(-10px)}}
.blink{animation:blink 1.1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.shoot,.steam{display:none}}
</style>`;

// Layers fade toward their peaks, so the far ones read as haze.
function hazeDefs(t, W) {
  const g = (id, c) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".35"/><stop offset=".55" stop-color="${c}"/></linearGradient>`;
  return g("hFar", t.far) + g("hMid", t.mid) + g("hNear", t.near) +
    `<linearGradient id="tail" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="${t.star}"/><stop offset="1" stop-color="${t.star}" stop-opacity="0"/></linearGradient>`;
}

const svg = (W, H, label, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${STYLE}${body}</svg>\n`;

// ─── header ────────────────────────────────────────────────────────────────

function header(t) {
  const W = 1200, H = 420;
  // Keep the peaks low under the name, and let them rise on the right.
  const damp = (x) => (x < 760 ? 0.42 + (x / 760) * 0.25 : 1);
  const trees = [[40, 50], [70, 66], [98, 44], [1080, 58], [1112, 78], [1142, 52], [1168, 70], [1190, 46]]
    .map(([x, h]) => pine(x, 404, h)).join(" ");
  // A few towers either side of Monas: Jakarta, without drawing a skyline.
  const city = [[700, 34, 22], [728, 58, 26], [760, 44, 20], [930, 52, 24], [958, 30, 30], [995, 64, 22], [1022, 40, 18]]
    .map(([x, h, w]) => `<rect x="${x}" y="${392 - h}" width="${w}" height="${h + 10}" fill="${t.city}"/>`).join("");

  return svg(W, H, "Firlandi Ansyari, software engineer at GoTo, Jakarta. A grey mountain range with Monas in front of it.", `
<defs>${hazeDefs(t, W)}</defs>
${stars("hdr", 90, { W, H: 250, avoid: (x, y) => x < 720 && y > 60 && y < 220 }, t)}
${shootingStar(t, { x: 820, y: 40 })}
${moon(1040, 96, 26, t, "hm")}
<path d="${ridge("far", { W, H, base: 330, amp: 190, minW: 150, maxW: 280, jag: 5, damp })}" fill="url(#hFar)"/>
<path d="${ridge("mid", { W, H, base: 356, amp: 130, minW: 110, maxW: 210, jag: 5, damp })}" fill="url(#hMid)"/>
<path d="${ridge("near", { W, H, base: 382, amp: 80, minW: 90, maxW: 170, jag: 4, damp })}" fill="url(#hNear)"/>
${city}
${monas(860, 400, 1.55, t)}
<path d="${ridge("ground", { W, H, base: 404, amp: 10, minW: 200, maxW: 380, jag: 1 })}" fill="${t.ground}"/>
<path d="${trees}" fill="${t.tree}"/>
<text x="56" y="138" font-family="${SANS}" font-size="78" font-weight="700" letter-spacing="-2.4" fill="${t.ink}">Firlandi Ansyari</text>
<text x="60" y="186" font-family="${SANS}" font-size="24" fill="${t.soft}">Software engineer at GoTo · Jakarta</text>`);
}

// ─── bands between sections ────────────────────────────────────────────────

function band(t, seed, { trees = [], monasAt } = {}) {
  const W = 1200, H = 110;
  const tr = trees.map(([x, h]) => pine(x, 104, h)).join(" ");
  return svg(W, H, "", `
<defs>${hazeDefs(t, W)}</defs>
${stars(seed, 26, { W, H: 50 }, t)}
<path d="${ridge(seed + "a", { W, H, base: 86, amp: 70, minW: 120, maxW: 240, jag: 4 })}" fill="url(#hFar)"/>
<path d="${ridge(seed + "b", { W, H, base: 100, amp: 44, minW: 90, maxW: 180, jag: 3 })}" fill="url(#hMid)"/>
${monasAt ? monas(monasAt, 104, 0.62, t) : ""}
<path d="${ridge(seed + "c", { W, H, base: 106, amp: 6, minW: 200, maxW: 400, jag: 1 })}" fill="${t.near}"/>
<path d="${tr}" fill="${t.tree}"/>`);
}

// ─── project rows ──────────────────────────────────────────────────────────
// Ruled rows, like the work list on the site: number, a drawing, the words.

function row(t, { n, title, lines, stack, tag, label, draw }) {
  const W = 1200, H = 236;
  const body = lines.map((l, i) => `<text x="440" y="${118 + i * 36}" font-family="${SANS}" font-size="26" fill="${t.soft}">${esc(l)}</text>`).join("");
  return svg(W, H, label, `
<line x1="0" y1="1" x2="${W}" y2="1" stroke="${t.rule}" stroke-width="2"/>
<text x="0" y="66" font-family="${MONO}" font-size="20" fill="${t.faint}">${n}</text>
<g transform="translate(64 26)"><rect width="330" height="186" rx="16" fill="${t.box}" stroke="${t.boxLine}" stroke-width="1.5"/>${draw}</g>
<text x="440" y="72" font-family="${SANS}" font-size="44" font-weight="700" letter-spacing="-1.2" fill="${t.ink}">${esc(title)}</text>
${body}
<text x="440" y="${118 + lines.length * 36 + 22}" font-family="${MONO}" font-size="19" fill="${t.faint}">${esc(stack)}</text>
<text x="${W}" y="66" text-anchor="end" font-family="${MONO}" font-size="19" fill="${t.faint}">${esc(tag)}</text>`);
}

// A plausible QR: three finder squares and seeded modules in between.
function qr(x, y, m, t) {
  const r = rng("menu"), N = 21;
  const finder = (i, j) => i < 7 && j < 7 || i < 7 && j >= N - 7 || i >= N - 7 && j < 7;
  let d = "";
  for (const [fi, fj] of [[0, 0], [0, N - 7], [N - 7, 0]]) {
    const X = x + fj * m, Y = y + fi * m;
    d += `M${r1(X)} ${r1(Y)}h${7 * m}v${7 * m}h${-7 * m}Z M${r1(X + m)} ${r1(Y + m)}v${5 * m}h${5 * m}v${-5 * m}Z M${r1(X + 2 * m)} ${r1(Y + 2 * m)}h${3 * m}v${3 * m}h${-3 * m}Z `;
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (finder(i, j) || (i < 8 && j < 8) || (i < 8 && j > N - 9) || (i > N - 9 && j < 8)) continue;
    if (r() < 0.47) d += `M${r1(x + j * m)} ${r1(y + i * m)}h${m}v${m}h${-m}Z `;
  }
  return `<path d="${d}" fill="${t.mark}" fill-rule="evenodd"/>`;
}

function drawMenu(t) {
  const steam = [0, 1.2, 2.4].map((d, i) => `<path class="steam" style="animation-delay:${d}s" d="M${238 + i * 10} 104 q-5 -8 0 -16 q5 -8 0 -16" fill="none" stroke="${t.faint}" stroke-width="2" stroke-linecap="round"/>`).join("");
  return `
<rect x="24" y="150" width="282" height="8" rx="4" fill="${t.faint}" opacity=".5"/>
<path d="M92 150 L106 30 L186 30 L200 150 Z" fill="${t.box}" stroke="${t.mark}" stroke-width="2.5" stroke-linejoin="round"/>
<text x="146" y="50" text-anchor="middle" font-family="${MONO}" font-size="12" fill="${t.soft}">table 7</text>
${qr(113, 60, 3.2, t)}
<text x="146" y="142" text-anchor="middle" font-family="${MONO}" font-size="10" fill="${t.faint}">scan to order</text>
${steam}
<path d="M226 112 h40 v22 a14 14 0 0 1 -14 14 h-12 a14 14 0 0 1 -14 -14 Z" fill="${t.mark}"/>
<path d="M266 118 a9 9 0 0 1 0 18" fill="none" stroke="${t.mark}" stroke-width="3.5"/>
<ellipse cx="246" cy="150" rx="32" ry="4" fill="${t.mark}"/>`;
}

function drawPc(t) {
  const fan = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="17" fill="none" stroke="${t.soft}" stroke-width="2"/><g class="fan"><path d="M${cx} ${cy} q4 -14 -6 -14 M${cx} ${cy} q14 4 14 -6 M${cx} ${cy} q-4 14 6 14 M${cx} ${cy} q-14 -4 -14 6" fill="none" stroke="${t.mark}" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="3" fill="${t.mark}"/></g>`;
  const check = (y, k, v) => `<text x="150" y="${y}" font-family="${MONO}" font-size="14" fill="${t.soft}">${k}</text><text x="232" y="${y}" font-family="${MONO}" font-size="14" fill="${t.mark}">${v}</text><path d="M${288} ${y - 5} l4 4 l8 -9" fill="none" stroke="${t.mark}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `
<rect x="40" y="26" width="84" height="140" rx="8" fill="none" stroke="${t.mark}" stroke-width="2.5"/>
<rect x="52" y="36" width="60" height="6" rx="3" fill="${t.faint}" opacity=".6"/>
${fan(82, 72)}${fan(82, 116)}
<circle cx="112" cy="154" r="3" fill="${t.mark}"/>
<rect x="36" y="166" width="12" height="5" rx="2" fill="${t.mark}"/><rect x="116" y="166" width="12" height="5" rx="2" fill="${t.mark}"/>
${check(58, "socket", "AM5")}${check(88, "memory", "DDR5")}${check(118, "power", "750W")}
<line x1="150" y1="134" x2="302" y2="134" stroke="${t.boxLine}" stroke-width="2"/>
<text x="150" y="160" font-family="${MONO}" font-size="16" font-weight="700" fill="${t.mark}">Rp 18.450.000</text>`;
}

function drawBot(t) {
  return `
<text x="22" y="30" font-family="${MONO}" font-size="12" fill="${t.faint}">POST /api/interactions</text>
<rect x="22" y="44" width="200" height="34" rx="17" fill="none" stroke="${t.mark}" stroke-width="2"/>
<text x="38" y="66" font-family="${MONO}" font-size="14" fill="${t.mark}">/timeout @spam 10m</text>
<rect x="100" y="94" width="208" height="54" rx="14" fill="${t.mark}"/>
<text x="116" y="117" font-family="${SANS}" font-size="14" font-weight="600" fill="${t.box}">done.</text>
<text x="116" y="137" font-family="${SANS}" font-size="13" fill="${t.box}" opacity=".75">back in ten minutes</text>
<text x="22" y="172" font-family="${MONO}" font-size="12" fill="${t.faint}">200 OK · 41ms</text>
<rect x="138" y="162" width="8" height="12" fill="${t.faint}" class="blink"/>`;
}

// FDI numbering, each tooth split into its five surfaces the way the chart in
// the clinic app draws them. A couple are marked.
function drawTeeth(t) {
  const s = 30, gap = 5, x0 = 40;
  const marks = { "16:o": 1, "14:m": 1, "12:v": 1, "46:d": 1, "47:o": 1, "44:o": 1 };
  let out = "";
  const rows = [[18, 17, 16, 15, 14, 13, 12, 11], [48, 47, 46, 45, 44, 43, 42, 41]];
  rows.forEach((teeth, ri) => {
    const y = ri ? 104 : 38;
    teeth.forEach((tooth, i) => {
      const S = s * 0.95, q = s * 0.3;
      const X = x0 + i * (S + gap * 0.6);
      const surf = {
        v: `M${X} ${y}h${S}l${-q} ${q}h${-(S - 2 * q)}Z`,
        d: `M${X + S} ${y}v${S}l${-q} ${-q}v${-(S - 2 * q)}Z`,
        l: `M${X} ${y + S}h${S}l${-q} ${-q}h${-(S - 2 * q)}Z`,
        m: `M${X} ${y}v${S}l${q} ${-q}v${-(S - 2 * q)}Z`,
        o: `M${X + q} ${y + q}h${S - 2 * q}v${S - 2 * q}h${-(S - 2 * q)}Z`,
      };
      for (const [k, d] of Object.entries(surf)) {
        out += `<path d="${d}" fill="${marks[`${tooth}:${k}`] ? t.mark : "none"}" stroke="${t.soft}" stroke-width="1.2" stroke-linejoin="round"/>`;
      }
      out += `<text x="${X + S / 2}" y="${ri ? y + S + 16 : y - 7}" text-anchor="middle" font-family="${MONO}" font-size="10" fill="${t.faint}">${tooth}</text>`;
    });
  });
  return out;
}

function drawSite(t) {
  const W = 330, H = 186;
  return `
<defs><clipPath id="sc"><rect width="${W}" height="${H}" rx="16"/></clipPath>${hazeDefs(t, W)}</defs>
<g clip-path="url(#sc)">
${stars("site", 30, { W, H: 90 }, t)}
${moon(262, 44, 13, t, "sm")}
<path d="${ridge("s1", { W, H, base: 140, amp: 80, minW: 60, maxW: 110, jag: 3 })}" fill="url(#hFar)"/>
<path d="${ridge("s2", { W, H, base: 160, amp: 50, minW: 50, maxW: 90, jag: 3 })}" fill="url(#hMid)"/>
<path d="${ridge("s3", { W, H, base: 178, amp: 18, minW: 80, maxW: 140, jag: 2 })}" fill="${t.near}"/>
<path d="${[[26, 34], [44, 44], [290, 40], [308, 30]].map(([x, h]) => pine(x, 186, h)).join(" ")}" fill="${t.tree}"/>
</g>
<rect x="95" y="16" width="140" height="22" rx="11" fill="${t.box}" stroke="${t.boxLine}"/>
${[0, 1, 2, 3, 4].map((i) => `<rect x="${108 + i * 24}" y="25" width="14" height="4" rx="2" fill="${i === 0 ? t.mark : t.faint}"/>`).join("")}
<text font-family="${SANS}" font-size="19" font-weight="700" letter-spacing="-.5" fill="${t.ink}"><tspan x="24" y="72">Firlandi Althaf</tspan><tspan x="24" y="94">Ansyari</tspan></text>`;
}

const ROWS = [
  {
    file: "menuscanorder", n: "01", title: "menuscanorder", tag: "public ↗",
    lines: ["QR menus for restaurants. Scan the code on", "the table, order from your phone."],
    stack: "codeigniter 4 · php · mysql · docker", draw: drawMenu,
  },
  {
    file: "pc-marketplace", n: "02", title: "pc-marketplace", tag: "public ↗",
    lines: ["Buy, sell, and plan PC builds. The builder checks", "socket, RAM, and PSU before you find out the hard way."],
    stack: "next.js · django rest · jwt · prices in rupiah", draw: drawPc,
  },
  {
    file: "landi-bot", n: "03", title: "landi-bot", tag: "private",
    lines: ["A Discord moderation bot with no gateway at all.", "Discord posts to Vercel, the bot answers."],
    stack: "typescript · vercel functions · neon postgres", draw: drawBot,
  },
  {
    file: "clinic", n: "04", title: "dental clinic records", tag: "private",
    lines: ["Patient records, bookings, and a tooth-by-tooth", "chart you can click, surface by surface."],
    stack: "next.js · supabase · row level security", draw: drawTeeth,
  },
  {
    file: "site", n: "05", title: "firlandiansyari.com", tag: "live ↗",
    lines: ["My site. Every page gets its own drawn landscape,", "including both campuses I studied at."],
    stack: "next.js · framer motion · photos straight from drive", draw: drawSite,
  },
];

// ─── footer ────────────────────────────────────────────────────────────────

function footer(t) {
  const W = 1200, H = 150;
  const r = rng("foot");
  const trees = Array.from({ length: 34 }, (_, i) => [i * 36 + r() * 20, 30 + r() * 44])
    .map(([x, h]) => pine(x, 146, h)).join(" ");
  return svg(W, H, "", `
<defs>${hazeDefs(t, W)}</defs>
${stars("foot", 40, { W, H: 70 }, t)}
${shootingStar(t, { x: 180, y: 18, dx: 220, dy: 70, every: 13 })}
${moon(1100, 36, 14, t, "fm")}
<path d="${ridge("fa", { W, H, base: 120, amp: 80, minW: 120, maxW: 220, jag: 4 })}" fill="url(#hFar)"/>
<path d="${ridge("fb", { W, H, base: 136, amp: 40, minW: 90, maxW: 170, jag: 3 })}" fill="url(#hMid)"/>
<path d="${trees}" fill="${t.tree}"/>`);
}

// ─── write ─────────────────────────────────────────────────────────────────

for (const [name, t] of Object.entries(THEMES)) {
  const put = (file, body) => writeFileSync(new URL(`${file}-${name}.svg`, OUT), body);
  put("header", header(t));
  put("band-1", band(t, "one", { trees: [[1100, 30], [1124, 40], [1146, 26]] }));
  put("band-2", band(t, "two", { trees: [[40, 34], [62, 24]], monasAt: 980 }));
  put("footer", footer(t));
  for (const r of ROWS) {
    put(`row-${r.file}`, row(t, { ...r, label: `${r.title}: ${r.lines.join(" ")}`, draw: r.draw(t) }));
  }
}
console.log("drawn");
