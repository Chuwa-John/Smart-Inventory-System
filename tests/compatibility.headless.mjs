// Guards COMPAT-1: what a browser that cannot run the app actually shows.
//
//   node compatibility.headless.mjs
//
// Every view's markup lives in index.html and is shown or hidden by JavaScript.
// So a browser that never runs it rendered SIX views stacked on top of each
// other, complete with 18 buttons and 9 form fields that responded to nothing,
// and no explanation anywhere. That reads as a broken product rather than an
// unsupported browser, and it is the worse of the two: a shopkeeper pokes at it
// for a while before giving up.
//
// This is not hypothetical for this market. Opera Mini's extreme mode renders
// server-side and does not run client JavaScript, data-saver proxies strip it,
// and a browser too old for ES modules ignores <script type="module"> entirely.
// All three land in the same place.
//
// Rendered with a real engine, twice, because the whole point is what the DOM
// looks like when the script never executes -- which no amount of source
// scanning can tell you.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
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

// The REAL production headers, read from firebase.json rather than copied here
// where they could drift. This exists because of a live outage: the
// flag-clearing script was inline, the production CSP is script-src 'self' with
// no unsafe-inline, so the browser blocked it, the flag never cleared, and every
// visitor saw the "cannot run" notice on a browser that runs the app perfectly
// well. This test passed at the time because the server below sent no CSP at
// all -- it was faithfully testing a page that does not exist in production.
const hostingHeaders = (() => {
  const config = JSON.parse(readFileSync(new URL("../firebase.json", import.meta.url), "utf8"));
  const out = {};
  for (const rule of config.hosting?.headers ?? []) {
    if (rule.source !== "**") continue;
    for (const { key, value } of rule.headers ?? []) out[key] = value;
  }
  return out;
})();

const server = createServer(async (req, res) => {
  try {
    const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const file = join(ROOT, rel === "/" ? "index.html" : rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { ...hostingHeaders, "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

async function render(javaScriptEnabled) {
  const ctx = await browser.newContext({ javaScriptEnabled, viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  // Nothing external: this must not depend on Firebase or a CDN being up.
  await page.route("**/*", (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
  page.on("pageerror", () => {});
  await page.goto(`${base}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(900);      // past the fallback's reveal delay
  const out = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
    };
    const notice = document.querySelector(".app-unavailable");
    return {
      pendingFlag: document.documentElement.classList.contains("js-pending"),
      noticeVisible: notice ? vis(notice) : false,
      noticeText: notice ? notice.innerText.replace(/\s+/g, " ").trim() : "",
      visibleControls: [...document.querySelectorAll("input,select,textarea,button")].filter(vis).length,
      visibleViews: [...document.querySelectorAll("[data-view], .view, section[id]")].filter(vis).length,
      appShellVisible: (() => { const el = document.querySelector(".app-shell"); return el ? vis(el) : false; })(),
      authGateVisible: (() => { const el = document.querySelector("#authGate"); return el ? vis(el) : false; })()
    };
  });
  await ctx.close();
  return out;
}

console.log("=== a browser that cannot run the app is told so ===");
{
  const off = await render(false);
  check("the pending flag survives, because nothing cleared it", off.pendingFlag,
    "a module script cleared it -- but this context runs no scripts at all");
  check("the notice is shown", off.noticeVisible);
  check("it names the requirement in English", /needs JavaScript/i.test(off.noticeText));
  check("and in Swahili, since the translation layer is not running either",
    /inahitaji JavaScript/i.test(off.noticeText), off.noticeText.slice(0, 90));
  check("it names data-saving mode, which is how this usually happens here",
    /data-sav|kuokoa data/i.test(off.noticeText));

  check("no dead views are rendered", off.visibleViews === 0, `${off.visibleViews} visible`);
  check("no dead controls are rendered", off.visibleControls === 0,
    `${off.visibleControls} buttons/fields that respond to nothing`);
  check("the app shell is hidden", !off.appShellVisible);
  // #authGate lives outside .app-shell and was still drawing a full sign-in
  // form beneath the notice.
  check("the sign-in form is hidden too", !off.authGateVisible);
}

console.log("\n=== a browser that can run it is unaffected ===");
{
  const on = await render(true);
  check("the pending flag is cleared", !on.pendingFlag);
  check("the notice never appears", !on.noticeVisible);
  check("the sign-in form is shown", on.authGateVisible);
  check("controls are interactive again", on.visibleControls > 5, `${on.visibleControls} visible`);
}

console.log("\n=== the flag is cleared the only way the CSP permits ===");
{
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const boot = await readFile(new URL("../boot.js", import.meta.url), "utf8");

  // Inline is what caused the outage: script-src 'self' with no unsafe-inline
  // blocks it silently, so the flag never clears and the app is unreachable.
  check("no inline script tries to clear the flag",
    !/<script(?![^>]*\bsrc=)[^>]*>[^<]*js-pending/.test(html),
    "an inline script is blocked by the production CSP and the app never appears");
  check("it is a same-origin file, which script-src 'self' allows",
    /<script type="module" src="\.\/boot\.js\?v=[^"]+"><\/script>/.test(html));
  // Still a module: a browser too old for ES modules must ignore it and keep
  // the notice, which is the entire point of the mechanism.
  check("it is still loaded as a module", /<script type="module" src="\.\/boot\.js/.test(html));
  check("boot.js does the clearing", /classList\.remove\("js-pending"\)/.test(boot));
  check("it loads before the app bundle, not after",
    html.indexOf("boot.js") < html.indexOf('src="./app.js'),
    "otherwise the notice shows until a 360 KB download finishes");
  check("boot.js is versioned like every other cached asset",
    /boot\.js\?v=/.test(html));
  check("the service worker pre-caches the same url the page requests",
    (await readFile(new URL("../sw.js", import.meta.url), "utf8")).includes(
      (html.match(/\.\/boot\.js\?v=[^"]+/) || [""])[0]));
  check("the document starts flagged", /<html lang="en" class="js-pending">/.test(html));
  check("the production CSP is actually being served by this test",
    /script-src/.test(hostingHeaders["Content-Security-Policy"] || ""),
    "without it, an inline-script regression passes here and breaks production");
}

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
