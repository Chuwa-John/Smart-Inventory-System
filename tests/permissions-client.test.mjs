// Cashier permissions, on the client side -- DESIGN-permissions.md.
//
//   node permissions-client.test.mjs
//
// rules-permissions.test.mjs proves the boundary. This proves the three things
// the boundary cannot:
//
//   1. The key list is the SAME in app.js, proxy/server.js and firestore.rules.
//      A key the screen offers and the rules never read is a promise to an
//      owner that nothing keeps -- they tick it, the cashier still cannot do
//      the thing, and nothing anywhere says why.
//   2. An absent map means today's behaviour. This ships to shops that are
//      already selling; a default read the wrong way would withdraw credit from
//      every cashier in the country at once.
//   3. The screens follow the permissions -- canOpenView() above all, because
//      it is the choke point the command palette and every stale handler pass
//      through.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../proxy/server.js", import.meta.url), "utf8");
const design = readFileSync(new URL("../DESIGN-permissions.md", import.meta.url), "utf8");

const results = [];
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function extract(name) {
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  if (start === -1) throw new Error(`${name} not found`);
  let i = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

// The real object literal out of app.js, not a copy of it.
const defaultsSource = src.slice(src.indexOf("const STAFF_PERMISSION_DEFAULTS = {"));
const STAFF_PERMISSION_DEFAULTS = new Function(
  `${defaultsSource.slice(0, defaultsSource.indexOf("};") + 2)} return STAFF_PERMISSION_DEFAULTS;`)();
const KEYS = Object.keys(STAFF_PERMISSION_DEFAULTS);

console.log("=== one list of keys, in all four places ===");
{
  // The proxy decides what may be stored; the rules decide what is enforced;
  // app.js decides what is offered. Any disagreement is a permission that
  // silently does nothing.
  const proxyKeys = (proxy.match(/const STAFF_PERMISSION_KEYS = \[([\s\S]*?)\]/) || [])[1] || "";
  const proxyList = [...proxyKeys.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]).sort();
  check("the proxy stores exactly the keys app.js offers", proxyList, [...KEYS].sort());

  // Every key is named in the design table, so the document cannot drift from
  // the code that implements it.
  check("every key is documented", KEYS.filter((key) => !design.includes(`\`${key}\``)), []);

  // And every key has both a label and an explanation, in both languages: a
  // tick box with no words is not a permission an owner can reason about.
  for (const key of KEYS) {
    check(`${key} has a label and a hint, in en and sw`,
      [(src.match(new RegExp(`"permissions\\.${key}":`, "g")) || []).length,
       (src.match(new RegExp(`"permissions\\.${key}Hint":`, "g")) || []).length],
      [2, 2]);
  }
}

console.log("\n=== what the rules enforce, and what they deliberately do not ===");
{
  // These five are refused server-side. If one ever stops appearing in the
  // rules, the screen is the only thing standing between a cashier and the
  // write -- which is not a boundary at all.
  for (const key of ["recordExpenses", "receiveDeliveries", "processReturns", "sellOnCredit", "takeRepayments"]) {
    check(`${key} is enforced in firestore.rules`, rules.includes(`'${key}'`), true);
  }
  // These three are screen-level only, and DESIGN-permissions.md §5 says why:
  // a sale's per-line prices are not visible to the rules, and refusing a
  // discount at replay time would discard a completed offline sale. If someone
  // later enforces them, this test should be updated deliberately rather than
  // quietly.
  for (const key of ["viewStock", "viewTodaySales", "giveDiscounts"]) {
    check(`${key} is not claimed as enforced`, rules.includes(`'${key}'`), false);
  }
  // The premise that makes refusing a credit sale safe: credit never queues
  // offline, so no queued sale can be rejected hours later on replay.
  check("a credit sale is still refused offline, which is why the rule is safe",
    /isOfflineNow\(\) && paymentMethod !== "cash"/.test(src), true);
}

console.log("\n=== an absent map means exactly today's behaviour ===");
{
  check("the three every cashier has today are on by default",
    [STAFF_PERMISSION_DEFAULTS.sellOnCredit, STAFF_PERMISSION_DEFAULTS.takeRepayments,
     STAFF_PERMISSION_DEFAULTS.giveDiscounts], [true, true, true]);
  check("and everything that grants something new is off",
    KEYS.filter((key) => STAFF_PERMISSION_DEFAULTS[key]).sort(),
    ["giveDiscounts", "sellOnCredit", "takeRepayments"]);

  const normalize = new Function("STAFF_PERMISSION_KEYS", "STAFF_PERMISSION_DEFAULTS", `
    ${extract("normalizeStaffPermissions")}
    return normalizeStaffPermissions;`)(KEYS, STAFF_PERMISSION_DEFAULTS);

  check("no map at all gives the defaults", normalize(undefined), STAFF_PERMISSION_DEFAULTS);
  check("an empty map gives the defaults", normalize({}), STAFF_PERMISSION_DEFAULTS);
  check("a key the app does not know is dropped",
    Object.keys(normalize({ deleteEverything: true })).sort(), [...KEYS].sort());
  check("a non-boolean value falls back to the default rather than being trusted",
    normalize({ sellOnCredit: "no" }).sellOnCredit, true);
  check("and a real withdrawal is kept", normalize({ sellOnCredit: false }).sellOnCredit, false);
}

