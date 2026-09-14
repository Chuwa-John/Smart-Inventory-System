// The owner-side check that a closed shift's own figures agree with the sales
// record. Evaluates the REAL function out of app.js.
//
//   node shift-reconciliation.test.mjs
//
// This is the compensating control named by L-1 in KNOWN-LIMITATIONS.md.
// firestore.rules can force a shift's five closing numbers to agree with each
// other, but it cannot prove cashSales -- rules authorise one write at a time
// and cannot aggregate a shift's sales. So a cashier can still understate
// cashSales, write the matching expectedCash, and close a short drawer as
// balanced. What that does is move the lie somewhere the OWNER can check it,
// and this is the check.
//
// The most important property here is not detection. It is restraint:
//
//   the sales subscription is limit(1000), so state.sales holds only the most
//   recent sales. A shift older than that window is not evidence of anything,
//   and reporting it as a discrepancy would accuse a cashier of theft because
//   the app had not loaded far enough back.
//
// A reconciliation tool that does that is worse than no tool, because it
// spends the owner's trust in it on false positives and then gets ignored on
// the true one. Every "unknown" case below exists for that reason.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const { reconcileShiftCash } = new Function(
  `${extract("safeNumber")}
   ${extract("reconcileShiftCash")}
   return { reconcileShiftCash };`
)();

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}
const eq = (name, actual, expected) =>
  check(name, actual === expected, `expected ${expected}, got ${actual}`);

const OPENED = new Date("2026-08-01T06:00:00Z");
const CLOSED = new Date("2026-08-01T18:00:00Z");
const ts = (d) => ({ toDate: () => d });

// An honest close: float 100,000 + 500,000 cash sales = 600,000 expected,
// 600,000 counted, balanced.
const honestShift = {
  status: "closed", storeId: "storeA",
  openedAt: ts(OPENED), closedAt: ts(CLOSED),
  openingFloat: 100000, cashSales: 500000, cashRefunds: 0, cashRepayments: 0,
  expectedCash: 600000, countedCash: 600000, variance: 0
};
const honestActual = { cashSales: 500000, cashRefunds: 0, cashRepayments: 0 };

console.log("=== a shift whose numbers match the sales record ===");
{
  const r = reconcileShiftCash(honestShift, honestActual, null);
  eq("status is matched", r.status, "matched");
  eq("nothing unaccounted for", r.unaccounted, 0);
  eq("the recorded variance stands", r.actualVariance, 0);
}

console.log("\n=== THE CASE THIS EXISTS FOR: 50,000 taken, closed as balanced ===");
// The cashier removed 50,000, counted the drawer honestly at 550,000, and
// wrote cashSales down by 50,000 so expectedCash matched the count. The rules
// accept it -- every number agrees with every other number.
{
  const cooked = {
    ...honestShift,
    cashSales: 450000, expectedCash: 550000, countedCash: 550000, variance: 0
  };
  const r = reconcileShiftCash(cooked, honestActual, null);
  eq("status is mismatch", r.status, "mismatch");
  eq("the missing 50,000 is named", r.unaccounted, 50000);
  eq("the true variance is the shortfall", r.actualVariance, -50000);
  eq("while the shift itself claimed balanced", r.recordedVariance, 0);
}

console.log("\n=== overstating cash sales is caught too ===");
// Less obviously fraudulent, more often a bug -- but it makes a drawer look
// short that was not, which costs an innocent cashier.
{
  const r = reconcileShiftCash(
    { ...honestShift, cashSales: 560000, expectedCash: 660000, variance: -60000 },
    honestActual, null);
  eq("status is mismatch", r.status, "mismatch");
  eq("the overstatement is signed the other way", r.unaccounted, -60000);
}

console.log("\n=== refunds and repayments belong in the comparison ===");
{
  const shift = {
    ...honestShift,
    cashSales: 500000, cashRefunds: 15000, cashRepayments: 40000,
    expectedCash: 625000, countedCash: 625000, variance: 0
  };
  const r = reconcileShiftCash(shift, { cashSales: 500000, cashRefunds: 15000, cashRepayments: 40000 }, null);
  eq("a shift with refunds and repayments reconciles", r.status, "matched");

  const r2 = reconcileShiftCash(shift, { cashSales: 500000, cashRefunds: 0, cashRepayments: 40000 }, null);
  eq("a refund that never happened is a mismatch", r2.status, "mismatch");
  eq("and is worth exactly the invented refund", r2.unaccounted, 15000);
}

