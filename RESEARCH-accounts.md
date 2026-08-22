# Accounts, and preparing a business for a TRA audit — research

**Status: research only. Nothing here has been built, and nothing here should be
read as tax advice.** Every figure below is dated and sourced. Tanzanian rates
and thresholds move every Finance Act — the last three all touched something in
this document — so treat the numbers as *evidence that a versioned rules table
is required*, not as constants to hard-code. Your own instinct on that point was
right and it is the single most important design constraint in here.

Researched 2026-08-21, against a system live for 8 businesses on `20260808o`.

**Revised the same day.** The first pass was written around the small end of the
market — it used "a duka" as shorthand for the customer and marked the general
ledger, fixed assets and payroll as marginal on that basis. That is wrong: the
system is meant to onboard large clients as well as local shops, and for a large
client every one of those is compulsory. §1 is new, §3 and §6 are substantially
expanded, and §8, §10 and §11 change their conclusions. Two factual corrections
are marked in place.

---

## 0. The short version

Six findings change the shape of what you proposed, ranked by how much.

1. **We may already be offside on data location, independently of this
   feature.** Section 35(7) of the Tax Administration Act, as amended by the
   Finance Act 2023 and effective **1 January 2024**, requires any taxpayer
   keeping records in electronic form to maintain their **primary data server
   in Tanzania**, and the amendment explicitly defines "primary data server" to
   include a **virtual** server. SaviaSmart's records live in Firestore, which
   is not in Tanzania. This is a real exposure for the 8 shops *today*, and an
   Accounts module sharpens it, because the module's whole claim is that the
   system holds their books. **It gets worse as clients get bigger** — a large
   client has an external auditor whose job includes asking this question. §2.3.

2. **The large-client ambition is already on our own record as a HIGH risk, and
   the Accounts module lands squarely on the person it hurts most.** `L-8` in
   `KNOWN-LIMITATIONS.md` states the target as *"over 10,000 SKUs per branch"*,
   measures the cost (10,000 products = **4.55 MB / 6.6 s** against a local
   emulator with no network in the path), rates it **HIGH** — *"this one
   describes the expected customer"* — and sets a hard gate: **do not onboard
   above ~3,000 SKUs per branch.** For an owner, `subscribeToProducts()` is
   *unfiltered across every branch*, so a 12-branch chain multiplies that
   figure. The owner is exactly who an Accounts module is built for. §9.

3. **This is two products, not one, and the tax law says so.** Below TZS 11m a
   business need not even own an Electronic Fiscal Device. Above TZS 100m it
   must file **audited** financial statements — which an auditor cannot produce
   from a single-entry system. The same module cannot serve both ends without
   deciding, early, which one the data model is for. §1.

4. **For a small shop, record-keeping is a discount; for a large one it is
   three separate turnover taxes.** A trader on TZS 4–7m pays a flat **TZS
   100,000** with no records or **3% of the excess over 4m** with them. A
   company pays **18% VAT**, **0.25% service levy on turnover**, and — if it
   has run unrelieved losses three years running — **1% alternative minimum tax
   on turnover**. All three are computed from the sales figure we already hold.
   §3.1, §3.2.

5. **"EFD/VFD reconciliation" reconciles against something we do not have, and
   the larger the client the more certainly they are keying every sale twice.**
   The EFD obligation starts at **TZS 11m** turnover, not the TZS 200m VAT
   threshold. Any client big enough to want an Accounts module has an EFD. §5.
   Separately, `DESIGN-vat.md` §96 deferred fiscalisation on a premise that may
   not survive contact with the actual VFD API — the verification number and the
   RSA signature are both computable offline. The real blocker is key custody in
   a browser, which is a different decision. §5.4.

6. **The missing half of the books is the purchase side.** No purchases, no
   expenses, no supplier ledger, no bank or mobile-money book, no general
   ledger. `costPrice` is a single mutable field per product with no history, so
   cost of goods is explicitly *"estimated"* in the code today
   (`app.js:8220`). Without the purchase side there is no input VAT, no real
   gross profit, and no defensible closing-stock valuation — and for a company,
   no deductions, no depreciation schedule and no P&L. §7, §8.