console.log("\n=== hasStaffPermission: managers hold everything, cashiers hold what they were given ===");
{
  const make = (role, permissions) => new Function(
    "state", "isManagerOrOwnerRole", "STAFF_PERMISSION_DEFAULTS", `
      ${extract("hasStaffPermission")}
      ${extract("isCashierWith")}
      return { hasStaffPermission, isCashierWith };`)(
    { currentUserRole: role, currentPermissions: permissions },
    () => role === "owner" || role === "manager",
    STAFF_PERMISSION_DEFAULTS);

  const owner = make("owner", {});
  const manager = make("manager", { sellOnCredit: false, recordExpenses: false });
  const plain = make("cashier", {});
  const granted = make("cashier", { recordExpenses: true });
  const strict = make("cashier", { sellOnCredit: false });
  const signedOut = make(null, {});

  check("an owner holds every key", KEYS.filter((key) => !owner.hasStaffPermission(key)), []);
  check("a manager holds every key, whatever the map says",
    KEYS.filter((key) => !manager.hasStaffPermission(key)), []);
  check("a cashier with no map keeps credit, repayments and discounts",
    [plain.hasStaffPermission("sellOnCredit"), plain.hasStaffPermission("takeRepayments"),
     plain.hasStaffPermission("giveDiscounts")], [true, true, true]);
  check("...and is granted nothing else",
    [plain.hasStaffPermission("recordExpenses"), plain.hasStaffPermission("receiveDeliveries"),
     plain.hasStaffPermission("processReturns"), plain.hasStaffPermission("viewStock"),
     plain.hasStaffPermission("viewTodaySales")], [false, false, false, false, false]);
  check("a granted key is held", granted.hasStaffPermission("recordExpenses"), true);
  check("a withdrawn key is not", strict.hasStaffPermission("sellOnCredit"), false);
  // Before the role resolves, state.currentUserRole is null. Nothing is held.
  check("no role yet holds nothing", KEYS.filter((key) => signedOut.hasStaffPermission(key)), []);
  // isCashierWith() exists so a manager is never sent to the cut-down screens.
  check("isCashierWith is false for a manager", manager.isCashierWith("recordExpenses"), false);
  check("...and true for a granted cashier", granted.isCashierWith("recordExpenses"), true);
}

console.log("\n=== canOpenView follows the permissions ===");
{
  const viewsFor = (role, permissions) => {
    const api = new Function("state", "isManagerOrOwnerRole", "isOwnerRole", "STAFF_PERMISSION_DEFAULTS",
      "CASHIER_ALLOWED_VIEWS", "VAT_VIEW_ENABLED", "storeSellsServices", "vatSettings", `
        ${extract("hasStaffPermission")}
        ${extract("isCashierWith")}
        ${extract("canOpenView")}
        return canOpenView;`)(
      { currentUserRole: role, currentPermissions: permissions },
      () => role === "owner" || role === "manager",
      () => role === "owner",
      STAFF_PERMISSION_DEFAULTS,
      ["pos", "settings"], false, () => false, () => ({ registered: false }));
    return ["dashboard", "inventory", "purchases", "arrivals", "pos", "expenses", "reports", "ai", "profit", "settings"]
      .filter((view) => api(view));
  };

  check("a cashier with no permissions reaches the till and settings only",
    viewsFor("cashier", {}), ["pos", "settings"]);
  check("viewStock opens Inventory and nothing else",
    viewsFor("cashier", { viewStock: true }), ["inventory", "pos", "settings"]);
  check("recordExpenses opens Expenses and nothing else",
    viewsFor("cashier", { recordExpenses: true }), ["pos", "expenses", "settings"]);
  check("receiveDeliveries opens Deliveries and nothing else",
    viewsFor("cashier", { receiveDeliveries: true }), ["arrivals", "pos", "settings"]);
  // The screens that carry cost, profit or the whole business stay shut whatever
  // is ticked -- there is no permission that opens them.
  const everything = Object.fromEntries(KEYS.map((key) => [key, true]));
  check("no permission opens Purchases, Reports, the dashboard, AI or Profit",
    viewsFor("cashier", everything).filter((view) =>
      ["purchases", "reports", "dashboard", "ai", "profit"].includes(view)), []);
  check("a manager keeps everything except Profit",
    viewsFor("manager", {}),
    ["dashboard", "inventory", "purchases", "pos", "expenses", "reports", "ai", "settings"]);
  // Arrivals is the cashier's own request list. A manager approves from
  // Purchases instead, so it must not appear for them.
  check("...and never the cashier's own arrivals screen",
    viewsFor("manager", {}).includes("arrivals"), false);
  check("the owner reaches Profit", viewsFor("owner", {}).includes("profit"), true);
}

