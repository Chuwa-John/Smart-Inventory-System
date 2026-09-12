// The navigation bar.
//
//   node nav-structure.test.mjs
//
// The nav was flattened on 2026-09-10 to the order the owner asked for, and two
// things about it are easy to break silently later:
//
//   1. ACCOUNTS IS DORMANT ON PURPOSE. It is the shelf the double-entry books
//      will sit on, and those wait on the s.35(7) data-residency research. It
//      must stay VISIBLE (so the owner can see what is coming) and stay
//      UNCLICKABLE (there is no screen behind it). The dangerous version of
//      this is an item that carries a data-view for a section that does not
//      exist: openView() would then deactivate every view and leave a blank
//      screen with no way back except a reload.
//   2. PROFIT & LOSS MUST NOT BE PARKED BEHIND IT. It is built from the
//      transactions themselves, so it works today, and it keeps its own tab.
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

const results = [];
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const nav = html.slice(html.indexOf('<nav class="nav-list"'), html.indexOf("</nav>", html.indexOf('<nav class="nav-list"')));
const items = [...nav.matchAll(/<button class="nav-item[^"]*"[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);

console.log("=== the order the owner asked for ===");
{
  const views = [...nav.matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]);
  // Profit is absent on purpose: it is opened from the Reports chooser, not
  // from the sidebar. VAT is still in the markup but switched off by
  // VAT_VIEW_ENABLED, so it is never shown.
  check("flat, in order",
    views,
    // `arrivals` is a cashier's own delivery requests (DESIGN-permissions.md 4),
    // sitting where a cashier expects stock to live -- right after Purchases,
    // which is where the same requests are approved. It is hidden for everyone
    // else, by canOpenView() rather than by CSS.
    ["dashboard", "inventory", "purchases", "arrivals", "pos", "services", "expenses",
     "reports", "ai", "vat", "settings"]);
  check("arrivals is cashier-only, and only with the permission",
    /if \(viewId === "arrivals"\) return isCashierWith\("receiveDeliveries"\);/.test(src), true);
  check("...and it ships hidden, so nobody sees it before the role resolves",
    /data-view="arrivals"[^>]*hidden/.test(html), true);
  // Deliveries were folded into Purchases: two destinations answered one
  // question -- "stock arrived, here is what it cost".
  check("deliveries is no longer its own destination", views.includes("deliveries"), false);
  check("...and its panel lives inside Purchases",
    html.indexOf('id="deliveriesPanel"') > html.indexOf('<section class="view" id="purchases">')
    && html.indexOf('id="deliveriesPanel"') < html.indexOf('</section>', html.indexOf('<section class="view" id="purchases">')),
    true);
  // The group that briefly held Purchases, Expenses and Profit behind one
  // toggle is gone; a menu cost a tap and bought nothing.
  check("no dropdown group remains", /nav-group|accountsGroupToggle/.test(html + src), false);
}

console.log("\n=== every nav item points somewhere real ===");
{
  const sections = new Set([...html.matchAll(/<section class="view[^"]*" id="([a-z]+)"/g)].map((m) => m[1]));
  const views = [...new Set([...nav.matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]))];
  check("no item names a section that does not exist",
    views.filter((v) => !sections.has(v)), []);
}

console.log("\n=== Accounts is dormant, and safely so ===");
{
  const accounts = items.find((b) => b.includes('data-nav-placeholder="accounts"'));
  check("the item is present", Boolean(accounts), true);
  // THE important one. With a data-view, openView() would be handed an id no
  // section matches, every view would go inactive, and the screen would be
  // blank.
  check("it carries NO data-view", /data-view=/.test(accounts || ""), false);
  check("it is disabled", /\sdisabled/.test(accounts || ""), true);
  check("...and says so to assistive technology", /aria-disabled="true"/.test(accounts || ""), true);
  check("it is not clickable by CSS either", /\.nav-item-dormant\s*{[^}]*pointer-events:\s*none/.test(css), true);
  // A greyed control with no explanation reads as a fault, and a shop that
  // thinks a tab is broken telephones about it.
  check("it explains itself with a badge", /data-i18n="nav\.soon"/.test(accounts || ""), true);
  check("the badge is in en and sw", (src.match(/"nav\.soon":/g) || []).length, 2);
  check("it is still labelled Accounts", /data-i18n="nav\.accounts"/.test(accounts || ""), true);
}

console.log("\n=== who sees the dormant shelf ===");
{
  // canOpenView() would be asked about `undefined` and fall through to the
  // manager check, putting an empty shelf in front of staff. The placeholder
  // branch has to come FIRST, and has to be owner-strict.
  const fn = src.slice(src.indexOf("function applyRoleViewVisibility"),
                       src.indexOf("function openView"));
  check("the placeholder is handled before the view check",
    fn.indexOf("navPlaceholder") !== -1
    && fn.indexOf("navPlaceholder") < fn.indexOf("canOpenView(item.dataset.view)"), true);
  check("...and only an owner sees it", /navPlaceholder[\s\S]{0,400}?item\.hidden = !isOwnerRole\(\)/.test(fn), true);
  check("...and that branch returns, so the view check cannot undo it",
    /item\.hidden = !isOwnerRole\(\);\s*\n\s*return;/.test(fn), true);
}

console.log("\n=== Profit & Loss is not parked behind it ===");
{
  // It has NO nav item -- it is reached from the Reports chooser, which is
  // where the owner asked for it on 2026-09-10.
  const profit = items.find((b) => b.includes('data-view="profit"'));
  check("it has no nav item of its own", Boolean(profit), false);
  check("...but the view still exists", /<section class="view" id="profit">/.test(html), true);
  check("...and it can be got back out of", /id="profitBackButton"/.test(html), true);
  // Owner-strict, decided 2026-08-21: it exposes buying prices by inference.
  check("still owner-strict", /if \(viewId === "profit"\) return isOwnerRole\(\)/.test(src), true);
  // The four statements this system cannot yet produce are NAMED rather than
  // faked, and sit beside the statement that does work.
  const p0 = html.indexOf('<section class="view" id="profit">');
  const p1 = html.indexOf("\n        </section>", p0);
  const panel = html.indexOf('id="ledgerPendingPanel"');
  check("the disclosure sits with the statement that does work", p0 < panel && panel < p1, true);
  check("...and it says where the four will appear",
    /They will appear under Accounts/.test(html), true);
  check("...in both languages",
    (src.match(/They will appear under Accounts/g) || []).length === 1
    && (src.match(/Zitaonekana chini ya Hesabu/g) || []).length === 1, true);
}

console.log("\n=== Inventory no longer asks for a cost ===");
{
  // Inventory records what is already on the shelf; cost belongs to Purchases,
  // where a delivery states what was paid and freight is spread across lines.
  const fn = src.slice(src.indexOf("function renderProductCostFields"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  check("the cost fields are always hidden",
    /fields\.hidden = true/.test(body) && /receiptFields\.hidden = true/.test(body), true);
  check("...with no role or edit condition left to flip",
    /hidden = isEdit/.test(body), false);
  check("and the screen says where cost lives now",
    /data-i18n="inventory\.intro"/.test(html), true);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
