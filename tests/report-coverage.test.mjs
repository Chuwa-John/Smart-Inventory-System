// QA-102: reports must not report on history they cannot see.
//
//   node report-coverage.test.mjs
//
// subscribeToSales() holds the newest SALES_HISTORY_LIMIT sales. At fifty sales
// a day that is twenty trading days, so by the 25th of a busy month the
// previous month has already fallen out of the loaded set.
//
// Reporting on the visible remainder is not a display bug. computeMonthlyMetrics
// feeds an AI narrative and is then written to monthlyReports as an
// authoritative record, and computeVatReport feeds a VAT return. An understated
// revenue figure becomes stored truth, and the understated VAT liability filed
// against it is a penalty exposure the owner has no way to detect -- the report
// looks complete. Worse, a month entirely outside the window reports zero
// transactions, so the owner was told "no sales data" for a month they traded.
//
// salesCoverageFromMs() was built for exactly this question and only
// reconcileShiftCash() was asking it. That is the same shape as QA-101: a
// correct component wired to one of the places that needed it.
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

const LIMIT = Number(app.match(/const SALES_HISTORY_LIMIT = (\d+);/)?.[1]);

console.log("=== the boundary means what it says ===");
{
  const state = { sales: [] };
  const { salesCoverageFromMs } = new Function("state", "SALES_HISTORY_LIMIT",
    `${extractFn("salesCoverageFromMs")}\nreturn { salesCoverageFromMs };`)(state, LIMIT);

  check("the limit was found", LIMIT >= 100, `SALES_HISTORY_LIMIT=${LIMIT}`);

  const at = (ms) => ({ createdAt: { toDate: () => new Date(ms) } });

  // Short of the limit: we hold everything, so absence really is absence.
  state.sales = [at(5000), at(9000)];
  check("a partial page means no boundary", salesCoverageFromMs() === null,
    "a short page is the whole history; claiming a boundary would refuse valid reports");

  // Full page: older sales exist that we do not hold.
  state.sales = Array.from({ length: LIMIT }, (_, i) => at(100000 + i));
  check("a full page reports the oldest loaded sale", salesCoverageFromMs() === 100000,
    `got ${salesCoverageFromMs()}`);

  // Order must not matter — the subscription is newest-first.
  state.sales = Array.from({ length: LIMIT }, (_, i) => at(999999 - i));
  check("the oldest is found regardless of order", salesCoverageFromMs() === 999999 - (LIMIT - 1));
}

console.log("=== the monthly report refuses rather than under-reports ===");
{
  const fn = extractFn("generateMonthlyReport");
  check("it asks how far back it can see", /salesCoverageFromMs\(\)/.test(fn),
    "without this it silently narrates and STORES a truncated month");
  check("it refuses when the period starts before the boundary",
    /coverage !== null && metrics\.periodStart\.getTime\(\) < coverage/.test(fn));
  check("...with a named reason, not a generic failure",
    /toast\.reportPeriodBeyondHistory/.test(fn));

  // Every ordering assertion below compares positions in CODE. Comments are
  // stripped first: the explanatory note above the guard mentions
  // "monthlyReports", and matching that instead of the setDoc made this block
  // pass for the wrong reason on its first run.
  const code = fn.replace(/\/\/[^\n]*/g, "");

  // Order is the whole point: an uncovered month reports zero transactions, so
  // the empty-month message would fire first and state a confident falsehood.
  const coverageAt = code.indexOf("salesCoverageFromMs()");
  const emptyAt = code.indexOf("monthlyReport.noSalesData");
  check("the coverage check runs BEFORE the empty-month check",
    coverageAt !== -1 && emptyAt !== -1 && coverageAt < emptyAt,
    'otherwise the owner is told "no sales data" for a month they traded');

  // And it must stop, not merely warn: the AI call and the setDoc both follow.
  check("it returns rather than continuing", /return showToast\(t\("toast\.reportPeriodBeyondHistory"/.test(code),
    "continuing would still write the truncated metrics to monthlyReports");
  const refuseAt = code.indexOf("toast.reportPeriodBeyondHistory");
  const persistAt = code.indexOf("setDoc(reportRef");
  check("...before the record is persisted",
    refuseAt !== -1 && persistAt !== -1 && refuseAt < persistAt,
    "the stored record is what makes this a filing risk rather than a display bug");
  check("...and before the AI is paid to narrate it", refuseAt < code.indexOf("generateMonthlyReportNarrative"),
    "narrating a truncated month spends quota to produce a confident wrong summary");
}

console.log("\n=== the VAT return states what it cannot see ===");
{
  const fn = extractFn("computeVatReport");

  // Read out of the RETURNED OBJECT, not the function body. Matching the name
  // anywhere also matched its own `const coverageComplete = ...` declaration,
  // so deleting it from the return went undetected — found by mutating exactly
  // that. The caller can only use what is returned.
  const retStart = fn.lastIndexOf("return {");
  const returned = fn.slice(retStart);
  check("the returned object carries the coverage flag", /\bcoverageComplete\b\s*[,:]/.test(returned),
    `the caller sees only what is returned. Return block: ${returned.slice(0, 120)}`);
  check("...and the boundary date to name", /\bcoverageBoundary\b\s*:/.test(returned));
  check("...derived from the same boundary", /salesCoverageFromMs\(\)/.test(fn),
    "a second definition of 'far enough back' would drift from the first");
  check("...and the range being asked for", /getSalesRangeBounds\(\)/.test(fn));

  // A null start is the all-time preset: with any boundary at all it cannot be
  // complete, and that is the case an owner is most likely to file from.
  check("an open-ended range is incomplete whenever a boundary exists",
    /start !== null && start\.getTime\(\) >= boundary/.test(fn),
    "all-time with a boundary must not report itself as complete");

  const render = extractFn("renderVatReport");
  check("the panel says so when incomplete", /!r\.coverageComplete/.test(render));
  check("...naming the date it can see back to", /r\.coverageBoundary/.test(render));
  check("...and saying it is not a filing figure",
    /report\.vatCoverageIncomplete/.test(render));

  // Deliberately different from the monthly report: the VAT panel still renders
  // the covered part, because refusing outright would leave the owner with
  // nothing at all.
  check("the panel still renders the covered portion", !/coverageComplete\) return;/.test(render),
    "refusing to render would be less useful than rendering with a stated limit");
}

console.log("\n=== both languages ===");
{
  for (const key of ["toast.reportPeriodBeyondHistory", "report.vatCoverageIncomplete"]) {
    const n = [...app.matchAll(new RegExp(`"${key.replace(/\./g, "\\.")}":`, "g"))].length;
    check(`${key} is defined in English and Swahili`, n === 2, `found ${n}`);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
