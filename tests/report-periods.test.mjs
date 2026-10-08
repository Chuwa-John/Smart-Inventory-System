// Every report answers for a period, and they all ask for it the same way.
//
// Asked for twice, the second time in capitals: "IN THE REPORTS ALL REPORTS ...
// SHOULD BE ABLE TO CHOOSE TO SEE A REPORT BETWEEN A CERTAIN TIME FRAME NOT
// JUST A MONTH AS ITS IN PROFIT REPORT AMONGST OTHERS". Six screens held a
// month picker between them; the Profit Report had grown a From/To pair of its
// own, and copying that pair five more times would have been five more places
// for "what is a period" to drift.
//
// What this file pins is not the markup. It is the three properties that keep
// the screens honest:
//
//   1. ONE implementation. A screen that parses its own dates can disagree
//      with the summariser it feeds, and the disagreement looks like a figure
//      rather than like a bug.
//   2. The tiles and the rows under them read the SAME period. This is the
//      defect class the drill-downs exist to rule out, arriving from the date
//      side instead of the arithmetic side.
//   3. A backwards range is SAID, not totalled to zero. Zero reads as a shop
//      that sold nothing, which is the one answer a report must never give by
//      accident.
//
// Source-scanning, like its neighbours: these are structural properties of
// app.js and app.html, not behaviour a DOM sandbox would show.

import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
// Comments are stripped before anything is counted. This file has been through
// the other failure twice: a comment that NAMES the thing it is explaining
// satisfies a scan that was meant to find the code.
const src = app.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const results = [];
function check(name, actual, expected) {
  const pass = actual === expected;
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`      expected ${expected}, got ${actual}`);
}

function body(signature) {
  const start = src.indexOf(signature);
  if (start === -1) return "";
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return "";
}

// The six period pickers, by the name each one is keyed on. A picker called
// "purchase" reads #purchaseFromInput, keeps state.purchaseFrom, and resets
// from #purchaseThisMonth -- convention, so a seventh report needs markup and
// one call rather than a registration.
const PICKERS = ["profit", "purchase", "expense", "delivery", "cost"];

console.log("\n=== every report screen has a From and a To ===");
{
  for (const name of PICKERS) {
    check(`${name}: there is a from date`, html.includes(`id="${name}FromInput"`), true);
    check(`${name}: there is a to date`, html.includes(`id="${name}ToInput"`), true);
    check(`${name}: ...and a shortcut back to the current month`,
      html.includes(`id="${name}ThisMonth"`), true);
  }
  // The COGS report asked for a period before any of this and keeps its own
  // Generate button, so it has no "this month" shortcut -- but it wears the
  // same control, because a reader moving between reports should not have to
  // find the dates again on each one.
  check("the COGS report has the pair too",
    html.includes('id="cogsFromInput"') && html.includes('id="cogsToInput"'), true);
  check("...and wears the same picker",
    (html.match(/class="period-picker"/g) || []).length, 6);

  // The month inputs these replaced. A screen that kept one would be answering
  // a different question from the screen beside it.
  for (const dead of ["profitMonthInput", "purchaseMonthInput", "expenseMonthInput",
                      "deliveryMonthInput", "costReportMonthInput"]) {
    check(`the ${dead} month picker is gone`, html.includes(dead), false);
  }
}

console.log("\n=== the VAT record stays monthly, on purpose ===");
{
  // NOT an oversight, and not a screen that was missed. A VAT return is filed
  // for a calendar month, so a record meant to be checked before filing must
  // bucket the way the filing does. A range here would produce a figure that
  // matches no return the shop will ever submit.
  check("the VAT record still asks for a month", html.includes('id="vatMonthInput"'), true);
  check("...and the monthly report does too", html.includes('id="monthlyReportMonth"'), true);
}

