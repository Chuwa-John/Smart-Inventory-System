// The owner's own name: captured at sign-up, shown in Settings, and used to
// attribute the sales they ring up.
//
//   node owner-name.test.mjs
//
// Before this, Settings -> Account showed an email address and the till
// attributed the owner's sales to the BUSINESS name (or, on an account with no
// business name, to the local part of the Gmail address -- "robertbahati40").
//
// The field deliberately is NOT displayName. Three call sites read displayName
// as the business-name fallback for accounts created before this existed, so
// repointing it at the person would silently rename those businesses. That
// separation is the thing most likely to be "tidied up" by a later edit, so it
// is asserted directly.
//
// Functions are evaluated out of app.js rather than reimplemented -- the
// purchases.test.mjs convention. A reimplementation only proves the copy agrees
// with itself.
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

// The body of a function, for asserting a claim about how it is written where
// the behaviour itself needs a browser and a Firestore to observe.
function body(name) {
  return extract(name).replace(/\/\/[^\n]*/g, "");
}

// --- the real resolver, on stubbed state ------------------------------------
// resolveCurrentUserName() decides the name a sale is filed under, so it is run
// for real rather than described. It closes over state and readOwnMemberDoc.
const state = { cachedProfile: null };
const load = (memberName) => new Function("state", "readOwnMemberDoc", `
  ${extract("resolveCurrentUserName")}
  return resolveCurrentUserName;
`)(state, async () => ({
  exists: () => memberName !== undefined,
  data: () => ({ name: memberName })
}));

console.log("\n=== the owner is attributed by their own name ===");
{
  const OWNER = "owner-uid";
  const run = (profile, user) => {
    state.cachedProfile = profile;
    return load(undefined)({ uid: OWNER, ...user }, OWNER);
  };

  check("the owner's name wins over everything else",
    await run({ ownerName: "Robert Bahati", businessName: "Bahati Hardware" },
              { displayName: "Bahati Hardware", email: "robertbahati40@gmail.com" }),
    "Robert Bahati");

  // The regression the user reported: no owner name, no business name, so the
  // email's local part was standing in as a person's name.
  check("without one, the email local part is still the last resort",
    await run({}, { displayName: "", email: "robertbahati40@gmail.com" }),
    "robertbahati40");

  // Forward-only. An existing account carries the BUSINESS name in displayName
  // and no ownerName, and must keep ringing up exactly as it did yesterday --
  // this changes what new accounts record, not what old ones already recorded.
  check("an account created before this field is unaffected",
    await run({ businessName: "Bahati Hardware" },
              { displayName: "Bahati Hardware", email: "robertbahati40@gmail.com" }),
    "Bahati Hardware");

  check("a blank name is not a name",
    await run({ ownerName: "   " }, { displayName: "Bahati Hardware", email: "a@b.com" }),
    "Bahati Hardware");

  // firestore.rules caps staffName at 80 characters and rejects the write
  // outright above it -- which would fail the SALE, not merely the name.
  const long = await run({ ownerName: "x".repeat(200) }, { displayName: "", email: "a@b.com" });
  check("an over-long name is clamped to the 80 rules allow", long.length, 80);
}

console.log("\n=== a staff name still comes from the invitation they accepted ===");
{
  state.cachedProfile = { ownerName: "Robert Bahati" };
  // The owner's name is cached in the same place for everyone signed into this
  // tenant, so a cashier must not pick it up.
  check("a cashier is their own name, not the owner's",
    await load("Asha Mwenda")({ uid: "staff-uid", displayName: "", email: "asha@x.com" }, "owner-uid"),
    "Asha Mwenda");
}

