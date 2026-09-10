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
  const log = { toasts: [], fieldErrors: [], sent: [], disabled: [] };
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
    "setFieldError", "console", "PASSWORD_RESET_SILENT_CODES", "__button", `
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
