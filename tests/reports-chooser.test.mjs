// The Reports chooser.
//
//   node reports-chooser.test.mjs
//
// Reports was eighteen panels on one scrolling page, every one rendered on
// every open. It is now a menu that shows one report at a time. Two ways that
// can go wrong, and both are silent:
//
//   1. IT COULD REVEAL A REPORT A ROLE WAS REFUSED. renderSpecReports() decides
//      role visibility; this layer must only ever narrow that decision. A
//      chooser that set `hidden = false` on the selected panel would hand a
//      manager the Stock Valuation and Purchase reports -- every figure in
//      which is a buying price.
//   2. IT COULD STRAND A REPORT. A panel that exists but is in no group, or a
//      menu entry pointing at a panel that is gone, leaves a report either
//      unreachable or a dead button. The menu is therefore BUILT FROM the
//      panels rather than from a list typed alongside them.
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

const reportsStart = html.indexOf('<section class="view" id="reports">');
const reportsView = html.slice(reportsStart, html.indexOf("\n        </section>", reportsStart));
const panels = [...reportsView.matchAll(/<article class="panel"([^>]*)>/g)].map((m) => m[1]);
const tagged = panels.filter((a) => /data-report="/.test(a));

console.log("=== every report is tagged, and every tag is grouped ===");
{
  // The index panel itself is the one untagged article, by design.
  check("all but the chooser carry data-report", panels.length - tagged.length, 1);
  check("...and the exception is the chooser",
    panels.some((a) => /id="reportsIndex"/.test(a) && !/data-report=/.test(a)), true);
  const groups = tagged.map((a) => a.match(/data-report-group="([a-z]+)"/)?.[1]);
  check("every tagged panel names a group", groups.filter(Boolean).length, groups.length);
  const known = ["money", "sales", "stock", "buying", "ai"];
  check("...and every group is one the menu renders",
    [...new Set(groups)].filter((g) => !known.includes(g)), []);
  // A group order that omitted a group in use would hide those reports
  // entirely: renderReportsIndex() iterates REPORT_GROUP_ORDER, not the map's
  // own keys, so a group missing from the order is a group nobody can reach.
  const order = src.match(/const REPORT_GROUP_ORDER = \[([^\]]+)\]/)[1]
    .split(",").map((part) => part.trim().replace(/"/g, ""));
  check("the render order covers every group in use",
    [...new Set(groups)].filter((g) => !order.includes(g)), []);
  const keys = tagged.map((a) => a.match(/data-report="([A-Za-z]+)"/)?.[1]);
  check("no two panels claim the same key", keys.length, new Set(keys).size);
}

console.log("\n=== the menu is built from the panels, not from a second list ===");
{
  const fn = src.slice(src.indexOf("function renderReportsIndex"), src.indexOf("function applyReportSelection"));
  check("it reads the panels", /reportPanels\(\)/.test(fn), true);
  check("...and takes each label from the panel's own heading",
    /querySelector\("h2"\)/.test(fn), true);
  // A hard-coded label would drift from the heading and, worse, would not
  // translate -- the headings carry data-i18n and are rewritten in place.
  check("no hard-coded English report names",
    /"(Sales by Product|Stock Valuation|Purchase Summary|Supplier Balances)"/.test(fn), false);
}

console.log("\n=== it narrows the role decision, never widens it ===");
{
  const fn = src.slice(src.indexOf("function applyReportSelection"), src.indexOf("function openReport"));
  // THE assertion. The role's verdict is recorded once, and the visibility a
  // panel ends up with is the OR of "role refused" with "not selected" -- so no
  // path through this function can clear a refusal.
  check("the role's verdict is remembered", /reportHiddenByRole/.test(fn), true);
  check("a refused panel stays hidden whatever is selected",
    /panel\.hidden = refusedByRole \|\| panel\.dataset\.report !== selected/.test(fn), true);
  check("...and nothing in here assigns hidden = false",
    /hidden = false/.test(fn), false);
  // Opening is guarded too, so a stale menu button cannot reach a refused panel.
  const open = src.slice(src.indexOf("function openReport"), src.indexOf("function closeReport"));
  check("opening a refused report is refused",
    /dataset\.reportHiddenByRole === "1"\) return/.test(open), true);
  // And the menu never lists one.
  const idx = src.slice(src.indexOf("function renderReportsIndex"), src.indexOf("function applyReportSelection"));
  check("a refused report is never listed", /reportHiddenByRole === "1"\) continue/.test(idx), true);
}

console.log("\n=== ordering: the narrowing runs after the role gate ===");
{
  // applyReportSelection() reads what renderSpecReports() decided, so it has to
  // run after it. Reversed, every panel would be recorded as role-visible.
  const orch = src.slice(src.indexOf("function renderPaymentReports"));
  const body = orch.slice(0, orch.indexOf("\n}"));
  check("renderSpecReports comes first",
    body.indexOf("renderSpecReports()") !== -1
    && body.indexOf("renderSpecReports()") < body.indexOf("applyReportSelection()"), true);
}

