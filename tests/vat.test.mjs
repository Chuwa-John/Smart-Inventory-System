// Phase 24, the tax half: VAT arithmetic, before anything calls it.
//
//   node vat.test.mjs
//
// Design and the commercial decisions behind it: DESIGN-vat.md. The property
// this suite exists for is one line:
//
//     netTotal + taxTotal === total
//
// for every basket, in every combination of tax classes and discounts. Not
// approximately. A VAT return that does not reconcile to takings is worse than
// no VAT feature, because it is wrong on a document the shop is audited on and
// it is wrong quietly.
//
// The two ways that invariant gets broken, both guarded below:
//
//   1. Rounding `net` on its own instead of deriving it by subtraction. Each
//      line is then off by up to a shilling in a direction nothing corrects.
//   2. Apportioning a basket discount per line and rounding each share. The
//      shares stop summing to the discount, so the total disagrees with its own
//      lines -- and the tax is extracted from the wrong base as well.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

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

// The shipped functions, with the shipped rate and class list.
const RATE = Number(app.match(/const VAT_RATE = ([\d.]+);/)?.[1]);
const CLASSES = JSON.parse((app.match(/const TAX_CLASSES = (\[[^\]]+\]);/)?.[1] ?? "[]").replace(/'/g, '"'));
const api = new Function("VAT_RATE", "TAX_CLASSES", `
  ${extractFn("vatFromInclusive")}
  ${extractFn("apportionDiscount")}
  ${extractFn("computeSaleTax")}
  ${extractFn("taxClassOf")}
  return { vatFromInclusive, apportionDiscount, computeSaleTax, taxClassOf };
`)(RATE, CLASSES);
const { vatFromInclusive, apportionDiscount, computeSaleTax, taxClassOf } = api;

const isWhole = (n) => Number.isInteger(n);

console.log("=== the rate and the classes are what was agreed ===");
{
  check("the standard rate is 18%", RATE === 0.18, `got ${RATE}`);
  check("there are three tax classes", CLASSES.length === 3, JSON.stringify(CLASSES));
  check("zeroRated and exempt are distinct classes",
    CLASSES.includes("zeroRated") && CLASSES.includes("exempt"),
    "collapsing them into one no-tax flag misstates taxable turnover on the return");
}

console.log("\n=== tax is extracted from inside the shelf price ===");
{
  // The worked case: an inclusive 1,180 at 18% holds 180 of VAT and 1,000 net.
  check("1,180 inclusive holds 180 of VAT", vatFromInclusive(1180) === 180, `got ${vatFromInclusive(1180)}`);
  check("...leaving 1,000 net", 1180 - vatFromInclusive(1180) === 1000);

  // Exclusive arithmetic on the same number would give 212.4 -- the commonest
  // way this feature is got wrong.
  check("it is not computed as 18% OF the price", vatFromInclusive(1180) !== Math.round(1180 * 0.18),
    "that is exclusive arithmetic and overstates the tax on every sale");

  check("nothing is owed on nothing", vatFromInclusive(0) === 0);
  check("a negative amount cannot invent tax", vatFromInclusive(-500) === 0);
  check("a nonsense amount cannot invent tax", vatFromInclusive(Infinity) === 0 && vatFromInclusive(NaN) === 0,
    "Infinity has been accepted by this codebase before");
  check("the tax is always whole shillings", isWhole(vatFromInclusive(1333)));
}

console.log("\n=== a discount is spread across lines without losing a shilling ===");
{
  const cases = [
    [[1000, 1000], 100], [[1000, 2000, 3000], 500], [[333, 333, 334], 100],
    [[1, 1, 1], 2], [[10000], 3333], [[7, 11, 13, 17], 23], [[1000, 1], 500]
  ];
  let exact = true, negative = false, over = false;
  for (const [amounts, discount] of cases) {
    const shares = apportionDiscount(amounts, discount);
    if (shares.reduce((a, b) => a + b, 0) !== discount) exact = false;
    if (shares.some((s) => s < 0)) negative = true;
    if (shares.some((s, i) => s > amounts[i])) over = true;
  }
  check("the shares sum to exactly the discount", exact,
    "a residue here is a total that disagrees with the sum of its own lines");
  check("no share is negative", !negative);
  check("no line is discounted below zero", !over);

  check("a discount larger than the basket is capped",
    apportionDiscount([100, 100], 5000).reduce((a, b) => a + b, 0) === 200);
  check("no discount means no shares", apportionDiscount([500, 500], 0).every((s) => s === 0));
  check("an empty basket does not throw", apportionDiscount([], 100).length === 0);
}

console.log("\n=== the invariant, over every mix that can occur ===");
{
  // Exhaustive rather than illustrative: three classes across up to three
  // lines, awkward prices, and discounts including none, some, and all of it.
  const prices = [1, 7, 333, 1000, 1333, 4567, 98765];
  let checked = 0;
  const broken = [];

  for (const a of prices) {
    for (const b of prices) {
      for (const ca of CLASSES) {
        for (const cb of CLASSES) {
          const lines = [{ inclusive: a, taxClass: ca }, { inclusive: b, taxClass: cb }];
          const subtotal = a + b;
          for (const discount of [0, 1, Math.floor(subtotal / 3), subtotal - 1, subtotal]) {
            const r = computeSaleTax(lines, discount);
            checked++;
            const sumNet = CLASSES.reduce((s, c) => s + r.breakdown[c].net, 0);
            const sumVat = CLASSES.reduce((s, c) => s + r.breakdown[c].vat, 0);
            if (r.netTotal + r.taxTotal !== r.total) broken.push(`reconcile ${a}/${ca} ${b}/${cb} -${discount}`);
            else if (r.total !== subtotal - discount) broken.push(`total ${a}/${b} -${discount} gave ${r.total}`);
            else if (sumNet + sumVat !== r.total) broken.push(`breakdown ${a}/${ca} ${b}/${cb} -${discount}`);
            else if (sumVat !== r.taxTotal) broken.push(`vat sum ${a}/${ca} ${b}/${cb} -${discount}`);
            else if (![r.total, r.taxTotal, r.netTotal, sumNet, sumVat].every(isWhole))
              broken.push(`fractional ${a}/${ca} ${b}/${cb} -${discount}`);
            else if (r.taxTotal < 0 || r.netTotal < 0) broken.push(`negative ${a}/${ca} ${b}/${cb} -${discount}`);
          }
        }
      }
    }
  }

  check("enough combinations were actually exercised", checked >= 2000, `${checked} baskets`);
  check("net + tax equals the total in every one of them", broken.length === 0,
    `${broken.length} failures, first: ${broken.slice(0, 3).join(" | ")}`);
}

console.log("\n=== the classes behave differently where they should ===");
{
  const one = (inclusive, taxClass) => computeSaleTax([{ inclusive, taxClass }], 0);

  const std = one(1180, "standard");
  check("a standard line carries tax", std.taxTotal === 180 && std.netTotal === 1000);

  for (const c of ["zeroRated", "exempt"]) {
    const r = one(1180, c);
    check(`a ${c} line carries no tax`, r.taxTotal === 0 && r.netTotal === 1180);
    check(`...and is still reported under ${c}`, r.breakdown[c].net === 1180,
      "zero-rated and exempt turnover are separate lines on the return");
  }

  // Mixed basket: only the standard line should contribute tax.
  const mixed = computeSaleTax([
    { inclusive: 1180, taxClass: "standard" },
    { inclusive: 5000, taxClass: "zeroRated" },
    { inclusive: 2000, taxClass: "exempt" }
  ], 0);
  check("in a mixed basket only the standard line is taxed", mixed.taxTotal === 180, `got ${mixed.taxTotal}`);
  check("...and the whole basket still reconciles", mixed.netTotal + mixed.taxTotal === 8180);

  // The defect apportionment prevents: discounting the untaxed lines must not
  // change the tax owed on the taxed one by more than its own share.
  const discounted = computeSaleTax([
    { inclusive: 1180, taxClass: "standard" },
    { inclusive: 8820, taxClass: "zeroRated" }
  ], 1000);
  check("a discount is shared, not charged to the taxed line alone",
    discounted.taxTotal > 0 && discounted.taxTotal < 180,
    `got ${discounted.taxTotal}; charging it all to one line would give 0 or 180`);
  check("...and it still reconciles", discounted.netTotal + discounted.taxTotal === discounted.total);
}

console.log("\n=== an unclassified product is treated as standard-rated ===");
{
  // Defaulting the other way would silently under-collect on every product
  // added before the field existed.
  check("a missing class is standard", taxClassOf({}) === "standard");
  check("an unknown class is standard", taxClassOf({ taxClass: "made-up" }) === "standard");
  check("a null product is standard", taxClassOf(null) === "standard");
  for (const c of CLASSES) check(`${c} is preserved`, taxClassOf({ taxClass: c }) === c);

  const r = computeSaleTax([{ inclusive: 1180 }], 0);
  check("a line with no class is taxed", r.taxTotal === 180,
    "defaulting to exempt would under-collect on every legacy product");
}

console.log("\n=== the rate is written down, not looked up later ===");
{
  const r = computeSaleTax([{ inclusive: 1180, taxClass: "standard" }], 0);
  check("the result carries the rate it used", r.vatRate === RATE,
    "a report of last year's trading must not silently re-rate itself when TRA changes the rate");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
