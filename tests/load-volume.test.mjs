// The data layer under volume.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node load-volume.test.mjs"
//
// load-client.test.mjs measures what the browser does with data once it has it.
// This measures getting it: the exact queries app.js issues, against a tenant
// with a realistic catalogue and sales history, as both an owner and a staff
// member.
//
// The owner/staff split is the point of several assertions below. Every staff
// read resolves role and store access through get() on their member document --
// a deliberate trade recorded in firestore.rules, chosen over custom claims so
// revocation lands on the next request. That choice has a price, and it had
// never been measured. An owner short-circuits past it at isOwner().
//
// One thing this file CANNOT tell you: the emulator creates composite indexes
// on demand, so a query that would need an index in production passes here
// silently. The index coverage check at the end is static against
// firestore.indexes.json for that reason.
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  doc, setDoc, getDocs, collection, query, where, orderBy, limit, runTransaction, writeBatch
} from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_load";
const CASHIER = "cashier_load";
const STORE_A = "storeA";

const PRODUCTS = 800;
const SALES = 1600;
const MOVEMENTS = 600;

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
               host: "127.0.0.1", port: 8085 }
});
await testEnv.clearFirestore();

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

process.stdout.write(`seeding ${PRODUCTS} products, ${SALES} sales, ${MOVEMENTS} ledger entries... `);
const seedStart = Date.now();
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A", createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "members", CASHIER),
    { role: "cashier", status: "active", storeIds: [STORE_A] });

  const writes = [];
  for (let i = 0; i < PRODUCTS; i++) {
    writes.push([doc(db, "users", OWNER, "products", `p${i}`), {
      name: `Item ${i}`, category: "Food", brand: "B", supplier: "S",
      quantity: i % 97, storeId: STORE_A, sellingPrice: 1000 + i,
      sold30: 0, sold90: 0, createdAt: new Date(NOW - (i % 300) * DAY)
    }]);
  }
  for (let i = 0; i < SALES; i++) {
    writes.push([doc(db, "users", OWNER, "sales", `s${i}`), {
      items: [{ productId: `p${i % PRODUCTS}`, name: "Item", qty: 2, lineTotal: 2000 }],
      total: 2000, cashierUid: CASHIER, voided: false, storeId: STORE_A,
      staffId: "st1", staffName: "Asha", orderNumber: String(1000 + i),
      paymentMethod: "cash", cashTendered: 2000, changeDue: 0, branchId: null,
      createdAt: new Date(NOW - (i % 90) * DAY)
    }]);
  }
  for (let i = 0; i < MOVEMENTS; i++) {
    writes.push([doc(db, "users", OWNER, "stockMovements", `m${i}`), {
      productId: `p${i % PRODUCTS}`, storeId: STORE_A, reason: "sale",
      delta: -1, quantityBefore: 10, quantityAfter: 9, uid: CASHIER,
      createdAt: new Date(NOW - (i % 30) * DAY)
    }]);
  }
  // Batched, not one round trip per document. Seeding thousands of docs
  // individually took longer than the queries this file exists to measure.
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    for (const [ref, data] of writes.slice(i, i + 400)) batch.set(ref, data);
    await batch.commit();
  }
});
console.log(`${((Date.now() - seedStart) / 1000).toFixed(1)}s`);

const ownerDb = testEnv.authenticatedContext(OWNER).firestore();
const cashierDb = testEnv.authenticatedContext(CASHIER).firestore();

async function timed(fn) {
  const t0 = performance.now();
  const out = await fn();
  return { ms: performance.now() - t0, out };
}

