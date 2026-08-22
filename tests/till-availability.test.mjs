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

console.log("\n=== Transfer is held to the same rule ===");
{
  // Reported in UAT: the Transfer button stayed live while the transfer was
  // processing. It is the same defect the Complete Sale button already had,
  // and it is not a cosmetic one. A second run moves the stock twice, writes
  // two rows into transfer history, and where the destination store has no
  // matching SKU yet, both runs read that as empty OUTSIDE the transaction and
  // each creates its own destination product -- one SKU on two shelves, in the
  // system whose job is knowing where the stock is. Firestore's transaction
  // retry cannot save this: both runs are individually valid.
  const start = app.indexOf("async function confirmTransfer(");
  const lines = app.slice(start).split("\n");
  let depth = 0, endLine = null;
  for (let i = 0; i < lines.length; i++) {
    depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
    if (depth === 0 && i > 0) { endLine = i; break; }
  }
  const transfer = lines.slice(0, endLine + 1).join("\n");

  const guardAt = transfer.indexOf("confirmButton.disabled = true");
  const firstAwait = transfer.indexOf("await ");
  check("confirmTransfer claims the button", guardAt !== -1);
  check("it is claimed before the first await", guardAt !== -1 && guardAt < firstAwait,
    `guard at ${guardAt}, first await at ${firstAwait} — the dialog stays interactive across a lookup and a transaction`);
  check("a second entry while in flight is refused",
    /if \(confirmButton\.disabled\) return;/.test(transfer),
    "without this, two queued clicks both proceed");

  const reEnables = transfer.match(/confirmButton\.disabled = false/g) || [];
  check("there is exactly one re-enable", reEnables.length === 1,
    `${reEnables.length} found — more than one means the paths can diverge`);
  check("it lives in a finally block",
    /\} finally \{[\s\S]{0,400}confirmButton\.disabled = false;[\s\S]{0,40}\}/.test(transfer),
    "the dialog closes on success, so a re-enable on the happy path only would strand the next transfer");
  check("the finally covers the whole transaction",
    transfer.indexOf("runTransaction") > transfer.indexOf("try {") &&
    transfer.indexOf("runTransaction") < transfer.indexOf("} finally {"));

  // The validation above the guard is all synchronous, which is what makes it
  // safe to leave outside: no second click can interleave with it.
  const beforeGuard = transfer.slice(0, guardAt);
  check("nothing above the guard awaits", !/await /.test(beforeGuard),
    "an await above the guard reopens the window it exists to close");
}

console.log("\n=== and the second click is actually refused, not just guarded on paper ===");
{
  // The checks above read the source. This one runs confirmTransfer twice
  // without awaiting the first, which is what a double-click IS, and counts the
  // transactions that reach the database.
  const start = app.indexOf("async function confirmTransfer(");
  let depth = 0, i = app.indexOf("{", start);
  for (; i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}") { depth--; if (depth === 0) break; }
  }
  const source = app.slice(start, i + 1);

  function harness(withCost = false) {
    const calls = { transactions: 0, toasts: [], closed: 0 };
    const button = { disabled: false };
    const elements = {
      "#transferDialog": { close: () => { calls.closed += 1; } },
      "#transferDestinationSelect": { value: "store-b" },
      "#transferStaffNameInput": { value: "Juma Ally" },
      "#transferQuantityInput": { value: "10" },
      "#confirmTransferButton": button
    };
    const firestore = {
      collection: () => ({}),
      doc: () => ({ id: "ref" }),
      query: () => ({}),
      where: () => ({}),
      serverTimestamp: () => "ts",
      // The lookup that opens the window: a real one is a network round trip,
      // and it happens before the transaction claims anything.
      getDocs: async () => { await new Promise((r) => setTimeout(r, 10)); return { empty: true, docs: [] }; },
      runTransaction: async (db, fn) => {
        calls.transactions += 1;
        await fn({
          get: async () => ({ exists: () => true, data: () => ({ quantity: 100 }) }),
          update: () => {}, set: () => {}
        });
      }
    };
    const state = {
      pendingTransferProductId: "p1",
      products: [{ id: "p1", name: "Pipe", sku: "SKU1", quantity: 100, storeId: "store-a" }],
      stores: [{ id: "store-a", name: "Main" }, { id: "store-b", name: "Branch" }],
      db: {}, businessOwnerUid: "owner", user: { uid: "u1" },
      firebaseApi: { firestore }
    };

    const run = new Function(
      "state", "qs", "showToast", "t", "productStoreId", "recordStockMovement",
      "describeOperationError", "console",
      `${source} return confirmTransfer;`
    )(
      state,
      (selector) => elements[selector],
      (message) => calls.toasts.push(message),
      (key) => key,
      (product) => product.storeId,
      () => {},
      (error, fallback) => fallback,
      { warn: () => {} }
    );

    return { run, calls, button };
  }

  {
    const { run, calls, button } = harness();
    const first = run();
    const second = run();               // the double-click, before the first settles
    check("the button is disabled while the transfer is in flight", button.disabled === true);
    await Promise.all([first, second]);
    check("a double-click moves the stock once, not twice", calls.transactions === 1,
      `${calls.transactions} transactions reached the database`);
    check("and the dialog still closes", calls.closed === 1);
    check("the button is handed back afterwards", button.disabled === false);
  }

  {
    // The other half of the rule: refusing the second click must not cost the
    // next legitimate transfer.
    const { run, calls } = harness();
    await run();
    await run();
    check("two deliberate transfers both go through", calls.transactions === 2,
      `${calls.transactions} — the finally must re-enable, not just the happy path`);
  }
}

