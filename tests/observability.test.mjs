// Phase 30: observability — can a shop's failure reach anyone?
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node observability.test.mjs"
//
// Before this there were 73 console.warn and console.error calls in the client
// and not one of them went anywhere. They wrote to a browser console on a
// shopkeeper's phone, which nobody opens. There was no global handler either,
// so an uncaught exception was completely invisible. The first report of a
// broken till was a telephone call.
//
// The bar here is deliberately low and specific: what broke, where, and on
// which build, somewhere the owner already looks. Not crash reporting as a
// service -- no third party and no monthly bill on a product whose economics
// are thin.
//
// Three things it must never do, and each is tested: cost more than it is
// worth, carry a customer's details off the device, or break the app it exists
// to watch.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_obs";
const CASHIER = "cashier_obs";
const STORE = "storeObs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
               host: "127.0.0.1", port: 8085 }
});
await testEnv.clearFirestore();
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE), { name: "Branch" });
  await setDoc(doc(db, "users", OWNER, "members", CASHIER), { role: "cashier", status: "active", storeIds: [STORE] });
  await setDoc(doc(db, "users", OWNER, "errorLog", "seeded"), {
    kind: "error", message: "seeded", uid: OWNER, createdAt: new Date()
  });
});

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}
async function checkAsync(name, promise, detail = "") {
  try { await promise; check(name, true); } catch (e) { check(name, false, detail || String(e).slice(0, 110)); }
}
const dbOwner = testEnv.authenticatedContext(OWNER).firestore();
const dbCashier = testEnv.authenticatedContext(CASHIER).firestore();
const entry = (uid, over = {}) => ({
  kind: "error", message: "Cannot read properties of undefined", where: "app.js:1204",
  uid, storeId: STORE, appVersion: "20260802k", createdAt: new Date(), ...over
});

console.log("=== a fault reaches the owner, and cannot be tidied away ===");
await checkAsync("a cashier can report what broke in front of them",
  assertSucceeds(setDoc(doc(dbCashier, "users", OWNER, "errorLog", "e1"), entry(CASHIER))));
await checkAsync("the owner can report too",
  assertSucceeds(setDoc(doc(dbOwner, "users", OWNER, "errorLog", "e2"), entry(OWNER))));
await checkAsync("the owner can read the log",
  assertSucceeds(getDoc(doc(dbOwner, "users", OWNER, "errorLog", "e1"))));
await checkAsync("a cashier cannot read it back",
  assertFails(getDoc(doc(dbCashier, "users", OWNER, "errorLog", "e1"))),
  "staff reporting faults is not staff auditing themselves");
await checkAsync("a report cannot be edited afterwards",
  assertFails(updateDoc(doc(dbCashier, "users", OWNER, "errorLog", "e1"), { message: "nothing happened" })));
await checkAsync("a report cannot be deleted",
  assertFails(deleteDoc(doc(dbOwner, "users", OWNER, "errorLog", "e1"))));
await checkAsync("a report cannot be filed in someone else's name",
  assertFails(setDoc(doc(dbCashier, "users", OWNER, "errorLog", "e3"), entry(OWNER))));

console.log("\n=== a loop cannot write unbounded rows ===");
await checkAsync("an oversized message is refused",
  assertFails(setDoc(doc(dbCashier, "users", OWNER, "errorLog", "e4"), entry(CASHIER, { message: "x".repeat(301) }))));
await checkAsync("an empty message is refused",
  assertFails(setDoc(doc(dbCashier, "users", OWNER, "errorLog", "e5"), entry(CASHIER, { message: "" }))));
await checkAsync("an unknown kind is refused",
  assertFails(setDoc(doc(dbCashier, "users", OWNER, "errorLog", "e6"), entry(CASHIER, { kind: "gossip" }))));
check("the client caps how many one session may send",
  /const ERROR_LOG_MAX_PER_SESSION = \d+/.test(app));
check("...and the same fault repeated is still one fault",
  /if \(reportedFaults\.has\(key\)\) return;/.test(app));
check("dedupe happens BEFORE the cap is spent",
  app.indexOf("reportedFaults.has(key)") < app.indexOf("faultsReportedThisSession >="),
  "otherwise one repeating fault consumes the budget five different faults needed");

console.log("\n=== a customer's details do not leave the device ===");
{
  const { scrubFaultText } = new Function(
    `const ERROR_LOG_MESSAGE_MAX = 300;
     ${app.slice(app.indexOf("function scrubFaultText("), app.indexOf("async function reportFault("))}
     return { scrubFaultText };`)();
  check("an email address is removed",
    !/asha@example\.com/.test(scrubFaultText("failed for asha@example.com")),
    scrubFaultText("failed for asha@example.com"));
  check("a Tanzanian mobile number is removed",
    !/0712345678/.test(scrubFaultText("no customer 0712345678")),
    scrubFaultText("no customer 0712345678"));
  check("an international format is removed too",
    !/255712345678/.test(scrubFaultText("no customer +255712345678")),
    scrubFaultText("no customer +255712345678"));
  check("the actual fault survives scrubbing",
    /Cannot read properties/.test(scrubFaultText("Cannot read properties of undefined")));
  check("the message is truncated to what the rules accept",
    scrubFaultText("y".repeat(500)).length === 300);
  check("nothing is thrown on null", scrubFaultText(null) === "");
}

console.log("\n=== the reporter cannot break the app it watches ===");
{
  const body = app.slice(app.indexOf("async function reportFault("), app.indexOf("function installFaultReporting("));
  check("every path is wrapped", /try \{[\s\S]+\} catch \{/.test(body));
  check("and the catch is deliberately silent, with a reason",
    /A reporter that throws takes down the thing it was meant to watch/.test(body));
  check("it gives up quietly when signed out", /if \(!state\.db \|\| !state\.user \|\| !state\.businessOwnerUid\) return;/.test(body));
}

console.log("\n=== what is caught, and what it is labelled with ===");
{
  check("uncaught errors are caught", /window\.addEventListener\("error"/.test(app));
  check("unhandled promise rejections are caught too",
    /window\.addEventListener\("unhandledrejection"/.test(app),
    "every Firestore call is a promise; these never reach the error handler");
  check("reporting is installed at boot", /^installFaultReporting\(\);$/m.test(app));
  check("the build is recorded with the fault", /appVersion: APP_VERSION/.test(app));
  check("...and the build is read from the script's own url, not hand-maintained",
    /new URL\(import\.meta\.url\)\.searchParams\.get\("v"\)/.test(app));
  check("the branch is recorded so a fault can be placed", /storeId: state\.currentStoreId/.test(app));
}

console.log("\n=== the owner is shown it, not just sent it ===");
{
  check("the owner panel carries a fault count", /control\.faults/.test(app));
  check("it is loaded once per business, not per render",
    /faultFetchKey === state\.businessOwnerUid/.test(app));
  check("a failed read does not take the panel down", /state\.faults = null/.test(app));
  check("the label exists in both languages",
    (app.match(/"control\.faults":/g) || []).length === 2);
  check("it reads as reassurance when there is nothing",
    /"control\.faultsClear": "Nothing has failed this week\./.test(app));
}

await testEnv.cleanup();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
