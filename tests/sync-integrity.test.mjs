// Phase 22: offline behaviour and synchronisation.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node sync-integrity.test.mjs"
//
// The defect this exists for, verified against the emulator before it was
// fixed: the product edit form carries every field, so saving a PRICE wrote
// back whatever quantity the form happened to be holding. A cashier selling
// five between the dialog opening and the owner pressing save had those five
// put back on the shelf -- stock went 40 -> 35 -> 40.
//
// Offline is where it turns nasty. A queued write lands whenever the connection
// returns, so an edit made in the morning can silently reverse a day of sales.
// That is the "two devices editing the same record" case, and Firestore's
// last-write-wins is doing exactly what it promises: the fault is sending a
// field nobody changed.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, runTransaction, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_sync";
const CASHIER = "cashier_sync";
const STORE = "storeSync";
const CREATED = new Date("2026-07-01T08:00:00Z");

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
               host: "127.0.0.1", port: 8085 }
});

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}
async function checkAsync(name, promise, detail = "") {
  try { await promise; check(name, true); } catch (e) { check(name, false, detail || String(e).slice(0, 110)); }
}

// Created ONCE. Calling authenticatedContext().firestore() per use hands back a
// different Firestore instance each time, and a transaction given references
// from two of them fails with "different Firestore instance".
const dbOwner = testEnv.authenticatedContext(OWNER).firestore();
const dbCashier = testEnv.authenticatedContext(CASHIER).firestore();
const as = (uid) => (uid === OWNER ? dbOwner : dbCashier);
const pref = (db) => doc(db, "users", OWNER, "products", "p1");

async function seed(quantity = 40) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
    await setDoc(doc(db, "users", OWNER, "stores", STORE), { name: "Branch" });
    await setDoc(doc(db, "users", OWNER, "members", CASHIER), { role: "cashier", status: "active", storeIds: [STORE] });
    await setDoc(pref(db), {
      id: "p1", name: "Sukari", category: "Food", brand: "X", supplier: "Y",
      quantity, storeId: STORE, sellingPrice: 1500, sold30: 0, sold90: 0, createdAt: CREATED
    });
  });
}
const stock = async () => (await getDoc(pref(as(OWNER)))).data().quantity;

// What saveProduct now sends: the form's fields, with stock omitted when the
// owner did not touch the box.
function ownerSave(form, changes, quantityUntouched) {
  const payload = { ...form, ...changes, updatedAt: new Date() };
  if (quantityUntouched) { delete payload.quantity; delete payload.sold30; delete payload.sold90; }
  else payload.movementReason = "correction";
  return setDoc(pref(as(OWNER)), payload, { merge: true });
}

console.log("=== a price edit no longer resurrects sold stock ===");
{
  await seed(40);
  const form = (await getDoc(pref(as(OWNER)))).data();     // dialog opens, holds 40
  await runTransaction(as(CASHIER), async (tx) => {         // cashier sells five
    const s = await tx.get(pref(as(CASHIER)));
    tx.update(pref(as(CASHIER)), { quantity: s.data().quantity - 5, sold30: 5, movementReason: "sale" });
  });
  check("the cashier's sale landed", (await stock()) === 35);

  await ownerSave(form, { sellingPrice: 1600 }, true);      // price only
  const after = await stock();
  check("the owner's price change leaves stock alone", after === 35,
    `stock is ${after} — 40 means the five sold units came back`);
  check("...and the price actually changed",
    (await getDoc(pref(as(OWNER)))).data().sellingPrice === 1600);
  check("...and the sold counters were not reset either",
    (await getDoc(pref(as(OWNER)))).data().sold30 === 5);
}

console.log("\n=== a deliberate stock correction still works ===");
{
  await seed(40);
  const form = (await getDoc(pref(as(OWNER)))).data();
  // The owner counted the shelf and found 37.
  await ownerSave(form, { quantity: 37 }, false);
  check("an owner who counted the shelf can correct it", (await stock()) === 37);
  check("the correction is reasoned in the record",
    (await getDoc(pref(as(OWNER)))).data().movementReason === "correction");
}

console.log("\n=== a cashier cannot dress a stock decrease as a correction ===");
{
  await seed(40);
  // Staff writes go through validStockMovementUpdate, whose enum is
  // sale/restock/return/void. "correction" is deliberately not in it: a cashier
  // able to label stock leaving as a correction rather than a sale has a way to
  // move goods without a sale to match.
  await checkAsync("a cashier's 'correction' is refused",
    assertFails(updateDoc(pref(as(CASHIER)), { quantity: 30, movementReason: "correction" })));
  check("stock is untouched by the refusal", (await stock()) === 40);
  await checkAsync("a cashier's ordinary sale is still fine",
    assertSucceeds(updateDoc(pref(as(CASHIER)), { quantity: 35, sold30: 5, movementReason: "sale" })));
}

console.log("\n=== the code keeps the guarantee, not just this run ===");
{
  check("the form records the stock it opened with",
    /state\.productFormOpeningQuantity = product \? safeNumber\(product\.quantity\) : null/.test(app));
  check("an untouched stock box is not sent at all",
    /if \(quantityUntouched\) \{[\s\S]{0,140}delete payload\.quantity/.test(app));
  check("the sold counters are withheld with it",
    /delete payload\.sold30;[\s\S]{0,40}delete payload\.sold90;/.test(app));
  check("a real change is reasoned as a correction",
    /payload\.movementReason = "correction"/.test(app));
  check("a NEW product still writes its opening stock",
    /const quantityUntouched = existing && opened !== null/.test(app),
    "without the existing check, creating a product would drop its stock");
}

console.log("\n=== what the till can and cannot do without a connection ===");
{
  // Selling uses a transaction, and a Firestore transaction needs a round trip.
  // The app must therefore say so rather than appear to work -- checked in
  // source because the emulator cannot be taken offline mid-transaction here.
  check("selling is transactional, so it cannot complete offline",
    /await runTransaction\(state\.db, async \(transaction\)/.test(app));
  check("the app watches the connection", /function watchConnection\(/.test(app));
  check("and tells the shop plainly", /offline\.bannerText/.test(app));
  check("a failed write is explained, not echoed raw",
    /describeOperationError\(error, "toast\.saleFailedGeneric"\)/.test(app));
  check("reads keep working from the local cache",
    /persistentLocalCache\(/.test(app));
}

console.log("\n=== a retried sale cannot become two sales ===");
{
  // The offline case that matters most: a queued or re-tapped submission.
  check("sales are keyed deterministically, not by random id",
    /const dedupeSaleId = `ord_\$\{seller\.id\}_\$\{orderNumber\}`/.test(app));
  check("a deliberate re-entry is given its own id",
    /duplicate \? `\$\{dedupeSaleId\}_dup\$\{Date\.now\(\)\}`/.test(app));
  check("the transaction refuses a second write to the same id",
    /existingSaleSnap[\s\S]{0,200}txerror\.duplicateOrderSubmission/.test(app));
}

await testEnv.cleanup();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
