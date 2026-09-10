// Catalogue scale benchmark. NOT part of `npm test` -- it seeds tens of
// thousands of documents and takes minutes.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node bench-catalogue.mjs"
//
// Why this exists: `products` and `productCosts` are the only two live
// subscriptions that grow with the size of the business, and the owner's
// products query carries no `where` and no `limit` at all. Everything else in
// the app is bounded -- sales 1000, purchases 1000, movements 500 -- so this
// pair is the whole vertical ceiling, and nothing measured it. load-volume
// seeds 800 products, which is roughly a duka and twelve times below the
// catalogue the prospective client described.
//
// It measures the shape of the problem rather than asserting a threshold:
// wall-clock is an emulator on this machine, not a handset on Tanzanian 3G.
// The document COUNTS are the real finding, because they are what a quota and
// a phone's memory are spent on, and they do not depend on this hardware.
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, setDoc, collection, getDocs, query, where, limit as fbLimit } from "firebase/firestore";
import { writeBatch } from "firebase/firestore";

const OWNER = "ownerUid";
const CASHIER = "cashierUid";
const BRANCHES = ["branchA", "branchB", "branchC"];
// The client's own figure: >10,000 SKUs per branch, several branches.
const SKUS_PER_BRANCH = Number(process.env.SKUS || 10000);

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") }
});

const total = SKUS_PER_BRANCH * BRANCHES.length;
console.log(`Seeding ${total.toLocaleString()} products across ${BRANCHES.length} branches`
  + ` plus one cost document each...`);
const t0 = Date.now();

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  for (const b of BRANCHES) await setDoc(doc(db, "users", OWNER, "stores", b), { name: b, createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "members", CASHIER),
    { role: "cashier", status: "active", storeIds: [BRANCHES[0]] });

  let batch = writeBatch(db);
  let n = 0;
  const flush = async () => { await batch.commit(); batch = writeBatch(db); n = 0; };
  for (const b of BRANCHES) {
    for (let i = 0; i < SKUS_PER_BRANCH; i++) {
      const id = `${b}-p${i}`;
      batch.set(doc(db, "users", OWNER, "products", id), {
        name: `Item ${i} ${b}`, category: `Cat ${i % 40}`, brand: `Brand ${i % 120}`,
        quantity: i % 97, storeId: b, sellingPrice: 1000 + i, unit: "pc",
        active: true, reorderLevel: 5, createdAt: new Date()
      });
      if (++n >= 400) await flush();
      // One cost document per product -- this is the half of the read cost
      // that is easy to miss when counting "the catalogue".
      batch.set(doc(db, "users", OWNER, "productCosts", id), { costPrice: 500 + i, updatedAt: new Date() });
      if (++n >= 400) await flush();
    }
  }
  if (n) await batch.commit();
});
console.log(`  seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

const ownerDb = testEnv.authenticatedContext(OWNER).firestore();
const staffDb = testEnv.authenticatedContext(CASHIER).firestore();

async function measure(label, run) {
  const t = Date.now();
  const snap = await run();
  const ms = Date.now() - t;
  console.log(`  ${label.padEnd(46)} ${String(snap.size).padStart(7)} docs   ${String(ms).padStart(6)}ms`);
  return { docs: snap.size, ms };
}

console.log("What one cold start costs today");
const ownerProducts = await measure("owner, products, unfiltered (today)",
  () => getDocs(collection(ownerDb, "users", OWNER, "products")));
const ownerCosts = await measure("owner, productCosts, unfiltered (today)",
  () => getDocs(collection(ownerDb, "users", OWNER, "productCosts")));

console.log("\nWhat it would cost scoped to one branch");
const scopedProducts = await measure("owner, products, where storeId == branchA",
  () => getDocs(query(collection(ownerDb, "users", OWNER, "products"), where("storeId", "==", BRANCHES[0]))));
const staffProducts = await measure("staff, products, where storeId in [branchA]",
  () => getDocs(query(collection(staffDb, "users", OWNER, "products"), where("storeId", "in", [BRANCHES[0]]))));

console.log("\nWhat a bounded window would cost");
await measure("products, limit 500",
  () => getDocs(query(collection(ownerDb, "users", OWNER, "products"), fbLimit(500))));

const todayDocs = ownerProducts.docs + ownerCosts.docs;
const scopedDocs = scopedProducts.docs;
const SPARK_READS = 50000;

console.log(`
Reads on a single owner cold start
  today, all branches ................ ${todayDocs.toLocaleString()}
  scoped to one branch ............... ${scopedDocs.toLocaleString()} (+ its costs)
  Spark daily read quota ............. ${SPARK_READS.toLocaleString()}
  cold starts before the quota is gone ${(SPARK_READS / todayDocs).toFixed(2)}

The wall-clock above is an emulator on this machine and says little about a
handset. The counts are the finding: ${todayDocs.toLocaleString()} documents is
${(todayDocs / SPARK_READS * 100).toFixed(0)}% of a day's Spark quota spent by one
person opening the app once, and the same documents have to be parsed and held
in a browser on a cheap Android.`);

await testEnv.cleanup();
