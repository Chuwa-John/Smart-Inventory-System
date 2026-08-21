# Accounts, and preparing a shop for a TRA audit — research

**Status: research only. Nothing here has been built, and nothing here should be
read as tax advice.** Every figure below is dated and sourced. Tanzanian rates
and thresholds move every Finance Act — the last three all touched something in
this document — so treat the numbers as *evidence that a versioned rules table
is required*, not as constants to hard-code. Your own instinct on that point was
right and it is the single most important design constraint in here.

Researched 2026-08-21, against a system currently live for 8 businesses on
`20260808o`.

---

## 0. The short version

Five findings change the shape of what you proposed. In order of how much they
change it:

1. **We may already be non-compliant on data location, independently of this
   feature.** Section 35(7) of the Tax Administration Act, as amended by the
   Finance Act 2023 and effective **1 January 2024**, requires any taxpayer
   keeping records in electronic form to maintain their **primary data server
   in Tanzania**, and the amendment explicitly defines "primary data server" to
   include a **virtual** server. SaviaSmart's records live in Firestore, which
   is not in Tanzania. This is a real exposure for the 8 shops *today*, and
   building an Accounts module makes it sharper, because the module's whole
   claim is that the system holds their books. §2.3.

2. **Record-keeping is not just compliance — for a small shop it is a
   discount.** Under the presumptive regime, a trader turning over TZS 4–7m
   pays a flat **TZS 100,000** with no records, or **3% of the excess over
   4m** with records. At TZS 5m that is 100,000 versus 30,000. That is the
   commercial argument for the whole module, and it is arithmetic, not
   marketing. §3.1.

3. **"EFD/VFD reconciliation" reconciles against something we do not have, and
   the shops may be keying every sale twice today.** Every VAT-registered
   business, and every non-VAT trader over **TZS 11m** turnover, has been
   required to use an EFD since 2013. If our shops are compliant, they are
   ringing each sale into our POS *and* into an EFD. That is the actual pain,
   it is bigger than the audit pack, and it is a different programme with a
   different risk profile. §5.

4. **`DESIGN-vat.md` §96 assumed fiscalisation and offline selling could not
   both be true. On the evidence, that may be wrong** — the fiscal signature is
   computed locally with a private key, and only *transmission* needs the
   network, which is exactly how hardware EFDs already behave. The blocker
   turns out to be key custody in a browser, not numbering. That decision
   should be re-opened rather than inherited. §5.4.

5. **Half the books you listed cannot be produced from the data we hold, and
   the missing half is the purchase side.** We have no purchases, no expenses,
   no supplier ledger, no bank or mobile-money book, and no general ledger.
   `costPrice` is a single mutable field on the product with no history, so
   even cost of goods sold is explicitly "estimated" in the code today
   (`app.js:8220`). Without the purchase side there is no input VAT, no real
   gross profit, and no defensible closing-stock valuation. §7, §8.

---

## 1. What I actually researched

Your question was "what books are usually used to prepare for a TRA audit". I
went at it three ways, because the textbook answer and the operative answer are
different:

- **The statute** — what the Tax Administration Act 2015 obliges a taxpayer to
  keep, in what form, for how long, and where.
- **The regime** — what TRA's systems (EFDMS, VFD) already hold about a
  business, because an audit largely reconciles a taxpayer's books *against
  TRA's own data*, and that changes which books matter.
- **The codebase** — what SaviaSmart records today, so the gap is measured
  rather than guessed.

The third one is the reason this document is longer than a list of books.

---

## 2. The law: what a Tanzanian business must keep

### 2.1 The obligation

**Tax Administration Act 2015, section 35** ("maintenance of documents"). Every
taxable or liable person shall, **within the United Republic**, maintain
documents **in paper or electronic form** which contain the information to be
filed with the Commissioner General under any tax law, and which enable an
accurate determination of tax payable.

Three constraints sit on top of that:

