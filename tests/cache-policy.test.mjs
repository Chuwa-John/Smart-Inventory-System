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

console.log("\n=== module imports are not invisible to this guard (QA-106) ===");
{
  // The blind spot that made this necessary. The check above reads HTML `src`
  // and `href` attributes, so it never saw
  //
  //     import { firebaseConfig } from "./firebase-config.js";
  //
  // at the top of app.js and accept-invite.js. Those two files decide which
  // Firebase project the app talks to and where the AI proxy lives, and they
  // were being served `public, max-age=31536000, immutable` — verified against
  // production. Bumping app.js?v= does not help: the specifier inside it is
  // unchanged, so a device that has them keeps them for a year and no deploy
  // can rotate a project or a proxy URL.
  //
  // An imported module is safe if it is versioned OR explicitly declared
  // no-cache. Anything else is pinned.
  const scripts = readdirSync(ROOT).filter((f) => f.endsWith(".js"));
  const imports = [];
  for (const file of scripts) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const m of src.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+"(\.\/[^"]+\.js)(\?[^"]*)?"/g)) {
      imports.push({ file, target: m[1], versioned: Boolean(m[2]) });
    }
  }
  check("module imports were actually found to check", imports.length >= 2,
    `${imports.length} local imports across ${scripts.length} scripts`);

  const declaredNoCache = (target) => {
    const name = target.replace("./", "");
    return rules.some((rule) =>
      (rule.source.includes(name.replace(".js", "")) || rule.source === `/${name}`)
      && (rule.headers ?? []).some((h) =>
        h.key.toLowerCase() === "cache-control" && /no-cache/.test(h.value)));
  };

  const pinned = imports.filter((i) => !i.versioned && !declaredNoCache(i.target));
  check("no imported module is left pinned under immutable", pinned.length === 0,
    pinned.map((i) => `${i.file} -> ${i.target}`).join("\n      ")
      + "\n      version it, or declare it no-cache in firebase.json");

  // The config files specifically: assert the rule exists rather than relying
  // on the generic check above, because these two are the rotation path.
  for (const name of ["firebase-config.js", "ai-config.js"]) {
    check(`${name} is declared no-cache`, declaredNoCache(`./${name}`),
      "this is the file a project or proxy rotation has to be able to reach");
  }

  // Order is load-bearing here for the same reason it is for sw.js.
  const jsIndex = rules.findIndex((r) => r.source === "**/*.@(js|css)");
  const cfgIndex = rules.findIndex((r) => /firebase-config/.test(r.source));
  check("the config rule comes after the blanket js rule", cfgIndex > jsIndex,
    "Firebase takes the last matching value; reversed, the config is immutable again");
}

console.log("\n=== the worker cannot pin the config either ===");
{
  // Fixing the HTTP header alone is not enough: the service worker serves
  // same-origin GETs cache-first, so its own copy would outlive the header fix
  // until CACHE_NAME happened to move.
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  check("config is served network-first", /firebase-config\|ai-config/.test(sw),
    "cache-first would keep serving a stale project id however the header is set");
  // Brace-matched rather than sliced to a fixed length. The first version took
  // the next 700 characters, which silently stopped containing the .catch as
  // soon as a comment was added above it — an assertion that fails for editing
  // rather than for breaking is worse than none.
  const branchStart = sw.indexOf("if (/\\/(firebase-config|ai-config)");
  let depth = 0, bi = sw.indexOf("{", branchStart);
  for (let i = bi; i < sw.length; i++) {
    if (sw[i] === "{") depth++;
    else if (sw[i] === "}") { depth--; if (depth === 0) { bi = i; break; } }
  }
  // Comments stripped before any match. Three assertions in this session have
  // now passed by matching an explanatory comment instead of the code it sat
  // above — including one in this very block, whose note quotes `cache:
  // "reload"` verbatim. Match code, or the test measures the prose.
  const branch = sw.slice(branchStart, bi + 1).replace(/\/\/[^\n]*/g, "");
  check("the config branch was located", branch.length > 100 && branch.length < 2000,
    `${branch.length} chars`);
  check("...with the cache kept as the offline fallback",
    /\.catch\(\(\) => caches\.match\(request\)\)/.test(branch),
    "dropping the cache entirely would stop the app booting offline and take the offline till with it");
  check("...and still pre-cached for a cold offline start",
    /"\.\/firebase-config\.js"/.test(sw) && /"\.\/ai-config\.js"/.test(sw));

  // Without this the fix only protects installs that come AFTER it. Devices
  // that loaded the config while hosting was still sending `immutable` hold it
  // in their own HTTP cache until 2027, and a plain fetch() is answered from
  // there without touching the network — so the very devices the rotation needs
  // to reach are the ones it would still miss.
  check("...and the network fetch bypasses the browser's own HTTP cache",
    /cache: "reload"/.test(branch),
    "already-pinned devices are exactly the ones this has to recover");
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