console.log("\n=== the name survives a reload, and cannot be blanked ===");
{
  const b = body("ensureUserProfile");
  // Without the read-back the field exists only in the tab that created it:
  // cachedProfile is only ever written from what this function just wrote, so
  // a later sign-in would compute an empty name and merge it over the record.
  check("it reads the stored name back off the profile",
    /const ownerName = String\(state\.pendingOwnerName \|\| stored\?\.ownerName \|\| ""\)/.test(b), true);
  check("...clamped to the same 80", /\.trim\(\)\.slice\(0, 80\)/.test(b), true);
  // A merge write of "" is still a write.
  check("an empty name is omitted from the write, not written as empty",
    /\.\.\.\(ownerName \? \{ ownerName \} : \{\}\)/.test(b), true);
  check("the business name gets the same no-blank guard",
    /stored\?\.businessName/.test(b), true);
  // Anchored on the CLAIM -- that ownerName reaches the cache every reader
  // consults -- not on the exact field list. The cache legitimately gained
  // lastBackupAt later, and a test pinned to the literal failed for a reason
  // that had nothing to do with owner names.
  check("the cache carries it, because that is what every reader consults",
    /state\.cachedProfile = \{[^}]*ownerName[^}]*\}/.test(b), true);
  // The early return skips the whole function. If it did not know about
  // ownerName it would skip the very write that saves one.
  check("the unchanged-check knows about it", /cached\.ownerName === ownerName/.test(b), true);
}

console.log("\n=== displayName still means the BUSINESS ===");
{
  // If a later edit points displayName at the person, these three print a
  // human name where they mean a business -- on the invitation email a member
  // receives, among others.
  const businessFallbacks = src.match(/businessName = state\.cachedProfile\?\.businessName \|\| state\.user\?\.displayName/g) || [];
  check("the business-name fallbacks are untouched", businessFallbacks.length, 3);
  check("sign-up still sets displayName from the business name",
    /updateProfile\(credential\.user, \{ displayName: businessName \}\)/.test(src), true);
  check("...and never from the owner's name",
    /updateProfile\([^)]*displayName: ownerName/.test(src), false);
}

console.log("\n=== the sign-up form asks for it ===");
{
  const field = html.match(/<input id="ownerName"[^>]*>/);
  check("the field exists", Boolean(field), true);
  check("...capped at the 80 rules allow", /maxlength="80"/.test(field[0]), true);
  check("...and autofills as a person, not an organisation",
    /autocomplete="name"/.test(field[0]), true);
  check("it is submitted under a name the handler reads",
    /name="ownerName"/.test(field[0]), true);
  check("the handler reads it", /String\(form\.get\("ownerName"\) \|\| ""\)/.test(src), true);

  // Shown when creating an account, hidden when signing in -- the same rule the
  // business-name row follows.
  check("the row is hidden outside sign-up",
    /ownerNameRow\.hidden = !isSignup/.test(body("setAuthMode")), true);
}

console.log("\n=== Settings shows the person ===");
{
  check("there is a name element", html.includes('id="settingsUserName"'), true);
  check("the email survives, on its own line", html.includes('id="settingsUserEmail"'), true);
  const ui = body("updateAuthUi");
  check("the name element is filled from the resolved name",
    /settingsName\.textContent = state\.currentUserName/.test(ui), true);
  // Reachability: every account that exists today predates the sign-up field,
  // so without this control the feature would ship to nobody.
  check("an existing owner can set one", html.includes('id="changeOwnerNameButton"'), true);
  check("...and staff cannot, because their name is the owner's record",
    /changeNameButton\.hidden = !isOwner/.test(ui), true);
  const handler = body("changeOwnerName");
  check("cancelling the prompt changes nothing", /if \(entered === null\) return;/.test(handler), true);
  check("...and neither does clearing it", /if \(!name\) return;/.test(handler), true);
  check("saving updates the cache the readers consult",
    /state\.cachedProfile = \{ \.\.\.\(state\.cachedProfile \|\| \{\}\), ownerName: name \}/.test(handler), true);
  check("...and repaints the till, which shows the same name",
    /renderStaffSelect\(\);/.test(handler), true);
  check("the button is wired up",
    /qs\("#changeOwnerNameButton"\)\?\.addEventListener\("click", changeOwnerName\)/.test(src), true);
}

console.log("\n=== both languages ===");
{
  for (const key of ["auth.ownerName", "settings.emailLabel", "settings.changeNameButton",
                     "dialog.ownerNamePrompt", "toast.ownerNameSaved", "toast.couldNotSaveOwnerName"]) {
    const n = (src.match(new RegExp(`"${key.replace(".", "\\.")}":`, "g")) || []).length;
    check(`${key} is in en and sw`, n, 2);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