| Constraint | Requirement |
| --- | --- |
| **Retention** | At least **5 years** from the end of the year of income the records relate to — longer if an audit, objection or appeal is running. |
| **Language** | English or Kiswahili. |
| **Currency** | Tanzanian Shillings (foreign-currency accounting is a Commissioner concession, for branches of foreign companies). |

The 5-year retention is a design input, not a footnote: it is 5 years × 365 days
× a shop's daily sales, all of it required to be *producible*, against a client
that currently subscribes to the newest 1,000 sales (§9).

The language requirement is one we happen to satisfy twice over — the app is
already bilingual English/Kiswahili — and it is worth knowing that our Kiswahili
is machine-assisted and unreviewed. If an audit pack is generated in Kiswahili,
the label on a number is part of the record.

### 2.2 What "documents" means in practice

TRA and the practitioner guidance consistently list: **books of account,
invoices — including EFD receipts for sales — purchase receipts, contracts,
and bank statements.**

Note the shape of that list. It is not "a general ledger". It is *sales
evidence, purchase evidence, contracts, and money movement*. Three of the four
are things we do not hold.

### 2.3 The primary data server — the finding that matters most

**Section 35(7), as amended by the Finance Act 2023, effective 1 January
2024**: a person storing data in electronic form must maintain their **primary
data server in Tanzania**. The Act defines a primary data server as *a
physical, virtual or any other server that stores data created or collected by
a taxable or liable person in the ordinary course of business.*

The "virtual" wording was added specifically so that cloud storage could not be
used to sidestep the requirement. Commentary from EY and Bowmans flags genuine
ambiguity in how it is meant to be satisfied and how the Commissioner is meant
to be given access, and notes no published exemption.

What this means for us, stated plainly:

- SaviaSmart's data lives in Google Cloud Firestore under project
  `sanitaryflow-erp`. **I have not confirmed which region that database is in,
  and it should be checked** — but no Firestore region is in Tanzania.
- Today the shops arguably keep their *books* elsewhere (an EFD, a paper cash
  book) and use us as an operational tool. An Accounts module changes that
  claim: it makes us the books.
- I am not going to tell you whether this makes anyone liable. I am telling you
  it is a question a competent tax adviser has to answer **before** we market a
  module on TRA compliance, because the module's own storage would be the first
  thing an auditor asks about.

Possible directions, none of them free, none of them researched to conclusion:
a Tanzanian-hosted replica that TRA can be pointed at; a periodic signed export
the owner stores locally in-country; or a position, taken on advice, that the
customer's own exported records are the primary set. This is a legal question
first and an engineering question second, and that ordering matters.

---

## 3. The numbers, and their dates

Everything in this section is a candidate row in the versioned rules table.

### 3.1 Presumptive income tax — individuals, turnover ≤ TZS 100m

Last reviewed 14 January 2026 (PwC), consistent with the 2025/26 guides.

| Annual turnover (TZS) | Tax **without** records | Tax **with** records |
| --- | --- | --- |
| Below 4,000,000 | Nil | Nil |
| 4,000,000 – 7,000,000 | **100,000** | 3% of the excess over 4,000,000 |
| 7,000,000 – 11,000,000 | **250,000** | 90,000 + 3% of the excess over 7,000,000 |
| 11,000,000 – 100,000,000 | — | **3.5% of turnover** |

"With records" means section 35 is complied with. So:

- A shop on **TZS 5m** pays 100,000 without records, **30,000** with them.
- A shop on **TZS 9m** pays 250,000 without records, **150,000** with them.

Above TZS 11m the distinction disappears — it is 3.5% of turnover either way —
but at that point records and an EFD are compulsory anyway, so the incentive
becomes avoiding penalties rather than paying less.

This table is the strongest thing in the research. It says the module has a
**measurable** payoff for exactly the smallest customers, who are otherwise the
hardest to sell software to.

### 3.2 VAT