console.log("\n=== a change reaches an open till, and the screens honour it ===");
{
  const watcher = src.slice(src.indexOf("function subscribeToOwnMembership("));
  const body = watcher.slice(0, watcher.indexOf("\nasync function handleMembershipEnded"));
  check("the membership watcher reads the permissions", /normalizeStaffPermissions\(data\.permissions\)/.test(body), true);
  check("...and re-renders when they change, not only when the role does",
    /permissionsChanged/.test(body) && /nextRole !== state\.currentUserRole \|\| permissionsChanged/.test(body), true);
  check("...and a listener error falls back to the defaults, never to everything",
    /state\.currentPermissions = normalizeStaffPermissions\(null\);/.test(body), true);

  // The static controls a permission governs.
  const visibility = extract("applyPermissionVisibility");
  for (const [selector, key] of [["#posReturnButton", "processReturns"], ["#posTodayPanel", "viewTodaySales"],
                                 [".discount-controls", "giveDiscounts"], ['[data-payment="credit"]', "sellOnCredit"]]) {
    check(`${selector} follows ${key}`,
      visibility.includes(selector) && visibility.includes(`"${key}"`), true);
  }
  check("credit stops being the selected method once it is withdrawn",
    /state\.paymentMethod = "cash";/.test(visibility), true);
  check("applyPermissionVisibility runs on every render",
    /applyRoleViewVisibility\(\);\s*applyPermissionVisibility\(\);/.test(src), true);

  // The write paths refuse as well as hide: hiding alone leaves a stale handler
  // and the command palette.
  check("selling on credit is refused in completeSale, not only hidden",
    /if \(!hasStaffPermission\("sellOnCredit"\)\) \{\s*\n\s*showToast/.test(src), true);
  check("a return dialog refuses without the permission",
    /if \(!hasStaffPermission\("processReturns"\)\) return;/.test(extract("openReturnDialog")), true);
  check("a repayment dialog refuses without the permission",
    /if \(!hasStaffPermission\("takeRepayments"\)\) return;/.test(extract("openRecordPaymentDialog")), true);
  check("a discount refuses without the permission",
    /if \(!hasStaffPermission\("giveDiscounts"\)\) return;/.test(extract("applyDiscount")), true);
}

console.log("\n=== the cashier's expense screen is not the expense book ===");
{
  const render = extract("renderExpenses");
  check("their own entries carry no totals", /if \(ownEntriesOnly\) \{\s*\n\s*totals\.innerHTML = "";/.test(render), true);
  check("...and no landed-cost panel", /landedPanel\.hidden = true;/.test(render), true);
  const subscribe = extract("subscribeToExpenses");
  check("the subscription asks only for their own rows",
    /where\("recordedByUid", "==", state\.user\.uid\)/.test(subscribe), true);
  check("...and is refused entirely without the permission",
    /ownEntriesOnly && !isCashierWith\("recordExpenses"\)/.test(subscribe), true);
}

console.log("\n=== a delivery request cannot become stock on its own ===");
{
  const receive = extract("receiveDelivery");
  check("the request is read inside the transaction", /transaction\.get\(requestRef\)/.test(receive), true);
  check("...and refused unless it is still pending",
    /requestSnap\.data\(\)\.status !== "pending"/.test(receive), true);
  check("...and approved in the same commit as the delivery",
    /transaction\.update\(requestRef, \{\s*\n\s*status: "approved"/.test(receive), true);
  // The rules require the same pairing from the other side.
  check("the rules refuse an approval whose delivery did not land with it",
    /existsAfter\(\/databases\/\$\(database\)\/documents\/users\/\$\(userId\)\/deliveries\//.test(rules), true);
  check("a cashier's request screen exists in the markup",
    /<section class="view" id="arrivals">/.test(html), true);
  check("the cashier's dialog asks for no unit costs",
    /name="goodsCost"/.test(html.slice(html.indexOf('id="deliveryRequestForm"'),
      html.indexOf("</dialog>", html.indexOf('id="deliveryRequestForm"')))), false);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(failed.map((f) => "  FAILED: " + f.name).join("\n"));
  process.exit(1);
}