console.log("\n=== Restock is held to the same rule ===");
{
  // Found while fixing Transfer, and the same bug: the transaction reads the
  // shelf and adds to what it finds, so a second run adds the delivery twice.
  // The shop then believes it holds stock nobody delivered, which is the same
  // lie as an oversell wearing the opposite sign -- and unlike an oversell,
  // nothing downstream flags it, because a restock is supposed to raise the
  // count.
  const start = app.indexOf("async function confirmRestock(");
  const lines = app.slice(start).split("\n");
  let depth = 0, endLine = null;
  for (let i = 0; i < lines.length; i++) {
    depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
    if (depth === 0 && i > 0) { endLine = i; break; }
  }
  const restock = lines.slice(0, endLine + 1).join("\n");

  const guardAt = restock.indexOf("confirmButton.disabled = true");
  const firstAwait = restock.indexOf("await ");
  check("confirmRestock claims the button", guardAt !== -1);
  check("it is claimed before the first await", guardAt !== -1 && guardAt < firstAwait);
  check("a second entry while in flight is refused",
    /if \(confirmButton\.disabled\) return;/.test(restock));
  check("nothing above the guard awaits", !/await /.test(restock.slice(0, guardAt)));

  const reEnables = restock.match(/confirmButton\.disabled = false/g) || [];
  check("there is exactly one re-enable", reEnables.length === 1, `${reEnables.length} found`);
  check("it lives in a finally block",
    /\} finally \{[\s\S]{0,400}confirmButton\.disabled = false;[\s\S]{0,40}\}/.test(restock));

  // This function's shape is the reason to check rather than assume: its inner
  // catch returns early, and the close/render/toast sit AFTER the transaction
  // block rather than inside it. A finally that only wrapped the transaction
  // would miss all of it.
  const finallyAt = restock.indexOf("} finally {");
  check("the early return in the transaction's catch is covered",
    restock.indexOf("showToast(describeOperationError(error, \"toast.restockFailed\"))") < finallyAt,
    "the catch returns without closing the dialog — that path must still hand the button back");
  check("renderAll() runs inside the protected span",
    restock.indexOf("renderAll()") > restock.indexOf("try {") &&
    restock.indexOf("renderAll()") < finallyAt);

  // Runtime: two overlapping clicks, counting the transactions that land.
  const fnStart = app.indexOf("async function confirmRestock(");
  let d = 0, j = app.indexOf("{", fnStart);
  for (; j < app.length; j++) {
    if (app[j] === "{") d++;
    else if (app[j] === "}") { d--; if (d === 0) break; }
  }
  const source = app.slice(fnStart, j + 1);

  // confirmRestock now reaches for the purchase-capture helpers. These are
  // injected as the REAL functions -- lifted out of app.js the same way the
  // handler itself is -- because a stub would only prove the stub agrees with
  // the assertion. nextUnitCost takes a destructured parameter, so the body has
  // to be found past the parameter list rather than at the first brace.
  function lift(name) {
    const from = app.indexOf(`function ${name}(`);
    let k = app.indexOf("(", from);
    let parens = 0;
    for (; k < app.length; k++) {
      if (app[k] === "(") parens++;
      else if (app[k] === ")") { parens--; if (parens === 0) break; }
    }
    k = app.indexOf("{", k);
    let depth = 0;
    for (; k < app.length; k++) {
      if (app[k] === "{") depth++;
      else if (app[k] === "}") { depth--; if (depth === 0) break; }
    }
    return app.slice(from, k + 1);
  }
  const { realNextUnitCost, realProductCostKnown } = new Function(
    `${lift("safeNumber")}
     ${lift("nextUnitCost")}
     ${lift("productCostKnown")}
     return { realNextUnitCost: nextUnitCost, realProductCostKnown: productCostKnown };`
  )();

  function harness(withCost = false) {
    const calls = { transactions: 0, closed: 0, renders: 0, sets: 0, toasts: [] };
    const button = { disabled: false };
    const elements = {
      "#restockDialog": { close: () => { calls.closed += 1; } },
      "#restockQuantityInput": { value: "50" },
      "#restockTotalPaidInput": { value: withCost ? "100000" : "" },
      "#restockTotalPaidError": { textContent: "" },
      "#restockReceiptInput": { value: withCost ? "RCT001" : "" },
      "#restockSupplierInput": { value: withCost ? "Wholesale Ltd" : "" },
      "#confirmRestockButton": button
    };
    const state = {
      pendingRestockProductId: "p1",
      products: [{ id: "p1", name: "Pipe", quantity: 10, storeId: "store-a" }],
      db: {}, businessOwnerUid: "owner", user: { uid: "u1" },
      firebaseApi: { firestore: {
        doc: () => ({}), collection: () => ({}), serverTimestamp: () => "ts",
        // costKnownFrom is stamped with Timestamp.now() on a product whose cost
        // has never been recorded -- which is every product in production, so
        // this is the common path and not an edge case.
        Timestamp: { now: () => "stamped", fromDate: (d) => d },
        runTransaction: async (db, fn) => {
          calls.transactions += 1;
          // The delay is the point: a real transaction is a round trip, and the
          // dialog stays interactive for all of it.
          await new Promise((r) => setTimeout(r, 10));
          await fn({
            get: async () => ({ exists: () => true, data: () => ({ quantity: 10 }) }),
            update: () => {}, set: () => { calls.sets += 1; }
          });
        }
      } }
    };
    const run = new Function(
      "state", "qs", "showToast", "t", "productStoreId", "recordStockMovement",
      "describeOperationError", "renderAll", "console",
      "canRecordCost", "clampNonNegativeNumber", "MAX_MONEY", "safeNumber",
      "nextUnitCost", "productCostKnown", "isOfflineNow", "awaitRestockTransaction",
      `${source} return confirmRestock;`
    )(
      state, (selector) => elements[selector], (m) => calls.toasts.push(m), (key) => key,
      (product) => product.storeId, () => {}, (error, fallback) => fallback,
      () => { calls.renders += 1; }, { warn: () => {} },
      () => withCost, (v, max) => Math.min(Number(v) || 0, max), 1000000000,
      (v) => (Number.isFinite(Number(v)) ? Number(v) : 0),
      realNextUnitCost, realProductCostKnown,
      // The restock path now refuses offline outright and bounds the
      // transaction, because it could otherwise hang forever with the button
      // disabled behind it. Online here, and the race resolved by the attempt --
      // the point of THIS suite is the double-click guard, and the timeout gets
      // its own assertions in purchases.test.mjs.
      () => false,
      (attempt) => attempt.then(() => "committed")
    );
    return { run, calls, button };
  }

  {
    const { run, calls, button } = harness();
    const first = run();
    const second = run();
    check("the button is disabled while the restock is in flight", button.disabled === true);
    await Promise.all([first, second]);
    check("a double-click adds the delivery once, not twice", calls.transactions === 1,
      `${calls.transactions} transactions reached the database`);
    check("and the dialog still closes once", calls.closed === 1);
    check("the button is handed back afterwards", button.disabled === false);
  }

  {
    // A restock that records cost writes a SECOND document -- the purchase --
    // inside the same transaction. So a double-click here does not merely add
    // the delivery twice: it writes the batch to the Purchase Book twice, and
    // moves the weighted average twice off a delivery that arrived once. The
    // guard is the same one, but the damage is larger, so it is asserted
    // separately rather than assumed to carry over.
    const { run, calls, button } = harness(true);
    const first = run();
    const second = run();
    check("the button is disabled while a costed restock is in flight", button.disabled === true);
    await Promise.all([first, second]);
    check("a double-click records the delivery once", calls.transactions === 1,
      `${calls.transactions} transactions reached the database`);
    // Three writes per costed restock: the cost document, the purchase, and the
    // audit entry. Cost moved out of the product into /productCosts so a cashier
    // cannot read it, which added the third.
    check("...and writes the purchase once, not twice", calls.sets === 3,
      `${calls.sets} documents were set — a doubled purchase doubles the average`);
    check("the button is handed back afterwards", button.disabled === false);
  }

  {
    // The no-cost path must still write only the audit entry. If a purchase
    // document appears here, a cashier's quantity-only restock is inventing a
    // cost record the rules would refuse.
    const { run, calls } = harness(false);
    await run();
    check("a restock with no cost writes no purchase document", calls.sets === 1,
      `${calls.sets} documents were set — expected the audit entry alone`);
  }

  {
    const { run, calls } = harness();
    await run();
    await run();
    check("two deliberate restocks both go through", calls.transactions === 2);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
