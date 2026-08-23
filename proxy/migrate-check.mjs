// Temporary harness: proves the migration removes exactly the two fields, from
// exactly the documents that have them, and nothing else.
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { execFileSync } from "node:child_process";

// This harness SEEDS documents. Run against production credentials by accident
// and it writes test products into a real shop's inventory, so it refuses to
// run anywhere but an emulator. The migration itself has the opposite default
// (dry run) for the same reason: neither should be able to surprise anyone.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST is not set.");
  console.error("This harness writes test documents and must never touch a real project.");
  process.exit(2);
}
if (!getApps().length) initializeApp({ projectId: "sanitaryflow-erp" });
const db = getFirestore();

const A = "tenantA", B = "tenantB";
const base = { name: "Lotion", category: "C", brand: "B", supplier: "S",
               quantity: 7, sellingPrice: 1200, storeId: "s1", sku: "SKU-1" };

await db.doc(`users/${A}/products/p1`).set({ ...base, costPrice: 0 });
await db.doc(`users/${A}/products/p2`).set({ ...base, costPrice: 5000, costKnownFrom: new Date() });
await db.doc(`users/${A}/products/p3`).set({ ...base });                 // clean already
await db.doc(`users/${B}/products/p4`).set({ ...base, costKnownFrom: new Date() });
await db.doc(`users/${B}/sales/s1`).set({ total: 999, costPrice: 123 }); // must NOT be touched

const run = (...flags) => execFileSync("node", ["migrate-strip-product-cost.mjs", ...flags],
  { encoding: "utf8", env: { ...process.env } });

let fail = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (ok ? "" : `  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`));
};

const dry = run();
check("dry run finds all three affected", /carrying legacy cost  : 3/.test(dry), true);
const stillThere = (await db.doc(`users/${A}/products/p1`).get()).data();
check("dry run wrote NOTHING", Object.prototype.hasOwnProperty.call(stillThere, "costPrice"), true);

run("--apply");

const p1 = (await db.doc(`users/${A}/products/p1`).get()).data();
const p2 = (await db.doc(`users/${A}/products/p2`).get()).data();
const p3 = (await db.doc(`users/${A}/products/p3`).get()).data();
const p4 = (await db.doc(`users/${B}/products/p4`).get()).data();
const sale = (await db.doc(`users/${B}/sales/s1`).get()).data();

check("costPrice removed", "costPrice" in p1, false);
check("both fields removed", ["costPrice" in p2, "costKnownFrom" in p2], [false, false]);
check("every other field survived", [p2.name, p2.quantity, p2.sellingPrice, p2.sku], ["Lotion", 7, 1200, "SKU-1"]);
check("an already-clean product is untouched", p3.name, "Lotion");
check("second tenant migrated too", "costKnownFrom" in p4, false);
check("a NON-product doc with costPrice is left alone", sale.costPrice, 123);

let verifyOut = "", verifyCode = 0;
try { verifyOut = run("--verify"); } catch (e) { verifyOut = String(e.stdout || ""); verifyCode = 1; }
check("verify reports clean", /VERIFIED CLEAN/.test(verifyOut) && verifyCode === 0, true);

const again = run("--apply");
check("re-running is a no-op (idempotent)", /carrying legacy cost  : 0/.test(again), true);

console.log(fail ? `\n${fail} FAILED` : "\nall migration checks passed");
process.exit(fail ? 1 : 0);
