// The Invoices screen, and the one transaction in it that cannot be got wrong.
//
//   node invoices-screen.test.mjs
//
// Issuing is the only irreversible step in the feature: it mints a gapless
// number, takes goods off the shelf and creates a debt, all in one transaction.
// Three classes of mistake in it are invisible to every other test here:
//
//   1. A read placed after a write. Firestore refuses get() once a transaction
//      has written, so this fails at RUNTIME, mid-issue, on a real invoice.
//   2. The number and the counter drifting apart. firestore.rules pairs them
//      with getAfter(), so a client that computes one without writing the other
//      is refused -- and a shop cannot issue at all.
//   3. The debt being created twice. An invoice raised against an existing
//      credit sale carries saleId and must NOT move the balance again, because
//      the till already did (DESIGN-invoicing.md 4).
//
// The cross-file checks at the end are the other half: a client bound that
// disagrees with the rules is a refusal with nothing on screen explaining it.
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const indexes = JSON.parse(readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8"));

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass && detail) console.log(`      ${detail}`);
}

// The body of a top-level function, to its closing brace at column 0.
function bodyOf(name) {
  const start = src.indexOf(name);
  if (start === -1) return "";
  const end = src.indexOf("\n}\n", start);
  return end === -1 ? src.slice(start) : src.slice(start, end);
}

console.log("=== the screen is there and reachable ===");
{
  check("a nav item points at invoices", /data-view="invoices"/.test(html));
  check("...and a section answers to that id", /<section class="view" id="invoices">/.test(html));
  check("the list table exists", /id="invoicesTable"/.test(html));
  check("the editor dialog exists", /<dialog id="invoiceDialog">/.test(html));
  check("...with a line editor inside it", /id="invoiceLinesTable"/.test(html));
  check("it is rendered by renderAll()", /renderAll\(\)[\s\S]{0,2000}?renderInvoices\(\);/.test(src));
  // The ninth cashier permission. Not a fall-through to the manager check.
  check("a cashier reaches it only with issueInvoices",
    /if \(viewId === "invoices"\) return isManagerOrOwnerRole\(\) \|\| isCashierWith\("issueInvoices"\);/.test(src));
}

console.log("\n=== a draft is a draft: no number, no debt ===");
{
  const body = bodyOf("async function saveInvoiceDraft(");
  check("saveInvoiceDraft() was found", body.length > 0);
  check("it writes status draft", /status:\s*"draft"/.test(body));
  for (const forbidden of ["number:", "sequence:", "counterId:", "issuedAt:", "issuedByUid:"]) {
    check(`a draft payload never carries ${forbidden.replace(":", "")}`, !body.includes(forbidden),
      "firestore.rules refuses a draft that carries any of these -- numbering happens once, at issue");
  }
  check("it owes nothing yet", /amountPaid:\s*0/.test(body) && /amountCredited:\s*0/.test(body));
  // The rules pin both across an edit AND require the editor to be the creator,
  // so sending either could only ever fail.
  check("an edit does not resend createdAt or createdByUid",
    !/createdAt:\s*existing/.test(body) && !/createdByUid:\s*existing/.test(body));
  check("a new draft stamps its creator", /payload\.createdByUid = state\.user\.uid/.test(body));
}

