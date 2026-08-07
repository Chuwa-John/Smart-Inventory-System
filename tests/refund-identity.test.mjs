// QA-103 / QA-123: a refund must move every revenue figure by the same amount.
//
//   node refund-identity.test.mjs
//
// Refunds were netted out in three places and ignored in eight, so the same
// trading day read differently depending on which tab was open: sell 100,000,
// refund 40,000, and the owner's control panel said 60,000 while the revenue
// chart on the next tab said 100,000. Voids were already excluded everywhere,
// which is exactly what made this hard to see — the obvious case behaved
// correctly, so the surfaces looked consistent until a partial refund happened.
//
// financial-integrity.test.mjs covers rounding and drawer arithmetic and passes
// 20/20; it never asserted this identity across surfaces, which is why the
// inconsistency survived a suite that is otherwise thorough.
//
// The identity, over any set of sales:
//
//     revenue = Σ (total − refundedAmount)  for every sale that is not voided
//
// Anything reporting revenue answers to it.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const appHtml = readFileSync(new URL("../app.html", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

function extractFn(name) {
  const start = app.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
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
const api = new Function("safeNumber", `
  ${extractFn("saleNetTotal")}
  ${extractFn("saleAmountForMethod")}
  ${extractFn("summariseSales")}
  return { saleNetTotal, saleAmountForMethod, summariseSales };
`)(safeNumber);
const { saleNetTotal, saleAmountForMethod, summariseSales } = api;

const sale = (over = {}) => ({ total: 1000, paymentMethod: "cash", voided: false, items: [], ...over });

console.log("=== the definition itself ===");
{
  check("a clean sale contributes its total", saleNetTotal(sale()) === 1000);
  check("a partial refund reduces it", saleNetTotal(sale({ refundedAmount: 400 })) === 600);
  check("a full refund leaves nothing", saleNetTotal(sale({ refundedAmount: 1000 })) === 0);
  check("a void contributes nothing at all", saleNetTotal(sale({ voided: true })) === 0,
    "voids were already excluded everywhere; that is why this bug was invisible");
  check("a void with a refund still contributes nothing",
    saleNetTotal(sale({ voided: true, refundedAmount: 400 })) === 0,
    "otherwise a voided-then-refunded sale would count negatively");
  check("missing fields do not produce NaN",
    saleNetTotal({}) === 0 && Number.isFinite(saleNetTotal(sale({ refundedAmount: undefined }))));
  check("a null sale is safe", saleNetTotal(null) === 0);
}

console.log("\n=== every revenue surface uses it ===");
{
  // The eight that did not. Named individually so a failure says which one.
  const surfaces = [
    ["computeMonthlyMetrics", "the monthly report — narrated by AI and STORED as a record"],
    ["computeStoreBreakdown", "per-store totals"],
    ["computeRevenueTrend", "the revenue trend chart"],
    ["computeStaffBreakdown", "staff performance, which commission may be judged on"],
    ["saleAmountForMethod", "the payment-method report and its CSV/PDF export"]
  ];
  for (const [fn, why] of surfaces) {
    const body = extractFn(fn).replace(/\/\/[^\n]*/g, "");
    check(`${fn}() nets refunds`, /saleNetTotal\(/.test(body), `${why} — still counts refunded goods as revenue`);
    check(`...and does not sum raw totals instead`, !/Number\(sale\.total \|\| 0\)/.test(body),
      "a raw sale.total in a revenue sum is the defect itself");
  }
}

console.log("\n=== the surfaces agree with each other ===");
{
  // The scenario from the finding: sell 100,000, refund 40,000.
  const sales = [
    sale({ total: 100000, refundedAmount: 40000 }),
    sale({ total: 5000 }),
    sale({ total: 9000, voided: true })
  ];
  const expected = 60000 + 5000;

  const summary = summariseSales(sales);
  check("summariseSales agrees", summary.net === expected, `got ${summary.net}, expected ${expected}`);

  const byHelper = sales.reduce((sum, s) => sum + saleNetTotal(s), 0);
  check("the shared helper agrees", byHelper === expected, `got ${byHelper}`);

  // Method attribution has to reconcile to the same number for single-method,
  // non-credit sales.
  const byMethod = ["cash", "mobile", "card"]
    .reduce((sum, m) => sum + sales.reduce((s2, sl) => s2 + saleAmountForMethod(sl, m), 0), 0);
  check("the payment-method report agrees", byMethod === expected, `got ${byMethod}`);

  check("gross is still available and still gross", summary.gross === 105000,
    "netting must not destroy the gross figure — both are reported deliberately");
}

console.log("\n=== credit is treated as a receivable, not as cash returned ===");
{
  // A refund against a credit sale reduces what is owed, not the deposit that
  // was physically handed over. summariseSales() already made this choice for
  // drawerCash; the method report now mirrors it rather than inventing a second
  // rule that would disagree with the drawer.
  const credit = sale({ total: 10000, paymentMethod: "credit", amountPaid: 3000,
    amountPaidMethod: "cash", balanceDue: 7000, refundedAmount: 2000 });
  check("the deposit is attributed in full", saleAmountForMethod(credit, "cash") === 3000,
    "netting the refund here would understate the cash actually taken");
  check("...and nothing lands in the other methods",
    saleAmountForMethod(credit, "mobile") === 0 && saleAmountForMethod(credit, "card") === 0);
  check("but net revenue still drops by the refund", saleNetTotal(credit) === 8000);
}

console.log("\n=== the staff row adds up (QA-123) ===");
{
  const fn = extractFn("computeStaffBreakdown").replace(/\/\/[^\n]*/g, "");
  check("collected is the sum of its own columns",
    /entry\.collected = entry\.cash \+ entry\.mobile \+ entry\.card;/.test(fn),
    "a total that did not equal its columns read as an arithmetic error");
  check("net sold is tracked separately", /entry\.net \+= saleNetTotal\(sale\)/.test(fn),
    "sold and collected are different questions and were collapsed into one column");
  check("the columns come from one attribution rule", /saleAmountForMethod\(sale, method\)/.test(fn),
    "a second copy of the credit rule would drift from the payment report");
  check("ranking is by net, not by gross", /sort\(\(a, b\) => b\.net - a\.net\)/.test(fn),
    "ranking on gross rewards goods that came back");

  // The table has to have somewhere to put them.
  check("the table offers a Collected column", /reports\.collectedColumn/.test(appHtml));
  check("...and a Net sales column", /reports\.netSalesColumn/.test(appHtml));
  // Scoped to the staff table. Counting <th> across the whole document also
  // picked up another table sharing pos.cash / pos.mobile / pos.card, which
  // reported eight columns for a seven-column header.
  const tableEnd = appHtml.indexOf('id="staffBreakdownTable"');
  const tableStart = appHtml.lastIndexOf("<table>", tableEnd);
  const staffTable = appHtml.slice(tableStart, tableEnd);
  check("the staff table was located", tableStart !== -1 && tableEnd > tableStart);
  const headerCount = (staffTable.match(/<th\b/g) || []).length;
  check("the header row has seven columns", headerCount === 7,
    `found ${headerCount} in the staff table — a column added without a matching cell shifts every row`);
  check("the empty state spans them all", /colspan="7"/.test(extractFn("renderStaffBreakdown")),
    "a stale colspan leaves the empty message misaligned");

  for (const key of ["reports.collectedColumn", "reports.netSalesColumn"]) {
    const n = [...app.matchAll(new RegExp(`"${key.replace(/\./g, "\\.")}":`, "g"))].length;
    check(`${key} is in both languages`, n === 2, `found ${n}`);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
