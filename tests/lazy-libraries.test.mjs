// Guards the on-demand loading of the four heavy third-party libraries.
//
//   node lazy-libraries.test.mjs
//
// They used to load as parser-blocking <script> tags on every page: 552 KB
// gzipped, 1.66 MB parsed, measured, none of it needed to open a till. xlsx
// alone is 315 KB gzipped and serves one occasional owner export, yet every
// cashier paid for it at every shift start.
//
// Two ways this regresses. Someone re-adds a <script> tag to index.html for
// convenience and the cost quietly comes back. Or a consumer uses a global
// without awaiting the load first, which works on a warm cache and fails on a
// cold one -- the kind of bug that never reproduces on the developer's machine.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

const registry = app.slice(
  app.indexOf("const EXTERNAL_LIBRARIES"),
  app.indexOf("const externalLibraryLoads")
);

console.log("=== nothing heavy loads before the app does ===");
{
  const eagerTags = [...html.matchAll(/<script[^>]*cdnjs\.cloudflare\.com[^>]*>/g)];
  check("index.html has no eager CDN script tags", eagerTags.length === 0,
    eagerTags.map((m) => m[0].slice(0, 80)).join("\n      "));

  // The Firebase SDK is a different case: the app genuinely cannot start
  // without auth, so it stays. This test is not about it.
  check("a preconnect keeps the first on-demand fetch quick",
    /<link rel="preconnect" href="https:\/\/cdnjs\.cloudflare\.com"/.test(html));
}

console.log("\n=== every library is pinned to a hash ===");
{
  const entries = [...registry.matchAll(/url: "([^"]+)"/g)].map((m) => m[1]);
  const hashes = [...registry.matchAll(/integrity: "(sha\d{3}-[^"]+)"/g)].map((m) => m[1]);
  check("all four libraries are registered", entries.length === 4, `${entries.length} found`);
  check("every registered library carries an integrity hash",
    hashes.length === entries.length, `${entries.length} urls, ${hashes.length} hashes`);
  check("hashes are sha384 or stronger", hashes.every((h) => /^sha(384|512)-/.test(h)));
  check("the loader actually applies integrity and crossOrigin",
    /script\.integrity = spec\.integrity/.test(app) && /script\.crossOrigin = "anonymous"/.test(app));
  check("all urls are https", entries.every((u) => u.startsWith("https://")));
}

console.log("\n=== the plugin cannot race the library it attaches to ===");
{
  // jspdf-autotable attaches itself to an already-loaded jsPDF. Loading them in
  // parallel leaves the plugin with nothing to attach to, and the failure is
  // intermittent, which is the worst kind.
  const pdfBlock = registry.slice(registry.indexOf("pdf: ["), registry.indexOf("scanner:"));
  const order = [...pdfBlock.matchAll(/([a-z.-]+\.min\.js)/g)].map((m) => m[1]);
  check("jspdf is registered before its autotable plugin",
    order[0]?.startsWith("jspdf.umd") && order[1]?.includes("autotable"), order.join(" then "));
  check("the loader awaits each script in sequence",
    /for \(const spec of EXTERNAL_LIBRARIES\[name\]\) await loadScriptOnce\(spec\)/.test(app));
}

console.log("\n=== a dropped request does not disable the feature ===");
{
  // These tills run over connections that drop. Caching a rejected promise
  // would mean one bad moment disables exporting until someone reloads.
  check("a failed load is evicted so the next attempt retries",
    /externalLibraryLoads\.delete\(name\)/.test(app));
  check("a successful load is cached so it is fetched once",
    /externalLibraryLoads\.set\(name, load\)/.test(app));
  check("an already-present global short-circuits the fetch",
    /if \(spec\.global && window\[spec\.global\]\) return Promise\.resolve\(\)/.test(app));
}

console.log("\n=== every consumer waits for its library ===");
{
  const consumers = [
    ["generateReportXlsx", "xlsx"],
    ["openBarcodeScanner", "scanner"],
    ["exportMonthlyReportPdf", "pdf"],
    ["exportPaymentReportPdf", "pdf"],
    ["generateReportPdf", "pdf"],
    ["downloadPurchaseOrderPdf", "pdf"],
    ["downloadReceiptPdf", "pdf"]
  ];
  for (const [fn, lib] of consumers) {
    const start = app.indexOf(`async function ${fn}(`);
    check(`${fn} is async`, start !== -1, "not found, or still a plain function");
    if (start === -1) continue;
    let depth = 0, i = app.indexOf("{", start);
    for (; i < app.length; i++) {
      if (app[i] === "{") depth++;
      else if (app[i] === "}") { depth--; if (depth === 0) break; }
    }
    const body = app.slice(start, i + 1);
    const awaitIndex = body.indexOf(`await ensureLibrary("${lib}"`);
    check(`${fn} awaits the ${lib} library`, awaitIndex !== -1);

    // Using the global before the await is the cold-cache bug: fine locally,
    // broken for a user opening the app for the first time.
    const globals = { xlsx: "window.XLSX", pdf: "window.jspdf", scanner: "Html5Qrcode" };
    const firstUse = body.indexOf(globals[lib]);
    check(`${fn} does not touch ${globals[lib]} before awaiting`,
      firstUse === -1 || (awaitIndex !== -1 && awaitIndex < firstUse),
      `global used at ${firstUse}, await at ${awaitIndex}`);
  }
}

console.log("\n=== only the till's library is warmed ahead of use ===");
{
  const start = app.indexOf("function prewarmScannerWhenIdle(");
  check("the prewarm exists", start !== -1);
  let depth = 0, i = app.indexOf("{", start);
  for (; i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}") { depth--; if (depth === 0) break; }
  }
  const body = app.slice(start, i + 1);

  check("it warms the scanner", /loadExternalLibrary\("scanner"\)/.test(body));
  // Warming the exports would give back the win this whole change bought.
  check("it does NOT warm xlsx or pdf",
    !/loadExternalLibrary\("(xlsx|pdf)"\)/.test(body), "an export library is being prefetched");
  check("it respects Save-Data", /saveData/.test(body));
  check("it skips 2G connections", /2g/.test(body));
  check("it runs off the critical path", /requestIdleCallback/.test(body));
  check("it has a fallback for browsers without requestIdleCallback", /setTimeout\(warm/.test(body));
  check("a failed prewarm is swallowed, not surfaced", /\.catch\(\(\) => \{\}\)/.test(body));
  check("it is actually called during startup",
    /^prewarmScannerWhenIdle\(\);$/m.test(app));
}

console.log("\n=== failures are still explained to the user ===");
{
  for (const key of ["toast.excelLibraryFailed", "toast.pdfLibraryFailed", "toast.barcodeLibraryFailed"]) {
    const defined = (app.match(new RegExp(`"${key}":`, "g")) || []).length;
    check(`${key} exists in both languages`, defined === 2, `${defined} definition(s)`);
  }
  check("ensureLibrary reports a failure rather than failing silently",
    /showToast\(t\(failureKey\)\)/.test(app));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
