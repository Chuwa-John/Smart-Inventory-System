// Colour contrast, checked in a real browser.
//
//   npx playwright install --with-deps chromium   (once)
//   node contrast.headless.mjs
//
// Contrast is a property of rendered pixels, not of source text. A test that
// greps styles.css for a hex value asserts that someone typed a colour, not
// that the colour passes -- and the ratios here depend on custom properties,
// gradients and which surface an element happens to sit on. So this boots
// Chromium, loads the real shell, and measures.
//
// Two layers, because each misses what the other catches:
//   1. A token contract. Deterministic, and the regression that actually
//      happens: someone adjusts --panel and quietly drops --muted under 4.5.
//   2. A sweep of everything visible in the rendered page, which catches a new
//      element that hard-codes a colour instead of using a token.
//
// External requests are blocked, so this never depends on Firebase being
// reachable and never varies with the network. app.js failing to reach its
// backend is expected and irrelevant: the DOM and the stylesheet are what is
// under test.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("playwright is not installed. Run: npm ci && npx playwright install --with-deps chromium");
  process.exit(1);
}

// --- static server ----------------------------------------------------------
const server = createServer(async (req, res) => {
  try {
    // Strip the ?v= cache-busting query, and refuse to escape the project root.
    const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const file = join(ROOT, rel === "/" ? "app.html" : rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// Anything not served by us is blocked: Firebase, the CDN libraries, the proxy.
await page.route("**/*", (route) =>
  route.request().url().startsWith(base) ? route.continue() : route.abort());
page.on("pageerror", () => {});   // app.js cannot reach its backend here, by design
await page.goto(`${base}/app.html`, { waitUntil: "load" });

// --- the measurement, run inside the page ----------------------------------
const measure = async (theme) => page.evaluate(async (theme) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (theme) document.documentElement.dataset.theme = theme;
  else document.documentElement.removeAttribute("data-theme");
  // Colour transitions interpolate; measuring immediately reads the old theme.
  await wait(400);

  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
  const rgbs = (s) => [...s.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => {
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
  });
  // Resolve a custom property to actual channels via the browser itself.
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.appendChild(probe);
  const token = (name) => {
    probe.style.color = `var(${name})`;
    const v = getComputedStyle(probe).color;
    return rgbs(v)[0]?.c ?? null;
  };

  // Worst-case background: an opaque colour, or the extreme stops of a gradient.
  const bgOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node), img = cs.backgroundImage;
      if (img && img !== "none" && img.includes("gradient")) {
        // Only OPAQUE stops count. A wash like
        // radial-gradient(var(--accent-quiet), transparent) layered over a solid
        // panel is a tint, not a background -- treating its stops as the backdrop
        // compares text against near-transparency and reports 1:1 on a panel that
        // is perfectly legible. That produced three false failures on the split
        // sign-in panel, and I nearly redesigned around a measurement error.
        // Where every stop is translucent, keep walking for the solid beneath.
        const stops = rgbs(img).filter((x) => x.a > 0.9).map((x) => x.c);
        if (stops.length) { const s = stops.sort((a, b) => lum(a) - lum(b)); return [s[0], s[s.length - 1]]; }
      }
      const bg = rgbs(cs.backgroundColor)[0];
      if (bg && bg.a > 0.9) return [bg.c];
      node = node.parentElement;
    }
    return [rgbs(getComputedStyle(document.documentElement).backgroundColor)[0]?.c ?? [11, 13, 16]];
  };

  // 1. Token contract.
  const pairs = [
    ["--text", "--bg", 4.5, "body text on the page"],
    ["--text", "--panel", 4.5, "body text on a card"],
    ["--muted", "--panel", 4.5, "secondary text on a card"],
    ["--muted", "--bg", 4.5, "secondary text on the page"],
    ["--muted-strong", "--panel", 4.5, "emphasised secondary text"],
    ["--control-border", "--panel", 3.0, "control boundary on a card"],
    ["--control-border", "--bg", 3.0, "control boundary on the page"],
    ["--accent-ink", "--accent", 4.5, "label on the primary action"]
  ];
  const tokens = pairs.map(([fg, bg, need, what]) => {
    const a = token(fg), b = token(bg);
    const r = a && b ? ratio(a, b) : 0;
    return { pair: `${fg} on ${bg}`, what, ratio: Number(r.toFixed(2)), need, pass: r >= need };
  });

  // 2. Sweep of what is actually painted.
  const sweep = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    if (el.tagName === "OPTION") continue;              // drawn by the OS
    if (el.closest(".skip-link")) continue;              // offscreen until focused
    // WCAG 1.4.3 exempts logotypes: "text that is part of a logo or brand name
    // has no minimum contrast requirement". The "DS" mark measures 3.51:1 in
    // light and is deliberately left alone. This is the only exemption here --
    // if a second one is ever needed, that is a signal to look harder at the
    // palette rather than to lengthen this list.
    if (el.closest(".brand-mark")) continue;
    if (!el.getClientRects().length) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || Number(cs.opacity) < 0.1) continue;
    const fg = rgbs(cs.color)[0];
    if (!fg) continue;
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3.0 : 4.5;
    const worst = Math.min(...bgOf(el).map((bg) => ratio(fg.c, bg)));
    if (worst >= need) continue;
    const key = `${cs.color}|${Math.round(size)}|${(el.className || "").toString().slice(0, 24)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sweep.push({ el: (el.className || el.tagName).toString().slice(0, 40),
      text: el.textContent.trim().slice(0, 30), ratio: Number(worst.toFixed(2)), need });
  }
  probe.remove();
  return { tokens, sweep };
}, theme);

// --- assertions -------------------------------------------------------------
let exitCode = 0;
for (const theme of ["dark", "light"]) {
  console.log(`\n=== ${theme} theme ===`);
  const { tokens, sweep } = await measure(theme);

  for (const t of tokens) {
    check(`${t.what} — ${t.pair} (${t.ratio}:1, needs ${t.need})`, t.pass);
  }
  check(`nothing rendered falls below its threshold`, sweep.length === 0,
    sweep.map((s) => `${s.el} "${s.text}" ${s.ratio}:1 (needs ${s.need})`).join("\n      "));
}

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
