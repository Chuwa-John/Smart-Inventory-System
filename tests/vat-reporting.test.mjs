// VAT step 5: the receipt and the return. DESIGN-vat.md.
//
//   node vat-reporting.test.mjs
//
// Both outputs here are documents a shop is audited on, so the failure that
// matters is not a crash — it is a confident wrong number.
//
// The two ways that happens, both guarded below:
//
//   1. Showing "VAT 0" on a sale from before the business registered. Those
//      sales are OUTSIDE the scheme, not taxed at nothing. Printing a zero
//      makes a false statement; saying nothing is the honest rendering.
//   2. Recomputing tax from the sale's items at report time. Each sale carries
//      the rate it was rung up at, and re-deriving it would silently re-rate
//      last year's trading the moment TRA moves the rate.
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

// The report, run against sales it can see. money()/t() are stubbed because
// what is being tested is the arithmetic, not the formatting.
const state = { sales: [], stores: [{ id: "s1", vatRegistered: true }], currentStoreId: "s1" };
const { computeVatReport } = new Function("state", "filteredSales", "safeNumber", `
  ${extractFn("computeVatReport")}
  return { computeVatReport };
`)(state, () => state.sales, (v) => (Number.isFinite(Number(v)) ? Number(v) : 0));

const taxed = (over = {}) => ({
  vatRegistered: true, voided: false, total: 1180, netTotal: 1000, taxTotal: 180,
  taxBreakdown: { standard: { net: 1000, vat: 180 }, zeroRated: { net: 0, vat: 0 }, exempt: { net: 0, vat: 0 } },
  ...over
});

console.log("=== the return adds up ===");
{
  state.sales = [taxed(), taxed(), taxed()];
  const r = computeVatReport();
  check("VAT owed is the sum of what was charged", r.taxTotal === 540, `got ${r.taxTotal}`);
  check("net is the sum of the nets", r.netTotal === 3000, `got ${r.netTotal}`);
  check("net + VAT reconciles to the takings", r.netTotal + r.taxTotal === 3540);
  check("the sale count is what was counted", r.saleCount === 3);
}

console.log("\n=== a voided sale is not part of the return ===");
{
  state.sales = [taxed(), taxed({ voided: true })];
  const r = computeVatReport();
  check("a voided sale contributes no VAT", r.taxTotal === 180, `got ${r.taxTotal}`);
  check("...and is not counted", r.saleCount === 1);
}

console.log("\n=== sales from before registration are outside the scheme ===");
{
  // Not zero-rated. Folding them in would understate the rate against turnover
  // and misrepresent trading the scheme never covered.
  state.sales = [taxed(), { total: 5000, voided: false }, { total: 2000, voided: false }];
  const r = computeVatReport();
  check("they add nothing to VAT owed", r.taxTotal === 180, `got ${r.taxTotal}`);
  check("they add nothing to net", r.netTotal === 1000, `got ${r.netTotal}`);
  check("they are counted separately", r.outsideScheme === 2, `got ${r.outsideScheme}`);
  check("...and excluded from the sale count", r.saleCount === 1);
  check("the report says so in words", /report\.vatOutsideNote/.test(extractFn("renderVatReport")),
    "an unexplained gap between takings and the return is what triggers an audit question");
}

console.log("\n=== zero-rated and exempt are kept apart ===");
{
  state.sales = [taxed({
    total: 8180, netTotal: 8000, taxTotal: 180,
    taxBreakdown: { standard: { net: 1000, vat: 180 }, zeroRated: { net: 5000, vat: 0 }, exempt: { net: 2000, vat: 0 } }
  })];
  const r = computeVatReport();
  check("standard-rated net is reported", r.totals.standard.net === 1000);
  check("zero-rated net is reported", r.totals.zeroRated.net === 5000);
  check("exempt net is reported", r.totals.exempt.net === 2000);

  // The distinction that makes three classes worth having.
  check("taxable turnover includes zero-rated", r.taxableTurnover === 6000, `got ${r.taxableTurnover}`);
  check("...and excludes exempt", r.taxableTurnover !== 8000,
    "exempt supplies are not taxable turnover; including them overstates the base");
}

