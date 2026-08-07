// Phase 29: deployment validation — can a release be undone, and does the
// undoing actually reach a shop?
//
//   node deployment-validation.test.mjs
//
// Rollback was written down and had never been rehearsed, which makes it a plan
// rather than a capability. Rehearsing it turned up two defects that a drill is
// the only way to find, and both are the kind you discover at the worst moment.
//
// The first: OPERATIONS.md told you to bump the version in `index.html`, three
// separate times, and never mentioned `app.html`. index.html is the landing
// page — its CSS is inline and it references no versioned asset at all, so the
// documented procedure would have had you edit strings that do not exist while
// leaving untouched the one file that says which bundle to load. A rollback
// performed under pressure by following the runbook would have shipped a shell
// still pointing at the build being rolled back.
//
// The second is worse, because nothing about it looks broken. A shop opens the
// till in the morning and does not navigate again. The browser only re-checks
// sw.js on navigation, so that tab never learns a newer — or older — build
// exists. skipWaiting() and clients.claim() make the new worker serve fetches
// immediately, but the page is still RUNNING the JavaScript it parsed at
// opening time, and only a reload changes that. So the shop worst affected by a
// bad build was the shop least likely to receive its withdrawal.
import { readFileSync, readdirSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const appHtml = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const ops = readFileSync(new URL("../OPERATIONS.md", import.meta.url), "utf8");
const ROOT = new URL("..", import.meta.url);

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

console.log("=== the runbook names the files that actually carry a version ===");
{
  // The drift this catches is silent: renaming or splitting a page leaves the
  // procedure describing a layout that no longer exists, and nothing complains
  // until someone follows it during an incident.
  const pages = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  const stamped = pages.filter((f) => /\?v=[0-9a-z]+/.test(readFileSync(new URL(f, ROOT), "utf8")));

  // Only the numbered release-procedure step, not the whole document.
  const step = ops.slice(ops.indexOf("For every hosted frontend release"));
  const listed = step.slice(0, step.indexOf("\n3."));

  // The bullets are the instruction; the prose around them is commentary, and
  // the commentary deliberately names index.html in order to exclude it. Only
  // what you would actually go and edit counts as "named".
  const bullets = listed.split("\n").filter((l) => /^\s*- /.test(l)).join("\n");

  const missing = stamped.filter((f) => !bullets.includes(f));
  check("every stamped page is named in the release procedure", missing.length === 0,
    `not named: ${missing.join(", ")} — a release that follows the runbook would skip them`);

  const unstamped = pages.filter((f) => !stamped.includes(f));
  const wrongly = unstamped.filter((f) => new RegExp(`\`${f}\``).test(bullets));
  check("the procedure does not name a page that carries no version", wrongly.length === 0,
    `named but carries no ?v=: ${wrongly.join(", ")}`);

  check("app.html is named", bullets.includes("app.html"),
    "it is the file that says which bundle to load");
  check("sw.js CACHE_NAME is named", /CACHE_NAME/.test(bullets));
  check("the pages were actually scanned", pages.length >= 4 && stamped.length >= 3,
    `${pages.length} pages, ${stamped.length} stamped`);
}

console.log("\n=== a rollback can take effect without every tab closing ===");
{
  // Without skipWaiting the replacement worker sits in "waiting" until all tabs
  // for the origin close. A shop closes its tab once a day, so a rollback would
  // land the following morning at the earliest.
  check("the worker does not wait its turn", /self\.skipWaiting\(\)/.test(sw),
    "a waiting worker means the rollback lands whenever the shop next closes the tab");
  check("...and takes over pages already open", /self\.clients\.claim\(\)/.test(sw));

  // Rolling back changes CACHE_NAME to an older value. Activation has to drop
  // the newer cache or the shell being withdrawn keeps being served.
  const activate = sw.slice(sw.indexOf('addEventListener("activate"'));
  check("activation drops every cache but its own",
    /keys\.filter\(\(key\) => key !== CACHE_NAME\)/.test(activate),
    "otherwise the withdrawn shell is still on disk and still served");
}

console.log("\n=== an open till finds out a new build exists ===");
{
  check("the app asks periodically whether it is current",
    /registration\.update\(\)/.test(app),
    "the browser only re-checks sw.js on navigation, and a till does not navigate");
  check("...and asks again when it regains a connection",
    /addEventListener\("online", check\)/.test(app),
    "a shop that was offline for an hour may be several builds behind");
  check("...and when the till is looked at again",
    /visibilitychange/.test(app));

  check("a worker taking over is noticed", /addEventListener\("controllerchange"/.test(app),
    "clients.claim() changes who serves fetches, not what the page is already running");
  check("the first-ever load does not prompt",
    /const hadController = Boolean\(navigator\.serviceWorker\.controller\)/.test(app)
      && /if \(!hadController\) return;/.test(app),
    "controllerchange fires on first registration too, for a version nobody was running");
}

console.log("\n=== the reload is offered, never taken ===");
{
  // The whole reason this is a banner and not an automatic refresh: reloading a
  // till mid-sale, cart on screen and a customer waiting, is a worse fault than
  // the one being rolled back.
  const reloads = [...app.matchAll(/location\.reload\(\)/g)];
  check("the app reloads itself in exactly one place", reloads.length === 1,
    `${reloads.length} location.reload() call(s)`);
  check("...and that place is the button", /#updateReloadButton"\)\?\.addEventListener\("click"/.test(app),
    "an automatic reload would discard a cart that is mid-sale");

  check("the banner exists in the shell", /id="updateReadyBanner"/.test(appHtml));
  check("the banner starts hidden", /id="updateReadyBanner" hidden/.test(appHtml));
  check("it announces itself politely", /id="updateReadyBanner"[^>]*role="status"/.test(appHtml),
    'role="alert" would interrupt a screen reader mid-sale');

  for (const key of ["update.readyText", "update.reloadButton"]) {
    const uses = [...app.matchAll(new RegExp(`"${key.replace(".", "\\.")}":`, "g"))].length;
    check(`${key} is translated in both languages`, uses === 2, `found ${uses} definitions, expected en + sw`);
    check(`...and the shell references ${key}`, appHtml.includes(key));
  }
}

console.log("\n=== what a rollback restores is the whole set, not part of it ===");
{
  // Every stamp has to move together. Half a rollback -- an old shell asking
  // for a new bundle, or the reverse -- is worse than no rollback, because the
  // combination was never tested anywhere.
  const stamps = new Set([...appHtml.matchAll(/\?v=([0-9a-z]+)/g)].map((m) => m[1]));
  check("app.html carries exactly one version across all its assets", stamps.size === 1,
    `found ${[...stamps].join(", ")}`);

  const swStamps = new Set([...sw.matchAll(/\?v=([0-9a-z]+)/g)].map((m) => m[1]));
  check("the service worker shell agrees with it",
    swStamps.size === 1 && [...swStamps][0] === [...stamps][0],
    `app.html ${[...stamps].join(",")} vs sw.js ${[...swStamps].join(",")}`);

  check("CACHE_NAME moved too", /const CACHE_NAME = "savia-shell-v\d+"/.test(sw));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