console.log("\n=== RESTRAINT: never accuse on data we do not have ===");
{
  // The shift opened before the oldest sale we hold. We cannot know what it
  // took, so we must not imply it took nothing.
  const coverageFrom = new Date("2026-08-01T12:00:00Z").getTime();
  const r = reconcileShiftCash(honestShift, { cashSales: 0, cashRefunds: 0, cashRepayments: 0 }, coverageFrom);
  eq("a shift older than the loaded history is unknown, not a mismatch", r.status, "unknown");
  eq("and says why", r.reason, "outside-loaded-history");
  check("no figure is offered that could be read as an accusation", r.unaccounted === null,
    `unaccounted was ${r.unaccounted}`);
}
{
  const coverageFrom = OPENED.getTime();
  const r = reconcileShiftCash(honestShift, honestActual, coverageFrom);
  eq("a shift exactly at the coverage boundary is checked", r.status, "matched");
}
{
  const r = reconcileShiftCash({ ...honestShift, openedAt: null }, honestActual, null);
  eq("a shift with no opening time is unknown", r.status, "unknown");
  eq("and says why", r.reason, "no-timestamps");
}
{
  const r = reconcileShiftCash({ ...honestShift, status: "open" }, honestActual, null);
  eq("an open shift is not reconciled at all", r.status, "not-closed");
}

console.log("\n=== rounding does not manufacture discrepancies ===");
{
  const r = reconcileShiftCash(
    { ...honestShift, expectedCash: 600000.4 },
    honestActual, null);
  eq("a sub-unit difference is still matched", r.status, "matched");
}
{
  const r = reconcileShiftCash({ ...honestShift, expectedCash: 599999 }, honestActual, null);
  eq("a whole unit is not", r.status, "mismatch");
}

console.log("\n=== shifts closed before the component fields existed ===");
{
  // Older records carry expectedCash but no cashSales breakdown. They can
  // still be compared -- expectedCash is what the drawer was judged against.
  const legacy = {
    status: "closed", storeId: "storeA",
    openedAt: ts(OPENED), closedAt: ts(CLOSED),
    openingFloat: 100000, expectedCash: 600000, countedCash: 600000, variance: 0
  };
  eq("a legacy shift still reconciles", reconcileShiftCash(legacy, honestActual, null).status, "matched");
  eq("and is still caught when it does not",
    reconcileShiftCash({ ...legacy, expectedCash: 550000 }, honestActual, null).status, "mismatch");
}

console.log("\n=== garbage in does not become an accusation ===");
{
  const r = reconcileShiftCash({ ...honestShift, expectedCash: "lots" }, honestActual, null);
  check("a non-numeric expectedCash does not produce NaN", Number.isFinite(r.unaccounted),
    `unaccounted was ${r.unaccounted}`);
  const r2 = reconcileShiftCash(null, honestActual, null);
  eq("a missing shift is not closed", r2.status, "not-closed");
}

