// Tests the AI monthly-quota decision by evaluating the REAL function out of
// proxy/server.js — not a reimplementation, which would only prove the copy
// agrees with itself.
//
//   node ai-quota.test.mjs
//
// Every branch here is a way to give tokens away by accident. The per-minute
// limiter bounds burst; this function is the only thing bounding spend, and the
// exposure it closes is roughly $268/month from a single determined account.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../proxy/server.js", import.meta.url), "utf8");

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in proxy/server.js`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const { evaluateQuota, currentPeriodKey } = new Function(
  `${extract("evaluateQuota")}
   ${extract("currentPeriodKey")}
   return { evaluateQuota, currentPeriodKey };`
)();

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

const NOW = "2026-07";

console.log("=== a fresh business ===");
{
  const d = evaluateQuota(null, 100, NOW);
  check("first question is allowed", d.allowed === true);
  check("counter starts at 1, not 0", d.used === 1, `used=${d.used}`);
  check("remaining reflects the reservation", d.remaining === 99, `remaining=${d.remaining}`);
}

console.log("\n=== the exhaustion boundary ===");
{
  const last = evaluateQuota({ periodKey: NOW, used: 99 }, 100, NOW);
  check("the 100th question is allowed", last.allowed === true);
  check("it leaves nothing behind", last.remaining === 0, `remaining=${last.remaining}`);

  const over = evaluateQuota({ periodKey: NOW, used: 100 }, 100, NOW);
  check("the 101st is refused", over.allowed === false);
  check("refusal reports zero remaining", over.remaining === 0);

  // >= not >: a > here hands every tenant one free question every month.
  const way = evaluateQuota({ periodKey: NOW, used: 5000 }, 100, NOW);
  check("a counter past the limit stays refused", way.allowed === false);
}

console.log("\n=== month rollover resets in place ===");
{
  const rolled = evaluateQuota({ periodKey: "2026-06", used: 100 }, 100, NOW);
  check("last month's exhausted counter does not carry over", rolled.allowed === true);
  check("the new month starts from 1", rolled.used === 1, `used=${rolled.used}`);

  const future = evaluateQuota({ periodKey: "2026-08", used: 100 }, 100, NOW);
  check("a counter from another month is also ignored", future.allowed === true);
}

console.log("\n=== absent vs corrupt are different states ===");
{
  // Absent is the normal state of a bucket nobody has used this month — the
  // first report of every month arrives with no reportsUsed field. It must read
  // as zero, or that request is refused for no reason.
  const absent = evaluateQuota({ periodKey: NOW, used: undefined }, 100, NOW);
  check("an absent counter reads as zero, not as corrupt", absent.allowed === true,
    `allowed=${absent.allowed}`);
  check("...and starts the month at 1", absent.used === 1, `used=${absent.used}`);

  // Present-but-malformed is corrupt bookkeeping: cost a question, never the
  // month's whole budget.
  for (const [label, used] of [["null", null], ["a string", "many"],
                               ["NaN", NaN], ["negative", -50]]) {
    const d = evaluateQuota({ periodKey: NOW, used }, 100, NOW);
    check(`a ${label} counter is refused, not read as zero`, d.allowed === false,
      `allowed=${d.allowed}`);
  }
}

console.log("\n=== per-tenant limits ===");
{
  check("a zero quota refuses immediately",
    evaluateQuota(null, 0, NOW).allowed === false);
  const generous = evaluateQuota({ periodKey: NOW, used: 150 }, 400, NOW);
  check("an upgraded tenant keeps going past the default", generous.allowed === true);
  check("remaining tracks the tenant's own limit", generous.remaining === 249,
    `remaining=${generous.remaining}`);
}

console.log("\n=== the period key ===");
{
  check("is zero-padded", currentPeriodKey(new Date(Date.UTC(2026, 0, 15))) === "2026-01",
    currentPeriodKey(new Date(Date.UTC(2026, 0, 15))));
  check("rolls at the month boundary",
    currentPeriodKey(new Date(Date.UTC(2026, 6, 31, 23, 59))) !== currentPeriodKey(new Date(Date.UTC(2026, 7, 1, 0, 1))));
  // UTC, not local: a device clock in another timezone must not shift the reset.
  check("is computed in UTC",
    currentPeriodKey(new Date(Date.UTC(2026, 7, 1, 0, 30))) === "2026-08");
}

// Chat questions and month-end reports share the endpoint but not the
// allowance. Sharing one meant a business that chatted its way to zero could
// not produce its month-end report -- the highest-value output blocked by the
// most casual one.
console.log("\n=== the two buckets are independent ===");
{
  const spentChat = { periodKey: NOW, used: 80, reportsUsed: 0 };
  check("a spent question allowance still permits a report",
    evaluateQuota(spentChat, 20, NOW, "reportsUsed").allowed === true);
  check("...and still refuses another question",
    evaluateQuota(spentChat, 80, NOW, "used").allowed === false);

  const spentReports = { periodKey: NOW, used: 3, reportsUsed: 20 };
  check("a spent report allowance still permits a question",
    evaluateQuota(spentReports, 80, NOW, "used").allowed === true);
  check("...and still refuses another report",
    evaluateQuota(spentReports, 20, NOW, "reportsUsed").allowed === false);

  // The buckets must not read each other's counter.
  check("the report bucket ignores the chat counter",
    evaluateQuota({ periodKey: NOW, used: 80 }, 20, NOW, "reportsUsed").remaining === 19,
    JSON.stringify(evaluateQuota({ periodKey: NOW, used: 80 }, 20, NOW, "reportsUsed")));
}

console.log("\n=== rollover applies to a bucket that has no counter yet ===");
{
  // Whichever bucket rolls the month first stamps the new periodKey. The other
  // bucket then reads a doc that is "this month" but has no entry of its own —
  // it must start at zero, not inherit anything.
  const chatRolledFirst = { periodKey: NOW, used: 1 };
  const report = evaluateQuota(chatRolledFirst, 20, NOW, "reportsUsed");
  check("a bucket with no field this month starts fresh", report.allowed === true);
  check("...at 1, not at the other bucket's count", report.used === 1, `used=${report.used}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