console.log("\n=== missing or malformed figures cannot poison the return ===");
{
  state.sales = [
    taxed({ taxTotal: undefined, netTotal: null }),
    taxed({ taxBreakdown: undefined }),
    taxed({ taxTotal: "180" }),
    taxed()
  ];
  const r = computeVatReport();
  const finite = [r.taxTotal, r.netTotal, r.taxableTurnover, r.totals.standard.net].every(Number.isFinite);
  check("every figure stays a finite number", finite, JSON.stringify(r));
  check("nothing became NaN", !Number.isNaN(r.taxTotal) && !Number.isNaN(r.netTotal),
    "one bad row must not blank the whole return");
}

console.log("\n=== the return is read off the sales, not recomputed ===");
{
  const fn = extractFn("computeVatReport");
  check("it reads the stored breakdown", /sale\.taxBreakdown/.test(fn));
  check("it does not recompute from items", !/computeSaleTax\(/.test(fn),
    "re-deriving would silently re-rate last year's trading if TRA moves the rate");
  check("it does not reach for the current rate", !/VAT_RATE/.test(fn));
}

console.log("\n=== the receipt states tax honestly ===");
{
  const fn = extractFn("receiptVatRows");
  check("a sale outside the scheme prints no tax lines", /sale\?\.vatRegistered !== true\) return ""/.test(fn),
    'printing "VAT 0" on a sale the scheme never covered is a false statement');
  check("the rate printed is the rate stored", /sale\.vatRate/.test(fn),
    "printing the current rate would misstate an old receipt after a rate change");
  check("net and VAT both appear", /netTotal/.test(fn) && /taxTotal/.test(fn));
  check("zero-rated is only shown when there is some", /zeroRated > 0/.test(fn));
  check("exempt is only shown when there is some", /exempt > 0/.test(fn));
  check("the receipt says prices include VAT", /receipt\.vatInclusiveNote/.test(fn),
    "on inclusive pricing the customer must not read net and VAT as additions to the total");

  const receipt = extractFn("buildReceiptHtml");
  check("the tax lines sit under the total", receipt.indexOf("receiptVatRows") > receipt.indexOf('t("pos.total")'),
    "printed above, they invite the customer to add them to the total");
  check("the VRN comes from the sale, not the current setting", /sale\.vrn/.test(receipt),
    "a receipt reprinted next year must show the number in force when the sale happened");
  check("...and only for a scheme sale", /sale\.vatRegistered === true && sale\.vrn/.test(receipt));
}

console.log("\n=== the panel is hidden from a shop with no return to file ===");
{
  check("the VAT panel starts hidden", /id="vatReportPanel" hidden/.test(appHtml));
  const render = extractFn("renderVatReport");
  check("...and is shown only when registered", /panel\.hidden = !vatSettings\(\)\.registered/.test(render));
  check("...and does no work when hidden", /if \(panel\.hidden\) return;/.test(render));
  check("the report pass actually runs it", /renderVatReport\(\);/.test(extractFn("renderPaymentReports")));
}

console.log("\n=== both languages ===");
{
  const keys = ["receipt.vatNetLabel", "receipt.vatLabel", "receipt.vatZeroRatedLabel", "receipt.vatExemptLabel",
    "receipt.vrnLabel", "receipt.vatInclusiveNote", "report.vatTitle", "report.vatDue", "report.vatNet",
    "report.vatStandard", "report.vatZeroRated", "report.vatExempt", "report.vatTaxableTurnover",
    "report.vatOutsideNote"];
  const missing = keys.filter((k) => [...app.matchAll(new RegExp(`"${k.replace(/\./g, "\\.")}":`, "g"))].length !== 2);
  check("every string is defined in English and Swahili", missing.length === 0, `not twice: ${missing.join(", ")}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
