// An audit entry must never send null where the rules type a string.
//
//   node audit-null-fields.test.mjs
//
// Found by selling on credit to a new customer against the live database. It
// had been live for weeks.
//
// A credit sale writes six documents in ONE transaction. Five were valid. The
// sixth was the CREDIT_LIMIT_UNCHECKED audit entry carrying
// `customerId: creditLimitDecision.customerId || null`. auditStringsBounded()
// in firestore.rules reads:
//
//     !('customerId' in d) || (d.customerId is string && d.customerId.size() <= 120)
//
// Absent is fine. Null is refused, because the key IS present and null is not a
// string. That refusal took the whole transaction with it: no sale, no stock
// movement, no customer balance, and a cashier told "your account is not
// allowed to do this" with a customer standing in front of them.
//
// It fired on precisely the case the entry exists to record. reason
// "customer-not-visible" is returned when the customer is not in local state --
// a FIRST-TIME credit customer, whose document is created moments later, and a
// cashier serving another branch's customer (QA-110). The "no-limit-set" path
// sends a real customerId, which is why one unchecked path always worked and
// the other never did. That is also why it survived testing: an established
// customer with no limit is fine, a brand-new one is not.
//
// The asymmetry that made it easy to miss: validSale() DOES allow
// customerId: null. The sale document and the audit document disagree about how
// to say "nobody", and only the sale says so out loud.
//
// tests/audit-actions-agree.test.mjs compares which ACTIONS exist. This file
// compares what goes IN them, which is where this one hid.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const appSrc = app.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

// Every audit field the rules require to be a string when present. Read from
// the rules rather than listed here, so adding a guard there extends this
// check automatically instead of silently leaving the new field uncovered.
const guarded = [...rules.matchAll(/!\('([a-zA-Z]+)' in d\) \|\| \(d\.[a-zA-Z]+ is string/g)]
  .map((m) => m[1]);

console.log("=== the rules type-guard id-shaped audit fields ===");
{
  check("the guards were found in firestore.rules", guarded.length >= 8,
    `found ${guarded.length}: ${[...new Set(guarded)].join(", ")}`);
  for (const field of ["customerId", "customerName", "storeId", "saleId", "productId"]) {
    check(`${field} must be a string when present`, guarded.includes(field));
  }
}

console.log("\n=== no audit write in app.js sends null for one of them ===");
{
  // Each auditLogs write site, sliced from the opening brace of the object
  // literal that carries `action:` to its closing `});`.
  const offenders = [];
  for (const m of appSrc.matchAll(/action: "([A-Z_]+)"/g)) {
    const start = appSrc.lastIndexOf("{", m.index);
    // The nearest terminator of EITHER shape. An object literal assigned to a
    // variable ends "};" while an inline transaction.set(...) ends "});", and
    // taking only the latter ran one entry's slice into the next, reporting a
    // field the following write owned.
    const endParen = appSrc.indexOf("});", m.index);
    const endBrace = appSrc.indexOf("};", m.index);
    const end = Math.min(endParen === -1 ? Infinity : endParen,
                         endBrace === -1 ? Infinity : endBrace);
    if (start === -1 || !isFinite(end)) continue;
    const body = appSrc.slice(start, end);
    for (const field of new Set(guarded)) {
      // Matches `field: null`, `field: x || null` and `field: x ?? null`.
      const bad = new RegExp(field + "\\s*:\\s*[^,}\\n]*null\\b");
      if (bad.test(body)) offenders.push(m[1] + "." + field);
    }
  }
  check("every guarded field is omitted rather than nulled", offenders.length === 0,
    offenders.join(" | ") + "  <- omit the key; absent is what the rule allows");
}

console.log("\n=== the fixed write says nothing by omission ===");
{
  const at = appSrc.indexOf('action: "CREDIT_LIMIT_UNCHECKED"');
  check("the unchecked entry exists", at !== -1);
  const body = appSrc.slice(appSrc.lastIndexOf("const uncheckedEntry", at), appSrc.indexOf("transaction.set(uncheckedRef", at));
  check("customerId is added only when there is one",
    /if \(creditLimitDecision\.customerId\) uncheckedEntry\.customerId = creditLimitDecision\.customerId;/.test(body));
  check("customerName is added only when there is one",
    /if \(customerName\) uncheckedEntry\.customerName = customerName;/.test(body));
  check("previousBalance is added only when it is known",
    /if \(creditLimitDecision\.previousBalance != null\)/.test(body),
    "a number field the rules do not type-check, omitted anyway so the entry says 'unknown' one way");
  check("reason is always present, because that is the point of the entry",
    /reason: creditLimitDecision\.uncheckedReason \|\| "unknown"/.test(body));
}

console.log("\n=== the sale document is deliberately different, and still is ===");
{
  // Not a bug to fix: a sale may legitimately record customerId: null, and the
  // rule says so explicitly. Pinned so nobody "tidies" the two into agreement
  // by tightening the sale rule and breaking every cash sale.
  check("validSale still permits a null customerId",
    /\(!\('customerId' in d\) \|\| d\.customerId == null \|\| \(d\.customerId is string/.test(rules),
    "the offline queue writes customerId: null on every cash sale it holds");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