| Item | Value | Note |
| --- | --- | --- |
| Standard rate | **18%** | Matches our `VAT_RATE`. |
| Registration threshold | **TZS 200,000,000** / year | Raised from 100m on **1 July 2023**. |
| Six-month trigger | TZS 100,000,000 in any 6 consecutive months | Compulsory registration even below the annual threshold. |
| Return and payment | Monthly, by the **20th** of the following month | |
| Input tax claim window | **6 months**, running from the **fiscal receipt date** | Not the invoice date. See §5.3. |
| Reduced rate | **16%** on electronically-paid B2C supplies to unregistered persons | From **1 September 2025**. |
| VAT withholding | **3%** goods, **6%** services | From **1 July 2025**, with TRA system-generated certificates. |
| Credit notes | Adjustment note **ITX.254.02.E**, filed within 7 days | Manual — not a device operation. |
| Zanzibar | **Separate jurisdiction**, ZRA, **15%**, own VFMS | Not interoperable with mainland EFDMS. |

Two of these are new since our VAT work shipped on 2026-08-07 and neither is
modelled: the **16% electronic-payment rate** (we record the payment method on
every sale — we already hold the input for it and do not use it) and **VAT
withholding**.

The **Zanzibar** row is a straight product question: if any of the 8, or any
future customer, trades in Zanzibar, none of the mainland logic applies to them.

### 3.3 The rest of the calendar

| Obligation | Deadline |
| --- | --- |
| PAYE | 7th of the following month |
| VAT return | 20th of the following month |
| Provisional tax | Four instalments: 31 Mar, 30 Jun, 30 Sep, 31 Dec (25% of estimate each) |
| Final income tax return | Within 6 months of financial year end |

### 3.4 Penalties

A **currency point is TZS 20,000** (raised from 15,000 by the Finance Act 2024,
effective 1 July 2024).

| Failure | Penalty |
| --- | --- |
| Not issuing a fiscal receipt / not using an EFD | 20% of the value, or 100 currency points, whichever is greater — capped at 200 CP (**TZS 4,000,000**), and/or up to 3 years imprisonment. Business can be closed until compliant. |
| Buyer not demanding a receipt | 2–100 currency points |
| Tax evasion | Twice the tax evaded |
| Late filing (companies) | Up to TZS 225,000 or 2.5% of the tax per month, whichever is higher |

### 3.5 Thresholds worth knowing

- Turnover **≥ TZS 100m**: audited financial statements to be submitted.
- Individuals up to **TZS 500m** turnover: exempt from having a CPA in Public
  Practice prepare or certify the return.
- Companies: the Companies Act 2002 requires financial statements per NBAA
  rules. NBAA has adopted **IFRS** and **IFRS for SMEs** without modification.
  IFRS for SMEs is available to non-PIEs with fewer than 100 employees or
  capital investment under TZS 800m — which is every customer we have.

---

## 4. What a TRA audit actually is

The process, from the practitioner sources:

1. **Initiation** by the Commissioner General — triggered by discrepancies in
   returns, irregularities in financial statements, or routine selection.
2. **Information requests.** Officers request records; the taxpayer is obliged
   to give access to premises and documents.
3. **Fieldwork** — examination of financial records, returns, and supporting
   documentation.
4. **Notes of discussion** — a final audit report setting out the issues
   discussed and the position reached, **signed by both parties**.
5. **Assessment** — system-generated.
6. **Objection**, if any, within **30 days** of service, in writing, with
   grounds and evidence — and it is **not admitted** unless accompanied by
   payment of the tax not in dispute or **one third of the assessed tax**,
   whichever is greater.

That last clause is the one that should shape the product. An assessment you
cannot immediately rebut costs a third of it in cash before you are even allowed
to argue. **The value of an audit pack is not that it looks thorough at step 3 —
it is that it makes step 6 unnecessary.** Design toward "here is the document
that answers the question", not toward "here are fourteen reports".

Your instinct on this was already correct: *"The key is reconciliation, not
merely producing pretty reports."* The research supports it strongly.

---

## 5. Fiscalisation — the big one

### 5.1 Who must have an EFD

- **VAT-registered persons** — since 2010.
- **Non-VAT traders with annual turnover above TZS 11,000,000** — since 2013.
- Below TZS 11m: manual receipts **in duplicate**.

