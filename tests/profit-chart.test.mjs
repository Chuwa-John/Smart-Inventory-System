// The dashboard chart: net profit over time, as bars.
//
//   node profit-chart.test.mjs
//
// It replaced a line chart of stock quantity per product. That chart's x axis
// was a LIST OF PRODUCTS, so the slope between two points meant nothing while
// inviting a reading ("stock is falling") the data did not support. Profit over
// time is a real series, and bars are the honest mark for discrete periods.
//
// Two things here can mislead an owner about money, so both are pinned:
//
//   1. A period whose sales have no recorded cost must not be drawn. Reporting
//      revenue as profit is the defect DESIGN-purchases.md 2 found LIVE on this
//      very screen; a bar built from it would put it straight back.
//   2. A loss must be drawn below the zero line, not clipped at it. The chart
//      this replaced assumed every value was positive -- true of a stock count,
//      false of a profit.
//
// Functions are evaluated out of app.js rather than reimplemented -- the
// purchases.test.mjs convention.
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
const body = (name) => extract(name).replace(/\/\/[^\n]*/g, "");

// --- the bucket maths, for real ---------------------------------------------
const { profitTrendBuckets, compactMoney } = new Function(`
  ${extract("profitTrendBuckets")}
  ${extract("compactMoney")}
  return { profitTrendBuckets, compactMoney };
`)();

console.log("\n=== the periods the owner picks between ===");
{
  check("annual shows five years", profitTrendBuckets("year").length, 5);
  check("monthly shows twelve months", profitTrendBuckets("month").length, 12);
  check("weekly shows eight weeks", profitTrendBuckets("week").length, 8);
  // An unrecognised value must not produce an empty chart.
  check("anything else falls back to months", profitTrendBuckets("").length, 12);

  const years = profitTrendBuckets("year");
  check("the current year is last, not first",
    Number(years[years.length - 1].label), new Date().getFullYear());

  // Contiguous and non-overlapping: a gap silently drops a day's takings out of
  // the chart, an overlap counts one twice.
  for (const period of ["week", "month", "year"]) {
    const b = profitTrendBuckets(period);
    const joined = b.every((x, i) => i === 0 || x.start.getTime() === b[i - 1].end.getTime());
    check(`${period} buckets are contiguous and non-overlapping`, joined, true);
    check(`${period} buckets each end after they start`,
      b.every((x) => x.end.getTime() > x.start.getTime()), true);
  }

  // A shop talks about a week as Monday to Monday.
  check("weeks start on a Monday",
    profitTrendBuckets("week").every((b) => b.start.getDay() === 1), true);
  check("...and the last one contains today",
    profitTrendBuckets("week").slice(-1)[0].end.getTime() > Date.now(), true);
  check("months start on the 1st",
    profitTrendBuckets("month").every((b) => b.start.getDate() === 1), true);
}

console.log("\n=== the axis stays readable at shop-sized numbers ===");
{
  // 1,200,000 in a 76px gutter is unreadable; the exact figure is on the Profit
  // Report. The axis is for shape.
  check("thousands", compactMoney(94000), "94k");
  check("millions", compactMoney(1200000), "1.2M");
  check("tens of millions drop the decimal", compactMoney(24000000), "24M");
  check("small numbers stay themselves", compactMoney(430), "430");
  // Losses are the whole point of the rewrite, so the axis has to label them.
  check("a negative keeps its sign", compactMoney(-94000), "-94k");
  check("zero", compactMoney(0), "0");
}

// --- the series, with its dependencies injected -----------------------------
// summariseProfitTrend() is the real function; everything it leans on is a stub
// so the test controls exactly what it sees.
const makeSeries = ({ sales, expenses, storeId = "all" }) => new Function(
  "state", "buildCostIndex", "saleStoreId", "storeExpenses", "saleTimestamp",
  "summariseSales", "summariseCostOfGoods", "expenseSpentAt", "safeNumber", `
  ${extract("profitTrendBuckets")}
  ${extract("summariseProfitTrend")}
  return summariseProfitTrend;
`)(
  { currentStoreId: storeId, sales, productCostHistory: [] },
  () => ({}),
  (sale) => sale.storeId,
  () => expenses,
  (sale) => sale.at,
  (list) => ({ net: list.reduce((s, x) => s + x.revenue, 0), count: list.length }),
  (list) => ({
    cogs: list.reduce((s, x) => s + (x.cost || 0), 0),
    anyCostKnown: list.some((x) => x.cost !== undefined)
  }),
  (e) => e.at,
  (n) => Number(n) || 0
);

const thisMonth = (day) => new Date(new Date().getFullYear(), new Date().getMonth(), day, 12);

