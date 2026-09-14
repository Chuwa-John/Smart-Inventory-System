# Invoicing — phases 1 and 2

Decided with the owner on 2026-09-13: build phase 1 **and** phase 2 from
`RESEARCH-invoicing.md` §6, shaped the way serious accounting systems do it —
quotation → invoice → payments → credit note → statement.

This file is the record of the decisions. `RESEARCH-invoicing.md` is the
research behind them and is not repeated here.

## 1. What this is, and what it is not

**Ours is a commercial invoice.** A formal request for payment that records the
debt and what it was for. It is a business record, kept five years.

**It is not a tax invoice.** In Tanzania the document that proves VAT — and lets
the buyer claim input VAT back — is the fiscal receipt from an EFD or VFD, with
its verification code and QR. The upgraded EFDMS rejects input-VAT claims on
invoices without one.

So: the printed document says **"Invoice"**, never "Tax Invoice". A
VAT-registered business sees a line telling it the fiscal receipt is still
required, because issuing this document is the moment the supply happens (below).
Printing "Tax Invoice" on this would cost a customer their VAT claim and put a
false statement on a document the shop is audited on. Same principle as
`receiptVatRows()`: silence beats a confident wrong statement.

## 2. Issuing is a tax event

For goods, time of supply is the **earliest** of: the invoice being issued, any
part being paid, or payment falling due. Issuing is therefore deliberate and
irreversible:

- **Draft** — editable, numbered nothing, moves no stock, owes no money.
- **Issued** — numbered, stock moved, debt created. Cannot be edited, only
  credited (§6) or voided (§7).

Stored status is **`draft | issued | void` and nothing else**. "Partly paid" and
"paid" are DERIVED from `amountPaid + amountCredited` against `total`, never
stored: a status somebody can set by hand is a status that disagrees with the
money, which is the same reason the delivery screen derives its payment state
rather than storing one.

A draft is not an invoice. Nothing outside the drafts list ever counts one.

## 3. Numbering: gapless, and therefore online-only

`INV-2026-0001`, per business, resetting each calendar year. Quotations are
`QT-2026-0001` and credit notes `CN-2026-0001`, each with their own counter.

Gapless means a counter document read and then written **inside the same
transaction** that writes the invoice. That is the read-then-write offline
selling forbids — which is why `DESIGN-vat.md` §96 refused fiscal numbers at the
till. An invoice is not a till: it is raised at a desk, so **issuing requires a
connection**. Offline, the Issue button says so and the draft waits. Drafts
themselves save offline like anything else.

A gap in an invoice sequence is the first thing an auditor asks about, so a
number is never reused, never re-minted, and a voided invoice keeps its number.

Counter lives at `counters/{invoice-2026}` etc. and is owner/manager writable,
bounded to +1 by the rules: a counter that can jump can also collide.

**How the rules actually enforce it.** An issued invoice carries `counterId`
(`invoice-2026`) and `sequence` (the number as an integer), and the rule requires

    getAfter(counters/$(counterId)).data.value == request.resource.data.sequence

so the invoice and the counter move together or neither does. Two tills issuing
at the same moment cannot mint one number: the second transaction re-runs
against the new counter and takes the next sequence. The printed `number` string
is built from the same sequence, so it cannot disagree with it.

## 4. Stock, and the double-deduction trap

An issued invoice for goods **moves stock**, exactly as a sale does.

The trap: the same goods must never leave twice. A shop can reach an invoice two
ways, and they are different documents:

| Route | Stock | Debt |
|---|---|---|
| **Raised fresh** — customer orders, invoice issued, goods handed over | moves on issue | created by the invoice |
| **Raised against an existing credit sale** — goods already left through the till | **moves nothing** | already exists; the invoice only formalises it |

The second carries `saleId` and is stamped "from sale" on the document. Rules
require: an invoice carrying `saleId` writes no stock movement and creates no new
debt; one without it does both. Phase 1 builds both, because a shop that sells on
credit at the till and is then asked for an invoice is the common case, and
without it somebody retypes the sale and the shelf goes wrong.

Service lines move no stock either way.

## 5. The receivable stays one number

`customers.balanceOwed` remains the single balance, written by the till today.
An issued invoice **increases** it; a payment **decreases** it; a credit note
**decreases** it. An invoice raised against an existing sale changes nothing,
because the sale already did.

`payments` gains an optional `invoiceId`. A payment with one is applied to that
invoice and to the balance; a payment without one is a payment on account, which
is what the till writes today and keeps working unchanged.

This is also the detective fix L-10 has been waiting for: expected balance is now
`sum(issued invoices) + sum(credit sales) − sum(payments) − sum(credit notes)`,
and anything else is a gap somebody has to explain.

## 6. Credit notes, not deletions