So the EFD obligation bites at **TZS 11m**, not at the TZS 200m VAT threshold.
Any of our 8 shops turning over more than about TZS 917,000 a month is in
scope. Some almost certainly are.

### 5.2 What TRA already holds

This is the part that reframes the audit module. Every fiscal receipt is
transmitted to **EFDMS**, carrying: seller name/address/TIN, buyer
name/address/TIN, item description, quantity, unit price, discounts, tax code,
tax-exclusive and tax-inclusive totals, a daily sequential counter, and a
Receipt Verification Code with a QR pointing at TRA's verification URL. Daily
**Z-reports** aggregate sales and VAT by rate and by payment method.

An auditor therefore already has the shop's sales. What they are testing is
whether the shop's *own* books agree with it. That is why "EFD reconciliation"
is the highest-value line on your list — and why it is unbuildable until we are
either the EFD or reading from one.

### 5.3 The input-VAT trap

The 6-month input tax window runs **from the date of the fiscal receipt**, and
the buyer's TIN on that receipt is what makes input VAT claimable at all. A
Purchase Book that records "supplier, amount, date" and not "fiscal receipt
number, RVC, receipt date, buyer TIN present yes/no" would produce a claim the
shop then loses. If we build the purchase side, those fields are the point of
it.

### 5.4 Re-opening the §96 decision

`DESIGN-vat.md` §96 concluded that a gapless fiscal sequence and offline selling
cannot both be true, and deferred fiscalisation on that basis. Having now read
the actual VFD API, I think the premise needs re-testing.

What the API requires (test endpoints under
`virtual.tra.go.tz/efdmsRctApi`, XML over HTTP):

- Registration: **TIN + CERTKEY** (device serial) → **REGID**, **RECEIPTCODE**,
  and a certificate (PFX).
- A **token** for posting receipts and Z-reports, valid for a limited period.
- Per receipt: `RCTNUM`, `DC` (daily counter, resets at midnight), `GC` (global
  counter, lifetime), `ZNUM`, and `RCTVNUM` = **RECEIPTCODE + GC**.
- Each `<RCT>` signed **SHA-1 with RSA** using the certificate's private key,
  base64-encoded.
- Daily **Z-report** before opening the next business day.
- Rules: sequences must never skip; future dates prohibited; a cancelled
  transaction takes a new number rather than reusing one; send one transaction
  at a time and only send the next when the current one has succeeded; **failed
  submissions retain their original timestamps on retry.**

Read that list against our offline queue and the conflict is narrower than §96
assumed:

- The **verification number is computable offline** — it is `RECEIPTCODE + GC`,
  and `GC` is a counter *we* maintain per registered device.
- The **signature is computable offline** — it is a local RSA operation.
- **Retry with the original timestamp is explicitly allowed**, which is exactly
  what our replay does.
- "One at a time, in order" is a property of the *queue*, which we already have.

Which means a complete, verifiable fiscal receipt could in principle be printed
at the till with no connection and posted when the connection returns —
precisely how a hardware EFD behaves. The counter stays gapless if each till is
its own registered device with its own serial, which is how the model is meant
to be used anyway.

**The actual blocker is key custody.** Signing offline means the business's RSA
private key is on the device. In a browser PWA that means a per-business private
key sitting in IndexedDB on a shop phone. Doing it server-side is safe and needs
the network, which defeats the point. That is a hard problem and I have not
solved it here — but it is a *different* hard problem from the one §96 recorded,
and it deserves its own decision rather than inheriting the old one.

### 5.5 The thing that would invalidate all of the above

The 2025/26 Budget (announced 13 June 2025) proposes moving EFDMS to
**token-based pre-clearance**: the taxpayer requests permission to issue an
e-invoice, with a live token sent to EFDMS, and TRA verifies and approves
**before the receipt reaches the customer**.

If that becomes law as described, offline fiscalisation is impossible by
construction — not difficult, impossible — and every offline-capable POS in
Tanzania has the same problem. As at this research it is a **budget proposal,
not statute**, with no firm effective date or transition timetable.

