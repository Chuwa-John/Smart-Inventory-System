// Finds what pushes validSale() past Firestore's 1000-expression ceiling for a
// staff member, by rewriting the rules in memory and re-testing the same write.
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_probe";
const CASHIER = "cashier_probe";
const STORE = "storeProbe";
const baseRules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

function unrollTo(rules, n) {
  const calls = [];
  for (let i = 0; i < n; i++) calls.push(`itemValidAt(items, ${i})`);
  return rules.replace(
    /function allItemsValid\(items\) \{\s*return [\s\S]*?;\s*\}/,
    `function allItemsValid(items) {\n      return ${calls.join(" &&\n        ")};\n    }`
  );
}

function trimItemChecks(rules) {
  return rules.replace(
    /function validSaleItem\(item\) \{[\s\S]*?\n    \}/,
    `function validSaleItem(item) {
      return item.productId is string && item.productId.size() <= 128
        && item.name is string && item.name.size() > 0 && item.name.size() <= 120
        && item.qty is number && item.qty > 0 && item.qty <= 100000
        && item.lineTotal is number && item.lineTotal >= 0;
    }`
  );
}

const makeItem = (i) => ({
  productId: `p${i}`, name: `Item ${i}`, category: "Milk", brand: "Festive",
  supplier: "Festive Ltd", qty: 15, sellingPrice: 5000, lineTotal: 75000
});

async function trial(label, rules, itemCount) {
  const testEnv = await initializeTestEnvironment({
    projectId: `probe-${Math.random().toString(36).slice(2, 10)}`,
    firestore: { rules, host: "127.0.0.1", port: 8085 }
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", OWNER), { uid: OWNER });
    await setDoc(doc(db, "users", OWNER, "stores", STORE), { name: "S", createdAt: new Date() });
    await setDoc(doc(db, "users", OWNER, "members", CASHIER), { role: "cashier", status: "active", storeIds: [STORE] });
  });
  const db = testEnv.authenticatedContext(CASHIER).firestore();
  const sale = {
    items: Array.from({ length: itemCount }, (_, i) => makeItem(i)),
    subtotal: 100, total: 100, paymentMethod: "cash", cashTendered: 100, changeDue: 0,
    storeId: STORE, branchId: STORE, cashierUid: CASHIER, staffId: CASHIER,
    staffName: "John Chuwa", orderNumber: "5489513241", voided: false, createdAt: serverTimestamp()
  };
  let outcome;
  try {
    await setDoc(doc(db, "users", OWNER, "sales", `ord_${CASHIER}_${itemCount}`), sale);
    outcome = "ALLOWED";
  } catch (e) {
    outcome = /maximum of 1000 expressions/.test(String(e.message)) ? "BUDGET EXCEEDED" : "DENIED (other)";
  }
  console.log(`  ${outcome.padEnd(16)} ${label}, ${itemCount} item(s)`);
  await testEnv.cleanup();
  return outcome;
}

console.log("\n=== current rules (40 slots, full per-item checks) ===");
for (const n of [1, 2, 5]) await trial("as shipped", baseRules, n);

console.log("\n=== fewer unrolled slots, same per-item checks ===");
for (const slots of [30, 20, 10]) {
  await trial(`${slots} slots`, unrollTo(baseRules, slots), 2);
}

console.log("\n=== trimmed per-item checks, 40 slots ===");
await trial("trimmed checks", trimItemChecks(baseRules), 2);

console.log("\n=== trimmed per-item checks + 20 slots ===");
for (const n of [1, 2, 10, 20]) {
  await trial("trimmed + 20 slots", trimItemChecks(unrollTo(baseRules, 20)), n);
}