console.log("\n=== one implementation, not six ===");
{
  check("there is a shared default", /function periodDefaults\(name\) \{/.test(src), true);
  check("there is a shared reader", /function periodFor\(name\) \{/.test(src), true);
  check("there is a shared binder", /function bindPeriodPicker\(name, onChange\) \{/.test(src), true);
  check("...and a shared refusal", /function periodIsBackwards\(bounds\) \{/.test(src), true);

  // Every screen binds through the helper. A hand-written change listener on a
  // From input is the drift this exists to prevent.
  for (const name of PICKERS) {
    check(`${name} binds through the helper`,
      src.includes(`bindPeriodPicker("${name}"`), true);
  }
  check("no screen binds a From input by hand",
    /qs\("#\w+FromInput"\)\?\.addEventListener/.test(src), false);
  check("...or a To input",
    /qs\("#\w+ToInput"\)\?\.addEventListener/.test(src), false);

  // The Profit Report's own copy, which came first. One of these two parses
  // dates; the other calls it.
  check("profitPeriodBounds is now one line over the helper",
    /function profitPeriodBounds\(\) \{\s*return periodFor\("profit"\);\s*\}/.test(src), true);
}

console.log("\n=== a period wins over a month, and a month still works ===");
{
  // The summarisers take `bounds` as an optional extra. Every caller that still
  // thinks in months -- the monthly report, the VAT record, the dashboard -- is
  // untouched by this, which is why the change could be made at all.
  for (const fn of ["summariseExpenses", "summariseLandedForMonth", "summariseDeliveries",
                    "summarisePurchases", "summariseSuppliers", "summariseExpensesByNature"]) {
    check(`${fn} takes an optional period`,
      new RegExp(`function ${fn}\\([^)]*bounds = null\\)`).test(src), true);
  }
  check("a month key still derives a period",
    /const \[year, month\] = String\(monthKey \|\| ""\)\.split/.test(src), true);

  // periodBounds() must not destructure in its signature: several harnesses
  // extract a function by counting braces from the first `{`, which for a
  // destructured parameter is the parameter list, so they capture no body and
  // the sandbox fails to parse. expenses.test.mjs broke exactly this way.
  check("periodBounds takes a plain object", /function periodBounds\(input\)/.test(src), true);
}

console.log("\n=== the tiles and the rows read the same period ===");
{
  // One periodFor() call per render, and the rows filtered by the object it
  // returned. Two calls could not disagree today -- but a screen that resolves
  // its period twice is one edit away from a total that the rows beneath it
  // contradict, which is exactly how a report stops being trustworthy.
  const screens = [
    ["renderPurchases", "purchase", "purchasedAt(purchase)"],
    ["renderExpenses", "expense", "expenseSpentAt(expense)"],
    ["renderDeliveries", "delivery", "deliveryReceivedAt(delivery)"],
    ["renderCostReports", "cost", null]
  ];
  for (const [fn, name, rowDate] of screens) {
    const b = body(`function ${fn}(`);
    check(`${fn} was located`, b.length > 500, true);
    check(`${fn} resolves its period once`,
      (b.match(new RegExp(`periodFor\\("${name}"\\)`, "g")) || []).length, 1);
    if (rowDate) {
      check(`${fn} filters its rows by that period`,
        b.includes(`return inPeriod(${rowDate}, period);`), true);
    }
    // No screen may still bucket by a month key: that is the old rule, and a
    // leftover copy would quietly ignore the dates the shop typed.
    check(`${fn} no longer buckets by a month key`,
      /localMonthKey\(at\) === monthKey/.test(b), false);
  }

  // The per-product table under the Profit Report ran on the FIRST month of the
  // range while the statement above it ran on the whole range. A shop asking
  // for July to September got a September statement explained by a July table,
  // with nothing on screen saying the two answered different questions.
  check("the per-product table takes the period, not a month",
    /function renderProductProfit\(p, period\) \{/.test(src), true);
  check("...and passes its two ends through",
    /fromMs: period\.fromMs,\s*\n\s*toMs: period\.toMs/.test(src), true);
  check("the derived month key is gone", /profitMonthSelection/.test(src), false);
}

console.log("\n=== a backwards range is said, not totalled to zero ===");
{
  check("one message, in both languages",
    (app.match(/"period\.datesBackwards":/g) || []).length, 2);
  // Each screen refuses before it summarises. Without this the summariser
  // returns zero for everything, which on a sales screen reads as a shop that
  // sold nothing -- a confident wrong answer instead of a correction.
  for (const fn of ["renderProfit", "renderPurchases", "renderExpenses", "renderDeliveries"]) {
    check(`${fn} refuses a backwards range`,
      /periodIsBackwards\(period\)/.test(body(`function ${fn}(`)), true);
  }
  check("and the COGS report says the same thing",
    /t\("period\.datesBackwards"\)/.test(src), true);
  check("...so no screen keeps its own wording for it",
    /cogs\.datesBackwards|profit\.datesBackwards/.test(app), false);
}

console.log("\n=== a screen nobody has touched follows the calendar ===");
{
  // The defect this prevents is specific and has been shipped before: a till
  // left open across midnight on the 1st keeps showing last month, and every
  // sale and expense recorded that morning is missing from a screen that looks
  // like it is reporting today.
  for (const [fn, name] of [["renderProfit", "profit"], ["renderPurchases", "purchase"],
                            ["renderExpenses", "expense"], ["renderDeliveries", "delivery"],
                            ["renderCostReports", "cost"]]) {
    check(`${fn} re-anchors until the shop chooses a period`,
      body(`function ${fn}(`).includes(`if (!state.${name}PeriodTouched) periodDefaults("${name}");`), true);
  }
  // ...and stops the moment they do. Moving a period the shop chose would be
  // the app arguing with them.
  for (const name of PICKERS) {
    check(`choosing a ${name} period is remembered`,
      src.includes(`state.${name}PeriodTouched = true;`), true);
  }

  // Local date parts, never an ISO slice. A UTC slice disagrees with the shop
  // between midnight and 03:00 EAT on the 1st -- the same three hours as above,
  // arriving from the other direction.
  const defaults = body("function periodDefaults(name) {");
  check("the default period is built from local parts",
    /localDateInputValue\(new Date\(now\.getFullYear\(\), now\.getMonth\(\), 1\)\)/.test(defaults), true);
  check("...and closes on the last day of the month",
    /now\.getMonth\(\) \+ 1, 0\)\)/.test(defaults), true);
  check("...with no ISO slicing anywhere in it", /toISOString/.test(defaults), false);

  // The whole of the last day, or a report for the 3rd to the 19th stops at
  // midnight on the 19th and silently drops that day's trading.
  check("the To date covers its whole day",
    /23, 59, 59, 999/.test(body("function periodFor(name) {")), true);
}

console.log("\n=== the month keys the screens no longer hold ===");
{
  // Four screens kept a month key AND a touched flag. Keeping a derived month
  // in step with a range it cannot represent is how the per-product table came
  // to disagree with the line above it, so the fields went.
  for (const dead of ["purchaseMonthSelection", "expenseMonthSelection",
                      "deliveryMonthSelection", "reportsCostMonth"]) {
    check(`${dead} is gone`, src.includes(dead), false);
  }
  // Monthly Reports keeps its own, because it IS a monthly report: a month-by-
  // month comparison is the question it answers.
  check("the monthly report keeps its month", src.includes("reportMonthSelection"), true);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
