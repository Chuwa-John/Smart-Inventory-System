// The audit action enum in firestore.rules must match what app.js can emit.
//
//   node audit-actions-agree.test.mjs
//
// firestore.rules now closes `action` to a role-scoped set. That is the control
// -- it is also a tripwire pointed at the till: add an action to app.js without
// adding it to the rules and the write is denied, inside the same transaction
// that completes a sale or records a payment. The failure surfaces as "the till
// stopped working", at a shop, with a queue.
//
// This is not hypothetical. Building the enum, a plain grep for
//   action: "SOMETHING"
// missed two things at once: the ternary at the PRODUCT_CREATED/PRODUCT_EDITED
// write site, and the whole ACCOUNT_* deletion-lifecycle family, which is
// written by the proxy and by the owner's client while a tenant is frozen. The
// second was caught only because rules-deletion.test.mjs happened to cover it.
// Nothing would have caught the next one.
//
// So this reads both files and compares them. It needs no emulator, so it runs
// in the fast half of the suite where a mistake is found in seconds.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

// --- what the rules allow ----------------------------------------------------
// Union across the three role functions: anything app.js emits must appear in
// at least one of them, and the per-role split is asserted by
// rules-audit-log.test.mjs against the live emulator.
function actionsIn(fnName) {
  const start = rules.indexOf(`function ${fnName}()`);
  if (start === -1) return null;
  const body = rules.slice(start, rules.indexOf("}", start));
  return [...body.matchAll(/'([A-Z][A-Z_]+)'/g)].map((m) => m[1]);
}

const cashier = actionsIn("cashierAuditActions");
const manager = actionsIn("managerAuditActions");
const owner = actionsIn("ownerAuditActions");

console.log("=== the rule's action functions are present and parseable ===");
check("cashierAuditActions() found", Array.isArray(cashier) && cashier.length > 0);
check("managerAuditActions() found", Array.isArray(manager) && manager.length > 0);
check("ownerAuditActions() found", Array.isArray(owner) && owner.length > 0);

const allowed = new Set([...(cashier || []), ...(manager || []), ...(owner || [])]);

// --- what the client emits ---------------------------------------------------
// Two shapes, because both occur:
//   action: "LITERAL"
//   action: cond ? "ONE" : "OTHER"
// The second is the one a naive grep drops.
const emitted = new Set();
for (const m of app.matchAll(/\baction:\s*"([A-Z][A-Z_]+)"/g)) emitted.add(m[1]);
// Third shape, added with the expense and purchase trail: the action is the
// first ARGUMENT to a helper that builds the entry, not a property in a literal.
//
//   moneyAuditEntry("EXPENSE_DELETED", { ... })
//   moneyAuditEntry(cond ? "EXPENSE_UPDATED" : "EXPENSE_RECORDED", { ... })
//
// Without this the suite reports four perfectly well-written actions as
// orphans, which is a false alarm that trains people to widen
// NOT_WRITTEN_BY_APP_JS instead of looking.
for (const m of app.matchAll(/moneyAuditEntry\(\s*"([A-Z][A-Z_]+)"/g)) emitted.add(m[1]);
for (const m of app.matchAll(/moneyAuditEntry\(\s*[^,\n]*\?\s*"([A-Z][A-Z_]+)"\s*:\s*"([A-Z][A-Z_]+)"/g)) {
  emitted.add(m[1]);
  emitted.add(m[2]);
}
for (const m of app.matchAll(/\baction:\s*[^,\n]*\?\s*"([A-Z][A-Z_]+)"\s*:\s*"([A-Z][A-Z_]+)"/g)) {
  emitted.add(m[1]);
  emitted.add(m[2]);
}

console.log("\n=== app.js emits at least the actions we know about ===");
check("app.js audit actions were found", emitted.size > 0,
  "the `action:` pattern matched nothing -- has the write shape changed?");
// A floor, so a regex that silently stops matching cannot turn this file green.
check("at least 10 distinct actions found in app.js", emitted.size >= 10,
  `found ${emitted.size}: ${[...emitted].sort().join(", ")}`);

console.log("\n=== every action app.js can write is permitted by the rules ===");
for (const action of [...emitted].sort()) {
  check(`${action} is in the rules enum`, allowed.has(action),
    `app.js writes "${action}" but no *AuditActions() function lists it.\n` +
    `      Firestore will deny that write -- inside the transaction it belongs to.\n` +
    `      Add it to the role that performs the action in firestore.rules.`);
}

console.log("\n=== the rules enum has no entries the client cannot produce ===");
// Dead permission in a security rule is worth seeing rather than inheriting, so
// anything the rules allow that app.js cannot emit has to be named here with a
// reason. Each entry is a claim someone can check.
const NOT_WRITTEN_BY_APP_JS = {
  // Written by proxy/server.js through the Admin SDK, which bypasses rules
  // entirely. Listed in the enum for completeness, not necessity.
  ACCOUNT_DELETION_REQUESTED: "proxy, Admin SDK",
  ACCOUNT_DELETION_CANCELLED: "proxy, Admin SDK",
  // ACCOUNT_ACCESS_DURING_GRACE used to sit here as "documented but
  // unimplemented" -- the permission existed, DATA-DELETION.md described the
  // trail, and no production code emitted it. app.js now writes it once per
  // sign-in to a frozen tenant (L-6 closed), so it is expected in `emitted`
  // below and needs no excuse.
};
const orphans = [...allowed].filter((a) => !emitted.has(a) && !(a in NOT_WRITTEN_BY_APP_JS));
check("no unexplained actions in the rules enum", orphans.length === 0,
  `allowed but never written by app.js or the proxy: ${orphans.join(", ")}\n` +
  `      Either the client stopped writing it (remove it) or it belongs in NOT_WRITTEN_BY_APP_JS with a reason.`);

console.log("\n=== the access-during-grace trail is actually written (L-6) ===");
{
  const noComments = app.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  check("app.js emits ACCOUNT_ACCESS_DURING_GRACE", emitted.has("ACCOUNT_ACCESS_DURING_GRACE"),
    "the deletion policy describes this trail; without a writer it does not exist");
  check("it fires when a pending deletion is detected",
    /state\.deletionScheduledFor\) await recordGraceAccess\(\)/.test(noComments),
    "written but never called");
  check("it is latched to once per sign-in",
    /if \(state\.graceAccessLogged\) return;/.test(noComments),
    "an entry per render turns an evidence trail into a flood");
  check("the latch is cleared on sign-in", /state\.graceAccessLogged = false;/.test(noComments),
    "a latch that never resets records only the first session ever");
  check("it is owner-only",
    /recordGraceAccess[\s\S]{0,400}state\.user\.uid !== state\.businessOwnerUid\) return;/.test(noComments),
    "the action is owner-scoped in the rules enum, so staff would only be denied");
  check("a failure to record never blocks the owner",
    /recordGraceAccess[\s\S]{0,900}catch[\s\S]{0,200}console\.warn/.test(noComments),
    "an evidence entry must not be why someone cannot get back into their account");
}


const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
