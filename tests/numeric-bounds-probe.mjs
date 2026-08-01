// Diagnostic for QA-003: what numbers do the rules actually accept today?
// Not a regression test -- this exists to replace guessing with measurement
// before choosing ceilings.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp "node numeric-bounds-probe.mjs"
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_uid_1";
const STORE_A = "storeA";

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 }
});
await testEnv.clearFirestore();
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A", createdAt: new Date() });
});

const owner = testEnv.authenticatedContext(OWNER).firestore();

const candidates = [
  ["a normal price", 5000],
  ["1 million", 1e6],
  ["1 billion", 1e9],
  ["beyond 2^53 (integer precision is lost)", 1e17],
  ["1e308 (near the float ceiling)", 1e308],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
  ["NaN", NaN],
  ["negative", -1]
];

console.log("field      | case                                    | rules verdict");
console.log("-----------|-----------------------------------------|--------------");
for (const field of ["quantity", "sellingPrice"]) {
  for (const [label, value] of candidates) {
    const payload = {
      name: "Probe", category: "Food", brand: "X", supplier: "Y",
      quantity: 1, sellingPrice: 1, storeId: STORE_A, createdAt: new Date()
    };
    payload[field] = value;
    let verdict;
    try {
      await setDoc(doc(owner, "users", OWNER, "products", `probe_${field}_${label.replace(/\W/g, "")}`), payload);
      verdict = "ACCEPTED";
    } catch (error) {
      verdict = /PERMISSION_DENIED/.test(String(error)) ? "denied by rules" : `rejected: ${String(error).slice(0, 40)}`;
    }
    console.log(`${field.padEnd(10)} | ${label.padEnd(39)} | ${verdict}`);
  }
}

// What the arithmetic does with a value that got through.
console.log("\nWhat a sale total does with an accepted-but-absurd value:");
for (const [label, qty, price] of [
  ["1e17 x 100", 1e17, 100],
  ["Infinity x 100", Infinity, 100],
  ["9007199254740993 (2^53+1) x 1", 9007199254740993, 1]
]) {
  const total = qty * price;
  console.log(`  ${label.padEnd(32)} -> ${total}  (safe integer: ${Number.isSafeInteger(total)})`);
}

await testEnv.cleanup();