This is the single biggest reason not to start fiscalisation this quarter, and
the single biggest reason to watch it monthly.

---

## 6. Your proposed book list, checked against reality

Your table is a good list of a full accounting system. Not all of it is a duka.
Marking each by whether it applies to our customers and whether we could produce
it:

| Book | Applies to our customers? | Can we produce it today? |
| --- | --- | --- |
| Sales Book | **Yes, central** | Mostly — see §7 |
| Purchase Book | **Yes, central** | **No** — no purchase records at all |
| Cash Book | **Yes** | Partly — shifts give till cash, nothing else |
| Bank Book | Some; **mobile money matters more** | **No** |
| General Ledger | Only if we go double-entry | **No** |
| Accounts Receivable | **Yes** — credit customers exist | **Yes**, essentially |
| Accounts Payable | Yes, once purchases exist | **No** |
| Inventory / Stock Ledger | **Yes, central** | Partly — quantities yes, valuation no |
| VAT records | Yes, where registered | Partly — output only, and overstated |
| Fixed Asset Register | Marginal for a duka; a fridge or a salon chair qualifies | **No** |
| Expense records | **Yes** — rent, power, wages, transport | **No** |
| Payroll | Yes for shops with staff; PAYE + SDL | **No** |
| EFD/VFD records | **Yes, and TRA already holds them** | **No** — §5 |

Two corrections to the framing:

**Bank Book should be a Money Book.** Tanzania's mobile-money culture is one of
the most developed in the world, and our POS already records `mobile` as a
payment method. For most of our customers M-Pesa, Tigo Pesa and Airtel Money
*are* the bank. Reconciling against an M-Pesa statement is the real requirement;
a bank column is the optional one. Building "Bank Reconciliation" first would be
building for the wrong customer.

**Payroll is a programme, not a book.** PAYE at 8/20/25/30% on monthly bands,
plus SDL, plus filing by the 7th, plus employee records. It should not be
smuggled into an Accounts release.

---

## 7. What SaviaSmart already holds

From `firestore.rules` and `app.js` as at `20260808p`.

**Collections:** `products`, `sales`, `services`, `customers`, `payments`,
`shifts`, `stockMovements`, `transfers`, `auditLogs`, `monthlyReports`,
`staff`, `members`, `errorLog`.

**What is genuinely strong, and closer to audit-ready than I expected:**

- **Sales** carry `items`, `subtotal`, `discountType/Value/Amount`, `total`,
  `paymentMethod` (cash / mobile / card / credit), `staffId`, `staffName`,
  `orderNumber`, `voided`, `madeOffline`, and — where the business is
  registered — `vatRegistered`, `vrn`, `vatRate`, `taxTotal`, `netTotal`,
  `taxBreakdown`, with a **rule-enforced invariant** that
  `netTotal + taxTotal == total`. A sale physically cannot be written whose VAT
  fails to reconcile to its own takings. That is a better foundation than most
  systems have.
- **Per-line `taxClass`** on sale items since 2026-08-07 (`standard`,
  `zeroRated`, `exempt`).
- **A stock ledger with a chain link**: `stockMovements` carry `quantityBefore`,
  `delta`, `quantityAfter`, with a rule enforcing
  `quantityAfter == quantityBefore + delta`, plus `reason` from a closed set
  (`sale`, `restock`, `return`, `void`, `transfer-in`, `transfer-out`,
  `adjustment`). This is a real audit trail for quantities.
- **Receivables**: `customers` with balances, `payments` against them.
- **Cash accountability**: `shifts` with float, expected, counted and variance.
- **An append-only audit log** with a closed action enum.
- **Services** (`kind: "service"` on sale lines) — which, note, is a *supply of
  services*, and VAT-withheld at **6%** not 3% where withholding applies.

**What is missing, one line each:**

- **Purchases.** Nothing. `supplier` is a free-text string on a product — not an
  entity, not a transaction, not an invoice.
