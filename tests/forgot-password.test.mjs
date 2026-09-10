// Forgot password.
//
//   node forgot-password.test.mjs
//
// Two things are in tension on this screen and both matter.
//
//   1. WHETHER AN ADDRESS HAS AN ACCOUNT MUST NOT BE DISCLOSED. Telling
//      "no such account" apart from "sent" is how someone tests a list of
//      email addresses against this business. Those codes are swallowed.
//   2. EVERY OTHER FAILURE MUST BE REPORTED. The old handler caught everything
//      and still said "a link has been sent", so a dead uplink, a blocked App
//      Check token or a misconfigured project all looked exactly like a
//      delivered email -- on the one screen where the person is already locked
//      out and has no other way in. That is the same misleading-success defect
//      that made sign-in look like wrong credentials.
//
// Functions are evaluated out of app.js rather than reimplemented.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");

const results = [];
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function extract(name) {
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let i = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

// The real handler, over stubs that record what it did.
function run({ throws = null, offline = false, email = "shop@example.com", authReady = true } = {}) {
  const log = { toasts: [], fieldErrors: [], sent: [], disabled: [], noticed: [] };
  const sendPasswordResetEmail = async (_auth, addr, settings) => {
    log.sent.push({ addr, settings: settings || null });
    if (throws && log.sent.length === 1) throw throws;
    if (throws && throws.alwaysThrows) throw throws;
    return true;
  };
  const button = { set disabled(v) { log.disabled.push(v); }, get disabled() { return false; } };

  // PASSWORD_RESET_SILENT_CODES lives outside the function, so hand it in.
  const silent = new Function(`${src.match(/const PASSWORD_RESET_SILENT_CODES = new Set\(\[[\s\S]*?\]\);/)[0]}
    return PASSWORD_RESET_SILENT_CODES;`)();

  const handler = new Function(
    "state", "qs", "showToast", "t", "validateAuthEmail", "isOfflineNow",
    "setFieldError", "console", "PASSWORD_RESET_SILENT_CODES", "showResetSentNotice", "__button", `
    ${extract("handleForgotPassword")}
    return handleForgotPassword;
  `)(
    { auth: authReady ? {} : null, firebaseApi: { auth: { sendPasswordResetEmail } } },
    (sel) => (sel === "#authEmail" ? { value: email } : __buttonProxy(button)),
    (msg) => log.toasts.push(msg),
    (k) => k,
    () => true,
    () => offline,
    (field, msg) => log.fieldErrors.push({ field, msg }),
    { warn() {} },
    silent,
    (addr) => log.noticed.push(addr),
    button
  );
  function __buttonProxy(b) { return b; }
  return { handler, log };
}

// location.origin is read inside the handler; jsdom-free, so provide it.
globalThis.location = { origin: "https://sanitaryflow-erp.web.app" };

console.log("=== an address's existence is never disclosed ===");
{
  for (const code of ["auth/user-not-found", "auth/invalid-recipient-email", "auth/email-not-found"]) {
    const { handler, log } = run({ throws: { code, alwaysThrows: true } });
    await handler();
    check(`${code} reads exactly like success`,
      log.toasts, ["toast.passwordResetSent"]);
  }
  // And the happy path says the same thing, or the two are distinguishable.
  const { handler, log } = run({});
  await handler();
  check("a delivered email says the same neutral sentence",
    log.toasts, ["toast.passwordResetSent"]);
}

console.log("\n=== a real failure is reported, not dressed up as success ===");
{
  const cases = [
    ["auth/network-request-failed", "toast.passwordResetOffline"],
    ["auth/too-many-requests", "toast.authTooManyRequests"],
    ["auth/internal-error", "toast.passwordResetFailed"],
    ["auth/firebase-app-check-token-is-invalid", "toast.passwordResetFailed"],
    ["auth/operation-not-allowed", "toast.passwordResetFailed"]
  ];
  for (const [code, expected] of cases) {
    const { handler, log } = run({ throws: { code, alwaysThrows: true } });
    await handler();
    check(`${code} is surfaced`, log.toasts, [expected]);
    check(`...and never claims the email was sent`,
      log.toasts.includes("toast.passwordResetSent"), false);
  }
  // A malformed address belongs on the field, not in a toast.
  const { handler, log } = run({ throws: { code: "auth/invalid-email", alwaysThrows: true } });
  await handler();
  check("an invalid address marks the field", log.fieldErrors.map((f) => f.field), ["authEmailError"]);
  check("...and does not claim success", log.toasts, []);
}

console.log("\n=== offline is refused before anything is claimed ===");
{
  const { handler, log } = run({ offline: true });
  await handler();
  check("nothing is even attempted", log.sent.length, 0);
  check("and it says why", log.toasts, ["toast.passwordResetOffline"]);
  // The old code fired anyway and then reported success.
  check("it never says a link was sent", log.toasts.includes("toast.passwordResetSent"), false);
}

console.log("\n=== the link comes back to the app ===");
{
  const { handler, log } = run({});
  await handler();
  check("a continue URL is supplied", Boolean(log.sent[0]?.settings), true);
  // Without this the reset ends on Firebase's own page: English only, no
  // branding, and no way back -- a dead end for a shopkeeper on a phone.
  check("...pointing at this app", log.sent[0].settings.url, "https://sanitaryflow-erp.web.app/app.html");
  check("...and handled by the hosted page, not in-app",
    log.sent[0].settings.handleCodeInApp, false);

  // A continue URL on a domain nobody authorised rejects the WHOLE request, so
  // the link is a courtesy and getting the email sent is not.
  const un = run({ throws: { code: "auth/unauthorized-continue-uri" } });
  await un.handler();
  check("an unauthorised continue URL falls back to sending without one",
    un.log.sent.length, 2);
  check("...the retry carries no settings", un.log.sent[1].settings, null);
  check("...and the person is still told it was sent",
    un.log.toasts, ["toast.passwordResetSent"]);
}

console.log("\n=== the confirmation outlives the toast ===");
{
  // A toast lasts 2,600ms. This one asks somebody to LEAVE the app, open their
  // inbox and come back -- so a message that has already faded has not told
  // them anything. Reported as "how will users know it was sent?".
  const { handler, log } = run({ email: "shop@example.com" });
  await handler();
  check("a successful send raises the standing notice", log.noticed, ["shop@example.com"]);
  // Named with the address, because mistyping it is the commonest reason a
  // reset "never arrives" -- and a fading toast never showed it.
  check("...carrying the address it went to", log.noticed[0], "shop@example.com");

  // It must NOT appear when nothing was sent, or it becomes a lie that stays on
  // screen instead of one that fades.
  const off = run({ offline: true });
  await off.handler();
  check("offline raises no notice", off.log.noticed, []);

  const failed = run({ throws: { code: "auth/internal-error", alwaysThrows: true } });
  await failed.handler();
  check("a real failure raises no notice", failed.log.noticed, []);

  // But an address with no account must still see it, or the notice becomes the
  // enumeration oracle the toast was carefully written not to be.
  const unknown = run({ throws: { code: "auth/user-not-found", alwaysThrows: true } });
  await unknown.handler();
  check("an unknown address sees the same notice", unknown.log.noticed.length, 1);
}

console.log("\n=== what the standing notice says ===");
{
  check("it is in the markup", html.includes('id="authResetSent"'), true);
  check("it starts hidden", /id="authResetSent" hidden/.test(html), true);
  // Firebase's default sender is an unauthenticated firebaseapp.com subdomain
  // and Gmail routes it to spam. Saying so is the difference between a working
  // reset and a shop that concludes the feature is broken.
  check("it names the spam folder", html.includes('data-i18n="auth.resetSentSpam"'), true);
  check("it can be dismissed", html.includes('id="authResetSentDismiss"'), true);
  // A stale "check your email" sitting over a later failed sign-in is its own
  // confusion.
  check("it clears when the address is edited",
    /qs\("#authEmail"\)\?\.addEventListener\("input", hideResetSentNotice\)/.test(src), true);
  check("...and when the form switches mode",
    /qs\("#authModeButton"\)\?\.addEventListener\("click", hideResetSentNotice\)/.test(src), true);
  for (const key of ["auth.resetSentTitle", "auth.resetSentBody", "auth.resetSentSpam",
                     "auth.resetSentDismiss", "toast.passwordResetNeedsEmail"]) {
    const n = (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}":`, "g")) || []).length;
    check(`${key} is in en and sw`, n, 2);
  }
}

console.log("\n=== pressing it with an empty box is not silence ===");
{
  const b = extract("handleForgotPassword").replace(/\/\/[^\n]*/g, "");
  // Reported from the live site as a dead button. It was not dead: it wrote
  // "This field is required." into a span under the EMAIL BOX -- a different
  // element from the link that was pressed, and off-screen on a phone. A
  // control that answers somewhere the eye is not has not answered.
  check("an empty address gets a message, not just a field mark",
    /toast\.passwordResetNeedsEmail/.test(b), true);
  check("...and the cursor is put where the answer says to type",
    /emailInput\?\.focus\(\)/.test(b), true);
  check("...and that field is brought into view", /scrollIntoView/.test(b), true);
  // The field mark stays: it is what shows WHICH box is wrong.
  check("the field is still marked as well", /validateAuthEmail\(\)/.test(b), true);
  // And it must still refuse to send.
  const refuseAt = b.indexOf("toast.passwordResetNeedsEmail");
  const sendAt = b.indexOf("sendPasswordResetEmail");
  check("nothing is sent without an address",
    refuseAt !== -1 && sendAt !== -1 && refuseAt < sendAt, true);
}

console.log("\n=== the button ===");
{
  check("it exists on the sign-in form", html.includes('id="authForgotPasswordButton"'), true);
  check("...and is wired", /qs\("#authForgotPasswordButton"\)\?\.addEventListener|handleForgotPassword\)/.test(src), true);
  const b = extract("handleForgotPassword").replace(/\/\/[^\n]*/g, "");
  // Re-enabled on every failure path, or one bad attempt locks the person out
  // of the only route back into their account.
  check("the button is re-enabled after a failure",
    (b.match(/button\.disabled = false/g) || []).length >= 1, true);
  check("...before any early return in the catch",
    b.indexOf("button.disabled = false") < b.indexOf('error?.code === "auth/too-many-requests"'), true);
}

console.log("\n=== both languages ===");
{
  for (const key of ["toast.passwordResetSent", "toast.passwordResetOffline",
                     "toast.passwordResetFailed", "auth.forgotPassword", "auth.errorEmailInvalid"]) {
    const n = (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}":`, "g")) || []).length;
    check(`${key} is in en and sw`, n, 2);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
