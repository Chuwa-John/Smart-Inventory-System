// The App Check debug token must never be reachable in production.
//
//   node appcheck-debug-guard.test.mjs
//
// Why the hook exists. The reCAPTCHA v3 site key is registered for the deployed
// domain, so on localhost the App Check token exchange fails with
// appCheck/recaptcha-error -- and because App Check is ENFORCED on Firebase
// Auth, every sign-in then comes back 401
// auth/firebase-app-check-token-is-invalid. That made the app impossible to
// exercise locally before a release, which is precisely when it most needs
// exercising.
//
// What it is. Firebase's documented debug-token mechanism, not a bypass: the
// flag makes the SDK mint a debug token and print it, and that token authorises
// nothing until the project owner registers it in the Firebase Console. An
// unregistered debug token is useless.
//
// Why this file exists. The entire safety of it is one hostname guard. If that
// ever widens -- a stray hostname, a truthy default, a refactor that hoists the
// flag out of its branch -- the deployed app stops verifying through reCAPTCHA
// and starts announcing itself as a debug client. That is an authentication
// control switched off quietly, on a system handling other people's money, and
// it would not look like a bug in any screenshot.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

const DEBUG_FLAG = "FIREBASE_APPCHECK_DEBUG_TOKEN";

console.log("=== the flag is set only for a locally served page ===");
{
  check("the hostname list is exactly the loopback names",
    /const servedLocally = \["localhost", "127\.0\.0\.1", "\[::1\]"\]\.includes\(location\.hostname\);/.test(noComments),
    "anything else in this list is a host that could be served to a real user");
  check("the flag is set behind that guard, never unconditionally",
    /if \(servedLocally\) self\.FIREBASE_APPCHECK_DEBUG_TOKEN = true;/.test(noComments));

  // One assignment, one guard. A second one anywhere is the shape this fails
  // to catch by regex alone, so it is counted rather than matched.
  const assignments = (noComments.match(new RegExp(`${DEBUG_FLAG}\\s*=`, "g")) || []).length;
  check("there is exactly one place the flag is ever assigned", assignments === 1,
    `${assignments} assignments found`);
}

console.log("\n=== production still verifies the way it always did ===");
{
  const guardAt = noComments.indexOf("const servedLocally");
  const initAt = noComments.indexOf("initializeAppCheck(app, {");
  check("the guard is evaluated before App Check is initialised", guardAt !== -1 && guardAt < initAt,
    "the SDK reads the flag at init; setting it afterwards does nothing at all");
  check("the real reCAPTCHA provider is still the provider",
    /new ReCaptchaV3Provider\("6LdtGFEtAAAAABK4HX_ufjUMskc7pix12Lz2NMGd"\)/.test(noComments),
    "the debug path must be additional to it, never a replacement for it");
  check("no deployed hostname appears in the guard",
    !/web\.app|firebaseapp\.com|sanitaryflow/.test(noComments.slice(guardAt, initAt)),
    "the deployed domain in this list would disable reCAPTCHA verification on the live site");
  check("the guard reads the real hostname, not something spoofable in-page",
    /location\.hostname/.test(noComments.slice(guardAt, initAt)) &&
    !/searchParams|localStorage|location\.search|location\.hash/.test(noComments.slice(guardAt, initAt)),
    "a query parameter or a stored value would let anyone turn this on from a URL");
}

console.log("\n=== and the failure it was added for stays non-fatal ===");
{
  // App Check has always been wrapped so a failure to initialise cannot stop
  // the app booting. That predates this hook and must survive it.
  check("App Check initialisation is still inside a try",
    /try \{[\s\S]{0,1400}initializeAppCheck\(app, \{/.test(noComments));
  check("a failure warns and continues rather than throwing",
    /catch \(appCheckError\) \{[\s\S]{0,200}console\.warn\("App Check failed to initialize; continuing without it\."/.test(src),
    "a shop must still reach the sign-in screen when App Check is unavailable");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
