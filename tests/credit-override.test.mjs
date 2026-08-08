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
  // Run rather than pattern-matched. These two used to assert the exact object
  // literal the gate returned, so adding a field to that literal failed them
  // while the behaviour was unchanged — a test that breaks on formatting and
  // stays quiet on meaning. Executing it is immune to both.
  {
    const customers = [];
    let confirmed = 0;
    let verified = 0;
    const env = {
      state: { customers, overridePasswordSet: true },
      findCustomerByPhone: (key) => customers.find((c) => c.phone === key),
      t: (k) => k,
      money: (v) => String(v),
      showToast: () => {},
      verifyOverridePassword: async () => { verified += 1; return true; },
      window: { confirm: () => { confirmed += 1; return true; } }
    };
    // extractFn slices from `function <name>(`, which drops the `async` keyword
    // sitting in front of it — the body awaits, so it has to go back on.
    const asyncGate = /async function checkCreditLimitBeforeSale/.test(app) ? `async ${gate}` : gate;
    const { checkCreditLimitBeforeSale } = new Function(
      ...Object.keys(env),
      `${asyncGate}\nreturn { checkCreditLimitBeforeSale };`
    )(...Object.values(env));

    customers.length = 0;
    customers.push({ id: "c1", phone: "255700000001", name: "Juma", balanceOwed: 1000, creditLimit: 50000 });
    const under = await checkCreditLimitBeforeSale("Juma", "255700000001", 2000);
    check("an under-limit sale is not interrupted",
      under.allowed === true && under.overridden === false && confirmed === 0 && verified === 0,
      JSON.stringify(under));
    check("...and it records that the ceiling WAS checked", under.limitChecked === true,
      "the audit needs to tell a checked sale from an unchecked one");

    customers.length = 0;
    customers.push({ id: "c2", phone: "255700000002", name: "Asha", balanceOwed: 1000 });
    const noLimit = await checkCreditLimitBeforeSale("Asha", "255700000002", 2000);
    check("a customer with no alert set is not interrupted",
      noLimit.allowed === true && noLimit.overridden === false && confirmed === 0,
      JSON.stringify(noLimit));
    check("...but the sale is marked as never ceiling-checked (QA-120)",
      noLimit.limitChecked === false && noLimit.uncheckedReason === "no-limit-set",
      "unlimited credit by default left no trace at all");

    // QA-110: the customer exists at another branch and this account cannot
    // read them, so the lookup misses. Previously indistinguishable from "no
    // limit", which is how the ceiling was defeated by walking to another till.
    customers.length = 0;
    const unseen = await checkCreditLimitBeforeSale("Stranger", "255700000009", 2000);
    check("an invisible customer does not block the sale", unseen.allowed === true);
    check("...and is recorded as a different reason from no-limit (QA-110)",
      unseen.limitChecked === false && unseen.uncheckedReason === "customer-not-visible",
      "collapsing the two hides a cross-branch bypass inside a normal-looking default");

    customers.length = 0;
    customers.push({ id: "c3", phone: "255700000003", name: "Neema", balanceOwed: 49000, creditLimit: 50000 });
    const over = await checkCreditLimitBeforeSale("Neema", "255700000003", 5000);
    check("a crossing still asks and still authorises",
      over.allowed === true && over.overridden === true && over.authorised === true
        && confirmed === 1 && verified === 1, JSON.stringify(over));
  }

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
