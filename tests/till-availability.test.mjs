// Guards UX-1 and UX-2: the Complete Sale button must never be left dead.
//
//   node till-availability.test.mjs
//
// The button is disabled while a sale is in flight, which is right -- a
// double-tap on a slow connection is the most likely way to record a sale
// twice. But the re-enable sat on two specific paths: the transaction's catch
// block, and the last line of the happy path. Between them ran an unguarded
// await and a full renderAll(). Anything throwing there left the button
// permanently disabled, and since the sale may already have been written the
// cashier could not tell whether to enter it again. A dead till is the worst
// possible failure for this app: the shop cannot sell.
//
// The guard was also claimed AFTER the credit-alert check, which awaits a
// network round trip to verify an override password while the page stays
// interactive -- so the button was live during exactly the pause a cashier is
// most likely to tap it again.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

// The click handler, by brace-matching from its registration.
const start = app.indexOf('qs("#completeSaleButton").addEventListener');
const lines = app.slice(start).split("\n");
let depth = 0, endLine = null;
for (let i = 0; i < lines.length; i++) {
  depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
  if (depth === 0 && i > 0) { endLine = i; break; }
}
const handler = lines.slice(0, endLine + 1).join("\n");

console.log("=== the guard is claimed before anything can await ===");
{
  const guardAt = handler.indexOf("completeButton.disabled = true");
  const firstAwait = handler.indexOf("await ");
  check("the handler claims the button", guardAt !== -1);
  check("it is claimed before the first await", guardAt !== -1 && guardAt < firstAwait,
    `guard at ${guardAt}, first await at ${firstAwait} — the button was live across a network round trip`);
  check("a second entry while in flight is refused",
    /if \(completeButton\.disabled\) return;/.test(handler),
    "without this, two queued clicks both proceed");
}

console.log("\n=== no path can leave the till dead ===");
{
  const reEnables = handler.match(/completeButton\.disabled = false/g) || [];
  check("there is exactly one re-enable", reEnables.length === 1,
    `${reEnables.length} found — more than one means the paths can diverge`);
  check("it lives in a finally block",
    /\} finally \{[\s\S]{0,600}completeButton\.disabled = false;[\s\S]{0,40}\}/.test(handler),
    "a re-enable outside finally is skipped by any throw above it");

  // The finally must cover the awaits and the render, which is where the
  // original defect lived.
  const tryAt = handler.indexOf("try {");
  const finallyAt = handler.indexOf("} finally {");
  check("the try opens before the first await", tryAt !== -1 && tryAt < handler.indexOf("await "));
  check("renderAll() runs inside the protected span",
    handler.indexOf("renderAll()") > tryAt && handler.indexOf("renderAll()") < finallyAt,
    "renderAll touches the whole UI and is the most likely thing to throw here");

  // Every early exit after the guard must be inside the try, or it strands the
  // button.
  const body = handler.slice(tryAt, finallyAt);
  const returnsInside = (body.match(/^\s*return[; ]/gm) || []).length;
  check("early exits after the guard sit inside the protected span", returnsInside >= 3,
    `${returnsInside} found — each one needs the finally to hand the till back`);
}

console.log("\n=== the guard did not cost the idempotency work ===");
{
  // A disabled button stops the second tap; the deterministic id stops the
  // retry that the button never saw. Both are still needed.
  check("sales are still keyed deterministically", /const dedupeSaleId = `ord_\$\{seller\.id\}_\$\{orderNumber\}`/.test(app));
  check("a deliberate re-entry still gets its own id", /duplicate \? `\$\{dedupeSaleId\}_dup\$\{Date\.now\(\)\}`/.test(app));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
