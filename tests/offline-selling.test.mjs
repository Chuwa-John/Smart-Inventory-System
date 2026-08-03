// What actually happens to a sale when the connection drops.
//
//   node offline-selling.test.mjs
//
// SECURITY-AUDIT.md F-4 argues that binding a stock decrement to a sale is
// unreachable, and one of its two reasons is that a server-mediated sale
// endpoint "cannot work offline" because offline selling is "a headline feature
// of this product".
//
// It is not a feature of this product. The sale path requires a Firestore
// transaction, transactions do not queue offline the way plain writes do, and
// the catch does not fall through to anything -- it toasts and returns. The
// offline banner says so in both languages: "sales cannot be recorded until the
// connection returns."
//
// This file pins that, for three reasons:
//
//   1. F-4's conclusion rests on the claim. If the premise is wrong the
//      conclusion deserves re-examination, and a test is harder to overlook
//      than a paragraph.
//   2. The local- sale path still exists for the no-Firestore case. If someone
//      ever wires it to the offline case instead, sales would be recorded that
//      never reach Firestore -- and therefore never write a stockMovements
//      entry, so the L-2 reconciliation would report the resulting shelf
//      difference as unexplained stock loss. A well-meant offline fallback
//      would start accusing cashiers of theft.
//   3. A till that stops selling when the internet does is the single largest
//      operational risk this product carries in its own market. It should not
//      be possible to change that accidentally.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

console.log("=== a failed sale stops, it does not quietly become a local one ===");
{
  // The sale's Firestore branch specifically. The same `if (state.db && ...)`
  // guard appears six times in app.js, so anchor on something only the sale
  // has -- indexOf on the guard alone lands on a customer write 4,000 lines
  // earlier and measures the wrong code.
  const anchor = noComments.indexOf('describeOperationError(error, "toast.saleFailedGeneric")');
  check("the sale path is locatable", anchor !== -1);
  const branch = noComments.lastIndexOf("if (state.db && state.user && state.businessOwnerUid) {", anchor);
  check("the Firestore sale branch exists", branch !== -1 && branch < anchor);
  const region = noComments.slice(branch, anchor + 4000);
  check("a failed sale toasts and returns",
    /catch \(error\) \{[\s\S]{0,200}showToast\(describeOperationError\(error, "toast\.saleFailedGeneric"\)\);\s*return;/.test(region),
    "without the return, a refused sale would fall into the local path and be recorded off the record");
  check("the local sale path is reached only when Firestore is absent",
    /\} else \{[\s\S]{0,400}state\.cart\.forEach/.test(region),
    "the local- branch must be the else of 'is Firestore configured', never of 'are we online'");
}

console.log("=== the user is told the truth about it ===");
{
  check("the offline banner says sales cannot be recorded",
    /"offline\.bannerText": "[^"]*sales cannot be recorded/.test(src),
    "if this softens, check the behaviour softened with it");
  check("the banner exists in Kiswahili too",
    (src.match(/"offline\.bannerText"/g) || []).length >= 2);
  check("being offline outranks whatever code the SDK returned",
    /navigator\.onLine === false\) return t\("error\.offline"\)/.test(noComments),
    "a cashier needs 'no internet', not 'unavailable'");
  check("the SDK's unavailable code maps to the offline message",
    /"unavailable": "error\.offline"/.test(noComments));
}

console.log("=== a sale is written in one transaction, which is why it cannot queue ===");
{
  check("the sale path uses runTransaction",
    /runTransaction\(state\.db, async \(transaction\)/.test(noComments));
  check("the stock ledger is written inside that same transaction",
    /recordStockMovement\(transaction/.test(noComments),
    "if the ledger ever moves outside the transaction, a crash between the two produces a gap the " +
    "reconciliation would read as theft");
}

console.log("=== the F-4 premise is flagged where it is stated ===");
{
  // A wrong premise in a security audit is worse than a wrong conclusion,
  // because it gets reused. This asserts the correction is recorded rather
  // than the original claim being left to be quoted again.
  const audit = readFileSync(new URL("../SECURITY-AUDIT.md", import.meta.url), "utf8");
  // Absence of the phrase is the wrong test: the correction quotes the original
  // sentence in order to refute it, so a bare "does not contain" check fails on
  // the fix itself. What matters is that the claim is not left standing
  // unqualified -- so require the correction, and require it to reach the claim.
  check("F-4's offline premise is corrected in place",
    /\*\*That premise is false/.test(audit),
    "the claim rules out a server-mediated sale endpoint; if it is false, that option is open");
  const claim = audit.indexOf("headline feature");
  const correction = audit.indexOf("That premise is false");
  check("the correction sits with the claim, not somewhere else in the file",
    claim !== -1 && correction > claim && correction - claim < 600,
    "a correction far from what it corrects gets read separately, or not at all");
  check("the corrected entry points at the test that pins it",
    /tests\/offline-selling\.test\.mjs/.test(audit));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
