// Diagnostic: does a cashier's worst-case sale still fit inside Firestore's
// 1000-expression evaluation ceiling after the QA-003 bounds were added?
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp "node sale-budget-probe.mjs"
//
// This path has blown the budget before. validSale() is the hottest write in
// the schema and the one where a staff member pays for every member get(), so
// each new condition is worth measuring rather than assuming.
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_budget";
const CASHIER = "cashier_budget";
const STORE = "storeBudget";

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 }
});
await testEnv.clearFirestore();
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE), { name: "Branch", createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "members", CASHIER), {
    role: "cashier", status: "active", storeIds: [STORE]
  });
});

const cashier = testEnv.authenticatedContext(CASHIER).firestore();

function sale(lineCount) {
  return {
    items: Array.from({ length: lineCount }, (_, i) => ({
      productId: `p${i}`, name: `Item ${i}`, quantity: 2, sellingPrice: 1500
    })),
    total: lineCount * 3000,
    subtotal: lineCount * 3000,
    discountType: "none",
    discountValue: 0,
    discountAmount: 0,
    cashierUid: CASHIER,
    voided: false,
    storeId: STORE,
    staffId: "st1",
    staffName: "Asha",
    orderNumber: "1234567890",
    paymentMethod: "cash",
    amountPaid: lineCount * 3000,
    balanceDue: 0,
    createdAt: serverTimestamp()
  };
}

console.log("lines | verdict");
console.log("------|--------");
for (const lines of [1, 2, 5, 10, 20, 39, 40]) {
  let verdict;
  try {
    await setDoc(doc(cashier, "users", OWNER, "sales", `sale_${lines}`), sale(lines));
    verdict = "accepted";
  } catch (error) {
    const text = String(error);
    verdict = /evaluation error|too many expression/i.test(text)
      ? "BUDGET EXCEEDED"
      : /PERMISSION_DENIED/.test(text) ? "denied (rule said no)" : text.slice(0, 60);
  }
  console.log(`${String(lines).padStart(5)} | ${verdict}`);
}

// 41 is over the documented item cap and must be refused by the rule itself,
// not by running out of budget.
try {
  await setDoc(doc(cashier, "users", OWNER, "sales", "sale_41"), sale(41));
  console.log("   41 | ACCEPTED -- the 40-item cap is not being enforced");
} catch {
  console.log("   41 | denied (over the 40-item cap, as intended)");
}

await testEnv.cleanup();