**Method.** Three passes: the statute (what the Tax Administration Act obliges a
taxpayer to keep, in what form, for how long, and where); the regime (what TRA's
own systems already hold, because an audit largely reconciles a taxpayer's books
*against the Authority's copy of them*); and this codebase, so the gap is
measured rather than guessed. The third pass is why this is longer than a list
of books.

---

## 1. Two customers, not one

The first draft of this document treated the customer as a small shop. Correcting
that changes more than tone, because Tanzanian tax law itself segments by
turnover — and it segments at four different thresholds, none of which line up.

| Threshold (TZS) | What changes at it |
| --- | --- |
| **4m** | Presumptive income tax starts. |
| **11m** | **EFD becomes compulsory.** Below it, manual receipts in duplicate. |
| **100m** | Presumptive regime ends. **Audited financial statements** must be filed. For a corporation, the CPA-PP certification exemption ends. |
| **200m** | **VAT registration** becomes compulsory (or TZS 100m in any six consecutive months). |
| **500m** | For an individual, the CPA-PP certification exemption ends. |
| **10bn** | Contemporaneous transfer pricing documentation must be filed. |

Read as customer segments, that is roughly:

**The duka — under TZS 11m.** No EFD, no VAT, presumptive tax. Wants one thing:
enough of a record to qualify for the "with records" column. Its books are a
sales register and a cash book, and nothing else is load-bearing.

**The growing business — TZS 11m to 200m.** Has an EFD and is keying into it
separately. Above 100m it needs audited accounts, which means an external
accountant is already in the picture, and that accountant needs a trial balance,
not a sales report. This is the segment where the module either becomes the
system of record or becomes a data source someone re-keys into Tally.

**The company — above TZS 200m.** VAT-registered, filing monthly. Corporate tax
at 30%, provisional tax quarterly, PAYE, SDL, service levy, withholding tax as
both payer and payee, a fixed asset register with statutory depreciation classes,
and audited financial statements. Multi-branch, and quite possibly multi-entity.

Three consequences worth stating plainly:

- **Double entry stops being optional above TZS 100m.** An external auditor
  cannot certify financial statements from a sales log. This was Q5 in the first
  draft's open questions; if large clients are in scope, it is answered.
- **The "readiness score" means different things per segment.** For a duka it
  means *are you in the with-records column*. For a company it means *will the
  trial balance survive an auditor*. Same widget, different computation, and
  pretending otherwise produces a number that flatters one and misleads the
  other.
- **Scale is a harder gate than features.** §9. The client-side subscription
  model has measured ceilings that sit *below* the large end of this market, and
  no amount of accounting logic gets past them.

---

## 2. The law: what a Tanzanian business must keep

### 2.1 The obligation

**Tax Administration Act 2015, section 35** ("maintenance of documents"). Every
taxable or liable person shall, **within the United Republic**, maintain
documents **in paper or electronic form** which contain the information to be
filed with the Commissioner General under any tax law, and which enable an
accurate determination of tax payable.

| Constraint | Requirement |
| --- | --- |
| **Retention** | At least **5 years** from the end of the year of income the records relate to — longer if an audit, objection or appeal is running. |
| **Language** | English or Kiswahili. |
| **Currency** | Tanzanian Shillings (foreign-currency accounting is a Commissioner concession, for branches of foreign companies). |

The 5-year retention is a design input, not a footnote: five years of daily sales,
all of it required to be *producible*, against a client that currently
subscribes to the newest 1,000 sales (§9). At duka volumes that is twenty
trading days. At supermarket volumes it is hours.

The language requirement we satisfy twice over — the app is already bilingual —
and it is worth knowing our Kiswahili is machine-assisted and unreviewed. If an
audit pack is generated in Kiswahili, the label on a number is part of the
record.

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

The word *virtual* was added specifically so that cloud storage could not be
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
- **This scales badly in the wrong direction.** A duka will never ask where the
  server is. A company above TZS 100m has an external auditor whose job includes
  asking, and a finance manager who has read the Finance Act commentary. The
  question arrives *with the customers you most want*.
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

### 3.1 The small end — presumptive income tax, individuals, turnover ≤ TZS 100m

Last reviewed 14 January 2026 (PwC), consistent with the 2025/26 guides.

| Annual turnover (TZS) | Tax **without** records | Tax **with** records |
| --- | --- | --- |
| Below 4,000,000 | Nil | Nil |
| 4,000,000 – 7,000,000 | **100,000** | 3% of the excess over 4,000,000 |
| 7,000,000 – 11,000,000 | **250,000** | 90,000 + 3% of the excess over 7,000,000 |
| 11,000,000 – 100,000,000 | — | **3.5% of turnover** |

"With records" means section 35 is complied with. So a shop on **TZS 5m** pays
100,000 without records and **30,000** with them; a shop on **TZS 9m** pays
250,000 without and **150,000** with.

Above TZS 11m the distinction disappears — 3.5% of turnover either way — but at
that point records and an EFD are compulsory anyway, so the incentive shifts
from paying less to avoiding penalties.

### 3.2 The large end — companies

| Item | Rate / threshold | Note |
| --- | --- | --- |
| **Corporate income tax** | **30%** | |
| **Alternative minimum tax** | **1% of turnover** | Entities with perpetual unrelieved losses for **three consecutive years**. Raised from 0.5% on **1 July 2025**. Exemptions: agriculture, tea processing (to 30 June 2027), health, education. |
| **Service levy** | **0.25% of turnover** | Payable to the local government authority. |
| **Skills and Development Levy** | **3.5% of payroll** | Employers with **10 or more employees**. |
| **Social security** | **20%** total | 10% employer, 10% employee. |
| **Workers Compensation Fund** | **0.5%** of cash sums paid | Monthly. |
| **Audited financial statements** | Turnover **≥ TZS 100m** | |
| **CPA-PP certification** | Required above **TZS 100m** gross income (corporations) or **TZS 500m** turnover (individuals) | |
| **Transfer pricing documentation** | Turnover **≥ TZS 10bn** | Contemporaneous, filed with TRA. |

The three turnover-based taxes in that table are the ones worth dwelling on.
**VAT, service levy and AMT are all computed from the same revenue figure we
already hold** — and AMT means a *loss-making* company still owes 1% of
turnover, so revenue accuracy matters even in a year with no profit. That is
three separate reasons a company cares whether our sales total is complete, and
§9 explains why today it often is not.

### 3.3 VAT

| Item | Value | Note |
| --- | --- | --- |
| Standard rate (mainland) | **18%** | Matches our `VAT_RATE`. |
| Registration threshold (mainland) | **TZS 200,000,000** / year | Raised from 100m on **1 July 2023**. |
| Six-month trigger | TZS 100,000,000 in any 6 consecutive months | Compulsory registration even below the annual threshold. |
| Return and payment | Monthly, by the **20th** of the following month | |
| Input tax claim window | **6 months**, from the **fiscal receipt date** | Not the invoice date. See §5.3. |
| Reduced rate | **16%** on B2C supplies paid by bank or electronic payment | From **1 September 2025**. |
| VAT withholding | **3%** goods, **6%** services | From **1 July 2025**. |
| Withholding agents | The Ministry of Finance; government entities retaining their own revenue; and registered persons appointed by the Commissioner General | A supplier **cannot deduct withheld output tax without holding a valid withholding certificate at the time of filing** (from 1 September 2025). |
| Credit notes | Adjustment note **ITX.254.02.E**, within 7 days | Manual — not a device operation. |
| Non-deductible input tax | Entertainment, club memberships, passenger-vehicle repairs | |
| **Zanzibar** | **15%** standard; **18%** for banking, postal, telecom, insurance and digital services. Threshold **TZS 100,000,000** | Separate jurisdiction — ZRA, own VFMS, not interoperable with mainland EFDMS. Sources disagree on the threshold (one gives TZS 50m); PwC at 14 January 2026 gives 100m, and this needs confirming before it reaches code. |

Two of these are new since our VAT work shipped on 2026-08-07 and neither is
modelled: the **16% electronic-payment rate** — we record the payment method on
every sale, so we already hold the input for it and do not use it — and **VAT
withholding**, which for a company selling to government is not an edge case
but a routine part of the return.

### 3.4 Withholding tax — a company is both payer and payee

| Payment | Resident | Non-resident |
| --- | --- | --- |
| Dividends (25%+ control) | 5% | 10% |
| Dividends (DSE-listed) | 5% | 5% |
| Dividends (other) | 10% | 10% |
| Interest | 10% | 10% |
| Rent — land and buildings | 10% | 10% |
| Rent — equipment, machinery, aircraft | 10% | 10% |
| Royalties | 15% | 15% |
| Service fees | **5%** | **15%** |
| Director fees | 15% | 15% |
| Insurance premium | 0% | 10% |

For a shop paying rent on its premises, the 10% on land and buildings is an
obligation *it* has to withhold and remit — which makes it an expense-side
record, not just a tax rate.

### 3.5 Tax depreciation classes

Straight from the Income Tax Act. A fixed asset register that does not carry the
class is not a tax record.

| Class | Assets | Rate | Method |
| --- | --- | --- | --- |
| 1 | Computers, automobiles, construction equipment, goods vehicles under 7 tonnes | **37.5%** | Reducing balance |
| 2 | Heavy trucks, aircraft, vessels, plant and machinery for agriculture or manufacturing | **25%** | Reducing balance |
| 3 | Office furniture, equipment, other unclassified assets | **12.5%** | Reducing balance |
| 5 | Agricultural buildings, dams, water reservoirs, fences | **20%** | Straight line |
| 6 | Non-agricultural buildings and permanent structures | **5%** | Straight line |
| 7 | Intangible assets | 1 ÷ useful life | Straight line |
| 8 | Agricultural plant and machinery; **electronic fiscal devices for non-VAT-registered persons** | **100%** | Immediate write-off |

Goodwill and interests in land do not qualify. Fines and income tax are not
deductible. Bad debts require evidence that reasonable steps were taken to
pursue payment.

Class 8 is a small irony worth noting in a sales conversation: a non-VAT-
registered trader writes off their EFD in full in year one.

### 3.6 The calendar

| Obligation | Deadline |
| --- | --- |
| PAYE | 7th of the following month |
| VAT return | 20th of the following month |
| Provisional tax | Four instalments: 31 Mar, 30 Jun, 30 Sep, 31 Dec (25% of estimate each) |
| Final income tax return | Within 6 months of financial year end (9 months for government-audited entities) |

### 3.7 Penalties

A **currency point is TZS 20,000** (raised from 15,000 by the Finance Act 2024,
effective 1 July 2024).

| Failure | Penalty |
| --- | --- |
| Not issuing a fiscal receipt / not using an EFD | 20% of the value, or 100 currency points, whichever is greater — capped at 200 CP (**TZS 4,000,000**), and/or up to 3 years imprisonment. Business can be closed until compliant. |
| Buyer not demanding a receipt | 2–100 currency points |
| Tax evasion | Twice the tax evaded |
| Late filing (companies) | Up to TZS 225,000 or 2.5% of the tax per month, whichever is higher |

### 3.8 Accounting standards

The Companies Act 2002 requires financial statements per NBAA rules. NBAA has
adopted **IFRS** and **IFRS for SMEs** without modification. IFRS for SMEs is
open to non-PIEs with fewer than 100 employees or capital investment under
**TZS 800m** — which covers most, though on the large-client ambition not
necessarily all, of the intended market.

---

## 4. What a TRA audit actually is

1. **Initiation** by the Commissioner General — discrepancies in returns,
   irregularities in financial statements, or routine selection. Audits may be
   **comprehensive** (all taxes) or **specific** — a VAT refund audit, a
   transfer pricing audit — and the specific kinds arrive with size.
2. **Information requests.** Officers request records; the taxpayer is obliged
   to give access to premises and documents.
3. **Fieldwork** — examination of financial records, returns and supporting
   documentation.
4. **Notes of discussion** — a final report setting out the issues discussed
   and the position reached, **signed by both parties**.
5. **Assessment** — system-generated.
6. **Objection**, if any, within **30 days** of service, in writing, with
   grounds and evidence — and **not admitted** unless accompanied by payment of
   the tax not in dispute or **one third of the assessed tax**, whichever is
   greater.

That last clause is the one that should shape the product. An assessment you
cannot immediately rebut costs a third of it in cash before you are even allowed
to argue — and a third of a large assessment is a cash-flow event, not an
annoyance. **The value of an audit pack is not that it looks thorough at step 3;
it is that it makes step 6 unnecessary.** Design toward "here is the document
that answers the question", not "here are fourteen reports".

Your framing was already right: *"The key is reconciliation, not merely
producing pretty reports."*

---

## 5. Fiscalisation — the big one

### 5.1 Who must have an EFD

- **VAT-registered persons** — since 2010.
- **Non-VAT traders with annual turnover above TZS 11,000,000** — since 2013.
- Below TZS 11m: manual receipts **in duplicate**.

The obligation bites at **TZS 11m**, not the TZS 200m VAT threshold — roughly
TZS 917,000 a month. Every client large enough to want an Accounts module has an
EFD, and is therefore keying every sale twice today.

### 5.2 What TRA already holds

Every fiscal receipt is transmitted to **EFDMS**, carrying seller name, address
and TIN; buyer name, address and TIN; item description, quantity, unit price,
discounts; tax code; tax-exclusive and tax-inclusive totals; a daily sequential
counter; and a Receipt Verification Code with a QR pointing at TRA's
verification URL. Daily **Z-reports** aggregate sales and VAT by rate and by
payment method.

An auditor therefore already has the taxpayer's sales. What they are testing is
whether the taxpayer's *own* books agree with it. That is why EFD reconciliation
is the highest-value line on your list — and why it is unbuildable until we are
either the device or reading from one.

### 5.3 The input-VAT trap

The six-month input tax window runs **from the date of the fiscal receipt**, and
the buyer's TIN on that receipt is what makes input VAT claimable at all. A
Purchase Book recording "supplier, amount, date" and not "fiscal receipt number,
RVC, receipt date, buyer TIN present yes/no" would produce a claim the business
then loses. If we build the purchase side, those fields are the point of it.

Since 1 September 2025 the same trap applies to **withheld** VAT: output tax
withheld by an agent cannot be deducted without a valid withholding certificate
held at the time of filing. That is another document a company must be able to
produce on demand, and another field on the sales side.

### 5.4 Re-opening the §96 decision

`DESIGN-vat.md` §96 concluded that a gapless fiscal sequence and offline selling
cannot both be true, and deferred fiscalisation on that basis. Having read the
actual VFD API, the premise needs re-testing.

What the API requires (test endpoints under `virtual.tra.go.tz/efdmsRctApi`,
XML over HTTP):

- Registration: **TIN + CERTKEY** (device serial) → **REGID**, **RECEIPTCODE**,
  and a certificate (PFX).
- A **token** for posting receipts and Z-reports, valid for a limited period.
- Per receipt: `RCTNUM`, `DC` (daily counter, resets at midnight), `GC` (global
  counter, lifetime), `ZNUM`, and `RCTVNUM` = **RECEIPTCODE + GC**.
- Each `<RCT>` signed **SHA-1 with RSA** using the certificate's private key,
  base64-encoded.
- Daily **Z-report** before opening the next business day.
- Rules: sequences must never skip; future dates prohibited; a cancelled
  transaction takes a new number rather than reusing one; send one at a time and
  only send the next when the current has succeeded; **failed submissions retain
  their original timestamps on retry.**

Read against our offline queue, the conflict is narrower than §96 assumed:

- The **verification number is computable offline** — `RECEIPTCODE + GC`, and
  `GC` is a counter *we* maintain per registered device.
- The **signature is computable offline** — a local RSA operation.
- **Retry with the original timestamp is explicitly allowed**, which is exactly
  what our replay does.
- "One at a time, in order" is a property of the *queue*, which we already have.

So a complete, verifiable fiscal receipt could in principle be printed at the
till with no connection and posted when the connection returns — precisely how a
hardware EFD behaves. The counter stays gapless if each till is its own
registered device with its own serial, which is how the model is meant to be
used anyway. **Note the multi-till consequence**: a large client with twelve
tills needs twelve registrations, twelve serials and twelve counters, and that
is a provisioning and reconciliation problem in its own right.

**The actual blocker is key custody.** Signing offline means the business's RSA
private key is on the device. In a browser PWA that means a per-business private
key in IndexedDB on a shop phone. Doing it server-side is safe and needs the
network, which defeats the point. I have not solved that — but it is a
*different* hard problem from the one §96 recorded, and it deserves its own
decision rather than inheriting the old one.

### 5.5 The thing that would invalidate all of the above

The 2025/26 Budget (announced 13 June 2025) proposes moving EFDMS to
**token-based pre-clearance**: the taxpayer requests permission to issue an
e-invoice, with a live token sent to EFDMS, and TRA verifies and approves
**before the receipt reaches the customer**.

If that becomes law as described, offline fiscalisation is impossible by
construction — not difficult, impossible — and every offline-capable POS in
Tanzania has the same problem. As at this research it is a **budget proposal,
not statute**, with no firm effective date or transition timetable.

The single biggest reason not to start fiscalisation this quarter, and the
single biggest reason to watch it monthly.

---

## 6. Your book list, checked against reality — by segment

The first draft marked several of these as marginal because it was reading the
whole market as small shops. Re-marked with the segments from §1. **Producible**
is unchanged — it is a fact about our data, not about the customer.

| Book | Duka (< 11m) | Growing (11–200m) | Company (> 200m) | Producible today? |
| --- | --- | --- | --- | --- |
| Sales Book | **Core** | **Core** | **Core** | Mostly — §7 |
| Purchase Book | Useful | **Core** | **Core** | **Partly** — one purchase per product per delivery, from the restock path only, forward-only |
| Cash Book | **Core** | **Core** | **Core** | Partly — shifts give till cash, nothing else |
| Bank / mobile-money book | Mobile money | **Both** | **Both** | **No** |
| General Ledger | No | **Yes above 100m** | **Compulsory** | **No** |
| Trial balance, P&L, balance sheet | No | **Yes above 100m** | **Compulsory, audited** | **No** |
| Accounts Receivable | Useful | **Core** | **Core** | **Yes**, essentially |
| Accounts Payable | Marginal | **Core** | **Core** | **No** |
| Inventory / Stock Ledger | **Core** | **Core** | **Core** | Partly — quantities yes; valuation forward-only from the first purchase, weighted average |
| VAT records | N/A | Above 200m | **Core, monthly** | Partly — output only, and overstated |
| Fixed Asset Register | Marginal | **Yes** | **Compulsory, by class** | **No** |
| Expense records | **Core** | **Core** | **Core** | **Yes** for a closed nine-category set; no bank or mobile-money side |
| Payroll (PAYE, SDL, WCF, social security) | If staffed | **Yes** | **Compulsory** | **No** |
| Withholding tax records | Rent only | **Yes** | **Both directions** | **No** |
| EFD/VFD records | Above 11m | **Yes** | **Yes** | **No** — §5 |

Two corrections to the framing that survive the revision, and one that does not:

**Bank Book should be a Money Book — but not only mobile money.** Tanzania's
mobile-money culture is one of the most developed in the world, and our POS
already records `mobile` as a payment method; for a duka, M-Pesa, Tigo Pesa and
Airtel Money *are* the bank. A company has both, plus card settlement, and needs
them reconciled together. Building bank-only first serves the wrong customer;
building mobile-only first serves only half the market.

**Payroll is a programme, not a book** — and for a company it is compulsory:
PAYE at 8/20/25/30% on monthly bands, SDL at 3.5% above ten employees, WCF at
0.5%, social security at 20%, filing by the 7th. It should not be smuggled into
an Accounts release, and it should not be dismissed either.

**Withdrawn from the first draft:** the claim that a fixed asset register is
marginal. For any client above TZS 100m it is a statutory record, it drives a
deduction, and §3.5 shows it needs a class per asset — not just a purchase
price.

---

## 7. What SaviaSmart already holds

From `firestore.rules` and `app.js` as at `20260808w`. Collections: `products`,
`sales`, `services`, `customers`, `payments`, `shifts`, `stockMovements`,
`transfers`, `auditLogs`, `monthlyReports`, `staff`, `members`, `errorLog`,
`expenses`, `purchases`, `productCosts`.

> **Updated 2026-08-21.** The three lists below described the codebase before
> `DESIGN-purchases.md` Phases 0, A and B shipped. The rows that changed are
> marked; everything unmarked still holds. Production is on `20260808o` and
> carries none of it, so as a description of *the live system* the original
> text was accurate and is preserved in git.

**Genuinely strong, and closer to audit-ready than I expected:**

- **Sales** carry items, subtotal, discount type/value/amount, total, payment
  method, staff id and name, order number, voided, `madeOffline` — and where the
  business is registered, `vatRegistered`, `vrn`, `vatRate`, `taxTotal`,
  `netTotal`, `taxBreakdown`, with a **rule-enforced invariant** that
  `netTotal + taxTotal == total`. A sale physically cannot be written whose VAT
  fails to reconcile to its own takings. That is a better foundation than most
  systems have.
- **Per-line `taxClass`** on sale items since 2026-08-07 — standard, zero-rated,
  exempt.
- **A stock ledger with a chain link**: movements carry `quantityBefore`,
  `delta`, `quantityAfter`, with a rule enforcing
  `quantityAfter == quantityBefore + delta`, and a `reason` from a closed set. A
  real audit trail for quantities.
- **Receivables** — customers with balances, payments against them.
- **Cash accountability** — shifts with float, expected, counted, variance.
- **An append-only audit log** with a closed action enum.
- **TIN, VRN and registration state are already captured** —
  `validStore()` carries `tin`, `vrn`, `vatRegistered`, `vatEnabledAt` and
  `currencyCode`, entered through the VAT settings dialog and written to every
  store in one batch so the copies cannot drift.
  **Correction to the first draft**, which said there was no TIN capture. There
  is, for the *seller*. What is missing is the **buyer's** TIN on a sale and the
  **supplier's** on a purchase — which are the two that make input VAT claimable
  (§5.3).

**Missing, one line each:**

- ~~**Purchases.** Nothing.~~ **Built.** A `purchases` collection, one document
  per batch, carrying quantity and what was actually paid, plus the supplier,
  TIN, fiscal receipt number and receipt date. `supplier` on the product remains
  a free-text string and is now redundant.
- ~~**Expenses.** Zero occurrences of the term in `app.js`.~~ **Built.** A closed
  nine-category set with `spentAt` separate from the recording date, and
  `paidFrom` distinguishing till from elsewhere.
- ~~**Cost history.** There is no valuation method.~~ **Partly built.** A
  weighted average is maintained per product in a `productCosts` collection —
  kept off the product document because `/products` is readable by every cashier
  and Firestore has no field-level read security. `costKnownFrom` marks where the
  figure becomes meaningful, and it is forward-only: stock held before the first
  purchase has an unknown cost, not a zero one. What is still missing is what
  stock was worth on a *past* date, which needs the cost on the sale line —
  `DESIGN-purchases.md` Phase D.
- **Money movement.** No bank, no mobile-money statement, no reconciliation.
- **A ledger.** No accounts, no double entry, no trial balance — so no P&L and
  no balance sheet, and therefore nothing an auditor can certify.
- **Fixed assets.** No register, no classes, no depreciation.
- **Payroll.** None.
- **Fiscal transaction data.** No receipt numbers, no RVC, no Z-reports.
- **Period lock.** Nothing prevents a sale being voided after the month it falls
  in has been reported and filed. For an audit module this is not a nice to have
  — it is the difference between a report and a record.

---

## 8. Difficulty, honestly ranked

Re-ranked for both ends of the market. **Unlocks** says which segment the work
serves, because that is now the deciding variable rather than raw value.

| Work | Unlocks | Value | Difficulty | Risk to production |
| --- | --- | --- | --- | --- |
| Expenses (capture + report) | All | High | Low | Low — additive |
| Purchases / supplier invoices with fiscal receipt fields | All | **Highest** | Medium | Low — additive; unlocks input VAT, real COGS, stock valuation |
| **Server-side aggregation (fixes L-11, L-8)** | **11m+** | **Prerequisite** | **High** | Medium — but §9 says nothing above it ships without this |
| Period lock | 11m+ | High | Low–Medium | **Touches the sale and void paths** |
| Cost history on stock movements | All | High | Medium | Medium — changes the restock path |
| Mobile-money / bank / card reconciliation | All | High | Medium | Low |
| Audit pack export | All | High | Medium | Low — after aggregation |
| Readiness score | All, differently per segment | High commercially | Low, *given the above* | Low — a read over other work |
| **General ledger / trial balance / P&L / balance sheet** | **100m+** | **Compulsory above 100m** | **High** | Medium — a genuine accounting engine |
| Fixed assets + statutory depreciation classes | 100m+ | **Compulsory above 100m** | Medium | Low |
| Withholding tax records, both directions | 200m+ | Medium–High | Medium | Low |
| Payroll — PAYE, SDL, WCF, social security | Staffed clients | **Compulsory** where it applies | **High** | Low, but its own programme |
| EFD/VFD fiscalisation | 11m+ | **Very high** | **Very high** | **High** — §5, plus pre-clearance risk |

Two things moved on this revision. **Server-side aggregation moved into the
table** — in the first draft it was a footnote in §9; it is in fact the third
row, because at large-client volumes nothing above it is producible. And the
**general ledger moved from "Medium value, optional" to "compulsory above TZS
100m"**, because audited financial statements are a statutory filing and no
auditor certifies them from a sales log.

The readiness score is still the right product idea, and still sits where it
sat: *cheap, but only once the rows above it exist*. It is a presentation of
reconciliations, worth exactly as much as the reconciliations underneath it and
not a shilling more. Shipping it early, over data we do not have, produces a
confident number that lies — worse than no number, for the reason
`DESIGN-vat.md` already gives: *"a tax calculation that is wrong is worse than
absent: it is wrong on a document a shop is audited on."*

---

## 9. Blockers already on our own record

These are in `KNOWN-LIMITATIONS.md`, and the large-client reading makes two of
them far more serious than the first draft said.

**L-8 — the products subscription is unbounded. Risk: HIGH.** This is the entry
that already anticipated your correction, and it is worth quoting: the stated
target is *"over 10,000 SKUs per branch"*, and *"this limitation is therefore
above, not below, the intended market… this one describes the expected
customer."* Measured against a local emulator with **no network in the path**:

| Catalogue | Cold read | Payload |
| --- | --- | --- |
| 800 products | 2,049 ms | — |
| **10,000 products** | **6,604 ms** | **4.55 MB of JSON** |

Two things the first draft missed. First, `subscribeToProducts()` filters by
store only for *staff*; for an **owner** it is unfiltered — the whole catalogue
across every branch, in one browser. A twelve-branch chain multiplies that
payload. Second, the owner is precisely who an Accounts module is for. The file
sets a hard gate — **do not onboard above ~3,000 SKUs per branch** — and roughly
15 call sites depend on holding the whole catalogue, so paging without a
server-maintained summary document does not degrade them, it breaks them.

**L-11 — reports see only the newest 1,000 sales.** `SALES_HISTORY_LIMIT` is
1,000; the stock ledger reads 500; shifts 20; transfers 2,000; every audit-log
read is a capped, action-filtered query rather than a period read. At 50 sales a
day that is twenty trading days. **At 2,000 sales a day it is half a day.** A
tax period must be computed over complete history and §2.1 requires five years
of it. The existing guard makes the monthly report refuse rather than
under-report — correct behaviour, and it means **an audit pack built on the
current client would refuse to generate for most real periods, and for a large
client for essentially all of them.**

**A third ceiling, not previously recorded here.** `FIRESTORE_IN_LIMIT = 30`: a
member assigned more than 30 stores loads only the first 30, with a console
warning and a suggestion to use the "all" scope instead. A chain above 30
branches has no working branch-scoped role.

**A fourth, structural.** The data model is `users/{ownerUid}/…` — one owner is
one business, and VAT registration is a business fact denormalised onto every
store. A group with **two legal entities and two TINs** under one owner has
nowhere to put the second, and their VAT returns must not be consolidated. Worth
knowing before the first multi-entity client, not after.

Also live:

- **L-12 — a refund does not reduce the VAT owed on it.** The return currently
  **overstates** liability. Safe direction, wrong figure, growing with refund
  volume. Its milestone was "the first full month after 2026-08-07" — that is
  **September 2026**, next month.
- **L-3 — the audit log is append-only but not tamper-evident.** For an "Audit
  Trail" line in an audit pack, "append-only by rule" and "tamper-evident" are
  not the same claim, and an external auditor knows the difference.
- **L-2 — a stock decrement cannot be bound to a sale.** Directly limits how
  strong an inventory reconciliation can honestly claim to be.

**Revised conclusion.** The first draft said L-11 and L-12 were the
prerequisites. With large clients in scope it is **L-8 and L-11 together** —
they are the same fix, a server-maintained summary and server-side aggregation,
and that fix is now the gate for the whole module rather than a milestone
alongside it.

---

## 10. Prior art — and the competitive read, corrected

- **VFD is the settled integration route.** Software-only since 2020. TRA
  publishes an approved-supplier list of 17+, and local platforms — vfd.co.tz,
  Risiti, Simplify VFD, Mojatax, Power VFD — exist specifically to broker it.
  **We would not have to be TRA-certified ourselves.** That materially lowers
  the wall in §5, and is worth pricing before building.
- **Vision XPOS** (Exact Software, Dar) — retail, restaurant and pharmacy POS,
  explicitly TRA-fiscal-device compliant, sold alongside its own accounting and
  payroll modules.
- **TallyPrime**, via Powercomputers — the incumbent for
  accounting-plus-inventory, with VFD support.
- **QuickBooks** — present, cloud, marketed as TRA-compliant.
- Native connectors from SAP, Oracle, Sage and QuickBooks to EFDMS are **not**
  documented, which is why the local broker layer exists.

**The first draft concluded that we do not compete with Tally and Vision. With
large clients in scope, that is wrong.** The corrected read:

- **At the small end** the position stands and is strong: offline-first,
  phone-first, bilingual, priced for a shop. Nobody serves it well.
- **At the large end we are entering an occupied market** against products that
  already have double entry, payroll, fixed assets and fiscalisation shipped and
  proven. Our differentiators there are the POS being native rather than bolted
  on, offline operation, and price — not accounting depth, which is the thing
  those incumbents are actually bought for.
- **The uncomfortable part:** offline-first is what wins the small end and is
  exactly what makes fiscalisation hardest (§5.4), while fiscalisation is table
  stakes at the large end. The strategy has to hold both, and this research
  cannot tell you how — that is a commercial call.

---

## 11. My read on shape

You asked for research, so this is a view and not a plan.

**Serving both ends is a sequencing problem, not a feature problem.** The books
the two segments need overlap almost entirely at the bottom — sales, purchases,
expenses, cash, stock. They diverge at the top, where the company needs a ledger
and the duka needs nothing above a register. So the first release should be the
shared foundation, chosen so that adding double entry later is a *layer* over
it rather than a rewrite of it.

**The Accounts dropdown is the right container and the wrong first release.**
The first release should be the books we cannot fake, that unlock the rest, and
that do not require touching the sale path: **purchases and expenses**.
Everything else — input VAT, gross profit, stock valuation, the readiness score,
the P&L — is downstream of them, and they are additive collections that cannot
break a sale.

**But there is a gate in front of all of it now.** §9. Server-side aggregation
and a per-store summary document are not a milestone to schedule alongside the
Accounts work; at large-client volumes they are the thing that makes any of it
producible. I would not design the module without deciding whether that gate is
in scope, because the answer changes what the module can honestly claim.

**Four positions I would want to hold:**

1. **A tax rules table with effective dates from day one**, exactly as you said,
   and every computed figure carrying the rule version it was computed under.
   §3 is proof this is not theoretical: three of those rows changed in the last
   three Finance Acts, and two changed after our VAT feature shipped.
2. **A figure that cannot be computed completely must refuse, not estimate.**
   That is the L-11 precedent and it should be the module's rule — and it is
   what makes serving a large client honestly possible before the aggregation
   work lands.
3. **Reconciliation, not reports** — your framing, and §4 backs it. The pack
   exists to make an objection unnecessary.
4. **Design the schema for double entry even if the first release does not do
   it.** Above TZS 100m it is compulsory, and retrofitting a ledger onto a
   single-entry transaction store is the expensive version of this work.

**Two things I would keep out of the first release:** fiscalisation (§5.5 alone
justifies waiting) and payroll (§6) — while noting that both are compulsory for
the large clients you want, so "not in the first release" has to mean scheduled,
not shelved.

**One thing I would resolve before designing anything:** §2.3, the data server.
It is a legal question, it sits underneath the whole module, and it arrives with
exactly the customers you are trying to win.

---

## 12. What I need from you before designing

1. **Data residency (§2.3).** Will you take advice on section 35(7)? The one
   that could change the shape rather than the scope — and the one a large
   client's auditor will raise.
2. **The spread, not the average.** How many of the 8 are under 11m, 11–100m,
   100–200m, over 200m? And what does the pipeline look like? §1 shows the law
   segments at four thresholds; the module's centre of gravity should sit where
   your customers actually are.
3. **Biggest client you intend to onboard in the next 12 months — SKUs per
   branch, branches, sales per day.** This is not curiosity: L-8 sets a hard
   gate at ~3,000 SKUs per branch and `FIRESTORE_IN_LIMIT` caps branch-scoped
   roles at 30. If the answer is past either, the aggregation work is not
   optional and it comes first.
4. **Does any of them have an EFD today?** If yes, they are keying every sale
   twice, and that changes the priority order completely.
5. **Multi-entity.** Will any client have two legal entities — two TINs — under
   one login? The current model has nowhere to put the second (§9).
6. **Zanzibar.** Any of them, now or planned? Separate regime, 15%, own system,
   and a threshold my sources disagree on.
7. **Double entry — I think the answer is yes, and I want it confirmed.** If
   clients above TZS 100m are in scope, audited financial statements are a
   statutory filing and a ledger is compulsory. That is a much larger build than
   an audit-support module. Confirming it now is cheap; discovering it after the
   schema is set is not.
8. **Who signs off the numbers?** I can build the arithmetic and test it
   exhaustively. I cannot certify it, and a figure a business files against
   should have been read by a Tanzanian accountant. §3 should be checked by one
   before any of it reaches code — and for the company-side numbers that is not
   optional, it is the difference between a tool and a liability.

---

## Sources

Statute and official

- Tax Administration Act 2015 (TRA) — https://www.tra.go.tz/images/uploads/acts/Tax_Administration_Act.pdf
- Tax Administration Act, Chapter 438 R.E. — https://www.tra.go.tz/images/uploads/acts/CHAPTER_438-THE_TAX_ADMINISTRATION_ACT.pdf
- Finance Act 2023 (TRA) — https://www.tra.go.tz/IMAGES/ACT_NO_7_THE_FINANCE_ACT_2023_230701_083832.pdf
- TRA — Taxes and duties at a glance 2025/26 — https://www.tra.go.tz/images/uploads/pages/TAXES_AND_DUTIES_AT_A_GLANCE_2025_2026.pdf
- TRA — Value Added Tax — https://www.tra.go.tz/page/value-added-tax-vat
- TRA — EFD/VFD approved suppliers — https://www.tra.go.tz/page/efd-vfd-suppliers
- TRA — Objections and appeals — https://www.tra.go.tz/page/objections-appeals
- TRA VFD API documentation — https://tra-docs.netlify.app/guide/api/

Practitioner analysis

- PwC Tax Summaries — Tanzania, corporate other taxes — https://taxsummaries.pwc.com/tanzania/corporate/other-taxes
- PwC Tax Summaries — Tanzania, corporate deductions — https://taxsummaries.pwc.com/tanzania/corporate/deductions
- PwC Tax Summaries — Tanzania, withholding taxes — https://taxsummaries.pwc.com/tanzania/corporate/withholding-taxes
- PwC Tax Summaries — Tanzania, individual income determination — https://taxsummaries.pwc.com/tanzania/individual/income-determination
- PwC Tax Summaries — Tanzania, taxes on personal income — https://taxsummaries.pwc.com/tanzania/individual/taxes-on-personal-income
- EY — Tanzanian Finance Act 2025 analysis — https://www.ey.com/en_gl/technical/tax-alerts/tanzanian-finance-act-2025-analysis
- EY — Tanzanian Finance Act 2023 analysis — https://www.ey.com/en_gl/technical/tax-alerts/tanzanian-finance-act--2023-analysis
- Bowmans — Tanzania Finance Act 2023 highlights — https://bowmanslaw.com/insights/tanzania-finance-act-2023-highlights/
- Auditax International — Tax administration in Tanzania — https://auditaxinternational.co.tz/tax-administration-in-tanzania-2/
- Auditax International — Tax audit process in Tanzania — https://auditaxinternational.co.tz/tax-audit-process-in-tanzania/
- Auditax International — Key tax implications of the Finance Act 2025 — https://auditaxinternational.co.tz/key-tax-implications-of-the-tanzania-finance-act/
- RSM Tanzania — Understanding the tax audit process — https://www.rsm.global/tanzania/insights/tax-insights/understanding-tax-audit-process-tanzania
- RSM Tanzania — Tax Guide 2025/26 — https://www.rsm.global/tanzania/sites/default/files/media/documents/RSMTZ_Tanzania%20Tax%20Guide%202025-26.pdf
- S R Auditors — Withholding VAT in Tanzania 2025 — https://sra.co.tz/withholding-vat-in-tanzania-2025/
- Rive & Co — Filing a tax objection with the TRA, a 2026 practitioner's guide — https://www.rive.co.tz/filling-a-tax-objection-with-the-tanzania-revenue-authority-tra-a-2026-practitioners-guide/

Fiscalisation

- VATupdate — Tanzania e-invoicing and e-reporting country booklet (7 July 2026) — https://www.vatupdate.com/2026/07/07/tanzania-e-invoicing-e-reporting-country-booklet/
- VATupdate — Tanzania's 2025 Finance Act: new VAT rates and withholding rules — https://www.vatupdate.com/2025/07/11/tanzanias-2025-finance-act-new-vat-rates-and-withholding-rules-implemented/
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
- `KNOWN-LIMITATIONS.md` — L-2, L-3, **L-8**, L-11, L-12
- `firestore.rules` — `validSale()`, `validProduct()`, `validStore()`, `validStockMovement()`, `validPayment()`
- `app.js:8220`, `app.js:8237` — cost of goods and stock valuation as currently estimated
- `app.js` — `subscribeToProducts()` unfiltered for owners; `FIRESTORE_IN_LIMIT = 30`
