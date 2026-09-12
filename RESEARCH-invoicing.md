# Invoicing — research

Researched 2026-09-11. **No code, no schema.** The owner asked for research
before anything is built. This file records what the law requires, what
SaviaSmart already holds, the constraints from our own record, and the decisions
needed before a design.

Nothing here is tax advice. Where sources disagree, it says so (§9). Confirm
anything tax-related with a Tanzanian tax adviser before it is built into a
document a business hands to a customer.

---

## 0. The short version

1. **A SaviaSmart invoice cannot be a tax invoice on its own.** In Tanzania the
   document that proves VAT, and lets the *buyer* claim input VAT back, is the
   fiscal receipt/invoice from an EFD or VFD. It carries a TRA verification code
   and QR code. The upgraded EFDMS reportedly rejects input-VAT claims on
   invoices without one. What we can build now is a **commercial invoice**: a
   formal request for payment that records the debt.
2. **Issuing an invoice starts the tax clock.** For goods, the time of supply is
   the earliest of: the invoice being issued, any part being paid, or payment
   falling due. A VAT-registered business that issues our invoice has made the
   supply, so it must issue its fiscal receipt then, not when the money arrives.
   Until we integrate a VFD, that means entering the sale twice. The screen has to
   say so honestly.
3. **Invoices do not have the offline problem the till has.** `DESIGN-vat.md` §96
   refused gapless numbers because a sale can be made offline. Invoices are raised
   at a desk, not at a queue. Issuing one can **require a connection**, which makes
   a gapless `INV-2026-0001` sequence a plain Firestore transaction. Drafts can
   still be written offline.
4. **Most of the plumbing already exists.** Customers, credit balances,
   append-only payments, ageing buckets, WhatsApp reminders, receipt PDFs, and
   jsPDF plus autotable (already lazy-loaded) are all in place. Invoicing is
   mainly a new *document* layered over the receivables we already keep.
5. **Payments against invoices also close L-10.** Today a balance is one number,
   and a cashier can set it to zero (KNOWN-LIMITATIONS L-10). Once money is applied
   to specific invoices, the expected balance can be worked out from the invoices
   and payments, and a gap becomes detectable.
6. **B2B buyers will pay short, legitimately.** Since 2025, government bodies and
   appointed agents withhold part of the VAT and hand over a certificate. An
   invoice that only accepts "paid in full" will show those customers as
   permanently owing. The payment record needs a *withheld* part and a
   certificate reference.
7. **Fiscalisation is a later phase, and it is buyable.** Third-party VFD
   providers expose a REST API for roughly TZS 55,000–115,000 a year plus TZS
   35,000 registration. The risk to watch is TRA's proposed **pre-clearance**
   model: approval before the receipt reaches the customer. It was proposed in
   June 2025 and was reportedly still not gazetted in July 2026. If enacted, offline
   fiscalisation becomes impossible by construction.

---

## 1. Three documents that get called "invoice"

| Document | What it is | Legal weight | Can SaviaSmart issue it today? |
|---|---|---|---|
| **Quotation / proforma** | "This is what it would cost." No sale, no debt, no stock movement. | None as a tax document. Not addressed in public TRA sources. | Yes |
| **Commercial invoice** | "You owe this, by this date." Records the debt and the goods. | A business record, kept 5 years. Starts the time of supply (§2.1). **Not** a tax invoice. | Yes |
| **Tax invoice / fiscal receipt** | Issued through an EFD/VFD. Signed, numbered by the device, carries a verification code and QR. | The only document that supports the buyer's input VAT claim. | **No.** Needs VFD integration (§6, phase 4). |

The most dangerous mistake would be printing "TAX INVOICE" on the middle one.
A buyer who files an input VAT claim on it loses the claim, and the shop that
issued it has made a false statement on a document it is audited on. Same
principle as `receiptVatRows()`: silence is better than a confident wrong
statement.

---

## 2. The law that shapes it

### 2.1 When the supply happens

VAT Act 2014 (Cap. 148): for goods, the time of supply is the **earliest** of

- the invoice being issued, if the supplier issues one;
- any part of the payment being received;
- the payment falling due.

Consequence: for a VAT-registered business, *Issue invoice* is a tax event. The
design should make issuing a deliberate act, with a draft state before it, not
something a Save button does in passing.

### 2.2 What a tax invoice / fiscal receipt must show

From the Income Tax (Electronic Fiscal Devices) Regulations 2012, reg. 10, as
summarised by VATupdate (July 2026):

- seller name, address, **TIN** (and VRN if registered);
- buyer name, address, **TIN**;
- device identification number;
- item description, quantity, unit price;
- discounts, mark-ups and corrections;
- date and time; total payable;
- daily ascending serial number and the fiscal logo;
- since the Protocol 2.1 upgrade: **Receipt Verification Code** and a **QR code**
  pointing at TRA's verification page.

