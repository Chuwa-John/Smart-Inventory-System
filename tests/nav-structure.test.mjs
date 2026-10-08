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
    // `customers` was added on 2026-09-13 with the invoicing work. The owner
    // asked for a screen of its own (DESIGN-invoicing.md 8): until then a
    // customer existed only as a name and a phone typed at the till, with
    // nowhere to edit it. It sits with selling -- after the till and the
    // services it sells, before what the shop spends -- and is manager/owner
    // only, by canOpenView() falling through to the manager check.
    // `invoices` joined it on the same day, straight after Customers: an
    // invoice is raised FOR a customer, so the two sit together. Manager and
    // owner, plus a cashier holding `issueInvoices` -- canOpenView() has an
    // explicit branch for it rather than falling through to the manager check.
    // REGROUPED 2026-10-08, reversing the 2026-09-10 flattening. That decision
    // was right for eight screens and wrong for fourteen: a shopkeeper looking
    // for the till read past nine other things to find it. Grouped, not
    // removed -- every screen is one tap further in and none was renamed.
    // Selling first, because that is what the app is for.
    ["dashboard", "pos", "services", "customers", "invoices",
     "inventory", "purchases", "arrivals",
     "reports", "expenses", "vat",
     "ai", "settings"]);
  check("five top-level entries, not fourteen",
    (nav.match(/data-nav-group="/g) || []).length + 1, 5);
  check("...and every screen is still reachable inside one",
    [...nav.matchAll(/data-view="([a-z]+)"/g)].length, 13);
  check("arrivals is cashier-only, and only with the permission",
    /if \(viewId === "arrivals"\) return isCashierWith\("receiveDeliveries"\);/.test(src), true);
  check("...and it ships hidden, so nobody sees it before the role resolves",
    /data-view="arrivals"[^>]*hidden/.test(html), true);
  // Deliveries were folded into Purchases: two destinations answered one
  // question -- "stock arrived, here is what it cost".
  check("deliveries is no longer its own destination", views.includes("deliveries"), false);
  // VAT is switched off by VAT_VIEW_ENABLED, and BOTH the gate and the nav item
  // must honour it. They disagreed on the live site: canOpenView() refused the
  // view while renderVatNav() still showed the tab for a VAT-registered
  // business, so the item was visible and clicking it did nothing.
  check("the VAT tab is hidden whenever the view is switched off",
    /item\.hidden = !VAT_VIEW_ENABLED \|\| !vatSettings\(\)\.registered/.test(src), true);
  check("...and the gate refuses it on the same flag",
    /if \(viewId === "vat"\) return VAT_VIEW_ENABLED &&/.test(src), true);
  check("...and its panel lives inside Purchases",
    html.indexOf('id="deliveriesPanel"') > html.indexOf('<section class="view" id="purchases">')
    && html.indexOf('id="deliveriesPanel"') < html.indexOf('</section>', html.indexOf('<section class="view" id="purchases">')),
    true);
  // The 2026-09-10 flattening removed a scripted accordion that held Purchases,
  // Expenses and Profit. What replaced it on 2026-10-08 is not that: these are
  // native <details>, so the open state, the keyboard handling and the screen
  // reader behaviour are the browser's rather than ours.
  check("the old scripted accordion stays gone", /accountsGroupToggle/.test(html + src), false);
  check("the groups are native details", /<details class="nav-group"/.test(html), true);

  // A GROUP WITH NOTHING IN IT MUST HIDE ITSELF, or a cashier with no money
  // permissions sees a Money shelf that opens onto nothing -- which reads as
  // the app being broken rather than as a permission they do not have.
  check("an empty group hides itself",
    /group\.hidden = items\.length > 0 && items\.every\(\(item\) => item\.hidden\)/.test(src), true);
  check("...and the items still gate themselves one by one",
    /item\.hidden = !canOpenView\(item\.dataset\.view\)/.test(src), true);
  check("the group holding the open screen opens with it",
    /activeGroup\.open = true/.test(src), true);

  // A cashier lands on the till: ringing up sales is the whole of the job, and
  // the dashboard is a screen they can read and not act on.
  check("a cashier lands on the till", /!isManagerOrOwnerRole\(\) && canOpenView\("pos"\)/.test(src), true);
  check("...once per session, not every render", /state\.landedOnRoleHome = true/.test(src), true);
  check("...and only from the screen it booted to",
    /qs\("\.view\.active"\)\?\.id === "dashboard"/.test(src), true);
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
  // The panel naming the four statements this system cannot yet produce was
  // removed on 2026-10-07, to return with the Accounts work. Its strings went
  // with it: a dictionary entry nothing renders is a string that drifts out of
  // date unread, and i18n-dictionary.test.mjs would keep demanding a Swahili
  // translation for a panel nobody can see.
  check("the ledger-pending strings went with the panel",
    /ledgerPending/.test(src), false);
  check("...and so did its markup", /ledgerPending/.test(html), false);
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

console.log("\n=== every screen says which branch it is showing ===");
{
  // The asymmetry this guards is real and deliberate: the owner control tiles
  // are NOT scoped by the switcher and say "All stores" on their face, while
  // every report IS scoped to it. Unlabelled, the same month reads 829,500 on
  // one screen and 8,329,500 on the other, which looks like an error rather
  // than two different questions. Observed on 2026-09-28.
  check("the reports screen has a scope line", /id="reportsScope"/.test(html), true);
  check("the profit report has one too", /id="profitScope"/.test(html), true);
  check("the owner tiles still declare themselves all-stores",
    /data-i18n="control.allStoresScope"/.test(html), true);

  // One helper, because three surfaces were each spelling the lookup out and a
  // fourth was about to. A copy that drifts is how two screens start naming
  // the same branch differently.
  check("the branch name comes from one helper",
    /function currentStoreLabel\(\)/.test(src), true);
  const uses = (src.match(/currentStoreLabel\(\)/g) || []).length;
  check("...used by the reports screen, the profit report and the tiles",
    uses >= 4, true);
  check("...and nothing looks the store name up by hand any more",
    !/\?\.name \|\| t\("storeSwitcher\.fallbackName"\)\)\s*\n\s*: t\("staff\.allStoresLabel"\)/.test(src), true);

  // Set during the normal render, so switching branch updates it. Setting it
  // in openReport() alone would leave the chooser unlabelled and would go
  // stale the moment somebody changed branch with a report already open.
  check("the reports label is set on render, not only when a report opens",
    /function renderSpecReports\(\)[\s\S]{0,400}reportsScope/.test(src), true);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