console.log("\n=== the check is actually wired up, and only for the owner ===");
{
  check("computeShiftReconciliations() exists", src.includes("async function computeShiftReconciliations("));
  check("it runs when shifts load", /await computeShiftReconciliations\(\);/.test(src),
    "computed but never called -- the column would always read 'not checked'");
  check("it is owner-only", /computeShiftReconciliations[\s\S]{0,400}if \(!isOwnerRole\(\)\) return;/.test(src),
    "auditLogs is owner-read by rule, so a manager could only ever produce 'unknown' rows");
  check("the column is owner-gated in the header and the row",
    (src.match(/isOwnerRole\(\) \? `<t[hd]/g) || []).length >= 2,
    "a header without a cell (or vice versa) misaligns the table");

  // The coverage boundary and the subscription limit must be the same number.
  // A literal in one and a comparison in the other drifts into false positives.
  check("the sales limit is a shared constant, not a literal",
    src.includes("const SALES_HISTORY_LIMIT") &&
    !/limit\(1000\)/.test(src.replace(/\/\/[^\n]*/g, "")),
    "subscribeToSales() and salesCoverageFromMs() must agree by construction");
  check("coverage is derived from that constant",
    /salesCoverageFromMs[\s\S]{0,300}SALES_HISTORY_LIMIT/.test(src));

  // The verdict cell must never present an unverified shift as a clean one.
  const cell = src.slice(src.indexOf("function shiftReconciliationCell("));
  check("unknown and unchecked render the same neutral mark",
    /!result \|\| result\.status === "unknown"/.test(cell),
    "a shift that could not be checked must not read as one that passed");
}

console.log("\n=== the close writes the RULES-PINNED figure, never the derived one ===");
{
  // The load-bearing one. firestore.rules (shiftExpectedCashIsDerived) requires
  //   expectedCash == openingFloat + cashSales - cashRefunds + cashRepayments
  // exactly. computeShiftExpectedCash() now also returns expectedAfterExpenses,
  // which deducts till-paid expenses for the owner to READ. If closeShift() ever
  // writes that one instead, every close is permission-denied -- at end of day,
  // with the drawer counted and the shop waiting.
  const close = extract("closeShift");
  check("closeShift() was located", close.length > 400);
  check("it writes totals.expected", /expectedCash: totals\.expected/.test(close));
  check("...and never the after-expenses figure",
    !/expectedAfterExpenses/.test(close),
    "the derived figure is for display; writing it makes shiftExpectedCashIsDerived() refuse the close");
  check("...and variance is measured against the same figure",
    /const variance = counted - totals\.expected;/.test(close));
  // The audit entry is judged by the same rule surface, so it carries the same
  // number as the shift document.
  check("the audit entry repeats the pinned figure, not the derived one",
    (close.match(/expectedCash: totals\.expected/g) || []).length === 2);
}

console.log("\n=== till expenses: what left the drawer, and when we may say so ===");
{
  const LIMIT = 1000;
  const mk = (over) => Object.assign({
    storeId: "storeA", paidFrom: "till", amount: 10000,
    createdAt: ts(new Date("2026-08-01T09:00:00Z"))
  }, over);

  const run = (expenses, from, to, storeId = "storeA") => {
    const state = { expenses };
    return new Function("state", "ACCOUNTS_HISTORY_LIMIT",
      `${extract("safeNumber")}
       ${extract("expensesCoverageFromMs")}
       ${extract("shiftTillExpenses")}
       return shiftTillExpenses;`
    )(state, LIMIT)(storeId, from, to);
  };
  const FROM = OPENED.getTime();
  const TO = CLOSED.getTime();

  eq("a till expense inside the shift is counted", run([mk()], FROM, TO), 10000);
  eq("money paid from somewhere else is not",
    run([mk({ paidFrom: "other" })], FROM, TO), 0);
  eq("another branch's expense is not",
    run([mk({ storeId: "storeB" })], FROM, TO), 0);
  eq("one recorded before the shift opened is not",
    run([mk({ createdAt: ts(new Date("2026-07-31T23:00:00Z")) })], FROM, TO), 0);
  eq("two inside the window add up",
    run([mk(), mk({ amount: 5000 })], FROM, TO), 15000);

  // spentAt is a date somebody TYPES and may be backdated up to two years;
  // createdAt is when the record was made, which is when the cash left. An
  // expense dated last week but recorded during this shift still emptied this
  // drawer.
  eq("the anchor is createdAt, not the typed spentAt",
    run([mk({ spentAt: ts(new Date("2026-07-01T09:00:00Z")) })], FROM, TO), 10000);

  // Restraint, the same rule reconcileShiftCash() follows: state.expenses holds
  // only the most recent ACCOUNTS_HISTORY_LIMIT entries, so a shift that opened
  // before the oldest loaded one cannot be judged from it. A deduction computed
  // from a truncated list would understate what left the till.
  const full = Array.from({ length: LIMIT }, () =>
    mk({ createdAt: ts(new Date("2026-08-02T09:00:00Z")) }));
  eq("a shift older than the loaded window returns null, not a number",
    run(full, FROM, TO), null);
  check("...so the screen can say nothing rather than something wrong",
    run(full, FROM, TO) === null);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
