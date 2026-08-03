// Does a role change actually take effect on the next request?
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node rules-role-propagation.test.mjs"
//
// firestore.rules chooses get()-based role lookup over custom claims for one
// stated reason: "so that disabling a staff member takes effect on their very
// next request, not after their ID token happens to expire". That is the whole
// justification for paying a member document read on every staff operation --
// a real, billed cost accepted in exchange for instant revocation.
//
// It had never been tested. This asserts it end to end on ONE connection with
// ONE unchanged ID token: promote, demote, revoke and reinstate a member while
// they hold the session, and check the boundary moves immediately each time.
// If any of this fails, the cost is being paid for a property that is not
// delivered, and custom claims would be cheaper for the same behaviour.
//
// What this file deliberately does NOT prove is that the staff member's
// BROWSER notices. Rules are the boundary and they hold; the client's cached
// state.currentUserRole is a separate problem, covered by
// role-propagation-client.test.mjs.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc, deleteDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_prop";
const STAFF = "staff_prop";
const STORE_A = "storeA";

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
               host: "127.0.0.1", port: 8085 }
});
await testEnv.clearFirestore();

const seedSale = async (id) => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", OWNER, "sales", id), {
      items: [{ productId: "p1", name: "Sugar", qty: 1, lineTotal: 100 }],
      total: 100, cashierUid: STAFF, voided: false, storeId: STORE_A,
      staffId: "st1", staffName: "Asha", orderNumber: "8097",
      paymentMethod: "cash", createdAt: new Date(), cashTendered: 100, changeDue: 0,
      branchId: null
    });
  });
};

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A", createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "members", STAFF),
    { role: "manager", status: "active", storeIds: [STORE_A] });
});
for (const id of ["s1", "s2", "s3", "s4"]) await seedSale(id);

// The member document is rewritten by the OWNER out of band, exactly as the
// staff roster dialog does it. The staff connection below is never rebuilt.
const setMember = (patch) => testEnv.withSecurityRulesDisabled(async (ctx) =>
  updateDoc(doc(ctx.firestore(), "users", OWNER, "members", STAFF), patch));

const removeMember = () => testEnv.withSecurityRulesDisabled(async (ctx) =>
  deleteDoc(doc(ctx.firestore(), "users", OWNER, "members", STAFF)));

const restoreMember = (data) => testEnv.withSecurityRulesDisabled(async (ctx) =>
  setDoc(doc(ctx.firestore(), "users", OWNER, "members", STAFF), data));

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

// ONE context, ONE token, held across every role change below. This is the
// point of the file -- rebuilding it between steps would prove nothing.
const staffDb = testEnv.authenticatedContext(STAFF).firestore();

const voidSale = (id) => updateDoc(doc(staffDb, "users", OWNER, "sales", id),
  { voided: true, voidedAt: new Date() });
const readStore = () => getDoc(doc(staffDb, "users", OWNER, "stores", STORE_A));
const readOwnMember = () => getDoc(doc(staffDb, "users", OWNER, "members", STAFF));

console.log("=== as a manager ===");
await check("manager CAN void a sale in its store", true, () => voidSale("s1"));
await check("manager CAN read its assigned store", true, readStore);
await check("manager CAN read its own member doc (what the client subscribes to)", true, readOwnMember);

console.log("\n=== demoted to cashier, same session, same token ===");
await setMember({ role: "cashier" });
await check("the demotion applies on the very next request -- no void", false, () => voidSale("s2"));
await check("cashier-level access still works", true, readStore);
await check("still CAN read own member doc (so a client could notice the change)", true, readOwnMember);

console.log("\n=== suspended (status flipped), same session ===");
await setMember({ status: "suspended" });
await check("a suspended member loses store access at once", false, readStore);
await check("a suspended member cannot void", false, () => voidSale("s3"));

console.log("\n=== revoked (member doc deleted), same session ===");
await setMember({ status: "active" });
await removeMember();
await check("a revoked member loses store access at once", false, readStore);
await check("a revoked member cannot void", false, () => voidSale("s4"));
await check("a revoked member's own member doc is simply gone", true, readOwnMember);

console.log("\n=== reinstated, same session ===");
await restoreMember({ role: "manager", status: "active", storeIds: [STORE_A] });
await check("reinstatement also applies immediately", true, readStore);
await check("and the restored role is honoured", true, () => voidSale("s4"));

console.log("\n=== store scope changes propagate the same way ===");
await setMember({ role: "manager", status: "active", storeIds: ["storeZ"] });
await check("moving a member to another branch revokes the old one at once", false, readStore);
await setMember({ storeIds: ["all"] });
await check("granting roaming access applies at once", true, readStore);

await testEnv.cleanup();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