- **Expenses.** Zero occurrences of the term in `app.js`. Rent, power, wages,
  transport, licences — none of it exists.
- **Cost history.** `costPrice` is one mutable number per product. The code
  already says so: *"Cost of goods is estimated from each product's CURRENT
  costPrice"* (`app.js:8220`), and stock valuation is
  `quantity × current costPrice` (`app.js:8237`). There is **no valuation
  method** — not FIFO, not weighted average — and no way to recover what stock
  was worth at a past date, because the historical cost was overwritten. For a
  tax-relevant closing-stock figure that is the gap that matters most on the
  inventory side.
- **Money movement.** No bank, no mobile-money statement, no reconciliation.
- **A ledger.** No accounts, no double entry, no trial balance — so no P&L and
  no balance sheet.
- **Fiscal data.** No TIN capture, no receipt numbers, no RVC, no Z-reports.
- **Period lock.** Nothing prevents a sale being voided after the month it falls
  in has been reported and filed. For an audit module this is not a nice to
  have — it is the difference between a report and a record.

---

## 8. Difficulty, honestly ranked

Ordered by value per unit of risk, on my reading. This is input to your
decision, not a plan.

| Work | Value | Difficulty | Risk to production |
| --- | --- | --- | --- |
| Expenses (capture + report) | High | Low | Low — new collection, additive |
| Purchases / supplier invoices with fiscal receipt fields | **Highest** | Medium | Low — additive, and it unlocks input VAT, real COGS and stock valuation |
| Period lock | High | Low–Medium | **Touches the sale and void paths** |
| Cost history on stock movements | High | Medium | Medium — changes the restock path |
| Mobile-money / cash reconciliation | High | Medium | Low |
| Audit pack export (PDF/CSV bundle) | High | Medium | Low — but see §9 on the 1,000-sale ceiling |
| Readiness score | High commercially | Low, *given the above* | Low — it is a read over other work |
| General ledger / trial balance / P&L / balance sheet | Medium | **High** | Medium — a genuine accounting engine |
| Fixed assets + depreciation | Low–Medium | Medium | Low |
| Payroll / PAYE / SDL | Medium | **High** | Low, but it is its own programme |
| EFD/VFD fiscalisation | **Very high** | **Very high** | **High** — §5, plus pre-clearance risk |

The readiness score you sketched is, I think, the right product idea. Note where
it sits in that table: it is *cheap*, but only after the rows above it exist. It
is a presentation of reconciliations, so it is worth exactly as much as the
reconciliations underneath it and not a shilling more. Shipping the score early,
over data we do not have, would produce a confident number that lies — which on
this particular subject is worse than no number, for the same reason
`DESIGN-vat.md` gives: *"a tax calculation that is wrong is worse than absent:
it is wrong on a document a shop is audited on."*

---

## 9. Blockers already on our own record

These are in `KNOWN-LIMITATIONS.md` and every one of them is load-bearing here.

- **L-11 — reports see only the newest 1,000 sales.** `SALES_HISTORY_LIMIT` is
  1,000; the stock ledger reads 500; shifts 20; and every audit-log read is a
  capped, action-filtered query (100-300 entries) rather than a period read. A
  tax period must be
  computed over *complete* history, and §2.1 requires 5 years of it. The
  existing guard (`salesCoverageFromMs()`) makes the monthly report refuse
  rather than under-report — correct behaviour, and it means **an audit pack
  built on the current client would refuse to generate for most real periods.**
  This is the hard prerequisite. It needs server-side aggregation.
- **L-12 — a refund does not reduce the VAT owed on it.** The VAT return
  currently **overstates** liability. Safe direction, wrong figure, and it grows
  with refund volume. Its milestone was "the first full month after
  2026-08-07" — that is **September 2026**, i.e. next month. An audit module
  that reconciles VAT should not ship on top of a knowingly wrong VAT figure.
- **L-3 — the audit log is append-only but not tamper-evident.** For an "Audit
  Trail" line in an audit pack, "append-only by rule" and "tamper-evident" are
  not the same claim, and we should not make the second one.
