// The service worker's pre-cache list and the pages' asset references must
// agree, character for character.
//
//   node asset-versions.test.mjs
//
// A Cache Storage key includes the query string. "./app.js" and
// "./app.js?v=20260802l" are therefore two unrelated entries, not one file with
// a label. When APP_SHELL names the bare path and the page requests the
// versioned one, install downloads the file under a key nothing ever reads,
// then the fetch handler downloads it a second time under the key that is
// actually used. The app still works, which is exactly why this drifts
// unnoticed -- the only symptom is the bill and the wait, and the wait lands on
// the metered phone connection of a shop that has just been told to reload.
//
// It drifted here once already: styles.css and boot.js carried their versions
// into APP_SHELL and app.js -- the 406 KB one -- did not.
//
// The second check exists because cache.addAll() is atomic. One entry that 404s
// rejects the whole install, the service worker never activates, and offline
// mode is silently gone. A missing icon takes the till offline with it.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const sw = readFileSync(new URL("sw.js", root), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

// --- what the service worker promises to pre-cache ---------------------------
// Comments inside the list are stripped first. Without that, a comment that
// quotes a path -- e.g. one explaining why the bare "./app.js" is wrong -- is
// read as a list entry, and the duplicate check below fails on prose.
const shellBlock = sw
  .slice(sw.indexOf("const APP_SHELL"), sw.indexOf("];", sw.indexOf("const APP_SHELL")))
  .replace(/\/\/[^\n]*/g, "");
const APP_SHELL = [...shellBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

console.log("=== APP_SHELL is readable and non-empty ===");
check("APP_SHELL parsed from sw.js", APP_SHELL.length > 0,
  "could not find a quoted list after `const APP_SHELL` -- did the declaration change shape?");

// --- 1. every entry resolves to a real file ----------------------------------
console.log("\n=== every pre-cached entry exists on disk (addAll is atomic) ===");
for (const entry of APP_SHELL) {
  if (entry === "./") continue; // the navigation root, served by Hosting, not a file
  const relative = entry.replace(/^\.\//, "").split("?")[0];
  const onDisk = fileURLToPath(new URL(relative, root));
  check(`${entry} exists`, existsSync(onDisk), `expected a file at ${relative}`);
}

// --- 2. pre-cached pages may only reference pre-cached assets -----------------
// Scoped to the HTML files APP_SHELL itself lists. accept-invite.html is
// deliberately not pre-cached -- it is a once-per-staff-member page and has no
// business occupying the shell cache -- so its assets are not required here.
console.log("\n=== pre-cached pages reference exactly the assets that were pre-cached ===");
const pages = APP_SHELL.filter((e) => e.endsWith(".html"));
check("APP_SHELL lists at least one page", pages.length > 0);

// Guards the skip below from hiding a real regression: if every page suddenly
// referenced nothing, the checks would all skip and the file would pass empty.
let refsSeen = 0;

for (const page of pages) {
  const html = readFileSync(new URL(page.replace(/^\.\//, ""), root), "utf8");

  // Same-origin scripts and stylesheets only. Icons and images are referenced
  // by many pages and are already covered by check 1; what matters here is the
  // code and CSS, because those are the files that get versioned.
  const refs = [
    ...html.matchAll(/<script[^>]+src="(\.\/[^"]+\.js(?:\?[^"]*)?)"/g),
    ...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="(\.\/[^"]+\.css(?:\?[^"]*)?)"/g)
  ].map((m) => m[1]);

  // A page with no external code at all is legitimate -- index.html is the
  // marketing page and carries its own styles inline, deliberately, so that
  // the pitch renders without waiting on the app's stylesheet. Only the pages
  // that DO reference external assets have anything to agree about.
  if (refs.length === 0) {
    console.log(`SKIP  ${page} references no external script or stylesheet (self-contained)`);
    continue;
  }

  refsSeen += refs.length;
  for (const ref of refs) {
    const exact = APP_SHELL.includes(ref);
    const bare = ref.split("?")[0];
    const shadowed = !exact && APP_SHELL.some((e) => e.split("?")[0] === bare);
    check(`${page} -> ${ref} is pre-cached under the same key`, exact,
      shadowed
        ? `APP_SHELL has "${APP_SHELL.find((e) => e.split("?")[0] === bare)}" but the page requests "${ref}".\n` +
          `      Different query string means a different cache key: this file is downloaded twice per install\n` +
          `      and the pre-cached copy is never served. Change the APP_SHELL entry to "${ref}".`
        : `"${ref}" is missing from APP_SHELL entirely -- it will never be available offline.`);
  }
}

check("at least one pre-cached page references an external asset", refsSeen > 0,
  "every page skipped -- the reference pattern above has stopped matching anything");

// --- 3. no two entries differ only by query string ---------------------------
// Two keys for one file means one of them is dead weight, whichever way round.
console.log("\n=== no entry is shadowed by a second copy of the same file ===");
{
  const byPath = new Map();
  for (const entry of APP_SHELL) {
    const bare = entry.split("?")[0];
    byPath.set(bare, [...(byPath.get(bare) || []), entry]);
  }
  for (const [bare, entries] of byPath) {
    check(`${bare} appears once`, entries.length === 1, `found ${entries.length}: ${entries.join(", ")}`);
  }
}

// --- 4. a version bump must move CACHE_NAME ----------------------------------
// Editing APP_SHELL without bumping CACHE_NAME changes nothing for anyone who
// already has the old service worker: install only re-runs when the name moves.
console.log("\n=== CACHE_NAME is present and versioned ===");
{
  const m = sw.match(/const CACHE_NAME = "([^"]+)"/);
  check("CACHE_NAME is declared", Boolean(m), "sw.js has no CACHE_NAME constant");
  check("CACHE_NAME carries a version suffix", Boolean(m && /-v\d+$/.test(m[1])),
    `got "${m ? m[1] : "(none)"}" -- expected something ending in -v<number>`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
