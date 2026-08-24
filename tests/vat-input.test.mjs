// The two-sided VAT record. DESIGN-vat.md, "The VAT record - two-sided".
//
//   node vat-input.test.mjs
//
// Input VAT is a CLAIM, not a report line, and that changes which mistakes
// matter. An output figure that is too high costs the shop money it did not owe
// and an auditor never objects; an INPUT figure that is too high is an
// underpayment, and TRA prices those. So every case below that could inflate a
// claim is asserted from both directions.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log((pass ? "PASS  " : "FAIL  ") + name + (pass || !detail ? "" : "\n      " + detail));
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    "got " + JSON.stringify(actual) + " want " + JSON.stringify(expected));
}

function extractFn(name) {
  const start = app.indexOf("function " + name + "(");
  if (start === -1) throw new Error(name + " not found in app.js");
  let i = app.indexOf("(", start), parens = 0;
  for (; i < app.length; i++) {
    if (app[i] === "(") parens++;
    else if (app[i] === ")") { parens--; if (parens === 0) { i++; break; } }
  }
  let depth = 0;
  i = app.indexOf("{", i);
  for (; i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}") { depth--; if (depth === 0) break; }
  }
  return app.slice(start, i + 1);
}

const safeNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const saleTimestamp = (sale) => (sale && sale.createdAt instanceof Date ? sale.createdAt : null);
const localMonthKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");

const api = new Function("safeNumber", "saleTimestamp", "localMonthKey",
  "const INPUT_VAT_WINDOW_MONTHS = 6;\n"
  + extractFn("inputVatClaimExpiresAt") + "\n"
  + extractFn("purchaseReceiptDate") + "\n"
  + extractFn("inputVatClaimStatus") + "\n"
  + extractFn("summariseVatPeriod") + "\n"
  + "return { inputVatClaimExpiresAt, purchaseReceiptDate, inputVatClaimStatus, summariseVatPeriod };"
)(safeNumber, saleTimestamp, localMonthKey);

const { inputVatClaimStatus, summariseVatPeriod, inputVatClaimExpiresAt } = api;

const NOW = new Date("2026-08-24T12:00:00").getTime();
const purchase = (over = {}) => Object.assign({
  totalPaid: 118000, hasFiscalReceipt: true,
  receiptDate: new Date("2026-08-10T12:00:00"), vatAmount: 18000
}, over);

console.log("\n=== a claim has conditions, and says which one failed ===");
eq("a purchase with no fiscal receipt cannot be claimed",
  inputVatClaimStatus(purchase({ hasFiscalReceipt: false }), NOW).reason, "noReceipt");
eq("...nor one with a receipt but no date on it",
  inputVatClaimStatus(purchase({ receiptDate: null }), NOW).reason, "noReceiptDate");
eq("...nor one whose six-month window has closed",
  inputVatClaimStatus(purchase({ receiptDate: new Date("2026-01-01T12:00:00") }), NOW).reason, "expired");
eq("...nor one with no VAT recorded against it",
  inputVatClaimStatus(purchase({ vatAmount: 0 }), NOW).reason, "noVatAmount");
check("a complete purchase IS claimable", inputVatClaimStatus(purchase(), NOW).claimable, true);
eq("...for exactly the amount on the receipt", inputVatClaimStatus(purchase(), NOW).amount, 18000);

// The overclaim guard. A figure above what was paid is a typo, and claiming it
// would be an overclaim on a filed return.
eq("VAT above the amount paid is refused, not clamped",
  inputVatClaimStatus(purchase({ vatAmount: 200000 }), NOW).reason, "exceedsTotal");
eq("...and contributes nothing",
  inputVatClaimStatus(purchase({ vatAmount: 200000 }), NOW).amount, 0);

console.log("\n=== the reason is the FIRST thing the shop must fix ===");
// No point telling someone to type a VAT figure off a receipt they do not have.
eq("missing receipt outranks missing VAT amount",
  inputVatClaimStatus(purchase({ hasFiscalReceipt: false, vatAmount: 0 }), NOW).reason, "noReceipt");
eq("missing date outranks missing VAT amount",
  inputVatClaimStatus(purchase({ receiptDate: null, vatAmount: 0 }), NOW).reason, "noReceiptDate");

