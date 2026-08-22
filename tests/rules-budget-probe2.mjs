// SUPERSEDED -- DO NOT RUN. Kept as a record, not as an instrument.
//
// This probe tested whether collapsing the duplicate member get()s into a single
// helper would buy back expression budget on the sale path. It did, the change
// shipped, and firestore.rules now defines memberSellsInStore() for real. So the
// probe injects a SECOND definition of a function that already exists and fails
// at rules-compile time with "Function memberSellsInStore is already defined" --
// and its .replace() no longer matches the two-call `allow create` it was
// written against either.
//
// It is registered nowhere (not tests/package.json, not ci.yml) and cannot break
// a run. It is documented here because DESIGN-purchases.md once said to re-run
// "rules-budget-probe*.mjs" after every rules change, and following that
// literally sends someone chasing a compile error for an hour. The live probes
// are rules-budget-probe.mjs, sale-budget-probe.mjs and manager-paths-probe.mjs.

// Second probe: does collapsing the repeated member get() calls buy enough
// expression budget to keep full per-item validation for a realistic cart?
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_probe";
const CASHIER = "cashier_probe";
const STORE = "storeProbe";
const baseRules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

// One get() for role AND store, instead of isOwnerOrRole() + memberCanAccessStore()
// each doing their own.
function singleGetSaleCreate(rules) {
  const helper = `
    function memberSellsInStore(ownerUid, storeId) {
      let m = get(memberDocPath(ownerUid)).data;
      return exists(memberDocPath(ownerUid))
        && m.status == "active"
        && m.role in ["manager", "cashier"]
        && (("all" in m.storeIds) || (storeId in m.storeIds));
    }
`;
  return rules
    .replace("    function isOwnerOrRole(ownerUid, roles) {", helper + "    function isOwnerOrRole(ownerUid, roles) {")
    .replace(
      /allow create: if tenantNotFrozen\(userId\) && isOwnerOrRole\(userId, \["manager", "cashier"\]\) && validSale\(\)\s*\n\s*&& \(isOwner\(userId\) \|\| memberCanAccessStore\(userId, request\.resource\.data\.storeId\)\);/,
      `allow create: if tenantNotFrozen(userId) && validSale()
          && (isOwner(userId) || memberSellsInStore(userId, request.resource.data.storeId));`
    );
}

function noPerItemChecks(rules) {
  return rules.replace(
    /function allItemsValid\(items\) \{\s*return [\s\S]*?;\s*\}/,
    `function allItemsValid(items) {\n      return true;\n    }`
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

console.log("\n=== single member get(), full per-item checks, 40 slots ===");
for (const n of [2, 5, 10, 20, 40]) await trial("single-get", singleGetSaleCreate(baseRules), n);

console.log("\n=== single member get() + no per-item content checks ===");
for (const n of [2, 20, 40]) await trial("single-get + no item checks", noPerItemChecks(singleGetSaleCreate(baseRules)), n);
