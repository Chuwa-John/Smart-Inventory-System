// Guards the hosting cache policy against the two ways it goes wrong.
//
//   node cache-policy.test.mjs
//
// It was configured backwards. Versioned JS and CSS -- every one of them
// requested with a ?v= that changes on release -- were served `no-cache`, so a
// shop on metered mobile data revalidated the whole shell on every load for no
// benefit. Meanwhile app.html, which carries no version and is the thing that
// tells the browser which build of everything else to fetch, fell to Firebase's
// default of max-age=3600. A deploy therefore took up to an hour to reach a
// returning shop, including a fix on the sale path.
//
// Correcting it introduced the opposite hazard, which is the more dangerous of
// the two: `immutable` on an asset requested WITHOUT a version pins it in a
// browser for a year with no way to recover. terms.html and privacy-policy.html
// were loading a bare ./styles.css and would have been frozen at whatever
// stylesheet happened to be live that day.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(readFileSync(new URL("../firebase.json", import.meta.url), "utf8"));

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

const rules = config.hosting?.headers ?? [];
const cacheFor = (source) => {
  // Firebase applies every matching rule and the LAST wins for a repeated key,
  // so the effective value is the last one, not the first.
  let value = null;
  for (const rule of rules) {
    if (rule.source !== source) continue;
    for (const { key, value: v } of rule.headers ?? []) {
      if (key.toLowerCase() === "cache-control") value = v;
    }
  }
  return value;
};

console.log("=== the entry point is always revalidated ===");
{
  const html = cacheFor("**/*.html");
  check("html is declared no-cache", html === "no-cache",
    `got ${html} — without this Firebase defaults to max-age=3600 and a deploy takes an hour to land`);
  const sw = cacheFor("/sw.js");
  check("the service worker is no-cache too", sw === "no-cache",
    "it is the one script with no version in its url; a stale one keeps serving a stale shell");
}

console.log("\n=== versioned assets are cached properly ===");
{
  const assets = cacheFor("**/*.@(js|css)");
  check("js and css are cached long", /max-age=\d{7,}/.test(assets || ""), `got ${assets}`);
  check("...and marked immutable", /immutable/.test(assets || ""));
}

console.log("\n=== sw.js beats the blanket js rule ===");
{
  // Both patterns match sw.js. Order is what makes the specific one win, so an
  // innocent-looking reordering of firebase.json would silently pin the
  // service worker for a year.
  const jsIndex = rules.findIndex((r) => r.source === "**/*.@(js|css)");
  const swIndex = rules.findIndex((r) => r.source === "/sw.js");
  check("both rules exist", jsIndex !== -1 && swIndex !== -1);
  check("the sw.js rule comes after the blanket js rule", swIndex > jsIndex,
    "Firebase takes the last matching value; reversed, sw.js would be immutable for a year");
}

console.log("\n=== nothing immutable is requested without a version ===");
{
  // The hazard the correction created. An unversioned url under immutable is
  // pinned in a browser for a year and cannot be recovered by deploying.
  const pages = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  const offenders = [];
  for (const page of pages) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
    for (const m of html.matchAll(/(?:src|href)="(\.\/[^"]+\.(?:js|css))"/g)) {
      offenders.push(`${page} -> ${m[1]}`);
    }
  }
  check("every js/css reference in every page carries a ?v=", offenders.length === 0,
    offenders.join("\n      ") + "\n      an unversioned url under immutable is pinned for a year");
  check("the pages were actually scanned", pages.length >= 4, `${pages.length} html files`);
}

console.log("\n=== the service worker pre-caches the urls the pages request ===");
{
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const appHtml = readFileSync(new URL("../app.html", import.meta.url), "utf8");
  for (const asset of ["styles.css", "app.js", "boot.js"]) {
    const wanted = (appHtml.match(new RegExp(`\\./${asset.replace(".", "\\.")}\\?v=[0-9a-z]+`)) || [])[0];
    check(`sw pre-caches the same ${asset} url the page asks for`,
      Boolean(wanted && sw.includes(wanted)),
      `page wants ${wanted}; caching a different url means fetching one copy and serving another`);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