An issued invoice is never edited and never deleted. A mistake is corrected by a
**credit note** against it: full or partial, reducing the balance and optionally
returning stock.

A VAT-registered business is reminded that an EFD cannot process a credit note:
TRA takes an **adjustment note (ITX.254.02.E, three copies, generally within
7 days)**, and that filing is theirs. The screen says so and never implies we
filed it.

## 7. Voiding

Only an invoice with no payments and no credit notes may be voided, and only by
the owner. It keeps its number, is marked void, reverses its stock and its debt,
and says who voided it and when. Anything with money against it is corrected by
credit note instead.

## 8. What a document carries

**Customers get a screen of their own** (decided 2026-09-13). Until now a
customer existed only as a name and a phone typed at the till, created
implicitly by `findOrCreateCustomerForCredit()`, with nowhere to edit it and no
way to see what one had bought. A customer you can only reach through a report
is the wrong shape for invoicing a business that has a TIN and payment terms.
The screen lists customers, adds and edits them, and shows each one's invoices
and payments. Statements are generated from it.

Customer gains `tin`, `vrn`, `address`, `email` — all optional, all captured now
because retrofitting means guessing at history, and because a VFD integration
later makes buyer TIN mandatory.

**Who sees it (built 2026-09-13).** Manager and owner. A cashier's till reads
customers in order to sell on credit, but a list of who owes what is the
receivables book, and `DESIGN-permissions.md` is explicit that a cashier records
without seeing the books; `canOpenView()` enforces it by falling through to the
manager check, since `customers` is not in `CASHIER_ALLOWED_VIEWS`.

The Reports receivables panel is **not** replaced: it answers "who owes me",
which is a different question from "who do I sell to", and it is the panel the
owner already reads. The new screen lists everyone, including customers who owe
nothing.

Two things it deliberately does not do yet. A profile edit writes **no audit
entry**, because `CUSTOMER_UPDATED` is not in the rules enum (§12) — the rules
already guarantee such an edit cannot move money, so what is missing is a record
of who renamed somebody, not a hole. And the per-customer **invoice list stays
empty** until the invoices screen exists; it queries `invoices` by `customerId`
already, so it fills itself the moment the first one is raised.

An invoice carries: number, status, customer (id and a denormalised name, so the
document survives the customer being renamed), lines (product id or free text,
description, quantity, unit, unit price, line total), discount, subtotal, tax
fields when the business is registered, total, issue date, due date, terms,
`storeId`, `saleId?`, `quotationId?`, `createdBy`, and the amounts paid and
credited to date.

Money is stored the way sales store it: `netTotal + taxTotal == total`, derived
by subtraction from the total actually charged, never rounded independently —
`firestore.rules` enforces that invariant on sales and will enforce it here.

## 9. Quotations

`QT-2026-0001`. No stock, no debt, no tax event. Converts to a draft invoice in
one step, carrying its lines over and recording `quotationId`. Expires on a date;
an expired quotation is marked, not deleted.

## 10. Statements

Generated, never stored: per customer, per period — opening balance, every
invoice, payment and credit note in date order, closing balance. PDF and
WhatsApp, reusing `ensureLibrary("pdf")`, `doc.autoTable` and the `wa.me` share
the receipts already use. A statement is a reading of the ledger, so storing one
would only create a second version of the truth.

## 11. Who may do what

| | Owner | Manager | Cashier |
|---|---|---|---|
| Draft, quote | yes | yes | with `issueInvoices` |
| Issue | yes | yes | with `issueInvoices` |
| Record payment against an invoice | yes | yes | with `takeRepayments` |
| Credit note | yes | yes | **no** |
| Void | yes | **no** | no |
| See the invoice list | yes | yes (their branches) | own only |

`issueInvoices` is a ninth cashier permission (`DESIGN-permissions.md`), default
**off**, enforced in the rules.

## 12. What this does not do

- No fiscal receipt, no VFD call, no verification code (`RESEARCH-invoicing.md`
  §6 phase 4).
- No recurring invoices, no multi-currency: one currency per store, as today.
- No partial delivery against an invoice, and no delivery note in phase 2.
- Withheld VAT on a payment is phase 3, and until it exists a payment short by
  withholding is recorded as a payment plus a credit note, which is honest if
  clumsy.
- **The audit actions are not permitted yet.** `INVOICE_ISSUED`,
  `INVOICE_PAYMENT_APPLIED`, `CREDIT_NOTE_ISSUED`, `QUOTATION_ISSUED`,
  `CUSTOMER_UPDATED` and `INVOICE_VOIDED` were removed from the enum in
  `firestore.rules` because the rules landed before the screens that write them,
  and an entry no client can produce is permission nobody is checking
  (`tests/audit-actions-agree.test.mjs` fails on exactly that). Each goes back
  in the same change that adds the code emitting it — so the first screen to
  write one must add it, or its transaction is denied.