The VAT Act adds a tax-exclusive price per line and the rate.

**What this means for the commercial invoice:** collect buyer TIN, VRN and
address *now*, even though our document is not the fiscal one. When VFD
integration arrives those fields are mandatory. Asking for them on a customer
created two years earlier is exactly the retrofitting problem the expenses design
avoided by capturing `paidFrom` from day one.

### 2.3 Who must fiscalise

- All **VAT-registered persons** (since 2010). VAT registration threshold: TZS
  200m turnover (since 1 July 2023).
- **Non-VAT traders above a turnover threshold** (since 2013). Our earlier
  research recorded **TZS 11m**. One 2026 source gives **TZS 14m** (§9).
- Finance Act 2026 (from 1 July 2026): presumptive tax for resident individuals
  with turnover **above TZS 11m and up to TZS 200m** is **4%**. The ceiling rose
  from TZS 100m.

### 2.4 Penalties

Reported after the Finance Act 2024 (currency point = TZS 20,000): failing to
issue a fiscal receipt costs **20% of the value, or 100 currency points,
whichever is greater, capped at 200 currency points (TZS 4,000,000)**, and/or up
to 3 years' imprisonment. A buyer who fails to demand a receipt faces 2–100
currency points.

### 2.5 Credit notes

An EFD **cannot process a credit note**. For a decrease (a return, a
cancellation, a price correction), the supplier files an **adjustment note, form
ITX.254.02.E, in three copies, generally within 7 days**.

Our credit note is therefore a commercial record that reverses a debt and,
optionally, returns stock. The screen should remind a registered business that
the TRA adjustment is theirs to file, and by when. It must never imply we filed it.

A **cancelled invoice keeps its number** and is marked void. It is never deleted
and never renumbered. A gap in an invoice sequence is exactly what an auditor asks
about. This matches TRA's own rule for fiscal receipts, where a cancelled
transaction takes a new number rather than reusing one.

### 2.6 Withholding VAT: why B2B customers pay short

In force from 2025 (EY gives 1 September 2025, other sources 1 July 2025):

- **Withholding agents:** the Ministry of Finance; government entities that keep
  their own revenue (executive agencies, regulators, own-revenue boards, local
  government authorities, public universities); and anyone the
  Commissioner-General appoints.
- On a standard-rated supply the agent withholds **3% for goods (6% for services)**
  and remits it to TRA. The supplier receives the remaining VAT (15% for goods).
  Finance Act 2026 adds that mixed supplies split 3:2 goods to services.
- The agent issues a **withholding certificate** showing both parties' TIN and
  VRN, the description, the consideration and the VAT.
- The supplier **cannot deduct the withheld tax without holding a valid
  certificate at the time of filing**.

For the invoice design: a payment needs `amountReceived`, `vatWithheld` and
`withholdingCertificateNo`. The invoice counts as settled when received plus
withheld equals the total. A report listing "withheld, certificate not yet
received" protects real money. **This matters most for a maize or flour business
selling to government buyers**, schools, prisons or the food reserve.

### 2.7 A second VAT rate

Finance Act 2025 introduced a **16%** rate for supplies to an **unregistered**
buyer who pays through a bank or an electronic payment system approved by the
Commissioner-General (from 1 September 2025, per EY). If that holds, the VAT on
an invoice depends on who the buyer is and how they pay, not only on the product.
Today `vatRate` is a single business-wide figure. Confirm with an adviser before
designing the tax side (§9).

### 2.8 Retention

EFD Regulations reg. 17(2): records kept for **at least 5 years**. Invoices are
never hard-deleted, only voided. `firestore.rules` already treats payments and the
cost history this way.

### 2.9 Data residency

Unchanged from `RESEARCH-accounts.md` §2.3 and `RESEARCH-data-residency.md`: Tax
Administration Act s.35(7) requires the primary data server to be in Tanzania.
Invoices are a business record like any other, so they add no *new* exposure. But
a large B2B client's auditor is exactly the person who asks.

---

## 3. The document family, in the order a business uses it

```
Quotation ──accept──▶ Invoice ──deliver──▶ (Delivery note)
                         │
                         ├── Payment(s)  — partial, with withheld VAT + certificate
                         ├── Credit note — reverses some or all, may return stock
                         └── appears on ▶ Statement of account (per customer, per period)
```

