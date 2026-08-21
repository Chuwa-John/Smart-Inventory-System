// Phase B of DESIGN-services.md: a service can be sold, and selling one does
// not touch stock.
//
//   node services-sale-path.test.mjs
//
// The load-bearing assertion in this file is the first one. Before Phase B,
// completeSale()'s transaction mapped EVERY cart line to products/{id} and
// threw txerror.itemGone on the first one that did not exist. A service has no
// product document, so a bar ringing up a plate of food beside a bottled beer
// did not lose the food line -- it lost the whole sale, beer included. That is
// the first sale this feature would ever have processed.
//
// The rest guards the arithmetic staying identical. A service line reaches
// revenue, VAT and payment-method totals through exactly the same fields a
// product line does (lineTotal, total), so nothing downstream of the sale
// record needed changing -- and that is only true while the sale document keeps
// its shape.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let depth = 0, i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const handlerStart = noComments.indexOf('qs("#completeSaleButton").addEventListener');
const handler = noComments.slice(handlerStart, handlerStart + 16000);

console.log("=== the transaction only reaches for documents that exist ===");
{
  check("stock lines are filtered out of the cart before any product ref",
    /const stockCart = cart\.filter\(\(cartItem\) => !isServiceLine\(cartItem\)\);/.test(handler),
    "an unfiltered map builds products/undefined and throws itemGone for the whole sale");
  check("the product refs are built from the filtered list",
    /const productRefs = stockCart\.map\(/.test(handler));
  check("no product ref is built from the unfiltered cart",
    !/const productRefs = cart\.map\(/.test(handler),
    "this is the exact line that failed a mixed basket");

  // The subtle half. productSnaps is index-aligned with productRefs, which is
  // now stockCart -- reading cart[index] there would pair a snapshot with the
  // wrong line the moment a service sits earlier in the basket, decrementing
  // the wrong product by the wrong amount.
  const txStart = handler.indexOf("const stockCart = cart.filter");
  const txEnd = handler.indexOf("const auditRef", txStart);
  const txBody = handler.slice(txStart, txEnd > txStart ? txEnd : txStart + 3000);
  check("snapshot loops index the filtered list, not the cart",
    (txBody.match(/stockCart\[index\]/g) || []).length >= 2 && !/\bcart\[index\]/.test(txBody),
    "productSnaps is aligned with stockCart; cart[index] would pair the wrong line");
}

console.log("\n=== and the filtered list stays paired with its snapshots ===");
{
  // The quiet half of the same change, run rather than read. productSnaps is
  // built from productRefs, which is built from stockCart -- so the loops must
  // index stockCart. With a service FIRST in the basket, indexing `cart`
  // instead pairs each snapshot with the line after the one it belongs to:
  // no error, no rejection, just the wrong product decremented by the wrong
  // amount. That is the failure this alignment prevents, and it is invisible.
  const isServiceLine = new Function(`${extract("isServiceLine")} return isServiceLine;`)();

  const cart = [
    { id: "svc1", kind: "service", name: "Braiding", qty: 1 },
    { id: "p1", kind: "product", name: "Beer", qty: 3 },
    { id: "svc2", kind: "service", name: "Chips", qty: 2 },
    { id: "p2", kind: "product", name: "Soda", qty: 5 }
  ];
  const stockCart = cart.filter((cartItem) => !isServiceLine(cartItem));

  check("only stock lines reach the product refs",
    stockCart.map((c) => c.id).join(",") === "p1,p2");
  check("no service id is ever used to build a product path",
    !stockCart.some((c) => isServiceLine(c)),
    "products/svc1 does not exist and would throw itemGone for the whole sale");

  // Each snapshot stands for stockCart[i]; pairing by index must name the same
  // line and the same quantity.
  const snapshots = stockCart.map((c) => ({ id: c.id, onShelf: 10 }));
  const decrements = snapshots.map((snap, index) => {
    const cartItem = stockCart[index];
    return { product: cartItem.id, by: cartItem.qty, snapshotWas: snap.id };
  });
  check("every decrement names the product its snapshot came from",
    decrements.every((d) => d.product === d.snapshotWas));
  check("Beer is decremented by 3 and Soda by 5",
    JSON.stringify(decrements.map((d) => `${d.product}:${d.by}`)) === JSON.stringify(["p1:3", "p2:5"]));

  // The control: what indexing the unfiltered cart would have produced.
  const wrong = snapshots.map((snap, index) => `${cart[index].id}:${cart[index].qty}`);
  check("indexing the unfiltered cart would have decremented the wrong lines",
    JSON.stringify(wrong) === JSON.stringify(["svc1:1", "p1:3"]),
    "it would try products/svc1 and short Beer -- silently, with no error raised");
}

console.log("\n=== every sale line says what it is ===");
{
  check("kind is written on every item, not just services",
    /kind: isServiceLine\(cartItem\) \? "service" : "product"/.test(handler),
    "an absent discriminator is read correctly only by luck");
  check("a service line carries serviceId",
    /\{ serviceId: cartItem\.id \}/.test(handler));
  check("a service line does NOT carry productId",
    /\? \{ serviceId: cartItem\.id \}\s*:\s*\{ productId: cartItem\.id \}/.test(handler),
    "productId: null would build the path products/null instead of failing loudly");

  // No migration, and no historical sale reinterpreted.
  const helper = new Function(`${extract("isServiceLine")} return isServiceLine;`)();
  check("a line with no kind is treated as a product", helper({ productId: "p1" }) === false);
  check("a service line is recognised", helper({ kind: "service" }) === true);
  check("an explicit product line is recognised", helper({ kind: "product" }) === false);
  check("a null line does not throw", helper(null) === false);
}

console.log("\n=== a service has no shelf, anywhere it could be mistaken for one ===");
{
  check("the cart quantity input has no max for a service",
    /const maxQty = isServiceLine\(item\) \? "" : \(product \? product\.quantity : item\.qty\);/.test(noComments),
    "falling back to the current qty pins the input at 1 and blocks a second helping");
  check("the max attribute is omitted rather than emitted empty",
    /\$\{maxQty === "" \? "" : `max="\$\{maxQty\}"`\}/.test(noComments));
  check("the + button skips the stock ceiling for a service",
    /if \(isServiceLine\(cartItem\)\) \{[\s\S]{0,200}cartItem\.qty \+= 1;/.test(noComments));
  check("the typed quantity skips the stock ceiling for a service",
    /if \(isServiceLine\(cartItem\)\) \{[\s\S]{0,260}cartItem\.qty = Math\.max\(1, Math\.floor/.test(noComments));

  // The + button and the qty input both used a `cartItem && product` guard.
  // For a service `product` is undefined, so without the branch they did
  // nothing at all and the control looked broken rather than refused.
  check("both guards are reached before the product lookup",
    noComments.indexOf("isServiceLine(cartItem)") <
      noComments.indexOf("const product = state.products.find((item) => item.id === increaseButton.dataset.increaseCart)"),
    "the service branch has to come first or the joint guard swallows it");
}

console.log("\n=== the 40-line cap applies to services too ===");
{
  // firestore.rules caps sale.items at 40. A 41st line is a sale the server
  // refuses after the cashier has already taken the money.
  const fn = noComments.slice(noComments.indexOf("function addServiceToCartById("));
  const body = fn.slice(0, fn.indexOf("\nfunction "));
  check("adding a service respects the cart limit",
    /state\.cart\.length >= 40/.test(body) && /toast\.cartLimitReached/.test(body));
  check("adding a service is refused across all stores",
    /state\.currentStoreId === "all"/.test(body) && /toast\.selectStoreToSell/.test(body));
  check("a withdrawn or unknown service is refused",
    /toast\.serviceUnavailable/.test(body));
  check("it reads the scoped list, not the raw state",
    /storeServices\(\)\.find/.test(body),
    "storeServices() applies store scope and drops inactive items");
}

console.log("\n=== only the two business types that asked for it see any of this ===");
{
  const scoped = new Function("state", "currentBusinessType",
    `const SERVICE_BUSINESS_TYPES = ["salon", "bar"];
     ${extract("storeSellsServices")}
     ${extract("storeServices")}
     return { storeSellsServices, storeServices };`
  );
  const run = (type, services, currentStoreId = "storeA") =>
    scoped({ db: {}, services, currentStoreId }, () => type);

  for (const type of ["salon", "bar"]) {
    check(`${type} sells services`, run(type, []).storeSellsServices() === true);
  }
  for (const type of ["duka", "hardware", "pharmacy", "general"]) {
    check(`${type} does not`, run(type, []).storeSellsServices() === false);
  }
  check("a non-service business gets an empty list even if documents exist",
    run("duka", [{ id: "s1", storeId: "storeA", active: true }]).storeServices().length === 0,
    "belt and braces: the gating is not only in the renderer");

  const rows = [
    { id: "s1", storeId: "storeA", active: true },
    { id: "s2", storeId: "storeB", active: true },
    { id: "s3", storeId: "storeA", active: false }
  ];
  check("another branch's menu is not offered",
    run("salon", rows).storeServices().map((s) => s.id).join(",") === "s1");
  check("a withdrawn service is not offered",
    !run("salon", rows).storeServices().some((s) => s.id === "s3"),
    "deactivated rather than deleted, because sales already reference it");
  check("all-stores shows every branch's active services",
    run("salon", rows, "all").storeServices().map((s) => s.id).join(",") === "s1,s2");
  check("no store selected offers nothing",
    run("salon", rows, "").storeServices().length === 0);
}

console.log("\n=== the till panel and the label ===");
{
  check("the POS has a services section", /id="posServices"/.test(html));
  check("it is hidden in the markup by default", /<div id="posServices" hidden>/.test(html),
    "a duka must never see it, including in the moment before the first render");
  check("the heading is swapped by business type",
    /return currentBusinessType\(\) === "bar" \? "services\.menuTitle" : "services\.title";/.test(noComments));
  check("the panel is hidden for a non-service business at render time",
    /panel\.hidden = !storeSellsServices\(\);/.test(noComments));
  for (const key of ["services.title", "services.menuTitle", "services.posEmpty", "toast.serviceUnavailable"]) {
    check(`${key} exists in both languages`,
      (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length >= 3);
  }
}

console.log("\n=== the subscription is scoped like every other one ===");
{
  const fn = noComments.slice(noComments.indexOf("async function subscribeToServices("));
  const body = fn.slice(0, fn.indexOf("\nasync function "));
  check("it scopes by the member's stores", /where\("storeId", "in", queryStoreIds\)/.test(body));
  check("a member with no store access subscribes to nothing",
    /queryStoreIds !== null && queryStoreIds\.length === 0/.test(body),
    "Firestore rejects an empty `in` filter outright");
  check("it repaints through the once-per-frame path", /scheduleRenderAll\(\);/.test(body));
  check("it starts with the other subscriptions",
    /subscribeToTransfers\(\);\s*subscribeToServices\(\);/.test(noComments));
  check("it is torn down on sign-out",
    /state\.unsubscribeServices = null;\s*state\.services = \[\];/.test(noComments),
    "the next business on this device must not inherit the last one's menu");
}

console.log("\n=== Phase C: a service cannot be returned, and says why ===");
{
  // The decision, not a limitation (DESIGN-services.md §6). "Return three of
  // the ten screws" is a shelf movement; "return one haircut" is not, and what
  // the customer is owed there is a refund or a void, both of which exist.
  const fn = noComments.slice(noComments.indexOf("function saleReturnableItems("));
  const body = fn.slice(0, fn.indexOf("\nfunction "));
  check("service lines are dropped before a manager can pick one",
    /\.filter\(\(item\) => !isServiceLine\(item\)\)/.test(body),
    "tolerating one and skipping it later refunds a service with nothing recorded against it");

  // One choke point, deliberately. The dialog and the transaction both read
  // this, and filtering at only one of them is the bug it exists to prevent.
  const dialog = noComments.slice(noComments.indexOf("function openReturnDialog("));
  const dialogBody = dialog.slice(0, dialog.indexOf("\nasync function "));
  const confirm = noComments.slice(noComments.indexOf("async function confirmProcessReturn("));
  const confirmBody = confirm.slice(0, confirm.indexOf("\nasync function "));
  check("the dialog reads the filtered list", /saleReturnableItems\(sale\)/.test(dialogBody));
  check("the transaction reads the same filtered list", /saleReturnableItems\(sale\)/.test(confirmBody));

  // The invariant the return transaction rests on. It has no filter of its own
  // because `selections` cannot contain a service; if that ever stops being
  // true this line builds products/undefined again.
  check("selections are built only from the filtered list",
    /returnableItems\.find\(\(entry\) => entry\.productId === input\.dataset\.returnItem\)/.test(confirmBody) &&
    /const productRefs = selections\.map\(/.test(confirmBody),
    "the transaction is safe only because nothing upstream can hand it a service");

  // An empty list has two different causes and they must not share a sentence.
  check("a services-only sale is not told its goods were already returned",
    /\(sale\.items \|\| \[\]\)\.some\(\(item\) => !isServiceLine\(item\)\)\s*\?\s*"returns\.noItemsSelected"\s*:\s*"returns\.servicesNotReturnable"/.test(noComments),
    "nothing was returned and nothing can be -- the old message is simply false there");
  check("returns.servicesNotReturnable exists in both languages",
    (src.match(/"returns\.servicesNotReturnable"/g) || []).length >= 3);
}

console.log("\n=== Phase C: a void still voids the whole sale ===");
{
  const fn = noComments.slice(noComments.indexOf("async function undoLastSale("));
  const body = fn.slice(0, fn.indexOf("\nfunction "));

  check("stock lines are filtered before any product ref",
    /const stockItems = \(sale\.items \|\| \[\]\)\.filter\(\(item\) => !isServiceLine\(item\)\);/.test(body));
  check("the refs are built from the filtered list",
    /const productRefs = stockItems\.map\(/.test(body) && !/productRefs = sale\.items\.map\(/.test(body));
  // The half that was already wrong before services existed: productSnaps is
  // aligned with productRefs, so indexing sale.items pairs a snapshot with the
  // following line as soon as a service sits earlier in the basket.
  check("the snapshot loop indexes the filtered list",
    /const item = stockItems\[index\];/.test(body) && !/const item = sale\.items\[index\];/.test(body),
    "sale.items[index] restores the wrong quantity to the wrong shelf, silently");
  // The sale document is what makes a void a void; a service needs no undoing.
  check("the sale is still marked voided as a whole",
    /transaction\.update\(saleRef, \{ voided: true/.test(body));
}

console.log("\n=== Phase D: the offline queue, which is the one that fails silently ===");
{
  const fn = noComments.slice(noComments.indexOf("function queueOfflineSale("));
  const body = fn.slice(0, fn.indexOf("\nfunction ", 10));

  check("service lines are skipped before the product update",
    /for \(const item of args\.items\) \{\s*if \(isServiceLine\(item\)\) continue;/.test(body),
    "update() on a document that does not exist fails the whole atomic batch");
  check("and therefore write no stock movement either",
    body.indexOf("if (isServiceLine(item)) continue;") < body.indexOf("stockMovements"),
    "a service has no shelf, so there is nothing for the ledger to describe");
  // What must NOT be filtered: the sale itself. Takings cannot change because
  // of how the stock happens to be accounted.
  check("the queued sale still carries every line",
    /items: args\.items,/.test(body),
    "dropping services from the sale document would understate the day's takings");

  // Run it. The static checks above say the guard is written; this says what
  // the guard does to a real mixed basket, and what its absence did.
  const isServiceLine = new Function(`${extract("isServiceLine")} return isServiceLine;`)();
  const items = [
    { kind: "service", serviceId: "svc1", name: "Braiding", qty: 1 },
    { kind: "product", productId: "p1", name: "Beer", qty: 3 },
    { kind: "product", productId: "p2", name: "Soda", qty: 5 }
  ];

  const updated = [];
  for (const item of items) {
    if (isServiceLine(item)) continue;
    updated.push(`${item.productId}:${item.qty}`);
  }
  check("only real products are updated in the batch",
    JSON.stringify(updated) === JSON.stringify(["p1:3", "p2:5"]));

  // The control: every line, the way it was before the guard.
  const unguarded = items.map((item) => String(item.productId));
  check("without the guard the batch addresses products/undefined",
    unguarded[0] === "undefined",
    "one such path fails the write, and the batch is atomic, so the sale is lost with it");
  check("...and it would have taken the real products down with it",
    unguarded.length === 3 && unguarded.includes("p1") && unguarded.includes("p2"),
    "the beer and the soda are in the same batch as the broken path");
}

console.log("\n=== Phase E: the tab, and who is allowed to touch it ===");
{
  // Gated per STORE, not per account: businessType lives on the store document,
  // so an owner running a salon and a duka must see the tab appear and vanish
  // as they switch branches. That is why it runs from renderAll().
  check("the tab is rendered on every pass, not once at sign-in",
    /renderServices\(\);\s*renderManagerControl\(\);/.test(noComments),
    "businessType is per store, so the tab has to follow the store switcher");
  check("the nav item is hidden for a business that sells no services",
    /nav\.hidden = !sells \|\| !isManagerOrOwnerRole\(\);/.test(noComments));
  check("it ships hidden in the markup",
    /<button class="nav-item" data-view="services" id="servicesNavItem" hidden>/.test(html),
    "a duka must not see it flash before the first render");

  // Hiding a nav item is not a gate. openView() is also reached from the
  // command palette and from a stale click handler.
  check("the view itself is refused for a business that sells no services",
    /if \(viewId === "services" && !storeSellsServices\(\)\) return false;/.test(noComments),
    "canOpenView is the choke point; the hidden nav item is only the courtesy");
  check("someone standing on the tab when it disappears is moved somewhere real",
    /if \(nav\.hidden && view\.classList\.contains\("active"\)\) openView\("dashboard"\);/.test(noComments),
    "switching from a salon to a duka would otherwise leave a blank screen");

  // firestore.rules makes service writes owner-only. Showing a manager a
  // control that will be refused is the thing "hide, don't disable" exists to
  // prevent, and renderInventory() already draws this exact line on a product.
  check("editing is owner-only in the client",
    /const canEdit = isOwnerRole\(\);/.test(noComments));
  check("the add button is hidden from a manager",
    /if \(addButton\) addButton\.hidden = !canEdit;/.test(noComments));
  check("row controls are hidden from a manager",
    /<td class="table-actions">\$\{canEdit \? `/.test(noComments));
  check("...and the rules agree that writes are owner-only",
    /allow create: if isOwner\(userId\) && tenantNotFrozen\(userId\) && validService\(\);/.test(rules),
    "the client gate is a courtesy; this is the boundary");
}

console.log("\n=== Phase E: the screen says the right word ===");
{
  check("the heading follows the business type",
    /nav\.textContent = label;\s*qs\("#servicesTitle"\)\.textContent = label;/.test(noComments));
  // Caught in the browser: translateStaticDom() applies every data-i18n key
  // with no parameters, so a key taking {label} rendered literally as
  // "Add to {label}" until the dialog was opened. openServiceDialog() is the
  // only thing that may set it.
  check("the dialog title is not applied by the static translator",
    !/id="serviceDialogTitle" data-i18n=/.test(html),
    "a parameterised key in data-i18n renders its own placeholder");
  check("...and is set with its parameter when the dialog opens",
    /t\("services\.dialogEditTitle", \{ label \}\)/.test(noComments) &&
    /t\("services\.dialogAddTitle", \{ label \}\)/.test(noComments));
  check("a bar's column header says Item, a salon's says Service",
    /qs\("#servicesThName"\)\.textContent = label === t\("services\.menuTitle"\)/.test(noComments),
    "a bar prices dishes, not services");
  for (const key of ["services.eyebrow", "services.intro", "services.addButton", "services.emptyState",
                     "services.statusActive", "services.statusWithdrawn", "services.withdrawButton",
                     "services.restoreButton", "services.saveButton", "services.thItem",
                     "toast.serviceAdded", "toast.serviceWithdrawn", "toast.serviceSaveFailed"]) {
    check(`${key} exists in both languages`,
      (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length >= 2);
  }
}

console.log("\n=== Phase E: a service is withdrawn, never deleted ===");
{
  const fn = noComments.slice(noComments.indexOf("async function toggleServiceActive("));
  const body = fn.slice(0, fn.indexOf("\nfunction ") > 0 ? fn.indexOf("\nfunction ") : 3000);
  check("withdrawing flips a flag rather than removing the document",
    /\{ active: nextActive, updatedAt: serverTimestamp\(\) \}/.test(body) && !/deleteDoc/.test(body),
    "sales reference it by name and price; deleting leaves that history describing something gone");
  check("withdrawing asks first, restoring does not",
    /if \(!nextActive && !window\.confirm/.test(body),
    "putting something back on the till needs no confirmation");

  // The editing screen must show withdrawn items or they could never return.
  // The till must not. Two different lists, deliberately.
  const editing = noComments.slice(noComments.indexOf("function storeServicesForEditing("));
  const editingBody = editing.slice(0, editing.indexOf("\nfunction "));
  check("the editing list keeps withdrawn items visible",
    !/active !== false/.test(editingBody),
    "filtering them here would make a withdrawal permanent by accident");
  const till = noComments.slice(noComments.indexOf("function storeServices("));
  const tillBody = till.slice(0, till.indexOf("\nfunction "));
  check("the till list drops them", /service\.active !== false/.test(tillBody));
}

console.log("\n=== Phase E: the write matches what the rules will accept ===");
{
  const fn = noComments.slice(noComments.indexOf("async function saveService("));
  const body = fn.slice(0, fn.indexOf("\nasync function "));

  // serviceImmutableFieldsUnchanged() rejects an update that moves any of
  // these, so the client must not send a different one.
  check("an existing service keeps its branch",
    /storeId: existing\?\.storeId \|\| state\.currentStoreId,/.test(body),
    "letting the current store rewrite it would move a menu item between branches by accident");
  check("createdAt is written only on create",
    /\.\.\.\(existing \? \{\} : \{ createdAt: serverTimestamp\(\) \}\)/.test(body),
    "the rules require createdAt unchanged on update");
  check("the id is stable across an edit",
    /const id = existing\?\.id \|\| doc\(collection\(/.test(body));

  // Same two refusals saveProduct() makes, for the same reason: a document has
  // to name one branch.
  check("adding across all stores is refused",
    /!input\.id && state\.currentStoreId === "all"/.test(body));
  check("adding with no store resolved is refused",
    /!input\.id && !state\.currentStoreId/.test(body));

  check("the price is bounded, not merely non-negative",
    /clampNonNegativeNumber\(input\.price, MAX_MONEY\)/.test(body),
    "moneyInRange in the rules would reject it anyway; this names the field instead");
  check("a nameless service is refused before the write",
    /services\.nameRequired/.test(body));
  check("tax class is written only for a registered business",
    /\.\.\.\(vatSettings\(\)\.registered \? \{ taxClass: input\.taxClass \|\| "standard" \} : \{\}\)/.test(body),
    "a shop that does not collect VAT must not have its menu classified for it");

  // The same double-submit guard the till and the transfer dialog carry.
  check("the save button cannot be double-submitted",
    /if \(saveButton\.disabled\) return;\s*saveButton\.disabled = true;/.test(body) &&
    /finally \{\s*saveButton\.disabled = false;/.test(body));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
