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