- **L-8 — the products subscription is unbounded.** Same server-side
  aggregation milestone as L-11.
- **L-2 — a stock decrement cannot be bound to a sale.** Directly limits how
  strong an inventory reconciliation can honestly claim to be.

**L-11 and L-12 are prerequisites, not parallel work.** That is the most
actionable engineering conclusion in this document.

---

## 10. Prior art

Nothing here is a threat assessment; it is what the market has taught buyers to
expect.

- **VFD is the settled integration route.** Software-only since 2020. TRA
  publishes an approved-supplier list (17+), and local platforms — vfd.co.tz,
  Risiti, Simplify VFD, Mojatax, Power VFD — exist specifically to broker it.
  **We would not have to be TRA-certified ourselves to offer fiscalisation.**
  That materially lowers the wall in §5, and is worth pricing before building.
- **Vision XPOS** (Exact Software, Dar) — retail/restaurant/pharmacy POS,
  explicitly TRA-fiscal-device compliant, sold alongside its own accounting and
  payroll modules.
- **TallyPrime**, via Powercomputers — the incumbent for accounting-plus-
  inventory, with VFD support.
- **QuickBooks** — present, cloud, marketed as TRA-compliant.
- Native connectors from SAP, Oracle, Sage and QuickBooks to EFDMS are **not**
  documented, which is why the local broker layer exists.

The read: accounting-with-fiscalisation is well served for businesses that can
afford Tally or Vision. **Offline-first, phone-first, bilingual, priced for a
duka is not.** That is our position — and it is also exactly the position that
makes fiscalisation hardest (§5.4), which is worth sitting with rather than
designing around.

---

## 11. My read on shape

You asked for research, so this is a view and not a plan.

**The "Accounts" dropdown is the right container and the wrong first release.**
The 14-item audit pack is a destination. The first release should be the two or
three books that (a) we cannot fake, (b) unlock the rest, and (c) do not require
touching the sale path. On the evidence that is **purchases and expenses**,
because everything else — input VAT, gross profit, stock valuation, the
readiness score, the P&L — is downstream of them, and because they are additive
collections that cannot break a sale.

**Three positions I would want to hold:**

1. **A tax rules table with effective dates from day one**, exactly as you said,
   and every computed figure carrying the rule version it was computed under.
   §3 is proof this is not theoretical: three of those rows changed in the last
   three Finance Acts, and two changed after our VAT feature shipped.
2. **A figure that cannot be computed completely must refuse, not estimate.**
   That is the L-11 precedent and it should be the module's rule.
3. **Reconciliation, not reports** — your framing, and the §4 evidence backs it.
   The pack exists to make an objection unnecessary.

**Two things I would keep out of the first release:** fiscalisation (§5.5 alone
justifies waiting) and payroll (§6).

**One thing I would resolve before designing anything:** §2.3, the data server.
It is a legal question, it sits underneath the whole module, and the answer
could change the architecture rather than the feature list.

---

## 12. What I need from you before designing

1. **Data residency (§2.3)** — will you take advice on section 35(7)? This is
   the one that could change the shape rather than the scope.
2. **Turnover band** — roughly where do the 8 shops sit? Under 4m, 4–11m,
   11–100m, or over? It decides whether the module's headline is *"pay less
   presumptive tax"*, *"stay out of penalties"*, or *"file a VAT return"* —
   three different products.
3. **Do any of them have an EFD today?** If yes, they are keying every sale
   twice, and that changes the priority order completely.
4. **Zanzibar** — any of them, now or planned? Separate regime, 15%, own system.
5. **Double entry or not.** A real general ledger is the difference between an
   audit-support module and an accounting system, in build time and in
   maintenance. I would want that call made deliberately and early, not
   discovered.
6. **Who signs off the numbers?** I can build the arithmetic and test it
   exhaustively. I cannot certify it, and a figure a shop files against should
   have been read by a Tanzanian accountant. §3 should be checked by one before
   any of it reaches code.