console.log("\n=== the queries app.js actually issues, at volume ===");
{
  // subscribeToProducts: unbounded for an owner. This is L-8 measured.
  const r = await timed(() => getDocs(collection(ownerDb, "users", OWNER, "products")));
  check(`owner reads the whole catalogue (${r.out.size} docs)`, r.out.size === PRODUCTS,
    `expected ${PRODUCTS}, got ${r.out.size}`);
  check("an unbounded catalogue read completes in reasonable time", r.ms < 8000, `${r.ms.toFixed(0)}ms`);
  console.log(`      products, unbounded: ${r.ms.toFixed(0)}ms for ${r.out.size} docs`);
}
{
  // Staff pay for member get()s on every document. Same query, scoped.
  const r = await timed(() => getDocs(query(
    collection(cashierDb, "users", OWNER, "products"), where("storeId", "in", [STORE_A]))));
  check(`cashier reads the store-scoped catalogue (${r.out.size} docs)`, r.out.size === PRODUCTS);
  check("store-scoped catalogue read completes in reasonable time", r.ms < 12000, `${r.ms.toFixed(0)}ms`);
  console.log(`      products, staff store-scoped: ${r.ms.toFixed(0)}ms`);
}
{
  // subscribeToSales: newest SALES_HISTORY_LIMIT, which is the shape that
  // matters -- an unbounded sales read would be the real hazard.
  const r = await timed(() => getDocs(query(
    collection(ownerDb, "users", OWNER, "sales"), orderBy("createdAt", "desc"), limit(1000))));
  check("the bounded sales window returns exactly its limit", r.out.size === Math.min(1000, SALES), `got ${r.out.size}`);
  check("the sales window is fast regardless of history size", r.ms < 6000, `${r.ms.toFixed(0)}ms`);
  console.log(`      sales, limit 1000 of ${SALES}: ${r.ms.toFixed(0)}ms`);
}
{
  const r = await timed(() => getDocs(query(
    collection(ownerDb, "users", OWNER, "stockMovements"), orderBy("createdAt", "desc"), limit(500))));
  check("the ledger window returns exactly its limit", r.out.size === 500, `got ${r.out.size}`);
  check("the ledger window is fast", r.ms < 5000, `${r.ms.toFixed(0)}ms`);
  console.log(`      stockMovements, limit 500 of ${MOVEMENTS}: ${r.ms.toFixed(0)}ms`);
}

console.log("\n=== a bounded window does not get slower as history grows ===");
{
  // The property that matters for a shop trading for years: cost tracks the
  // window, not the archive behind it.
  const small = await timed(() => getDocs(query(
    collection(ownerDb, "users", OWNER, "sales"), orderBy("createdAt", "desc"), limit(50))));
  const large = await timed(() => getDocs(query(
    collection(ownerDb, "users", OWNER, "sales"), orderBy("createdAt", "desc"), limit(1000))));
  check("a 20x larger window is not 20x slower than the small one plus overhead",
    large.ms < small.ms * 20 + 2000,
    `limit 50 ${small.ms.toFixed(0)}ms, limit 1000 ${large.ms.toFixed(0)}ms`);
}

console.log("\n=== many tills at once ===");
{
  // Ten concurrent stock writes against distinct products, as ten tills would.
  // Indexed inside the seeded range -- an id past PRODUCTS would be a
  // transaction against a document that does not exist, which proves nothing
  // about contention.
  const TILLS = 10;
  const base = PRODUCTS - TILLS - 1;
  const sale = (i) => runTransaction(cashierDb, async (transaction) => {
    const ref = doc(cashierDb, "users", OWNER, "products", `p${base + i}`);
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error(`p${base + i} missing from the seed`);
    const qty = Number(snap.data().quantity || 0);
    transaction.update(ref, { quantity: qty + 1, sold30: 0, sold90: 0, movementReason: "restock" });
  });

  // settled, not all() -- the point is to observe how many succeeded, and
  // `check(..., true)` would pass whatever happened.
  const t0 = performance.now();
  const settled = await Promise.allSettled(Array.from({ length: TILLS }, (_, i) => sale(i)));
  const ms = performance.now() - t0;
  const ok = settled.filter((s) => s.status === "fulfilled").length;
  check(`all ${TILLS} concurrent till writes succeed`, ok === TILLS,
    `${ok}/${TILLS} succeeded; first failure: ${settled.find((s) => s.status === "rejected")?.reason?.message || "none"}`);
  check("ten concurrent till writes complete promptly", ms < 15000, `${ms.toFixed(0)}ms`);
  console.log(`      ${TILLS} concurrent transactions: ${ms.toFixed(0)}ms, ${ok} succeeded`);
}

