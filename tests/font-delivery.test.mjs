// The font is actually delivered.
//
//   node font-delivery.test.mjs
//
// styles.css named Inter from the beginning and set four Inter-specific
// features on every screen -- and no @font-face, no font file, and no font link
// existed anywhere in the repo. Every shop was reading Roboto or a browser
// default, and "cv02", "cv03", "cv04", "cv11" and the tabular-figures setting
// were inert on every device. Nothing failed; it simply was not true.
//
// That is the class of defect this file exists to catch: a stylesheet asking
// for something the build does not ship. It checks the whole chain -- the file
// is present, the face points at it, the page preloads it, the service worker
// pre-caches it for offline, the licence travels with it, and the hosting
// policy can actually serve it.
import { readFileSync, statSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const css = read("styles.css");
const html = read("app.html");
const sw = read("sw.js");
const firebaseJson = JSON.parse(read("firebase.json"));

const results = [];
function check(name, actual, expected = true) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log("=== the file exists, and is small enough to send over 2G ===");
{
  let size = 0;
  try { size = statSync(new URL("fonts/inter-latin.woff2", root)).size; } catch { size = 0; }
  check("fonts/inter-latin.woff2 ships", size > 0);
  // 39 KB as subset. The ceiling is a judgement about a shop on a slow link
  // paying for this once: the unsubset variable font is 352 KB, which is the
  // mistake this bound exists to stop anyone repeating.
  check("...and is under 60 KB", size > 0 && size < 60 * 1024, true);
  check("the OFL licence travels with it, as the licence requires",
    (() => { try { return read("fonts/OFL.txt").includes("SIL OPEN FONT LICENSE"); } catch { return false; } })());
}

console.log("\n=== the stylesheet points at the file it ships ===");
{
  const face = css.slice(css.indexOf("@font-face"), css.indexOf("}", css.indexOf("@font-face")) + 1);
  check("there is an @font-face", face.includes("@font-face"));
  check("...naming Inter", /font-family:\s*"Inter"/.test(face));
  check("...serving woff2", /format\("woff2"\)/.test(face));
  check("...from our own origin, never a CDN", /url\("\.\/fonts\/inter-latin\.woff2/.test(face));
  // The CSP is font-src 'self' data:, so a Google Fonts URL would be blocked at
  // runtime and the page would silently fall back -- exactly the failure this
  // file is named after.
  check("no external font host anywhere", /fonts\.googleapis|fonts\.gstatic|use\.typekit/.test(css + html), false);
  check("text stays visible while it loads", /font-display:\s*swap/.test(face));
  // A range, so 400 through 700 all come from the one file.
  check("one file covers the weights the app uses", /font-weight:\s*400 700/.test(face));
  check("the family is still what the body asks for", /font-family:\s*\n?\s*Inter,/.test(css));
}

console.log("\n=== the features that are set are the ones that matter at a till ===");
{
  // Disambiguation, not decoration: 1 against l against I, and 0 against O, are
  // what get mis-keyed in an order number or a price.
  check("the body enables Inter's disambiguation set", /font-feature-settings:\s*"ss02" 1/.test(css));
  check("...with l and I told apart", /"cv05" 1/.test(css) && /"cv08" 1/.test(css));
  // Declarations only. The @font-face comment above names the old features to
  // explain what went wrong, and a check that reads prose as code would fail on
  // its own documentation.
  const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");
  check("the decorative variants are gone",
    /"cv02"|"cv03"|"cv04"|"cv11"/.test(cssCode), false);
  // font-feature-settings overrides font-variant-numeric, so money must repeat
  // the disambiguation features or it loses them.
  const money = css.slice(css.indexOf(".money"), css.indexOf(".money") + 600);
  check("money keeps tabular figures", /"tnum" 1/.test(money));
  check("...and keeps the disambiguation with them", /"tnum" 1, "ss02" 1/.test(money));
}

console.log("\n=== it is preloaded, pre-cached, and versioned like everything else ===");
{
  const stamp = (html.match(/styles\.css\?v=([0-9a-z]+)/) || [])[1];
  check("the page has a version stamp", Boolean(stamp));
  check("the font is preloaded", /rel="preload"[^>]*fonts\/inter-latin\.woff2/.test(html));
  // Fonts are fetched in CORS mode even same-origin; without crossorigin the
  // preload is a second, unused download.
  check("...with crossorigin, or the preload is wasted",
    /<link rel="preload"[^>]*fonts\/inter-latin\.woff2[^>]*crossorigin/.test(html));
  check("the preload carries the same stamp as the page",
    new RegExp(`fonts/inter-latin\\.woff2\\?v=${stamp}`).test(html));
  check("the service worker pre-caches it, so an offline till has it",
    new RegExp(`"\\./fonts/inter-latin\\.woff2\\?v=${stamp}"`).test(sw));
  check("...and the stylesheet asks for that same stamp",
    new RegExp(`fonts/inter-latin\\.woff2\\?v=${stamp}`).test(css));
}

console.log("\n=== hosting serves it as an immutable, versioned asset ===");
{
  const headers = firebaseJson.hosting.headers || [];
  const fontRule = headers.find((h) => (h.source || "").includes("woff"));
  check("a cache rule covers woff2", Boolean(fontRule));
  check("...and it is immutable, like the stamped js and css",
    Boolean(fontRule) && fontRule.headers.some((h) =>
      h.key === "Cache-Control" && h.value.includes("immutable")));
  // The ignore list decides what reaches the CDN at all. A font in an ignored
  // path deploys to nothing and 404s in production while passing every test
  // here.
  const ignore = firebaseJson.hosting.ignore || [];
  check("the fonts folder is not excluded from the deploy",
    ignore.some((pattern) => pattern.startsWith("fonts")), false);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(failed.map((f) => "  FAILED: " + f.name).join("\n"));
  process.exit(1);
}
