// What actually happens to a sale when the connection drops.
//
//   node offline-selling.test.mjs
//
// SECURITY-AUDIT.md F-4 argues that binding a stock decrement to a sale is
// unreachable, and one of its two reasons is that a server-mediated sale
// endpoint "cannot work offline" because offline selling is "a headline feature
// of this product".
//
// It is not a feature of this product. The sale path requires a Firestore
// transaction, transactions do not queue offline the way plain writes do, and
// the catch does not fall through to anything -- it toasts and returns. The
// offline banner says so in both languages: "sales cannot be recorded until the
// connection returns."
//
// This file pins that, for three reasons:
//
//   1. F-4's conclusion rests on the claim. If the premise is wrong the
//      conclusion deserves re-examination, and a test is harder to overlook
//      than a paragraph.
//   2. The local- sale path still exists for the no-Firestore case. If someone
//      ever wires it to the offline case instead, sales would be recorded that
//      never reach Firestore -- and therefore never write a stockMovements
//      entry, so the L-2 reconciliation would report the resulting shelf
//      difference as unexplained stock loss. A well-meant offline fallback
//      would start accusing cashiers of theft.
//   3. A till that stops selling when the internet does is the single largest
//      operational risk this product carries in its own market. It should not
//      be possible to change that accidentally.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

console.log("=== a failed sale stops, it does not quietly become a local one ===");
{
  // The sale's Firestore branch specifically. The same `if (state.db && ...)`
  // guard appears six times in app.js, so anchor on something only the sale
  // has -- indexOf on the guard alone lands on a customer write 4,000 lines
  // earlier and measures the wrong code.
  const anchor = noComments.indexOf('describeOperationError(error, "toast.saleFailedGeneric")');
  check("the sale path is locatable", anchor !== -1);
  const branch = noComments.lastIndexOf("if (state.db && state.user && state.businessOwnerUid) {", anchor);
  check("the Firestore sale branch exists", branch !== -1 && branch < anchor);
  const region = noComments.slice(branch, anchor + 4000);
  check("a failed sale toasts and returns",
    /catch \(error\) \{[\s\S]{0,200}showToast\(describeOperationError\(error, "toast\.saleFailedGeneric"\)\);\s*return;/.test(region),
    "without the return, a refused sale would fall into the local path and be recorded off the record");
  check("the local sale path is reached only when Firestore is absent",
    /\} else \{[\s\S]{0,400}state\.cart\.forEach/.test(region),
    "the local- branch must be the else of 'is Firestore configured', never of 'are we online'");
}

console.log("=== the user is told the truth about it ===");
{
  // Changed in L-9 phase C. The banner used to say sales could not be recorded,
  // which was true and is now false for cash: they are queued on the device.
  // A banner that still claimed refusal would be the same class of lie as the
  // inventory table telling a loading shop its stock was gone.
  check("the offline banner says cash sales are held on the device",
    /"offline\.bannerText": "[^"]*saved on this device/.test(src),
    "the banner must match what the sale path actually does");
  check("the banner exists in Kiswahili too",
    (src.match(/"offline\.bannerText"/g) || []).length >= 2);
  check("being offline outranks whatever code the SDK returned",
    /navigator\.onLine === false\) return t\("error\.offline"\)/.test(noComments),
    "a cashier needs 'no internet', not 'unavailable'");
  check("the SDK's unavailable code maps to the offline message",
    /"unavailable": "error\.offline"/.test(noComments));
}

