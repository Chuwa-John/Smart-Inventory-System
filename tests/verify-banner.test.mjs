// Guards the amber "please verify your email" banner: it must come down on its
// own once the address is verified.
//
//   node verify-banner.test.mjs
//
// The banner's own logic was never wrong -- updateAuthUi() has always hidden it
// on state.user.emailVerified. What was missing is that nothing ever set that
// flag after sign-in. Verification happens by clicking a link in an email, which
// means it happens in another tab or on the phone the mail arrived on; the
// Firebase user object in THIS tab keeps the cached value it was created with,
// and onAuthStateChanged does not fire for a verification. So a staff member
// verified their address, came back, and the shop still told them to verify it,
// until somebody thought to reload the whole app.
//
// The fix re-asks when the tab comes back to the front. That puts a network
// request on a very common event, so the properties worth holding are as much
// about cost as about correctness:
//
//   - it stops completely once verified (the steady state is zero requests)
//   - it is throttled (a tab switch is not rare)
//   - it does not ask while offline (a till spends real time there)
//   - the ID token is forced, not just the account record: the proxy checks
//     email_verified on the token, so hiding the banner without refreshing it
//     would tell the user they are fine while the server kept refusing them
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

function extractFn(name) {
  const start = src.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

// Runs the real function against a stub user, so these are assertions about
// behaviour rather than about the shape of the source.
function harness({ emailVerified, online = true, verifiesOnReload = false, reloadThrows = false }) {
  const calls = { reload: 0, getIdToken: [], updateAuthUi: 0, toasts: [], warns: 0 };
  const user = {
    emailVerified,
    async reload() {
      calls.reload += 1;
      if (reloadThrows) throw new Error("network");
      if (verifiesOnReload) user.emailVerified = true;
    },
    async getIdToken(force) { calls.getIdToken.push(force); return "token"; }
  };

  const run = new Function(
    "state", "navigator", "updateAuthUi", "showToast", "t", "console", "calls",
    `const VERIFICATION_RECHECK_GAP_MS = ${/const VERIFICATION_RECHECK_GAP_MS = (\d+);/.exec(src)[1]};
     let lastVerificationCheckMs = 0;
     ${extractFn("refreshEmailVerification")}
     return refreshEmailVerification;`
  )(
    { user },
    { onLine: online },
    () => { calls.updateAuthUi += 1; },
    (message) => calls.toasts.push(message),
    (key) => key,
    { warn: () => { calls.warns += 1; } },
    calls
  );

  return { run, calls, user };
}

console.log("=== the banner comes down once the address is verified ===");
{
  const { run, calls } = harness({ emailVerified: false, verifiesOnReload: true });
  await run();
  check("an unverified user is re-checked", calls.reload === 1);
  check("the UI is told, so the banner is re-evaluated", calls.updateAuthUi === 1,
    "without this the flag flips and nothing repaints");
  check("the user is told why the banner vanished", calls.toasts.includes("toast.emailVerified"));
  check("the ID token is force-refreshed", calls.getIdToken.length === 1 && calls.getIdToken[0] === true,
    "the proxy reads email_verified off the token, not off the account record");
}

console.log("\n=== it costs nothing in the steady state ===");
{
  const { run, calls } = harness({ emailVerified: true });
  await run();
  await run();
  check("an already-verified user is never re-checked", calls.reload === 0,
    "this runs on every tab focus for the life of the session");
  check("and nothing is repainted or toasted", calls.updateAuthUi === 0 && calls.toasts.length === 0);
}
{
  const { run, calls } = harness({ emailVerified: false, verifiesOnReload: true });
  await run();
  await run();
  await run();
  check("checking stops the moment it flips", calls.reload === 1,
    "the second and third calls see a verified user and return early");
  check("the toast is shown once, not on every focus", calls.toasts.length === 1);
}

console.log("\n=== it is throttled and offline-aware ===");
{
  const { run, calls } = harness({ emailVerified: false });
  await run();
  await run();
  await run();
  check("rapid re-focus does not mean rapid requests", calls.reload === 1,
    "visibilitychange and focus both fire on a single tab switch");
}
{
  const { run, calls } = harness({ emailVerified: false, online: false });
  await run();
  check("nothing is asked while offline", calls.reload === 0);
}

console.log("\n=== a failed check is quiet and harmless ===");
{
  const { run, calls } = harness({ emailVerified: false, reloadThrows: true });
  await run();
  check("a reload failure is caught", calls.warns === 1);
  check("and the banner is left exactly as it was", calls.updateAuthUi === 0 && calls.toasts.length === 0,
    "a failed check must never be read as a successful verification");
}

console.log("\n=== the wiring exists and the strings are translated ===");
{
  const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  check("coming back to the tab triggers a check",
    /visibilitychange[\s\S]{0,120}refreshEmailVerification\(\)/.test(noComments));
  check("regaining the window triggers a check",
    /addEventListener\("focus", refreshEmailVerification\)/.test(noComments));
  check("regaining a connection triggers a check",
    /addEventListener\("online", refreshEmailVerification\)/.test(noComments));
  check("the banner still keys off emailVerified",
    /#verifyBanner"\)\.hidden = !signedIn \|\| Boolean\(state\.user\?\.emailVerified\)/.test(noComments));
  check("toast.emailVerified exists in both languages",
    (src.match(/"toast\.emailVerified"/g) || []).length >= 3,
    "expected two dictionary entries plus at least one usage");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