| Document | Moves stock? | Creates debt? | Numbered? |
|---|---|---|---|
| Quotation | no | no | `QT-2026-0001`, gaps harmless |
| Invoice | **decision (§8, 3)** | yes | `INV-2026-0001`, **gapless** |
| Delivery note | if stock moves on delivery | no | references the invoice |
| Payment / receipt | no | reduces it | append-only, like `payments` today |
| Credit note | optionally back in | reduces it | `CN-2026-0001`, gapless |
| Statement | no | no | generated, not stored |

---

## 4. What SaviaSmart already holds

| Need | Exists today | Where |
|---|---|---|
| Customers | yes, per store, name + phone + `balanceOwed` + `creditLimit` | `customers` rules, `renderCustomerAccounts()` |
| Payments | yes, **create-only** (no update, no delete) | `customers/{id}/payments` |
| Ageing | yes, buckets by days outstanding | `customerAgingBucket()`, `customerDaysOutstanding()` |
| Reminders | yes, WhatsApp text | `sendPaymentReminderWhatsApp()` |
| Credit limits + override | yes | `checkCreditLimitBeforeSale()`, `credit-override.test.mjs` |
| Document rendering | receipt HTML, 80 mm PDF, WhatsApp share | `buildReceiptHtml()`, `downloadReceiptPdf()` |
| A4 tables in PDF | jsPDF 2.5.1 + autotable 3.8.2, lazy-loaded | `ensureLibrary("pdf")` |
| VAT on a document | per sale, inclusive, VRN on receipt | `taxFields`, `receiptVatRows()` (VAT screen off) |
| Currency | one per store | `store.currencyCode` |
| Audit trail | append-only `auditLogs` | rules |

**Missing:** buyer TIN/VRN/address on a customer; a document with a number,
issue date, due date and terms; payments linked to a *document* rather than to a
customer balance; a withheld-VAT field; credit notes; statements; an A4 layout.

---

## 5. Constraints from our own record

1. **Offline.** Tills sell offline, and that is not traded away. Invoices are
   issued online-only, which a desk document can afford. A draft saved offline
   gets its number when issued. The number is never allocated on the device.
2. **A gapless counter is a read-then-write**, so it must run in a transaction:
   one `counters/invoices-{year}` document per business, or per branch if branches
   invoice separately (§8, 5). Issuing fails cleanly when offline and says why. It
   never queues.
3. **Cost disclosure.** An invoice line carries a *selling* price only. No
   invoice screen may show cost or margin (DESIGN-purchases.md §10). A profit-per-
   invoice view, if ever wanted, belongs behind the owner gate.
4. **The till's rules budget.** Invoices get their own collection and their own
   rules. `validSale()` and `memberSellsInStore()` are not touched: the sale path
   has already had an outage from the 1000-expression cap.
5. **Spark plan, no Blaze.** No Cloud Functions. Numbering is a client
   transaction checked by rules (next number = stored counter + 1). A VFD call,
   when it comes, goes through the existing Render proxy, which already holds the
   Admin SDK.
6. **Growing subscriptions.** Invoices are a new growing collection. They must
   carry the same bounded, store-scoped query and coverage refusal as sales
   (`load-volume.test.mjs`), plus a declared composite index. A missing index
   breaks staff only, and the emulator never catches it.
7. **No native dialogs.** Void, cancel and credit confirmations go through
   `askConfirm()`.

---

## 6. Recommended shape, phased

**Phase 1: invoices over the receivables we already keep.**
Customer gains TIN, VRN, address and email (all optional). Invoice: number,
customer, lines (product or free text, qty, unit, price), discount, total, issue
date, due date or terms (e.g. 30 days), status `draft → issued → partly paid →
paid | void`. Issue online-only with a gapless number. Payments applied to an
invoice, append-only. A4 PDF and WhatsApp share. The customer balance comes from
invoices minus payments. Printed title: **"Invoice"**, never "Tax invoice".

**Phase 2: quotation, credit note, statement.**
Quotation converts to an invoice in one step. Credit note reverses some or all of
an invoice and can return stock; a registered business is reminded about the
7-day TRA adjustment note. Statement of account per customer and period, as a PDF.

**Phase 3: B2B tax detail.**
Withheld VAT and certificate on payments. "Certificates outstanding" report.
USD or other currencies per invoice, if a client needs it. The 16% question
settled with an adviser.

**Phase 4: fiscalisation through a VFD provider.**
Server-side through the proxy. Online-only, because an invoice is. The provider's
verification code and QR go onto our PDF, which then *is* the tax invoice. Blocked
until the pre-clearance question (§0, 7) and key custody (`RESEARCH-accounts.md`
§5.4) are decided.

---

## 7. The maize client (meeting 20 September 2026)

That meeting is about **a system built for them**, not necessarily SaviaSmart as
it stands. Invoicing research only answers part of it. Things that differ from a
duka, to ask them about rather than assume:

- **Units.** Maize and flour trade in kg, tonnes and bags (50 kg, 100 kg, and
  others). Our stock counts units. Is a bag always the same weight? Do they
  invoice by weighbridge weight?
- **Moisture and quality deductions.** Buying grain usually means paying on
  weight *after* deductions. Public sources say quality checks are rare in
  informal trade, but an industrial buyer will have its own grading. That is a
  **purchase-side** document, not an invoice.
- **Who they sell to.** If government, schools, prisons or the food reserve:
  withholding VAT (§2.6) from day one.
- **Who they buy from.** Farmers, aggregators or warehouse-receipt auctions? The
  1% agricultural withholding tax is contested between sources (§9), and local
  produce cess on moving crops varies by council. Both are purchase-side.
- **Scale.** Branches, depots, transactions per day, whether trucks deliver
  against invoices (delivery notes), and whether they already hold an EFD or VFD.
- **Existing records**, and **data residency** (§2.9). A company of that size has
  an auditor.

---

## 8. Decisions needed before a design

1. **Scope of the first release.** Phase 1 only, or phases 1+2 together?
2. **Who it is for first.** The 23 shops (8 live + 15 arriving), or shaped
   around the maize client? The answers differ on units, currency and withholding.
3. **When stock leaves.** On issuing the invoice (simple, matches a sale), or on
   a delivery note (goods leave later, or in parts)?
4. **Who may issue.** Owner and manager; a cashier only with the new *Issue
   invoices* permission (see the permissions work).
5. **Numbering scope.** One sequence for the business, or one per branch
   (`DAR-INV-2026-0001`)?
6. **Credit sales at the till.** Keep them as they are, with invoices as a
   separate desk document, or have every credit sale become an invoice
   automatically?
7. **Adviser.** Will the owner put §2.3, §2.6 and §2.7 to a tax adviser before
   phase 3?

---

## 9. Conflicting or unverified

- **Non-VAT EFD threshold:** TZS 11m (earlier research, several sources) against
  TZS 14m (one 2026 search summary). Unresolved.
- **1% agricultural withholding tax (Finance Act 2026):** Clyde & Co says the
  rate remains in law but the obligation for corporations to withhold it was *not*
  enacted. TanzaniaInvest says the measure was dropped entirely. They disagree.
  Needs an adviser.
- **Withholding VAT start date:** 1 September 2025 (EY) or 1 July 2025 (other
  sources).
- **16% VAT rate:** reported from EY's Finance Act 2025 analysis. How it applies
  per invoice is not confirmed.
- **Pre-clearance:** "proposed, not gazetted" is as at VATupdate's July 2026
  booklet. Recheck before phase 4.
- Several summaries above were read through secondary sources (law-firm and
  VAT-news analyses), not the gazetted text.

---

## Sources

- VATupdate, *Tanzania — E-Invoicing & E-Reporting Country Booklet* (7 Jul 2026): https://www.vatupdate.com/2026/07/07/tanzania-e-invoicing-e-reporting-country-booklet/
- VATupdate, *Tanzania Enacts Finance Act 2026* (20 Aug 2026): https://www.vatupdate.com/2026/08/20/tanzania-enacts-finance-act-2026-with-major-vat-and-tax-changes/
- Clyde & Co, *Tanzania Tax Update: Finance Act 2026 Highlights*: https://www.clydeco.com/en/insights/2026/07/tanzania-tax-update-finance-act-2026-highlights
- TanzaniaInvest, *Finance Bill 2026 tax changes*: https://www.tanzaniainvest.com/economy/finance-bill-2026-tax-changes
- EY, *Tanzanian Finance Act, 2025 analysis*: https://www.ey.com/en_gl/technical/tax-alerts/tanzanian-finance-act-2025-analysis
- EY, *Tanzanian Finance Act, 2024*: https://www.ey.com/en_gl/technical/tax-alerts/tanzanian-finance-act-2024-makes-changes-affecting-businesses-and-individuals
- S R Auditors, *Withholding VAT in Tanzania 2025*: https://sra.co.tz/withholding-vat-in-tanzania-2025/
- Tally Solutions, *EFD in Tanzania*: https://tallysolutions.com/ssa/vat/efd-in-tanzania/
- VFD Tanzania (provider pricing and integration): https://www.vfd.co.tz/
- Laws of Tanzania, *Value Added Tax Act*: https://tanzanialaws.com/statutes/principal-legislation/410-value-added-tax-act
- FAO, *The Maize Value Chain in Tanzania*: https://www.fao.org/fileadmin/user_upload/ivc/PDF/SFVC/Tanzania_maize.pdf
- Earlier internal research: `RESEARCH-accounts.md` §5, `DESIGN-vat.md` §96, `KNOWN-LIMITATIONS.md` L-10.
