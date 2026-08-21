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
    /if \(isOfflineNow\(\)\) return t\("error\.offline"\);/.test(noComments),
    "a cashier needs 'no internet', not 'unavailable'");
  check("and it asks isOfflineNow(), not navigator.onLine directly",
    !/navigator\.onLine === false\) return t\("error\.offline"\)/.test(noComments),
    "on dead shop wifi the browser still says online, so the cashier got 'unavailable'");
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
    // Matches runTransaction( without requiring `await` in front of it: since
    // the phase F timeout the sale path starts the transaction and hands it to
    // awaitSaleTransaction() rather than awaiting it directly. The ordering
    // property this guards is unchanged.
    check("the offline branch is taken before the transaction one",
      region.indexOf("shouldQueueSaleOffline(paymentMethod)") !== -1 &&
      region.indexOf("runTransaction(state.db") !== -1 &&
      region.indexOf("shouldQueueSaleOffline(paymentMethod)") < region.indexOf("runTransaction(state.db"),
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
    (body.match(/batch\.set\(/g) || []).length >= 3 && /batch\.update\(/.test(body),
    "sale, stock, ledger and audit");

  // QA-114. These were four independent queued mutations, so they replayed
  // independently and could half-succeed. The realistic failure is not exotic:
  // the deterministic sale id already exists, the rules see an UPDATE where a
  // create was intended and refuse it, and the increment(-qty) stock writes --
  // which carry no such constraint -- land anyway. The shop is short a full
  // basket with no sale to explain it, and because the ledger entry is
  // offline: true the reconciliation reports it as unknown rather than flagging
  // it, so the only trace is the fault log.
  check("the whole sale replays as one unit, or not at all",
    /writeBatch\(state\.db\)/.test(body) && /batch\.commit\(\)/.test(body),
    "independent writes let a rejected sale leave its stock decrements applied");
  check("no write escapes the batch",
    !/[^.]\bsetDoc\(/.test(body) && !/[^.]\bupdateDoc\(/.test(body),
    "a single loose write outside the batch reintroduces the partial replay");
  check("the commit is still not awaited",
    !/await batch\.commit/.test(body),
    "awaiting a commit that cannot resolve until the connection returns is the spinner this whole path exists to avoid");
  check("a rejected batch still reports the fault",
    /batch\.commit\(\)\.catch\(onReplayFailure/.test(body));
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
    "belt and braces: the rules now type-check madeOffline, and every reader still tests === true");
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
  // Counted without requiring `await`: the sale path now starts its transaction
  // and races it against a timeout (phase F), so it reads
  // `const attempt = runTransaction(...)`. It is still transaction-bound, which
  // is what this number is about.
  const transactions = (noComments.match(/runTransaction\(state\.db/g) || []).length;
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

console.log("\n=== 'offline' means the database is unreachable, not what the OS thinks ===");
{
  // Reported in UAT as "sales don't work when the user is offline", with a
  // console log that named the cause: ERR_QUIC_PROTOCOL_ERROR, then run after
  // run of ERR_NAME_NOT_RESOLVED against firestore.googleapis.com. DNS was
  // dead. navigator.onLine was true throughout, because the device still had a
  // network interface with a route -- which is the only thing that flag means.
  //
  // So isOfflineNow() said online, the sale skipped the queue, and it went to
  // runTransaction(), which cannot complete without a server. The promise never
  // settled, the Complete Sale button stayed disabled behind it, and the till
  // stopped selling. The offline feature was never reached by the outage it was
  // built for. Captive portals and a hung uplink read identically.
  function extract(name) {
    const start = src.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`${name} not found`);
    let depth = 0, i = src.indexOf("{", start);
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) break; }
    }
    return src.slice(start, i + 1);
  }

  function harness({ onLine = true } = {}) {
    const listener = {};
    const state = {
      db: {}, user: { uid: "u1" }, serverReachable: null, unsubscribeConnection: null,
      firebaseApi: { firestore: {
        doc: (...path) => ({ path }),
        onSnapshot: (ref, options, onNext, onError) => {
          listener.ref = ref; listener.options = options;
          listener.onNext = onNext; listener.onError = onError;
          return () => { listener.stopped = true; };
        }
      } }
    };
    const api = new Function("state", "navigator", "syncConnectionState", "console",
      `${extract("isOfflineNow")}
       ${extract("watchServerConnection")}
       return { isOfflineNow, watchServerConnection };`
    )(state, { onLine }, () => {}, { warn: () => {} });
    return { state, listener, ...api };
  }

  // A connection dropping changes no data, so a listener without this never
  // fires and the till never learns. This is the whole mechanism.
  {
    const h = harness();
    h.watchServerConnection();
    check("the connection watch asks for metadata changes",
      h.listener.options && h.listener.options.includeMetadataChanges === true,
      "without it the callback only fires on data changes, and an outage changes no data");
    check("it watches the signed-in user's own profile document",
      JSON.stringify(h.listener.ref.path).includes("users") && h.listener.ref.path.includes("u1"),
      "every role may read its own profile, so this works for a cashier too");
  }

  // The phantom-outage guard. Snapshots arrive from cache during ordinary
  // startup; reading that as an outage would queue cash sales that could have
  // been transacted against a real stock check, and refuse credit sales with
  // "cash only" on a perfectly good connection.
  {
    const h = harness();
    h.watchServerConnection();
    check("before any snapshot, nothing is claimed", h.state.serverReachable === null);
    check("and the till is treated as online", h.isOfflineNow() === false);
    h.listener.onNext({ metadata: { fromCache: true } });
    check("a cache snapshot at startup is not an outage", h.state.serverReachable === null,
      "the flag must only fall after a live connection has been seen");
    check("so the till is still treated as online", h.isOfflineNow() === false);
  }

  // The reported bug.
  {
    const h = harness({ onLine: true });
    h.watchServerConnection();
    h.listener.onNext({ metadata: { fromCache: false } });
    check("a server snapshot establishes the connection", h.state.serverReachable === true);
    check("and the till is online", h.isOfflineNow() === false);

    h.listener.onNext({ metadata: { fromCache: true } });
    check("losing the connection is noticed", h.state.serverReachable === false);
    check("the till is offline even though the browser says otherwise",
      h.isOfflineNow() === true,
      "this is the DNS-failure case from the UAT log: navigator.onLine true, database unreachable");

    h.listener.onNext({ metadata: { fromCache: false } });
    check("and it recovers when the connection comes back", h.isOfflineNow() === false);
  }

  // A rules problem or a broken listener must not be read as an outage: that
  // would refuse every credit sale for the rest of the session.
  {
    const h = harness();
    h.watchServerConnection();
    h.listener.onNext({ metadata: { fromCache: false } });
    h.listener.onNext({ metadata: { fromCache: true } });
    check("a lost connection is offline", h.isOfflineNow() === true);
    h.listener.onError(new Error("permission-denied"));
    check("a failed watch falls back to unknown, not to offline",
      h.state.serverReachable === null && h.isOfflineNow() === false);
  }

  // The original signal still stands on its own.
  {
    const h = harness({ onLine: false });
    check("airplane mode is still offline without any snapshot at all",
      h.isOfflineNow() === true);
  }

  check("the watch starts with the other subscriptions",
    /subscribeToTransfers\(\);\s*\n\s*watchServerConnection\(\);/.test(noComments));
  check("and is torn down on sign-out",
    /state\.unsubscribeConnection = null;/.test(noComments) &&
    /state\.serverReachable = null;/.test(noComments),
    "the next sign-in must not inherit this session's verdict about a connection");
}

console.log("\n=== an outage that starts mid-transaction no longer strands the till ===");
{
  // Phase F caught the outage that had already begun when the sale started.
  // This is the other half: runTransaction() needs a server round trip, so a
  // connection dying AFTER it starts leaves a promise that never settles, with
  // #completeSaleButton disabled behind it. The shop stops selling until
  // somebody reloads.
  //
  // The fallback is only safe because of two properties that are checked here
  // rather than assumed, since getting either wrong records the sale twice and
  // decrements the stock twice.
  function extractAsync(name) {
    const start = src.indexOf(`async function ${name}(`);
    if (start === -1) throw new Error(`${name} not found`);
    let depth = 0, i = src.indexOf("{", start);
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) break; }
    }
    return src.slice(start, i + 1);
  }

  // Property one: ONE id, minted before the paths diverge. The duplicate case
  // appends Date.now(), so an id computed separately per path would differ --
  // and two different ids both commit. This is the whole safety argument.
  {
    const handlerStart = noComments.indexOf('qs("#completeSaleButton").addEventListener');
    // Wide enough to reach the timeout fallback, which sits ~12.8k in. A window
    // that stopped short of it silently checked only the first call site.
    const handler = noComments.slice(handlerStart, handlerStart + 16000);
    const mintAt = handler.indexOf("const saleId = duplicate ?");
    const branchAt = handler.indexOf("shouldQueueSaleOffline(paymentMethod)");
    check("the sale id is minted once", (handler.match(/const saleId = duplicate \?/g) || []).length === 1,
      "a second mint would give the duplicate case a different Date.now()");
    check("and minted before the offline/online paths split", mintAt !== -1 && mintAt < branchAt);
    // BOTH call sites, counted. There are two -- the offline branch and the
    // timeout fallback -- and it is the fallback that matters most, because it
    // is the one racing a transaction that may still commit. An earlier version
    // of this check matched only the first and passed with the fallback broken.
    const callSites = (handler.match(/queueOfflineSale\(\{/g) || []).length;
    const idPassed = (handler.match(/queueOfflineSale\(\{\s*saleId,/g) || []).length;
    check("every queued path is handed that id", callSites === 2 && idPassed === 2,
      `${idPassed} of ${callSites} call sites pass it — the fallback and the transaction ` +
      "must race under one id or both can commit");
    check("queueOfflineSale prefers the caller's id",
      /const saleId = args\.saleId \|\| \(args\.duplicate \?/.test(noComments));
  }

  // Property two: the loser of the race is refused, not merged. Checked against
  // the rules themselves -- sales may only be updated in void or return shape,
  // so a queued set() over a committed sale fails, and because the queued
  // writes are one batch (QA-114) the stock writes fail with it.
  {
    const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
    const salesAt = rules.indexOf("match /sales/{saleId}");
    // To the end of the block, not a fixed window: the allow clauses sit below
    // ~80 lines of validVoidUpdate/validReturnUpdate definitions.
    const salesBlock = rules.slice(salesAt, rules.indexOf("allow delete: if false;", salesAt));
    // Whitespace-tolerant: the clause wraps across four lines in the rules.
    const updateClause = salesBlock.slice(salesBlock.indexOf("allow update:"));
    check("a sale may only be updated as a void or a return",
      salesBlock.includes("allow update:") &&
      /validVoidUpdate\(\)\s*\|\|\s*validReturnUpdate\(\)/.test(updateClause) &&
      !/allow write:/.test(salesBlock),
      "if a plain overwrite were allowed, the losing path would silently replace the winner");
    check("the queued sale and its stock writes are one batch",
      /const batch = writeBatch\(state\.db\);/.test(noComments),
      "a refused sale must take its stock decrements down with it");
    check("the transaction refuses an id that already exists",
      /existingSaleSnap\.exists\(\)[\s\S]{0,120}txerror\.duplicateOrderSubmission/.test(noComments),
      "the other direction: the batch landed first");
  }

  // The race itself, run for real against a short timeout.
  {
    const run = (attempt, timeoutMs) => new Function("window", "SALE_TRANSACTION_TIMEOUT_MS",
      `${extractAsync("awaitSaleTransaction")} return awaitSaleTransaction;`
    )({ setTimeout, clearTimeout }, timeoutMs)(attempt);

    // Testing the helper proves nothing if the sale path does not use it. That
    // is not hypothetical caution: this suite passed with the call site removed
    // until this assertion was added.
    check("the sale path actually routes its transaction through the timeout",
      /const outcome = await awaitSaleTransaction\(attempt\);/.test(noComments),
      "awaiting the transaction directly is the hang this phase exists to remove");
    check("and the transaction is started without being awaited first",
      /const attempt = runTransaction\(state\.db/.test(noComments),
      "an await here would strand the till before the race could begin");

    check("a transaction that lands reports committed",
      (await run(Promise.resolve(), 1000)) === "committed");
    check("a transaction that never settles reports unconfirmed",
      (await run(new Promise(() => {}), 20)) === "unconfirmed",
      "this is the hang: without it the await never returns and the button stays disabled");

    let rejected = false;
    try { await run(Promise.reject(new Error("permission-denied")), 1000); }
    catch { rejected = true; }
    check("a real failure still rejects, so the existing catch reports it", rejected,
      "a timeout must not swallow the errors the cashier needs to see");

    // A till runs all shift. If the timer outlived a fast sale, node would not
    // exit here -- and neither would the handles accumulate harmlessly.
    check("the timer is cleared when the transaction wins",
      (await run(Promise.resolve(), 60_000)) === "committed");
  }

  // What the cashier is told, and what is not queued.
  {
    const handlerStart = noComments.indexOf('qs("#completeSaleButton").addEventListener');
    // Widened: the sale handler grows every time it gains a comment, and the
    // "} catch" that bounds the region below fell outside the slice, which
    // collapses it silently rather than failing loudly.
    const handler = noComments.slice(handlerStart, handlerStart + 20000);
    const unconfirmedAt = handler.indexOf('outcome === "unconfirmed"');
    // Bounded at the catch, or the generic failure message the catch legitimately
    // uses would be read as belonging to the unconfirmed branch.
    const region = handler.slice(unconfirmedAt, handler.indexOf("} catch (error) {", unconfirmedAt));
    check("an unconfirmed cash sale is held on the device",
      /paymentMethod === "cash"[\s\S]{0,200}queueOfflineSale\(\{/.test(region));
    check("an unconfirmed credit sale is NOT queued",
      /\} else \{[\s\S]{0,400}toast\.saleUnconfirmed/.test(region),
      "no real balance and no authorised override — the phase C rule holds here too");
    check("and it is not reported as a failure",
      !/toast\.saleFailedGeneric/.test(region),
      "the transaction may still commit; 'unknown' is the only true answer");
    check("the late settlement of an abandoned transaction is handled",
      /attempt\.catch\(\(lateError\) =>/.test(noComments),
      "Promise.race leaves the loser running, and an unhandled rejection reads as a crash");
    check("and it is recorded where the owner can see it",
      /reportFault\("rejection", `timed-out sale later failed/.test(noComments));
  }

  for (const key of ["toast.saleHeldUnconfirmed", "toast.saleUnconfirmed"]) {
    check(`${key} exists in both languages`,
      (src.match(new RegExp(`"${key.replace(".", "\\.")}"`, "g")) || []).length >= 3,
      "two dictionary entries plus at least one usage");
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