console.log("=== a sale is written in one transaction, which is why it cannot queue ===");
{
  check("the sale path uses runTransaction",
    /runTransaction\(state\.db, async \(transaction\)/.test(noComments));
  check("the stock ledger is written inside that same transaction",
    /recordStockMovement\(transaction/.test(noComments),
    "if the ledger ever moves outside the transaction, a crash between the two produces a gap the " +
    "reconciliation would read as theft");
}

console.log("=== a cash sale is queued offline, not refused (L-9 phase C) ===");
{
  const q = noComments.slice(noComments.indexOf("function queueOfflineSale("));
  const body = q.slice(0, q.indexOf("\nfunction ", 10));

  check("only cash is queued offline",
    /isOfflineNow\(\) && paymentMethod === "cash"/.test(noComments),
    "a credit sale offline could blow a limit with no authorisation trail");
  check("a non-cash sale offline is refused with its own reason",
    /isOfflineNow\(\) && paymentMethod !== "cash"[\s\S]{0,120}toast\.offlineCashOnly/.test(noComments),
    "otherwise it falls into the transaction and fails as a generic error");
  // Both anchored inside completeSale. shouldQueueSaleOffline is defined far
  // earlier in the file and runTransaction is first used by returns, so a bare
  // indexOf on either compares the wrong two places.
  {
    const saleEnd = noComments.indexOf('describeOperationError(error, "toast.saleFailedGeneric")');
    const saleStart = noComments.lastIndexOf("if (!seller.id", saleEnd);
    const region = noComments.slice(saleStart, saleEnd);
    check("the offline branch is taken before the transaction one",
      region.indexOf("shouldQueueSaleOffline(paymentMethod)") !== -1 &&
      region.indexOf("shouldQueueSaleOffline(paymentMethod)") < region.indexOf("await runTransaction("),
      "the transaction must be the else, or an offline sale still hits a path that cannot queue");
    check("the non-cash refusal comes before both",
      region.indexOf("toast.offlineCashOnly") < region.indexOf("shouldQueueSaleOffline(paymentMethod)"));
  }

  // The three properties that make this correct rather than merely working.
  check("stock moves by increment(), never read-then-write",
    /quantity: increment\(-item\.qty\)/.test(body),
    "reading first is what makes two tills clobber each other on replay");
  check("nothing in the queued path is awaited",
    !/await /.test(body),
    "awaiting a queued write hangs until the connection returns -- the cashier watches a spinner");
  check("the ledger entry is marked offline and carries no chain",
    /offline: true/.test(body) && !/quantityBefore/.test(body),
    "a chain built on a stale cache is a guess wearing the authority of a measurement");

  check("the sale keeps its deterministic id, so a double flush cannot double-record",
    /ord_\$\{args\.staffId\}_\$\{args\.orderNumber\}/.test(body));
  check("the sale is marked as made offline",
    /madeOffline: true/.test(body),
    "the owner needs to know which sales were rung up blind");
  check("a replay rejection is reported rather than swallowed",
    /onReplayFailure/.test(body) && /reportFault/.test(body),
    "a rejection arrives hours later; a toast then would connect to nothing");
  check("all four writes are queued",
    (body.match(/setDoc\(/g) || []).length >= 3 && /updateDoc\(/.test(body),
    "sale, stock, ledger and audit");
}

console.log("=== the online path is untouched ===");
{
  // Phase C adds a branch; it does not rewrite the transaction. Online sales
  // keep atomicity and the oversell guard that lives inside it.
  check("the transaction still exists for online sales",
    /await runTransaction\(state\.db, async \(transaction\)/.test(noComments));
  check("the online oversell guard is still inside it",
    /txerror\.notEnoughStockItem/.test(noComments),
    "this is what refuses to oversell while connected");
  check("the online ledger write still carries its chain",
    /recordStockMovement\(transaction,[\s\S]{0,220}quantityBefore: currentQuantity/.test(noComments));
}

console.log("=== staff keep their employer's data when the network drops ===");
{
  // resolveBusinessOwnerUid forces an ID token refresh, which needs the
  // network. Offline it throws, and falling straight to user.uid points a
  // STAFF member's whole session at their own uid -- a tree they own nothing
  // in. Every subscription then reads an empty shop, which looks exactly like
  // a shop with no stock. The owner never saw it because their uid IS the
  // business. The cached token already carries the claim.
  const fn = noComments.slice(noComments.indexOf("async function resolveBusinessOwnerUid("));
  const body = fn.slice(0, fn.indexOf("\n}") + 2);
  check("a forced refresh is still tried first",
    /getIdTokenResult\(\s*true\s*\)/.test(body),
    "a freshly invited staff member needs the claim set seconds ago, which a cached token predates");
  check("a failed refresh falls back to the cached token before giving up",
    /getIdTokenResult\(\s*false\s*\)/.test(body),
    "without this, offline staff are silently rerouted to their own empty tree");
  check("the cached token's claim is actually used",
    (body.match(/claims\?\.businessOwnerUid/g) || []).length >= 2);
  check("own uid remains the last resort, not the second step",
    body.lastIndexOf("return user.uid;") > body.indexOf("getIdTokenResult( false )".replace(/ /g, "")) ||
    body.lastIndexOf("return user.uid;") > body.indexOf("forceRefresh */ false"),
    "the fallback must sit after the cached-token attempt");
}

console.log("=== the cashier can tell whether the sale landed (L-9 phase D) ===");
{
  const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");

  // The i18n string was corrected in phase C but the static fallback in the
  // markup was not, so for the moment before translateStaticDom() runs -- and
  // permanently, if it ever fails -- the banner still told a cashier that
  // sales could not be recorded while the till was quietly recording them.
  check("the banner's static fallback matches what the code does",
    /id="offlineBanner"[\s\S]{0,400}saved on this device/.test(html),
    "the pre-i18n fallback is what a user sees first; it does not get to say something else");
  check("the static fallback no longer claims sales are refused",
    !/sales cannot be recorded until the connection returns/.test(html));

  // Connection state and queue state are different questions and separate
  // elements. A single banner keyed on connectivity vanishes the instant the
  // signal returns, which is exactly when the cashier most needs to know
  // whether the sales they rang up blind have actually landed.
  check("the unsynced count has its own banner, not a line inside the offline one",
    /id="unsyncedSalesBanner"/.test(html) &&
    html.indexOf('id="unsyncedSalesBanner"') > html.indexOf('id="offlineBanner"') &&
    !/id="offlineBanner"[\s\S]{0,200}id="unsyncedSalesBanner"/.test(html.replace(/\s+/g, " ")),
    "a queue outlives the outage that created it");
  check("the unsynced banner is a live region, so it is announced",
    /id="unsyncedSalesBanner"[^>]*role="status"/.test(html));

  // Counting definitions (`"key":`) rather than every mention: the key also
  // appears at its call site, so a bare occurrence count says three and would
  // pass just as happily on one language plus two uses.
  check("the unsynced count is rendered from state, in both languages",
    (src.match(/"offline\.unsyncedOne":/g) || []).length === 2 &&
    (src.match(/"offline\.unsyncedMany":/g) || []).length === 2);
  check("one queued sale is not described as '1 sales'",
    /count === 1 \? t\("offline\.unsyncedOne"\) : t\("offline\.unsyncedMany"/.test(noComments));
}

console.log("=== the count comes from the SDK's queue, and can reach zero ===");
{
  const fn = noComments.slice(noComments.indexOf("async function subscribeToSales("));
  const body = fn.slice(0, fn.indexOf("\nasync function ", 10));

  // Without includeMetadataChanges the acknowledgement of a queued write --
  // which changes no document data -- never wakes the listener, so the count
  // would stick at its outage-time value and the banner would claim sales were
  // still held long after they landed.
  check("the sales listener asks for metadata changes",
    /includeMetadataChanges: true/.test(body),
    "otherwise the count can go up but never come back down");
  check("the count is derived from hasPendingWrites, not tallied by us",
    /docSnap\.metadata\.hasPendingWrites === true/.test(body) &&
    /state\.unsyncedSaleCount = pendingIds\.size/.test(body),
    "a tally we maintained ourselves would drift the first time a replay was rejected");

  // productUnitsSold() caches on state.sales by array identity, documented as
  // sound because the array is replaced only when the data changes. Asking for
  // metadata callbacks and then rebuilding the array on each one would break
  // that premise silently -- a cache miss, and a full pass over the sales
  // history, for every acknowledged write. The queue is tracked beside the
  // array instead of inside it.
  check("the sales array is rebuilt only when the data actually changed",
    /state\.sales = snapshot\.docs\.map/.test(body) &&
    body.indexOf("snapshot.docChanges().length > 0") < body.indexOf("state.sales = snapshot.docs.map"),
    "productUnitsSold caches on state.sales by identity; rebuilding it per metadata wake-up is a cache miss per write");
  check("queued sales are tracked beside the array, not as a field on each sale",
    /state\.pendingSaleIds = pendingIds/.test(body) && !/pendingSync:/.test(body));

  // The reason asking for the extra callbacks is affordable. renderPaymentReports
  // redraws the chart and every breakdown; running it again for a snapshot whose
  // contents are identical is the same class of waste as the movement panel's
  // per-product rescan.
  check("a metadata-only wake-up updates the banner but skips the heavy render",
    body.indexOf("renderUnsyncedSalesBanner()") < body.indexOf("snapshot.docChanges().length > 0") &&
    /snapshot\.docChanges\(\)\.length > 0 \|\| !state\.salesRenderedOnce/.test(body),
    "docChanges() excludes metadata-only changes by default -- that is what makes the guard cheap");
  check("a shop with no sales yet still renders its empty state once",
    /!state\.salesRenderedOnce/.test(body),
    "the first snapshot of an empty collection reports no document changes at all");
  check("the count is cleared when the session's data is torn down",
    /state\.sales = \[\];\s*state\.unsyncedSaleCount = 0;\s*state\.pendingSaleIds = new Set\(\);/.test(noComments),
    "otherwise the banner outlives the session and warns the next sign-in about somebody else's queue");
}

console.log("=== a sale carries its own two markers, which are not the same fact ===");
{
  const fn = noComments.slice(noComments.indexOf("function buildStaffOrderCard("));
  const body = fn.slice(0, fn.indexOf("\nfunction ", 10));

  // Two of the checks below are negative, and a negative assertion against an
  // empty string passes for the wrong reason. If this function is ever renamed
  // the slice collapses, so pin that it was found before trusting anything
  // measured from it.
  check("the order card builder is locatable",
    body.length > 200 && /staff-order-card/.test(body),
    "a slice that missed would make the negative checks below pass vacuously");

  check("a sale rung up offline is marked as such",
    /sale\.madeOffline === true/.test(body));
  check("a sale still sitting in the queue is marked separately",
    /state\.pendingSaleIds\.has\(sale\.id\)/.test(body),
    "madeOffline is permanent, the queue marker clears itself -- collapsing them hides the durable one");
  check("the marker requires the value this app actually writes",
    !/sale\.madeOffline \?/.test(body) && !/if \(sale\.madeOffline\)/.test(body),
    "the rules do not constrain madeOffline's type, so a truthy check would honour a string");
  check("both markers exist in both languages",
    (src.match(/"offline\.saleMarker":/g) || []).length === 2 &&
    (src.match(/"offline\.salePending":/g) || []).length === 2);
}

console.log("=== the owner is told which shelves stopped being trustworthy ===");
{
  const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
  const fn = noComments.slice(noComments.indexOf("function computeOfflineSalesReport("));
  const body = fn.slice(0, fn.indexOf("\nfunction renderOfflineSalesReport"));

  // Same reason as the order card above: one check in this block is negative.
  check("the offline report's computation is locatable",
    body.length > 200 && /byProduct/.test(body),
    "a slice that missed would make the one-pass check below pass vacuously");
  check("the report has somewhere to render",
    /id="offlineSalesReport"/.test(html) && /id="offlineSalesTotal"/.test(html));
  check("the report is drawn whenever the reports are",
    /renderOfflineSalesReport\(\);/.test(noComments) &&
    noComments.indexOf("renderOfflineSalesReport();") < noComments.indexOf("function computeOfflineSalesReport("),
    "a report nobody calls is the same as no report");

  check("it reads only sales that were actually made offline",
    /filteredSales\(\)\.filter\(\(sale\) => sale\.madeOffline === true\)/.test(body));
  check("it respects the store and date filters like every other report",
    /filteredSales\(\)/.test(body),
    "an owner filtering to one branch must not be shown another branch's outage");

  // Grouped by product because that is what the owner acts on: they go and
  // count that shelf.
  check("it groups by product rather than listing sales",
    /byProduct/.test(body) && /entry\.units \+=/.test(body));
  check("it accumulates in one pass instead of scanning per product",
    !/state\.sales\.filter[\s\S]{0,200}forEach\([\s\S]{0,200}state\.sales\.filter/.test(body),
    "the movement panel went quadratic exactly this way");

  // An unknown product is not a product with nothing on the shelf. Same
  // distinction the inventory table now makes for a shop that is still loading.
  check("a product this device has never seen reads as unknown, not as zero",
    /onHand: product \? Number\(product\.quantity \|\| 0\) : null/.test(body));

  check("the report says the counts are unverified, in both languages",
    (src.match(/"offlineReport\.note":/g) || []).length === 2 &&
    /"offlineReport\.note": "[^"]*unverified until/.test(src),
    "without this the report is a list of numbers the owner would take as measured");
  check("it explains what a negative count means",
    /"offlineReport\.note": "[^"]*more was sold than/.test(src),
    "negative stock is the visible consequence of sell-anyway; it needs a sentence, not a minus sign");
}

console.log("=== negative stock is displayed, not laundered ===");
{
  check("a shelf past empty has no days of stock left, not negative days",
    /quantity <= 0 \? 0 : Math\.floor\(quantity \/ Math\.max\(dailyDemand, 0\.1\)\)/.test(noComments),
    "phase A allowed quantity < 0; dividing it by demand produced '-3 days until stockout'");
  check("stock status still calls a negative shelf out of stock",
    /product\.quantity <= 0\) return "out"/.test(noComments));
}

console.log("=== the excluded paths still refuse offline, and still say why (L-9 phase E) ===");
{
  // OFFLINE-CAPABILITIES.md sells these as "refused, honestly". Two halves:
  // they must still be transaction-bound (a transaction cannot queue, which is
  // what makes the refusal immediate rather than a write that lands hours later
  // against an unknowable balance), and the message must name the real cause.
  //
  // The second half had drifted. confirmProcessReturn() caught its error and
  // toasted a flat "could not process the return" whatever happened, so the
  // likeliest cause in this market -- no signal -- was the one it never
  // mentioned. describeOperationError() puts "no internet connection" ahead of
  // whatever code the SDK attached.
  const EXCLUDED = [
    ["toast.returnFailed", "a return"],
    ["toast.paymentFailed", "a customer payment"],
    ["toast.transferFailed", "a branch transfer"],
    ["toast.restockFailed", "a restock"],
    ["toast.couldNotUndoSale", "an undo/void"],
    ["toast.shiftOpenFailed", "opening a shift"],
    ["toast.shiftCloseFailed", "closing a shift"],
    ["toast.saleFailedGeneric", "a failed sale"]
  ];
  EXCLUDED.forEach(([key, label]) => {
    check(`${label} names the real cause when it fails`,
      new RegExp(`describeOperationError\\(error, "${key.replace(".", "\\.")}"\\)`).test(noComments),
      `offline this must say "no internet connection", not a generic failure`);
  });

  // The bare string is legitimate OUTSIDE a catch -- a missing dialog in the
  // markup, or an order number that failed validation before anything was
  // attempted, are not operation failures and have no error to describe. What
  // must not happen is a caught operation error being flattened into it. So
  // scan the catch blocks specifically rather than the whole file, which is
  // what the first version of this check did: it failed on two guards that were
  // both correct, and a check that cries wolf gets deleted rather than heeded.
  const catchBlocks = [...noComments.matchAll(/catch \(error\) \{/g)]
    .map((m) => noComments.slice(m.index, m.index + 400));
  const flattened = EXCLUDED
    .map(([key]) => key)
    .filter((key) => catchBlocks.some((block) =>
      new RegExp(`showToast\\(t\\("${key.replace(".", "\\.")}"\\)\\)`).test(block)));
  check("no caught operation error is flattened into a bare message",
    flattened.length === 0,
    `these lose the real cause: ${flattened.join(", ")}`);

  // Nine transaction sites, and every one of them is a path that genuinely
  // needs what a transaction gives it. If this count drops, something moved off
  // the transactional path -- which is exactly what phase C did to cash sales,
  // deliberately and with a design document. It should not happen by accident.
  const transactions = (noComments.match(/await runTransaction\(state\.db/g) || []).length;
  check("the online-only paths are still transaction-bound",
    transactions >= 8,
    `found ${transactions}; a drop means an operation can now queue, which for a return or a shift close is a correctness bug`);

  check("only the cash sale path was ever given a queued alternative",
    (noComments.match(/function queueOffline[A-Za-z]*\(/g) || []).length === 1,
    "a queued return or shift close would be a silent correctness failure, not a feature");
}

console.log("=== the F-4 premise is flagged where it is stated ===");
{
  // A wrong premise in a security audit is worse than a wrong conclusion,
  // because it gets reused. This asserts the correction is recorded rather
  // than the original claim being left to be quoted again.
  const audit = readFileSync(new URL("../SECURITY-AUDIT.md", import.meta.url), "utf8");
  // Absence of the phrase is the wrong test: the correction quotes the original
  // sentence in order to refute it, so a bare "does not contain" check fails on
  // the fix itself. What matters is that the claim is not left standing
  // unqualified -- so require the correction, and require it to reach the claim.
  check("F-4's offline premise is corrected in place",
    /\*\*That premise is false/.test(audit),
    "the claim rules out a server-mediated sale endpoint; if it is false, that option is open");
  const claim = audit.indexOf("headline feature");
  const correction = audit.indexOf("That premise is false");
  check("the correction sits with the claim, not somewhere else in the file",
    claim !== -1 && correction > claim && correction - claim < 600,
    "a correction far from what it corrects gets read separately, or not at all");
  check("the corrected entry points at the test that pins it",
    /tests\/offline-selling\.test\.mjs/.test(audit));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