console.log("\n=== revenue is never drawn as profit ===");
{
  // Sales exist, but nothing has a recorded cost. The honest answer is "we
  // cannot tell", which is a different statement from "no profit" -- and very
  // different from a bar the height of the takings.
  const noCost = makeSeries({
    sales: [{ at: thisMonth(3), revenue: 500000 }], expenses: []
  })("month").slice(-1)[0];
  check("a period with no known cost has no bar at all", noCost.net, null);
  check("...and is marked as having sold something", noCost.hasSales, true);
  check("...and as not knowing the cost", noCost.costKnown, false);

  // The same period once a cost is known.
  const known = makeSeries({
    sales: [{ at: thisMonth(3), revenue: 500000, cost: 300000 }],
    expenses: [{ at: thisMonth(4), amount: 50000 }]
  })("month").slice(-1)[0];
  check("with a cost, net is revenue less cost less expenses", known.net, 150000);
  check("...and it is drawable", known.costKnown, true);
}

console.log("\n=== a loss is a number, not a floor ===");
{
  const loss = makeSeries({
    sales: [{ at: thisMonth(2), revenue: 100000, cost: 90000 }],
    expenses: [{ at: thisMonth(5), amount: 104000 }]
  })("month").slice(-1)[0];
  check("spending more than you made is negative, not clamped to zero",
    loss.net, -94000);
}

console.log("\n=== nothing leaks across periods or branches ===");
{
  const lastYear = new Date(new Date().getFullYear() - 1, 0, 15, 12);
  const series = makeSeries({
    sales: [{ at: lastYear, revenue: 999999, cost: 1 }],
    expenses: []
  })("month");
  check("a sale outside every bucket appears in none",
    series.every((b) => b.net === null), true);

  const quiet = makeSeries({ sales: [], expenses: [] })("month");
  check("a period with nothing in it is empty, not zero", quiet.slice(-1)[0].net, null);
  check("...and says so", quiet.slice(-1)[0].hasSales, false);

  // Multi-branch: the dashboard is scoped to the selected branch, and so is this.
  const scoped = makeSeries({
    storeId: "branch-a",
    sales: [
      { at: thisMonth(3), revenue: 100000, cost: 40000, storeId: "branch-a" },
      { at: thisMonth(3), revenue: 800000, cost: 10000, storeId: "branch-b" }
    ],
    expenses: []
  })("month").slice(-1)[0];
  check("another branch's sales stay out of this branch's chart", scoped.net, 60000);
}

console.log("\n=== the drawing itself ===");
{
  const draw = body("renderChart");
  // The scale is built from both ends, so zero is always on it -- otherwise a
  // loss has nowhere to be drawn.
  check("the scale reaches below zero", /const rawMin = Math\.min\(\.\.\.known, 0\)/.test(draw), true);
  check("...and above it", /const rawMax = Math\.max\(\.\.\.known, 0\)/.test(draw), true);
  check("bars hang from the zero line, in whichever direction",
    /const top = Math\.min\(y, zeroY\)/.test(draw)
    && /Math\.abs\(y - zeroY\)/.test(draw), true);
  check("a loss is coloured differently from a profit",
    /bucket\.net < 0 \? "#ef6666" : "#46c2a1"/.test(draw), true);
  // A zero bar says "no profit". A blank slot says "we cannot tell". They are
  // not the same claim and must not look the same.
  check("an unknown period draws no bar", /if \(bucket\.net === null\)/.test(draw), true);
  check("...it is labelled instead", /t\("chart\.noCost"\)/.test(draw), true);
  check("bars, not a line: nothing strokes a path between points",
    /lineTo\(cx/.test(draw), false);
}

console.log("\n=== the panel says what it is, in both languages ===");
{
  check("the heading is about profit", html.includes('data-i18n="dashboard.profitTitle"'), true);
  // Scoped to this select: the Reports range picker uses the same option
  // values, so a document-wide match reads both and passes on the wrong one.
  const rangeSelect = html.slice(html.indexOf('id="chartRange"'));
  const chartOptions = rangeSelect.slice(0, rangeSelect.indexOf("</select>"));
  check("the ranges are the three the owner asked for",
    [...chartOptions.matchAll(/<option value="(\w+)"/g)].map((m) => m[1]),
    ["week", "month", "year"]);
  check("monthly is the default", /<option value="month" selected/.test(chartOptions), true);
  // Net profit is only as good as the expenses entered -- the same caveat
  // DESIGN-purchases.md 11 attaches to the figure everywhere else.
  check("the incompleteness of net profit is disclosed",
    html.includes('data-i18n="dashboard.profitNote"'), true);

  for (const key of ["dashboard.profitTitle", "dashboard.profitNote", "dashboard.profitEyebrow",
                     "dashboard.chartWeek", "dashboard.chartMonth", "dashboard.chartYear",
                     "chart.profitEmpty", "chart.noCost"]) {
    const n = (src.match(new RegExp(`"${key.replace(".", "\\.")}":`, "g")) || []).length;
    check(`${key} is in en and sw`, n, 2);
  }
  // The chart it replaced left keys behind that nothing reads.
  for (const dead of ["dashboard.stockLevelsTitle", "dashboard.chartQuantity"]) {
    check(`the dead key ${dead} is gone`, src.includes(dead), false);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