console.log("\n=== failure injection: a refused ledger entry takes the sale with it ===");
{
  // The stock ledger is written inside the sale transaction. That was a
  // deliberate choice -- a ledger written separately can be lost by the crash
  // that makes it matter -- and it carries a stated cost: a rejected entry
  // rolls the sale back. That claim had never been proved, only argued.
  //
  // Here the entry is deliberately malformed (a forged uid, which the rule
  // refuses). What must NOT happen is a half-applied sale: stock down with no
  // sale document, or a sale recorded with no ledger entry. Either would be
  // worse than the failure itself, because it is silent.
  const productRef = doc(cashierDb, "users", OWNER, "products", "p5");
  const before = (await getDocs(query(
    collection(ownerDb, "users", OWNER, "products"), where("name", "==", "Item 5")))).docs[0];
  const beforeQty = Number(before.data().quantity || 0);

  let refused = false;
  try {
    await runTransaction(cashierDb, async (transaction) => {
      const snap = await transaction.get(productRef);
      const qty = Number(snap.data()?.quantity || 0);
      transaction.update(productRef, { quantity: qty - 1, sold30: 1, sold90: 1, movementReason: "sale" });
      transaction.set(doc(collection(cashierDb, "users", OWNER, "stockMovements")), {
        productId: "p5", storeId: STORE_A, reason: "sale", delta: -1,
        quantityBefore: qty, quantityAfter: qty - 1,
        uid: OWNER, // forged: the rule requires uid == request.auth.uid
        createdAt: new Date()
      });
    });
  } catch (error) {
    refused = true;
  }
  check("a forged ledger entry is refused", refused,
    "the rule requires uid == request.auth.uid; if this succeeded the ledger could be attributed to anyone");

  const after = (await getDocs(query(
    collection(ownerDb, "users", OWNER, "products"), where("name", "==", "Item 5")))).docs[0];
  check("the stock movement rolled back with it",
    Number(after.data().quantity || 0) === beforeQty,
    `quantity was ${beforeQty}, is now ${after.data().quantity} -- a half-applied sale is worse than a refused one`);

  const orphans = await getDocs(query(
    collection(ownerDb, "users", OWNER, "stockMovements"), where("uid", "==", OWNER)));
  check("no ledger entry survives the rollback", orphans.size === 0, `${orphans.size} orphaned entries`);
}

console.log("\n=== composite indexes the client needs are declared ===");
{
  // The emulator builds indexes on demand, so a missing production index passes
  // here in silence. This is therefore a static check against the deploy file.
  const indexes = JSON.parse(readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
  const declared = (indexes.indexes || []).map((entry) =>
    `${entry.collectionGroup}:${(entry.fields || []).map((f) => f.fieldPath).join(",")}`);
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

  // Every query pairing a where() with an orderBy() on a different field needs
  // one. These are the pairings app.js issues today.
  const needed = [
    ["sales", "storeId,createdAt"],
    ["transfers", "sourceStoreId,createdAt"],
    ["transfers", "destinationStoreId,createdAt"],
    ["shifts", "storeId,openedAt"],
    ["auditLogs", "action,createdAt"]
  ];
  for (const [group, fields] of needed) {
    const has = declared.some((d) => d.startsWith(`${group}:`) &&
      fields.split(",").every((f) => d.includes(f)));
    check(`${group} (${fields}) has a declared index`, has,
      `app.js issues this pairing; without the index it fails in production and passes here`);
  }
  check("the stock ledger query needs no composite index",
    !/stockMovements[\s\S]{0,200}where\(/.test(app),
    "orderBy alone is served by the automatic single-field index");
}

await testEnv.cleanup();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
