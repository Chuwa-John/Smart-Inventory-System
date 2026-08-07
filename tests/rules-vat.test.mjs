// The VAT fields at the rules boundary (DESIGN-vat.md).
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node rules-vat.test.mjs"
//
// These fields ride on the sale document, so the stakes are the ones that
// always apply to validSale(): a rule that is too tight does not reject a
// field, it rejects the sale, and the till stops selling. Every shape the
// client will actually write is asserted here BEFORE app.js writes any of it.
//
// The clause worth the expressions is netTotal + taxTotal == total. Rules
// cannot sum a list, so they cannot check the tax against the items -- that
// limit is old news here and is why concurrency-integrity.test.mjs detects
// rather than prevents. But net and tax are scalars, and their sum is exactly
// the property the whole feature is judged on, so it is enforceable at the
// boundary and is enforced. A client bug cannot write a sale whose VAT return
// fails to reconcile to its own takings.
//
// The other half of the design is that VAT is FORWARD-ONLY: a business that is
// not registered writes none of these fields, and a sale from before it
// registered is outside the scheme rather than taxed at zero. So every field
// has to remain optional, and that is asserted first -- making them mandatory
// would reject every sale from every shop under the threshold.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_vat";
const CASHIER = "cashier_vat";
const STORE_A = "storeA";

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
               host: "127.0.0.1", port: 8085 }
});
await testEnv.clearFirestore();

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A" });
  await setDoc(doc(db, "users", OWNER, "members", CASHIER),
    { role: "cashier", status: "active", storeIds: [STORE_A] });
});

const results = [];
let n = 0;
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

const dbCashier = testEnv.authenticatedContext(CASHIER).firestore();
const dbOwner = testEnv.authenticatedContext(OWNER).firestore();

// A sale of 1,180 inclusive: 180 of VAT inside it, 1,000 net.
const sale = (over = {}) =>
  setDoc(doc(dbCashier, "users", OWNER, "sales", `sale_${n++}`), {
    items: [{ productId: "p1", name: "Sugar", qty: 1, price: 1180 }],
    total: 1180, subtotal: 1180,
    cashierUid: CASHIER, voided: false, storeId: STORE_A,
    staffId: "st1", staffName: "Asha", orderNumber: "1234567890",
    paymentMethod: "cash", createdAt: new Date(), ...over
  });

const product = (over = {}) =>
  setDoc(doc(dbOwner, "users", OWNER, "products", `p_${n++}`), {
    name: "Sugar", category: "Food", brand: "X", supplier: "Y",
    quantity: 10, storeId: STORE_A, sellingPrice: 1180, createdAt: new Date(), ...over
  });

console.log("=== a shop that is not VAT registered is unaffected ===");
// This is the forward-only decision at the boundary. Most Tanzanian dukas are
// under the TZS 200m threshold and must not be charging VAT at all.
await check("a sale with no tax fields at all is accepted", true, () => sale());
await check("a product with no tax class is accepted", true, () => product());

console.log("\n=== the shapes a registered shop actually writes ===");
const vatFields = {
  vatRegistered: true, vatRate: 0.18, taxTotal: 180, netTotal: 1000,
  taxBreakdown: { standard: { net: 1000, vat: 180 }, zeroRated: { net: 0, vat: 0 }, exempt: { net: 0, vat: 0 } }
};
await check("a fully taxed sale is accepted", true, () => sale(vatFields));
await check("a wholly zero-rated sale is accepted", true, () => sale({
  ...vatFields, taxTotal: 0, netTotal: 1180,
  taxBreakdown: { standard: { net: 0, vat: 0 }, zeroRated: { net: 1180, vat: 0 }, exempt: { net: 0, vat: 0 } }
}));
await check("a wholly exempt sale is accepted", true, () => sale({
  ...vatFields, taxTotal: 0, netTotal: 1180,
  taxBreakdown: { standard: { net: 0, vat: 0 }, zeroRated: { net: 0, vat: 0 }, exempt: { net: 1180, vat: 0 } }
}));
await check("a mixed basket is accepted", true, () => sale({
  ...vatFields, total: 8180, subtotal: 8180, taxTotal: 180, netTotal: 8000,
  taxBreakdown: { standard: { net: 1000, vat: 180 }, zeroRated: { net: 5000, vat: 0 }, exempt: { net: 2000, vat: 0 } }
}));
for (const taxClass of ["standard", "zeroRated", "exempt"]) {
  await check(`a product classed ${taxClass} is accepted`, true, () => product({ taxClass }));
}

console.log("\n=== the return has to reconcile to the takings ===");
// The whole point of spending expressions here.
await check("net + tax must equal the total", false, () => sale({ ...vatFields, taxTotal: 180, netTotal: 999 }));
await check("tax cannot be inflated on its own", false, () => sale({ ...vatFields, taxTotal: 500, netTotal: 1000 }));
await check("net cannot be inflated on its own", false, () => sale({ ...vatFields, taxTotal: 180, netTotal: 5000 }));
await check("a sale cannot claim all tax and no net", false, () => sale({ ...vatFields, taxTotal: 1180, netTotal: 1000 }));
await check("...but all-net-no-tax reconciles and is legitimate", true,
  () => sale({ ...vatFields, taxTotal: 0, netTotal: 1180 }));

console.log("\n=== the fields cannot be nonsense ===");
await check("vatRegistered must be a bool", false, () => sale({ ...vatFields, vatRegistered: "yes" }));
await check("vatRate must be a number", false, () => sale({ ...vatFields, vatRate: "18%" }));
await check("a rate above 100% is refused", false, () => sale({ ...vatFields, vatRate: 1.8 }));
await check("a negative rate is refused", false, () => sale({ ...vatFields, vatRate: -0.18 }));
await check("a zero rate is allowed", true, () => sale({
  ...vatFields, vatRate: 0, taxTotal: 0, netTotal: 1180
}));
await check("taxTotal must be a number", false, () => sale({ ...vatFields, taxTotal: "180" }));
// Infinity was accepted by this codebase once, and once stored every total
// touching the row became Infinity too.
await check("an infinite tax is refused", false, () => sale({ ...vatFields, taxTotal: Infinity }));
await check("a negative tax is refused", false, () => sale({ ...vatFields, taxTotal: -180, netTotal: 1360 }));
await check("taxBreakdown must be a map", false, () => sale({ ...vatFields, taxBreakdown: "standard" }));
await check("a made-up tax class on a product is refused", false, () => product({ taxClass: "luxury" }));
await check("a non-string tax class is refused", false, () => product({ taxClass: 18 }));

console.log("\n=== VAT does not weaken anything already enforced ===");
// Adding optional fields to validSale() must not create a way past the checks
// that were already there.
await check("a cashier still cannot write another cashier's sale", false,
  () => sale({ ...vatFields, cashierUid: "someone_else" }));
await check("a sale still cannot arrive pre-voided", false, () => sale({ ...vatFields, voided: true }));
await check("the total is still bounded", false, () => sale({ ...vatFields, total: Infinity }));

await testEnv.cleanup();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
