// Whether a closing cashier can choose their own variance.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node rules-shift-variance.test.mjs"
//
// rules-shifts.test.mjs already proves a close cannot rewrite how the shift
// OPENED -- the float is pinned, so a short drawer cannot be explained away by
// claiming it started fuller. This file asks the other half of the same
// question, which that one does not: can the closing figures simply be
// invented?
//
// The drawer is judged by
//
//     variance = countedCash - expectedCash
//     expectedCash = openingFloat + cashSales - cashRefunds + cashRepayments
//
// and closeShift() in app.js computes and writes all five numbers from the
// client. If the rules only range-check them, the person holding the cash
// supplies both sides of the subtraction that is supposed to catch them, and a
// shift that is 50,000 short closes as balanced.
//
// Rules cannot aggregate a shift's sales, so cashSales cannot be PROVEN here.
// What can be enforced is that the numbers agree with each other -- which
// forces any lie out of `variance`, where it is invisible, and into
// `cashSales`, where the owner can reconcile it against the sales collection.
// That is the difference between an unfalsifiable number and a falsifiable one.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_var";
const CASHIER = "cashier_var";
const STORE_A = "storeA";

const FLOAT = 100000;
const CASH_SALES = 500000;
const REFUNDS = 0;
const REPAYMENTS = 0;
const HONEST_EXPECTED = FLOAT + CASH_SALES - REFUNDS + REPAYMENTS; // 600000

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
               host: "127.0.0.1", port: 8085 }
});
await testEnv.clearFirestore();

let shiftN = 0;
async function freshShift() {
  const id = `shift_${shiftN++}`;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", OWNER, "shifts", id), {
      storeId: STORE_A, status: "open", openingFloat: FLOAT,
      openedByUid: CASHIER, openedByName: "Asha", openedAt: new Date()
    });
  });
  return id;
}

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A" });
  await setDoc(doc(db, "users", OWNER, "members", CASHIER),
    { role: "cashier", status: "active", storeIds: [STORE_A] });
});

const results = [];
async function check(name, expectSucceed, fn) {
  try {
    if (expectSucceed) await assertSucceeds(fn());
    else await assertFails(fn());
    results.push({ name, pass: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, pass: false });
    console.log(`FAIL  ${name}\n      ${String(e.message || e).slice(0, 170)}`);
  }
}

const cashierDb = testEnv.authenticatedContext(CASHIER).firestore();

// The close payload closeShift() actually writes, with overrides applied.
const closing = (over = {}) => ({
  status: "closed",
  countedCash: HONEST_EXPECTED,
  expectedCash: HONEST_EXPECTED,
  variance: 0,
  cashSales: CASH_SALES,
  cashRefunds: REFUNDS,
  cashRepayments: REPAYMENTS,
  closedByUid: CASHIER,
  closedByName: "Asha",
  closedAt: new Date(),
  note: "",
  ...over
});

const closeWith = async (over) =>
  updateDoc(doc(cashierDb, "users", OWNER, "shifts", await freshShift()), closing(over));

console.log("\n=== an honest close still works ===");
await check("cashier CAN close a balanced drawer", true, () => closeWith({}));
await check("cashier CAN close a genuinely short drawer", true,
  () => closeWith({ countedCash: HONEST_EXPECTED - 50000, variance: -50000 }));
await check("cashier CAN close a genuinely over drawer", true,
  () => closeWith({ countedCash: HONEST_EXPECTED + 2500, variance: 2500 }));
await check("cashier CAN close a shift with refunds and repayments", true,
  () => closeWith({
    cashRefunds: 15000, cashRepayments: 40000,
    expectedCash: FLOAT + CASH_SALES - 15000 + 40000,
    countedCash: FLOAT + CASH_SALES - 15000 + 40000,
    variance: 0
  }));

console.log("\n=== THE EXPLOIT: 50,000 removed, closed as balanced ===");
// Counted is honest -- the drawer really does hold 550,000. expectedCash is
// lowered to match it, so the shortfall reports as zero.
await check("cashier CANNOT understate expectedCash to hide a shortfall", false,
  () => closeWith({ countedCash: 550000, expectedCash: 550000, variance: 0 }));

console.log("\n=== the three closing numbers must agree with each other ===");
await check("cashier CANNOT write a variance that contradicts counted - expected", false,
  () => closeWith({ countedCash: HONEST_EXPECTED - 50000, variance: 0 }));
await check("cashier CANNOT write variance 0 on an over drawer", false,
  () => closeWith({ countedCash: HONEST_EXPECTED + 9000, variance: 0 }));
await check("cashier CANNOT invent an expectedCash unrelated to its components", false,
  () => closeWith({ expectedCash: 1, countedCash: 1, variance: 0 }));
await check("cashier CANNOT drop the float from the expected figure", false,
  () => closeWith({ expectedCash: CASH_SALES, countedCash: CASH_SALES, variance: 0 }));
await check("cashier CANNOT inflate refunds without moving expectedCash", false,
  () => closeWith({ cashRefunds: 50000 }));
await check("cashier CANNOT omit the component fields entirely", false,
  async () => {
    const id = await freshShift();
    const { cashSales, cashRefunds, cashRepayments, ...rest } = closing({});
    return updateDoc(doc(cashierDb, "users", OWNER, "shifts", id), rest);
  });

console.log("\n=== components stay bounded ===");
await check("cashier CANNOT write a negative cashSales", false,
  () => closeWith({ cashSales: -100, expectedCash: FLOAT - 100, countedCash: FLOAT - 100, variance: 0 }));
await check("cashier CANNOT write a non-numeric component", false,
  () => closeWith({ cashSales: "lots" }));

await testEnv.cleanup();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