console.log("\n=== Profit is offered here but keeps its own gate ===");
{
  const idx = src.slice(src.indexOf("function renderReportsIndex"), src.indexOf("function applyReportSelection"));
  check("the menu offers Profit", /REPORT_PROFIT_KEY/.test(idx), true);
  // Owner-strict, and asked as the SAME question the view itself asks rather
  // than a fresh role check that could drift from it.
  check("...only when canOpenView says so", /canOpenView\("profit"\)/.test(idx), true);
  const open = src.slice(src.indexOf("function openReport"), src.indexOf("function closeReport"));
  check("choosing it goes through openView, not around it",
    /openView\("profit"\)/.test(open), true);
  check("profit is still owner-strict at the choke point",
    /if \(viewId === "profit"\) return isOwnerRole\(\)/.test(src), true);
  // It is not one of the panels, so this layer cannot hide or show it at all.
  check("profit is not a report panel", /data-report="__profit"/.test(html), false);
}

console.log("\n=== Sold While Offline appears only when it has something to say ===");
{
  const fn = src.slice(src.indexOf("function reportHasContent"), src.indexOf("function renderReportsIndex"));
  // Read from a flag the RENDERER sets, not guessed from the panel's text.
  // Guessing counted the empty state -- "No sales were recorded offline in this
  // period." -- as content, so a permanently empty report was listed every day.
  check("emptiness is read from a flag", /dataset\.reportEmpty !== "1"/.test(fn), true);
  check("...and nothing sniffs the rendered text", /textContent/.test(fn), false);
  // The renderer must actually set it, or the flag is never anything but
  // undefined and the report is listed forever -- the bug, unfixed.
  const renderer = src.slice(src.indexOf("function renderOfflineSalesReport"));
  const rendererBody = renderer.slice(0, renderer.indexOf("\n}"));
  check("the renderer states it",
    /reportEmpty = rows\.length \? "0" : "1"/.test(rendererBody), true);
}

console.log("\n=== the role verdict is recorded, never read back off hidden ===");
{
  // The bug this replaced: applyReportSelection() inferred the role verdict
  // from panel.hidden, then hid every unselected panel -- so its next run read
  // its own output back as "refused by role", and the menu emptied itself down
  // to the one entry that is not a panel. Found by opening the screen.
  const apply = src.slice(src.indexOf("function applyReportSelection"), src.indexOf("function openReport"));
  check("the chooser never writes the verdict",
    /dataset\.reportHiddenByRole =[^=]/.test(apply), false);
  check("...it only reads it", /dataset\.reportHiddenByRole === "1"/.test(apply), true);
  const setter = src.slice(src.indexOf("function setReportRoleVisibility"), src.indexOf("function reportPanels"));
  check("one function records it",
    /dataset\.reportHiddenByRole = hiddenByRole \? "1" : "0"/.test(setter), true);
  // Every gate that decides role visibility must go through it, or a panel it
  // hides is one the chooser believes is allowed.
  check("the spec reports go through it",
    /setReportRoleVisibility\(qs\(id\), hidden\)/.test(src), true);
  check("the VAT panel goes through it",
    /setReportRoleVisibility\(panel, !vatSettings\(\)\.registered\)/.test(src), true);
  check("stock valuation goes through it",
    /setReportRoleVisibility\(panel, !isManagerOrOwnerRole\(\)\)/.test(src), true);
}

console.log("\n=== opening Reports lands on the menu ===");
{
  const open = src.slice(src.indexOf("function openView(viewId)"));
  const body = open.slice(0, open.indexOf("\n}"));
  check("the selection is cleared on entry", /state\.selectedReport = null/.test(body), true);
  check("the menu can be got back to", /id="reportsBackButton"/.test(html), true);
  check("...and it is wired", /reportsBackButton"\)\?\.addEventListener\("click", closeReport\)/.test(src), true);
  // Delegated: the menu is rebuilt whenever roles or content change, so
  // per-button listeners would be re-attached to elements that no longer exist.
  check("the menu's own buttons are delegated",
    /reportsIndexList"\)\?\.addEventListener\("click"/.test(src), true);
}

console.log("\n=== the panels that must not paint before the role check ===");
{
  // Stock Valuation is what the stock COST. It starts hidden in the markup so
  // it cannot flash before renderSpecReports() has run. Asserted without
  // relying on attribute order, which is how the equivalent VAT assertion
  // broke when these panels gained their data-report tags.
  check("Stock Valuation starts hidden",
    /<article[^>]*id="costReportsPanel"[^>]*\shidden[\s>]/.test(html), true);
  check("the VAT panel starts hidden",
    /<article[^>]*id="vatReportPanel"[^>]*\shidden[\s>]/.test(html), true);
}

console.log("\n=== both languages ===");
{
  for (const key of ["reports.chooseTitle", "reports.chooseEyebrow", "reports.backToAll",
                     "reports.group.money", "reports.group.sales", "reports.group.stock",
                     "reports.group.buying", "reports.group.ai", "reports.chooseEmpty"]) {
    const n = (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}":`, "g")) || []).length;
    check(`${key} is in en and sw`, n, 2);
  }
}

console.log("\n=== VAT is off, and off reversibly ===");
{
  check("the flag exists and is false", /const VAT_VIEW_ENABLED = false;/.test(src), true);
  check("the view asks it first",
    /VAT_VIEW_ENABLED && isManagerOrOwnerRole\(\) && vatSettings\(\)\.registered/.test(src), true);
  // Kept beneath the flag rather than deleted, so switching it back on is one
  // constant. The registration gate must survive that.
  check("the registration gate is not deleted", /vatSettings\(\)\.registered/.test(src), true);
  // Nothing stops being RECORDED while the screen is dark, or a shop that
  // switches it on later would find a hole where its history should be.
  check("the sale path still records tax", /vatAmount|outputVat/.test(src), true);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