---

## Sources

Statute and official

- Tax Administration Act 2015 (TRA) — https://www.tra.go.tz/images/uploads/acts/Tax_Administration_Act.pdf
- Tax Administration Act, Chapter 438 R.E. — https://www.tra.go.tz/images/uploads/acts/CHAPTER_438-THE_TAX_ADMINISTRATION_ACT.pdf
- Finance Act 2023 (TRA) — https://www.tra.go.tz/IMAGES/ACT_NO_7_THE_FINANCE_ACT_2023_230701_083832.pdf
- TRA — Value Added Tax — https://www.tra.go.tz/page/value-added-tax-vat
- TRA — EFD/VFD approved suppliers — https://www.tra.go.tz/page/efd-vfd-suppliers
- TRA — Objections and appeals — https://www.tra.go.tz/page/objections-appeals
- TRA VFD API documentation — https://tra-docs.netlify.app/guide/api/

Practitioner analysis

- Auditax International — Tax administration in Tanzania — https://auditaxinternational.co.tz/tax-administration-in-tanzania-2/
- Auditax International — Tax audit process in Tanzania — https://auditaxinternational.co.tz/tax-audit-process-in-tanzania/
- RSM Tanzania — Understanding the tax audit process — https://www.rsm.global/tanzania/insights/tax-insights/understanding-tax-audit-process-tanzania
- RSM Tanzania — Tax Guide 2025/26 — https://www.rsm.global/tanzania/sites/default/files/media/documents/RSMTZ_Tanzania%20Tax%20Guide%202025-26.pdf
- EY — Tanzanian Finance Act 2023 analysis — https://www.ey.com/en_gl/technical/tax-alerts/tanzanian-finance-act--2023-analysis
- Bowmans — Tanzania Finance Act 2023 highlights — https://bowmanslaw.com/insights/tanzania-finance-act-2023-highlights/
- PwC Tax Summaries — Tanzania, individual income determination — https://taxsummaries.pwc.com/tanzania/individual/income-determination
- PwC Tax Summaries — Tanzania, taxes on personal income — https://taxsummaries.pwc.com/tanzania/individual/taxes-on-personal-income
- Rive & Co — Filing a tax objection with the TRA, a 2026 practitioner's guide — https://www.rive.co.tz/filling-a-tax-objection-with-the-tanzania-revenue-authority-tra-a-2026-practitioners-guide/

Fiscalisation

- VATupdate — Tanzania e-invoicing and e-reporting country booklet (7 July 2026) — https://www.vatupdate.com/2026/07/07/tanzania-e-invoicing-e-reporting-country-booklet/
- vatcalc — Tanzania VFD e-invoicing to include pre-clearance — https://www.vatcalc.com/tanzania/tanzania-vfd-e-invoicing-to-include-pre-clearance/
- EDICOM — The electronic invoice in Tanzania (EFDMS) — https://edicomgroup.com/blog/the-electronic-invoice-in-tanzania
- Tally Solutions — Virtual Fiscal Device in Tanzania — https://tallysolutions.com/ssa/vat/vfd-tanzania/

Standards and market

- IFAC — Tanzania member country profile — https://www.ifac.org/about-ifac/membership/profile/tanzania-united-republic
- IFRS Foundation — Tanzania jurisdiction profile — https://www.ifrs.org/content/ifrs/home/use-around-the-world/use-of-ifrs-standards-by-jurisdiction/view-jurisdiction.html/tanzania
- Vision Software — https://visionsoftware.co.tz/
- Powercomputers — TRA VFD solution — https://powercomputers.co.tz/tra-vfd-solution/

Internal

- `DESIGN-vat.md` §96 — fiscal receipt numbers, deliberately not ours
- `KNOWN-LIMITATIONS.md` — L-2, L-3, L-8, L-11, L-12
- `firestore.rules` — `validSale()`, `validProduct()`, `validStockMovement()`, `validPayment()`
- `app.js:8220`, `app.js:8237` — cost of goods and stock valuation as currently estimated