console.log("\n=== issuing: every read before any write ===");
{
  const body = bodyOf("async function issueInvoice(");
  check("issueInvoice() was found", body.length > 0);

  // THE ordering invariant. Firestore refuses a get() after the first write in
  // a transaction, and that failure only ever appears at runtime, on a real
  // invoice, halfway through issuing it.
  const lastRead = Math.max(
    body.lastIndexOf("await transaction.get("),
    body.lastIndexOf("transaction.get(ref)")
  );
  const firstWrite = Math.min(
    ...["transaction.set(", "transaction.update("]
      .map((token) => body.indexOf(token))
      .filter((position) => position !== -1)
  );
  check("every transaction.get() precedes the first write", lastRead < firstWrite,
    `last read at ${lastRead}, first write at ${firstWrite} -- Firestore refuses a read after a write`);

  check("it refuses to issue without a connection", /isOfflineNow\(\)/.test(body),
    "gapless numbering is a read-then-write, which is exactly what offline selling forbids");
  check("it asks before an irreversible step", /askConfirm\(/.test(body));
  check("it re-checks the draft status INSIDE the transaction",
    /invoiceSnap\.data\(\)\.status !== "draft"/.test(body),
    "the snapshot the screen opened with is not evidence at commit time");
}

console.log("\n=== the number and the counter move together ===");
{
  const body = bodyOf("async function issueInvoice(");
  check("the next sequence is the counter plus one",
    /counterSnap\.exists\(\) \? safeNumber\(counterSnap\.data\(\)\.value\) : 0\) \+ 1/.test(body));
  check("the counter is written in the same transaction", /transaction\.set\(counterRef/.test(body));
  check("...and the invoice takes that same sequence",
    /sequence: nextSequence/.test(body) && /\$\{String\(nextSequence\)/.test(body),
    "the printed number is built from the sequence, so the two cannot disagree");
  check("the counter write carries only value and updatedAt",
    /transaction\.set\(counterRef, \{ value: nextSequence, updatedAt: serverTimestamp\(\) \}\)/.test(body),
    "firestore.rules caps the counter document to exactly these two keys");
}

console.log("\n=== stock leaves once, and says which document took it ===");
{
  const body = bodyOf("async function issueInvoice(");
  check("only lines backed by a product move stock",
    /\.filter\(\(line\) => line\.productId\)/.test(body),
    "a free-text line has no shelf to move");
  check("the shelf is checked before it is written",
    /notEnoughStockItem/.test(body));
  check("the movement reason stays 'sale'", /movementReason: "sale"/.test(body),
    "the allowlist is closed; inventing a reason is the trap DESIGN-purchases.md 9 names");
  check("the ledger records which invoice took the units", /invoiceId\b/.test(body));
  check("recordStockMovement() actually forwards invoiceId",
    /if \(fields\.invoiceId\) entry\.invoiceId =/.test(src),
    "it copies only known fields -- an unforwarded id is silently dropped");
}

console.log("\n=== the debt is created once ===");
{
  const body = bodyOf("async function issueInvoice(");
  check("an invoice raised against an existing sale does NOT move the balance",
    /if \(!invoice\.saleId\)/.test(body),
    "the till already created that debt -- DESIGN-invoicing.md 4");
  check("a fresh invoice adds its total to what is owed",
    /balanceOwed: currentOwed \+ safeNumber\(invoice\.total\)/.test(body));
  check("...and stamps oldestUnpaidAt only when the balance was clear",
    /if \(currentOwed <= 0\) customerUpdate\.oldestUnpaidAt/.test(body));
}

console.log("\n=== status is derived, never stored ===");
{
  const body = bodyOf("function invoiceStatusLabel(");
  check("paid/partly paid come from the amounts, not a field",
    /amountPaid\) \+ safeNumber\(invoice\.amountCredited\)/.test(body),
    "a status somebody can set by hand is a status that disagrees with the money");
  check("only three statuses are ever written",
    !/status:\s*"paid"/.test(src) && !/status:\s*"partly/.test(src));
}

console.log("\n=== the client and the rules agree ===");
{
  // A client bound looser than the rules is a refusal with nothing on screen
  // explaining it; tighter, and the screen forbids what the rules allow.
  const clientMax = /const INVOICE_MAX_LINES = (\d+)/.exec(src)?.[1];
  const rulesMax = /lines\.size\(\) <= (\d+)/.exec(rules)?.[1];
  check("the line cap matches firestore.rules", clientMax === rulesMax,
    `client ${clientMax}, rules ${rulesMax}`);

  check("INVOICE_ISSUED is permitted by the rules", /'INVOICE_ISSUED'/.test(rules),
    "the client writes it inside the issue transaction; an unlisted action rejects the whole issue");
  check("invoiceId is permitted on a stock movement", /'invoiceId' in d/.test(rules));

  // A missing composite index breaks STAFF only, and the emulator builds them
  // on demand, so it can never catch this.
  const invoiceIndexes = (indexes.indexes || [])
    .filter((entry) => entry.collectionGroup === "invoices")
    .map((entry) => entry.fields.map((field) => field.fieldPath).join(","));
  check("a roaming cashier's query has an index",
    invoiceIndexes.includes("createdByUid,createdAt"),
    `a cashier with the "all" store scope queries createdByUid + createdAt and nothing else; have: ${invoiceIndexes.join(" | ")}`);
  check("a branch cashier's query has an index",
    invoiceIndexes.includes("createdByUid,storeId,createdAt"));
  check("a manager's branch query has an index",
    invoiceIndexes.includes("storeId,createdAt"));
}

console.log("\n=== a payment against an invoice stays a repayment ===");
{
  const body = bodyOf("async function confirmRecordPayment(");
  check("confirmRecordPayment() was found", body.length > 0);

  // THE one that protects the till's cash reconciliation. loadRepaymentsToday()
  // counts auditLogs where action == "PAYMENT_RECORDED" and nothing else. If an
  // invoice settlement wrote its own action instead, it would vanish from the
  // day's repayment figure and expected cash would be short by exactly the
  // invoice payments -- silently, on every till that takes one.
  check("it still writes PAYMENT_RECORDED", /action: "PAYMENT_RECORDED"/.test(body));
  check("...and never a separate invoice action",
    !/INVOICE_PAYMENT_APPLIED/.test(body),
    "a second action would drop invoice settlements out of repayments-today");
  check("the invoice is named on the entry", /invoiceId: settlingInvoiceId/.test(body));

  // firestore.rules (validInvoiceSettlement) permits exactly amountPaid,
  // amountCredited and updatedAt to move. Anything else refuses the WHOLE
  // transaction, taking the balance and the payment record with it.
  const update = body.slice(body.indexOf("transaction.update(invoiceRef"),
                            body.indexOf("const nextBalance"));
  check("the invoice update raises amountPaid", /amountPaid:/.test(update));
  check("...and stamps updatedAt", /updatedAt: serverTimestamp\(\)/.test(update));
  for (const forbidden of ["status:", "total:", "number:", "lines:"]) {
    check(`...and never touches ${forbidden.replace(":", "")}`, !update.includes(forbidden),
      "validInvoiceSettlement() diff-checks this write down to three keys");
  }

  // An over-payment would be refused by the rules as a permission error with
  // nothing explaining it, so it is caught by name first.
  check("over-paying an invoice is refused by name", /INVOICE_OVERPAID/.test(body));
  check("the invoice is read in the read phase",
    body.indexOf("await transaction.get(invoiceRef)") < body.indexOf("transaction.update("),
    "Firestore refuses a get() after the first write");
}

console.log("\n=== a stale invoice id cannot settle the wrong invoice ===");
{
  const body = bodyOf("function openRecordPaymentDialog(");
  const cleared = body.indexOf('state.pendingPaymentInvoiceId = "";');
  const resolved = body.indexOf("const invoice = invoiceId ? invoiceById(invoiceId)");
  check("the invoice id is cleared on every open", cleared !== -1);
  check("...before the new one is resolved", cleared !== -1 && cleared < resolved,
    "otherwise an ordinary repayment settles whatever invoice was paid last");
}

console.log("\n=== voiding: owner only, and it puts everything back ===");
{
  const body = bodyOf("async function voidInvoice(");
  check("voidInvoice() was found", body.length > 0);
  check("the owner alone may void", /if \(!isOwnerRole\(\)\) return;/.test(body),
    "firestore.rules says owner-only; the button must not offer a refusal");
  check("an invoice with money against it is refused", /HAS_MONEY/.test(body));
  check("...and re-checked INSIDE the transaction",
    body.lastIndexOf("HAS_MONEY") > body.indexOf("runTransaction"),
    "a payment may have landed since the screen read it");
  check("it needs a connection", /isOfflineNow\(\)/.test(body));
  check("a reason is required", /voidReasonRequired/.test(body),
    "the rules refuse an empty reason, and the number stays in the sequence");

  // The number is KEPT. A gap in an invoice sequence is the first thing an
  // auditor asks about.
  const update = body.slice(body.indexOf("transaction.update(invoiceRef"),
                            body.indexOf("productSnaps.forEach"));
  check("the void keeps the number", !update.includes("number:"));
  check("...and records who and why",
    /voidedByUid/.test(update) && /voidReason/.test(update));

  check("stock goes back as a void", /reason: "void"/.test(body) && /movementReason: "void"/.test(body));
  check("...and the ledger says which invoice", /invoiceId\b/.test(body));
  check("sold30 and sold90 are floored at zero", /Math\.max\(0, safeNumber\(snap\.data\(\)\.sold30\)/.test(body),
    "a void must not drive a counter negative");
  check("only a debt this invoice CREATED is reversed",
    /if \(!invoice\.saleId && customerSnap/.test(body),
    "an invoice raised against an existing credit sale never added to the balance");
  check("every read precedes the first write",
    Math.max(body.lastIndexOf("await transaction.get(")) < body.indexOf("transaction.update("));
}

console.log("\n=== the document says what it is ===");
{
  check("the printed title is Invoice, never Tax Invoice",
    /"invoices\.docTitle": "INVOICE"/.test(src),
    "only an EFD or VFD receipt proves VAT in Tanzania (DESIGN-invoicing.md 1)");
  check("the document carries the fiscal-receipt note",
    /"invoices\.docNotTaxInvoice": "This is not a tax invoice\./.test(src));
  // One builder behind the screen, the PDF and the WhatsApp copy, so the three
  // cannot disagree about what was agreed.
  check("screen, PDF and WhatsApp share the summary rows",
    /function invoiceSummaryRows\(/.test(src)
    && /invoiceSummaryRows\(invoice\)/.test(bodyOf("function buildInvoiceDocumentHtml("))
    && /invoiceSummaryRows\(invoice\)/.test(bodyOf("function buildInvoiceTextLines("))
    && /invoiceSummaryRows\(invoice\)/.test(bodyOf("async function downloadInvoicePdf(")));
  // A manager on "all stores" must not print another branch's currency onto a
  // document the customer keeps.
  check("the document states the branch's own currency",
    /function invoiceMoney\(invoice, amount\) \{[\s\S]{0,120}moneyForStore\(amount, invoice\?\.storeId\)/.test(src));
}

console.log("\n=== the rules agree about what is written ===");
{
  check("INVOICE_VOIDED is permitted", /'INVOICE_VOIDED'/.test(rules),
    "voidInvoice() writes it inside the void transaction");
  check("INVOICE_PAYMENT_APPLIED is still NOT permitted",
    !/'INVOICE_PAYMENT_APPLIED'/.test(rules),
    "nothing writes it: an invoice payment writes PAYMENT_RECORDED so the day's repayments stay right");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(failed.map((f) => `  FAILED: ${f.name}`).join("\n"));
  process.exit(1);
}