console.log("\n=== the six-month window runs from the receipt date ===");
eq("six months after 10 August is 10 February",
  inputVatClaimExpiresAt(new Date("2026-08-10T12:00:00")).toISOString().slice(0, 10), "2027-02-10");
check("a receipt dated today is well inside the window",
  inputVatClaimStatus(purchase({ receiptDate: new Date("2026-08-24T12:00:00") }), NOW).claimable, true);

console.log("\n=== the period record ===");
const sale = (over = {}) => Object.assign({ createdAt: new Date("2026-08-05T10:00:00"),
  taxTotal: 1800, total: 11800, refundedAmount: 0, voided: false }, over);
const base = { monthKey: "2026-08", vatRegistered: true, nowMs: NOW,
  salesCoverageFromMs: null, purchasesCoverageFromMs: null };
const run = (over) => summariseVatPeriod(Object.assign({}, base, over));

const r1 = run({ sales: [sale(), sale()], purchases: [purchase()] });
eq("output VAT is what the sales were rung up with", r1.outputVat, 3600);
eq("input VAT is what the receipts show", r1.inputVat, 18000);
eq("net payable is output less input", r1.netPayable, 3600 - 18000);

eq("a voided sale contributes no output VAT",
  run({ sales: [sale(), sale({ voided: true })], purchases: [] }).outputVat, 1800);
eq("a sale in another month is not in this period",
  run({ sales: [sale({ createdAt: new Date("2026-07-05T10:00:00") })], purchases: [] }).outputVat, 0);

// A purchase belongs to the month its RECEIPT is dated in, not the day it was
// typed in -- the window runs from the receipt.
eq("a purchase is placed by its receipt date, not when it was recorded",
  run({ sales: [], purchases: [purchase({ receiptDate: new Date("2026-07-30T12:00:00") })] }).inputVat, 0);

console.log("\n=== L-12 is disclosed, not buried ===");
const r2 = run({ sales: [sale({ refundedAmount: 5000 })], purchases: [] });
eq("output VAT still does not net the refund", r2.outputVat, 1800);
eq("...but the refund total is reported so the size is visible", r2.refundsNotNetted, 5000);

console.log("\n=== blocked claims are listed with their reason ===");
const r3 = run({ sales: [],
  purchases: [purchase(), purchase({ hasFiscalReceipt: false }), purchase({ vatAmount: 0 })] });
eq("only the complete one is claimed", r3.inputVat, 18000);
eq("one claimed", r3.claimedCount, 1);
eq("two blocked, with reasons", r3.blocked.map((b) => b.reason), ["noReceipt", "noVatAmount"]);

console.log("\n=== the money-losing case: a claim about to expire ===");
// A receipt the shop HAS, still inside its window, with no VAT recorded.
// Nothing else in the app would ever mention it.
const r4 = run({ sales: [],
  purchases: [purchase({ vatAmount: 0, receiptDate: new Date("2026-03-01T12:00:00") })] });
eq("it is surfaced", r4.expiringClaims.length, 1);
eq("...and not counted as claimed", r4.inputVat, 0);
check("a purchase that already HAS its VAT recorded is not nagged about",
  run({ sales: [], purchases: [purchase({ receiptDate: new Date("2026-03-01T12:00:00") })] })
    .expiringClaims.length === 0, true);
check("a claim whose window already closed is not offered as still savable",
  run({ sales: [], purchases: [purchase({ vatAmount: 0, receiptDate: new Date("2025-01-01T12:00:00") })] })
    .expiringClaims.length === 0, true);

console.log("\n=== it refuses a period it cannot see all of ===");
const augStart = new Date(2026, 7, 1).getTime();
// eq(), not check(): check's third argument is a DETAIL string, so
// check(name, value, false) silently asserts `value` rather than comparing it
// to false. That is how the "is not refused" case passed a boolean into the
// message slot and failed for the wrong reason.
eq("a period starting before the SALES window is refused",
  run({ sales: [], purchases: [], salesCoverageFromMs: augStart + 86400000 }).outsideWindow, true);
eq("...and before the PURCHASES window too",
  run({ sales: [], purchases: [], purchasesCoverageFromMs: augStart + 86400000 }).outsideWindow, true);
eq("a fully covered period is not refused",
  run({ sales: [], purchases: [], salesCoverageFromMs: augStart - 86400000 }).outsideWindow, false);

const failed = results.filter((r) => !r.pass);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " passed");
process.exit(failed.length ? 1 : 0);
