// Guards QA-008: what happens when a sale would push a customer past their
// credit alert level.
//
//   node credit-override.test.mjs
//
// The limit used to be a plain window.confirm(). Any cashier clicked OK, the
// sale went through, and nothing anywhere recorded that a ceiling had been
// crossed or who crossed it.
//
// It is deliberately still not a hard block. In this market a refused sale to a
// regular does not prevent the credit -- it moves it off the books as cash or
// under a duplicate customer, and the shop keeps the exposure while losing
// sight of it. What changed is that crossing it now costs the manager override
// password and leaves a record.
//
// The two things that must never regress: the password cannot be skipped, and a
// crossing cannot happen silently.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const indexes = JSON.parse(readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8"));

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

function extractFn(name) {
  const start = app.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let depth = 0, i = app.indexOf("{", start);
  for (; i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}") { depth--; if (depth === 0) break; }
  }
  return app.slice(start, i + 1);
}

const gate = extractFn("checkCreditLimitBeforeSale");

console.log("=== the gate asks before it charges ===");
{
  check("the gate is async (it awaits authorisation)",
    /async function checkCreditLimitBeforeSale/.test(app));
  check("an under-limit sale is not interrupted",
    /if \(projectedTotal <= limit\) return \{ allowed: true, overridden: false \}/.test(gate));
  check("a customer with no alert set is not interrupted",
    /if \(limit == null\) return \{ allowed: true, overridden: false \}/.test(gate));

  // Order matters: showing the numbers first is what stops the password
  // becoming a reflex.
  const confirmAt = gate.indexOf("window.confirm");
  const verifyAt = gate.indexOf("verifyOverridePassword");
  check("the numbers are shown before the password is asked for",
    confirmAt !== -1 && verifyAt !== -1 && confirmAt < verifyAt,
    `confirm at ${confirmAt}, verify at ${verifyAt}`);
  check("declining the warning stops the sale",
    /if \(!acknowledged\) return \{ allowed: false, overridden: false \}/.test(gate));
}

console.log("\n=== the password cannot be skipped ===");
{
  check("crossing requires verifyOverridePassword", /await verifyOverridePassword\(\)/.test(gate));
  check("a failed authorisation refuses the sale",
    /if \(!authorized\)[\s\S]{0,120}return \{ allowed: false/.test(gate));
  check("the refusal is explained to the cashier",
    /toast\.creditLimitOverrideRefused/.test(gate));
  check("the refusal string exists in both languages",
    (app.match(/"toast\.creditLimitOverrideRefused":/g) || []).length === 2);
  // Authorisation is checked server-side by the proxy, not in the browser.
  check("authorisation is server-side, not a local comparison",
    /overrideVerifyUrl/.test(app) && !/creditLimit\s*===\s*input/.test(app));
}

console.log("\n=== a crossing is always recorded ===");
{
  check("an override returns the figures that justified it",
    /overridden: true/.test(gate) && /previousBalance/.test(gate) && /projectedTotal/.test(gate));
  check("the audit action exists", /action: "CREDIT_LIMIT_EXCEEDED"/.test(app));

  // The record must be atomic with the sale. An audit row whose sale rolled
  // back would be a false accusation; a sale whose record vanished would be the
  // hole this change exists to close.
  const txStart = app.indexOf('action: "SALE_COMPLETED"');
  const auditStart = app.indexOf('action: "CREDIT_LIMIT_EXCEEDED"');
  check("the override record is written alongside the sale, not separately",
    auditStart > txStart && app.slice(txStart, auditStart).includes("transaction.set"),
    "audit write is outside the sale transaction");
  check("it is written through the transaction object",
    /if \(creditLimitDecision\.overridden\)[\s\S]{0,200}transaction\.set\(/.test(app));
  check("it records who authorised it", /action: "CREDIT_LIMIT_EXCEEDED"[\s\S]{0,900}uid:/.test(app));
  check("it records the customer and the amounts",
    /action: "CREDIT_LIMIT_EXCEEDED"[\s\S]{0,900}customerId:[\s\S]{0,900}saleTotal:/.test(app));
}

console.log("\n=== an unconfigured business is not silently hard-blocked ===");
{
  // The trap this design walks into if unguarded: verifyOverridePassword()
  // returns false when no password has been configured, so demanding one would
  // refuse the sale outright -- the hard block this whole approach rejects,
  // arrived at by accident, and only for the businesses least set up to notice.
  check("no configured password means the acknowledgement stands alone",
    /if \(!state\.overridePasswordSet\)[\s\S]{0,140}allowed: true/.test(gate),
    "an unconfigured business would have the sale refused");
  check("that case is still recorded", /authorised: false/.test(gate));
  check("an authorised crossing is marked as such", /authorised: true/.test(gate));
  check("the audit row carries the distinction",
    /authorised: creditLimitDecision\.authorised === true/.test(app));
}

console.log("\n=== the owner is shown it, not just told it exists ===");
{
  check("the manager panel has an overrides tile", /control\.creditOverrides/.test(app));
  check("the tile label exists in both languages",
    (app.match(/"control\.creditOverrides":/g) || []).length === 2);
  check("the count is scoped to the selected store", /scopedOverrides/.test(app));
  check("history is fetched once per business, not per render",
    /creditOverrideFetchKey === state\.businessOwnerUid/.test(app));
  check("a failed history query does not break the panel",
    /state\.creditOverrides = null/.test(app) && /console\.warn\("Could not load credit override history/.test(app));

  const idx = indexes.indexes.find((i) => i.collectionGroup === "auditLogs");
  check("the composite index the query needs is declared", Boolean(idx),
    "equality on action + orderBy createdAt requires a composite index");
  check("...on action then createdAt",
    idx?.fields?.[0]?.fieldPath === "action" && idx?.fields?.[1]?.fieldPath === "createdAt",
    JSON.stringify(idx?.fields));
}

console.log("\n=== the label no longer promises a block ===");
{
  // The old wording said "Credit Limit", which reads as enforcement. The
  // stored field stays creditLimit -- renaming it would mean migrating every
  // customer document for no user-visible gain.
  check("the column no longer says 'Limit'",
    !/"customers\.colCreditLimit": "Credit Limit"/.test(app));
  check("it describes an alert", /"customers\.colCreditLimit": "Credit Alert At"/.test(app));
  check("the prompt says an override will be needed",
    /"dialog\.creditLimitPrompt": "Alert when[\s\S]{0,160}override password/.test(app));
  check("the warning says the crossing will be recorded",
    /"dialog\.creditLimitExceededConfirm":[\s\S]{0,240}recorded/.test(app));
  check("the stored field name is unchanged (no migration needed)",
    /creditLimit/.test(app) && /'creditLimit'/.test(rules));
  check("only a manager or owner can change it",
    /validCustomerLimitUpdate\(\)/.test(rules) &&
    /isOwnerOrRole\(userId, \["manager"\]\)[\s\S]{0,80}validCustomerLimitUpdate/.test(rules));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
