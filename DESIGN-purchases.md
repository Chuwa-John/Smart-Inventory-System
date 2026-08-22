# Design — purchases, expenses and profit

Status: **COMPLETE as scoped. Phases 0, A, B, C, D and E built 2026-08-21;
B was audited and substantially reworked as B2-a to B2-e. §5 is superseded
— see §13f.**
Production is on `20260808o`; `main` is on `20260808z` and carries Services
A–E and the whole of this design, none deployed.

Requested by the shop owner: record what stock cost when it is bought — *"if
they added 200 body lotions they record the total amount"* — so that profit can
be tracked against what it is then sold for, plus a place to record daily
expenses.

This is the first release of the Accounts work scoped in `RESEARCH-accounts.md`
§11, and it is chosen deliberately as the shared foundation both ends of the
market need: input VAT, real cost of goods, stock valuation, the P&L and the
readiness score are all downstream of purchases and expenses, and neither
collection can break a sale.

The document exists because three of the decisions below are not obvious, one
of them touches the sale path, and one of them is a number that is wrong on the
dashboard today.

---

## 1. Scope

**In:**

- A `purchases` collection: one document per batch bought, carrying the
  **quantity and the total paid**, plus the fields that make input VAT
  claimable.
- Cost capture on the two paths that add stock: **restock**, and **product
  create**.
- A **weighted average** unit cost maintained on the product.
- `unitCost` written onto each sale line at the time of sale.
- An `expenses` collection, with a closed category set.
- A profit surface that separates what is computed from what is self-reported.

**Out, deliberately:**

| Excluded | Why |
|---|---|
| Multi-line supplier invoices | One purchase per product per delivery. §9 shows why a line-item document is not free here, and §13 shows how this shape grows into one without a migration. |
| FIFO or specific-identification costing | §4. Weighted average is the only method that does not require batch tracking through the sale path. |
| Accounts payable / credit from suppliers | A purchase is recorded as paid. Supplier balances are a separate feature. |
| Backfilling cost onto historic stock | §4.3. Forward-only, the same call `DESIGN-vat.md` made. |
| Wiring till-paid expenses into shift reconciliation | §8.3. The field is captured from day one; the shift path is not touched in phase 1. |
| A general ledger, trial balance, P&L, balance sheet | `RESEARCH-accounts.md` §8. Compulsory above TZS 100m, and a much larger build. §12 records what this design does to keep that door open. |
| Payroll, fixed assets, withholding tax | Same. Separate programmes. |

---

## 2. The number that is wrong today

> **This section describes PRODUCTION (`20260808o`), where it is still true.**
> It was fixed on `main` by Phase 0 — see §13a. Do not read it as a description
> of the current code; read it as the justification for the phase, which is
> still live for the eight shops until this ships.

Worth stating first, because it changes this from an enhancement to a fix.

`costPrice` is validated in `firestore.rules` (`validProduct()`), read in four
places in `app.js`, and **written in none.** There is no input for it in the
product form or the restock dialog. The comment in the product form's numeric
validation said so in as many words:

> costPrice has no input in this form today and arrives as 0

So on the owner's control panel right now:

- **Stock at cost** reads **TZS 0**, on the panel and in the per-store table.
- **Gross margin** reads **100%**, because `cogs` sums to zero.
- The note under it reads the confident *"Revenue less cost of goods sold"*
  rather than *"Incomplete — some items have no cost price"*, because the guard
  is `costById.has(item.productId)` — **presence, not value**. A cost that is
  present and zero passes it.

Eight shops are being shown a 100% margin labelled as known. Two consequences
for this design:

1. **The `costKnown` guard is wrong independently of this feature** and should be
   fixed on its own, ahead of any of the work below. It is a one-line change
   from presence to a real known-cost test, and it makes the tile honest
   immediately rather than in four phases' time.
2. **Every existing product has `costPrice` absent, not zero-but-true.** §4.3
   turns on that distinction.

---

## 3. What a purchase is: the batch, not the unit

The owner's framing is right and it should survive into the schema: what happens
in the world is *200 lotions, 400,000 shillings*. That is what an invoice says
and what a fiscal receipt says.

**Store the batch. Derive the unit.**

```
purchases/{purchaseId}
  storeId          string    the branch the stock landed in
  productId        string
  productName      string    denormalised, so the book survives a product delete
  quantity         number    units received, > 0
  totalPaid        number    what was actually paid for the batch
  unitCost         number    totalPaid / quantity -- derived, NOT rounded
  supplierName     string    optional, free text for now
  supplierTin      string    optional
  receiptNumber    string    optional, the fiscal receipt number
  receiptDate      timestamp optional
  hasFiscalReceipt bool      optional -- decides input VAT claimability
  recordedByUid    string
  createdAt        timestamp
```

Two things this shape buys, and one trap it avoids.

**The trap.** 100 items for 33,333 is 333.33 each. If the unit cost is stored
rounded to 333 and the total discarded, the batch no longer reconciles to the
invoice — by 33 shillings, every time, compounding across a year of deliveries.
`totalPaid` is the recorded truth and `unitCost` bends to it. This is the same
discipline as `netTotal + taxTotal == total` in `validSale()`: the figure that
was actually transacted is the one that is authoritative.

`moneyInRange()` is `v is number && v >= 0 && v <= 1e9` — **no integer
requirement** — so a fractional `unitCost` is already permitted by the rules.
Round at the display boundary, never in the middle.

**What it buys.** The Purchase Book of `RESEARCH-accounts.md` §6 falls straight
out of this collection, and `receiptNumber` / `receiptDate` /
`hasFiscalReceipt` / `supplierTin` are exactly the fields §5.3 of that document
identifies as the ones that make input VAT claimable — the six-month window runs
from the **fiscal receipt date**, not the invoice date. One capture, two
payoffs, and a shop that records purchases without them loses a claim it was
entitled to.

---

## 4. The costing method

### 4.1 Weighted average, and why not FIFO

Once batches exist at different prices, selling 250 units when the shelf holds
200 bought at 2,000 and 100 bought at 2,200 needs a rule.

| Method | Accuracy | Cost |
|---|---|---|
| **FIFO** | Exact | Requires batch tracking **through the sale path** — the sale transaction must consume from batches in order. That is a change to `completeSale()`, offline replay, returns and voids. |
| **Weighted average** | Exact in aggregate, approximate per line | One number on the product, recomputed where stock arrives. **The till never touches it.** |
| Current cost (today) | Wrong | A price change rewrites last month's profit. |

**Weighted average.** It is permitted under IFRS for SMEs, which NBAA has
adopted without modification, so it is defensible in audited accounts. It is
what a shopkeeper does mentally. And decisively for this codebase: the two paths
where it must be recomputed — restock and transfer-in — are **already online-only
and already read the product inside a transaction.**

`OFFLINE-CAPABILITIES.md:52` and `:55`:

> Restocking — *Refused until the connection returns.*
> Transferring stock between branches — *Refused.*

That matters more than it looks. The constraint that shapes everything else in
this system is that offline writes must be relative (`increment()`) because they
cannot read first. A weighted average needs read-then-write, which would
normally be fatal. It is not, because neither path was ever offline. **This
design adds no new online requirement to anything.**

### 4.2 The arithmetic, and the two edge cases

```
newQuantity  = oldQuantity + deliveredQuantity
newUnitCost  = (oldQuantity × oldUnitCost + totalPaid) / newQuantity
```

**Edge case one: stock can be negative.** `stockCountInRange()` permits
`-1,000,000` to `1,000,000`, deliberately — offline oversell is taken and
flagged rather than refused (`DESIGN-offline-selling.md`). So `oldQuantity` may
be negative, and `oldQuantity + deliveredQuantity` may be zero. A division by
zero on the restock path is a till-adjacent outage.

**Rule: if `oldQuantity <= 0`, do not average — take the batch's own unit cost.**
There is no meaningful quantity of old stock to weight against, and the incoming
batch is the only real information.

**Edge case two: the existing cost may be unknown rather than zero.** §4.3.

### 4.3 Forward-only, and why absent must not mean zero

Every product in production today has no `costPrice`. If absent is read as zero,
the first purchase averages 100 units of "free" stock against 200 units bought
at 2,000 and produces a unit cost of 1,333 — **understating cost, overstating
profit**, on the shop's very first delivery under the new feature.

The units on hand before this ships have an unknown cost, not a zero cost, and
the difference is the whole feature.

**Rule: the first purchase for a product sets `unitCost` outright. Subsequent
purchases average.** A product carries `costKnownFrom` (a timestamp) written by
that first purchase, and every profit surface reads it the way
`salesCoverageFromMs()` is already read: a period that begins before
`costKnownFrom` reports what it can and **says so**, rather than showing a
confident figure computed over stock whose cost nobody ever recorded.

This is the same call `DESIGN-vat.md` made — *"a sale from before the business
registered is outside the scheme rather than taxed at zero"* — and for the same
reason.

---

## 5. Cost on the sale line — SUPERSEDED, see §13f

> **This section is no longer the design.** It was written before B2-a moved
> cost off the product document, and it assumed the till already knew what a
> thing cost. After B2-a it does not and cannot: the till is operated by a
> cashier, a cashier cannot read `/productCosts`, and `firestore.rules:978`
> lets a cashier **read sales** — so a `unitCost` on the line would be both
> unwritable by the till and, if written, readable by exactly the role cost was
> moved away from.
>
> Phase D instead records a **cost history with effective dates**, and answers
> profit from the cost in force on each sale's own date. That is historically
> exact for the same reason this section wanted, needs no sale-path change at
> all, and keeps cost out of a cashier's reach. §13f records the decision.
>
> Kept because its reasoning about why *current* cost is not good enough is
> still the argument, and because §12 and §13 refer to it.

## 5 (as originally written). Cost on the sale line — the one sale-path change

Weighted average on the product alone does **not** fix profit history. If cost
is read from the product at report time, a restock at a new price still rewrites
last month's margin — which is precisely the flaw `app.js:8220` documents today.

To make profit correct and permanent, the cost has to be written onto the sale
at the moment of sale:

```
saleItems[].unitCost   number, optional
```

**This is a sale-path change and it should not be presented as anything else.**
Three things make it the acceptable kind:

1. **It costs zero rules expressions.** `validSaleItems()` deliberately does not
   validate per-item content — the comment above it records why, at length: 40
   unrolled per-item slots blew Firestore's 1,000-expression cap and every
   cashier hit permission-denied on their second line item, while owners sold
   fine. Per-item iteration was removed and the cost made constant. Adding an
   optional field to an item therefore requires **no rules change at all**.
2. **There is a precedent that worked.** Per-line `taxClass` was added to sale
   items on 2026-08-07 in exactly this shape and did not destabilise anything.
3. **Absent is meaningful.** A sale line with no `unitCost` is a line whose cost
   was not known — pre-feature, or a product with no purchase yet. It is not a
   line that cost nothing. Every reader must treat it as unknown, and a period
   containing such lines must say its cost is partial.

What we give up, and accept: as with `kind` in `DESIGN-services.md` §8, a client
bug that fails to write `unitCost` is caught by no rule — only by the client
always writing it, and by a test that says so.

**Offline sales.** An offline sale reads the product from the local cache, which
carries `costPrice`, so it can write `unitCost` with no connection. The cached
cost may be stale if another device restocked. Accepted: the recorded cost is
the cost the device knew, which is a rounding-scale error, not a structural one.

---

## 6. VAT: there are two different profits

For a business that is not VAT-registered, profit is revenue minus cost and both
are gross. Nothing branches.

For a registered one, the 400,000 paid for lotions **includes input VAT** if the
supplier was registered and issued a fiscal receipt. Comparing that gross cost
against gross revenue is wrong at both ends.

**Rule: where `vatRegistered` is true, profit compares VAT-exclusive cost
against VAT-exclusive revenue.** The revenue side already exists — `netTotal` is
stored on every sale and rule-enforced to reconcile. The cost side is derived
from `totalPaid` and the product's `taxClass`, and only when
`hasFiscalReceipt` is true, because without one the input VAT is not
recoverable and the full amount paid **is** the cost.

That last clause is the one worth the care. A shop that buys from an
unregistered supplier genuinely bears the whole price as cost, and treating it
as VAT-inclusive would understate cost and overstate profit — the dangerous
direction (§11).

Out of scope here: computing and filing the input VAT claim itself. This design
captures the fields; the return is later work.

---

## 7. Transfers are a cost event, and today they are not treated as one

Found while auditing `confirmTransfer()` (`app.js:5872`):

- **First transfer into a branch** does `const { id, ...rest } = product` and
  writes the whole product to the destination. `costPrice` travels with it.
  Correct — by accident.
- **Every transfer after that** does
  `transaction.update(destinationRef, { quantity: destinationQty + qty, ... })`
  — **quantity only.** Branch B receives 50 units that cost 2,200 and its unit
  cost stays at whatever it already was. Silently wrong, and it compounds with
  every subsequent transfer.

A transfer-in is stock arriving at a known cost. It is the same event as a
restock and needs the same recomputation, using the **source's** unit cost as
the incoming batch price.

The fix is cheap because **the transaction already reads the destination
snapshot** when the destination exists — it is a recompute inside a read that is
already there, not a new read and not a new transaction.

Transfer-*out* needs nothing: removing units at the prevailing average does not
change the average.

**A transfer is not a purchase.** It moves cost between branches; it does not
create any. No `purchases` document is written, or the Purchase Book would
double-count the group's buying.

---

## 8. Expenses

### 8.1 Shape

```
expenses/{expenseId}
  storeId        string
  category       string     from the closed set below
  amount         number     > 0
  note           string     optional, <= 200
  spentAt        timestamp  the date the money left, not the date it was typed
  paidFrom       string     'till' | 'other'   -- see §8.3
  recordedByUid  string
  createdAt      timestamp
```

`spentAt` separate from `createdAt` because expenses are routinely entered late,
and a period report keyed on the typing date is wrong.

**Offline for free.** An expense is a create with no read, so it queues and
replays like any other offline write with no extra machinery. Worth having: a
shop pays for transport with no signal.

### 8.2 Categories

A closed set, because free text cannot be reported on and cannot be mapped to a
tax treatment later:

`rent`, `utilities`, `wages`, `transport`, `supplies`, `repairs`,
`licences`, `marketing`, `other`

Two of these carry tax consequences already documented in
`RESEARCH-accounts.md` §3.4 and §3.3, and are worth capturing correctly now even
though nothing acts on them yet: **rent** to a resident landlord triggers a
**10% withholding obligation on the payer**, and input VAT on **entertainment**
is not deductible — which is one reason there is no entertainment category and
such spending belongs in `other` with a note until there is a treatment for it.

### 8.3 The shift interaction — captured now, wired later

`reconcileShiftCash()` computes expected cash as:

```
openingFloat + cashSales − cashRefunds + cashRepayments
```

There is **no expense term.** If a manager takes 10,000 from the drawer for
transport, the drawer comes up 10,000 short at close and the reconciliation
reads it as an unexplained shortfall — which is exactly the signal that surface
exists to raise.

`paidFrom` is captured from day one because it is one field and retrofitting it
means guessing at history. **It is deliberately not wired into
`reconcileShiftCash()` in phase 1**, because that function is the cash-control
surface and `KNOWN-LIMITATIONS.md` L-1 already records that expected cash cannot
be proven. Changing it is its own phase, with its own tests, and it must not
ride along with a new collection.

Until then, a till-paid expense still explains a shortfall to a human reading
both screens — which is strictly better than today, where nothing does.

---

## 9. Rules: the closed lists this touches

This project has been bitten by closed allowlists before —
`DESIGN-vat.md`'s closing section records the audit action enum and the audit
field allowlist not knowing about `VAT_REGISTRATION_ENABLED`, caught by tests
rather than review. Enumerating them up front:

| Closed list | Change needed | Note |
|---|---|---|
| `validSaleItems()` | **None** | Per-item content is deliberately unvalidated (expression budget). `unitCost` is free. |
| `validProduct()` | Add `costKnownFrom` | `costPrice` is already permitted. |
| **`validStockMovementUpdate()`** | **`affectedKeys()` must gain `costPrice` and `costKnownFrom`** | **The one that will fail silently.** See below. |
| `auditLogFields()` | Add the purchase fields carried on `PRODUCT_RESTOCKED` | Currently allows `qtyAdded` and `sellingPrice` but no cost field. |
| `cashierAuditActions()` / `managerAuditActions()` | New actions for purchase and expense records | `PRODUCT_RESTOCKED` is already cashier-writable. §10. |
| New: `validPurchase()`, `validExpense()` | New | Plus `match` blocks and read/write rules, in the `tenantNotFrozen()` pattern. |

**`validStockMovementUpdate()` is the trap.** It restricts a
manager's or cashier's product update to
`['quantity', 'sold30', 'sold90', 'updatedAt', 'movementReason']`. `confirmRestock()`
writes exactly `quantity`, `updatedAt`, `movementReason` — inside the
allowlist. **Add `costPrice` to that write without widening the allowlist and
every restock by a non-owner is refused**, while the owner's own testing passes,
because `isOwner()` takes the other branch entirely. That is the precise shape
of the outage the expression-budget comment describes: invisible to owner-side
testing, total for staff.

**The expression budget is a live constraint, not a theoretical one.** The cap is
1,000 expressions per evaluation and the sale path has already had to give
ground to stay under it; `tests/rules-budget-probe.mjs`, `sale-budget-probe.mjs` and
`manager-paths-probe.mjs` exist to measure it. Two
consequences: `validPurchase()` and `validExpense()` must be flat, constant-cost
validators with no iteration, and **this is the structural argument against
multi-line purchase documents** (§1) — a line-item purchase would face exactly
the per-item unrolling problem the sale path lost.

Every rules change is re-measured with the probes before the phase closes.

---

## 10. Roles: who may know what a thing cost

`PRODUCT_RESTOCKED` is a **cashier-writable** audit action today, and
managers and cashiers can restock. Purchase cost is commercially sensitive in a
way stock quantity is not: a cashier who knows the buying price of every item
knows the shop's margin on every sale.

**Recommendation:**

| Action | Owner | Manager | Cashier |
|---|---|---|---|
| Restock (quantity only) | yes | yes | yes |
| Restock **with cost** | yes | yes | **no** |
| Read `purchases` | yes | yes | **no** |
| Record an expense | yes | yes | **no** |
| Read the profit surface | yes | **decide** | no |

A cashier restocking without cost is a real and acceptable case — a delivery
arrives, someone counts it in. That batch simply has no purchase record, the
product's unit cost is unchanged, and the units are absorbed at the prevailing
average. That is a small, bounded inaccuracy, and it is much better than either
refusing the restock or showing the cashier the margins.

**Decided by the owner, 2026-08-21.**

*The profit surface is owner-only.* Not manager, not cashier. Profit exposes
buying prices by inference, and that is the owner's information. Conveniently,
the surface this design extends is already gated that way: `renderAdminControl()`
opens with `panel.hidden = !isOwnerRole()`, and `isOwnerRole()` is
`state.currentUserRole === "owner"` — a manager never renders it. So the
decision is already enforced for everything on that panel, and the rule for the
rest of this design is that **anything deriving cost or profit belongs inside an
owner-gated surface, and no manager-visible screen gains a cost figure.** Phase
E adds nothing outside `#adminControlPanel` without that being an explicit,
separate decision.

*A cashier may restock.* Confirmed as recommended — a trusted cashier records
a delivery when the manager is not there, and refusing that to protect a cost
field would break a real working pattern to solve a problem that is not the
cashier's. Quantity only: the cashier sees no buying price, records no purchase,
and the batch is absorbed at the prevailing average. This is why widening
`validStockMovementUpdate()` in Phase B has to be proven **from a cashier
account** against the emulator, not an owner one — the cashier restock is now
a supported path, not a tolerated one.

---

## 11. Profit: three numbers, two trust levels

There are three figures and they must not be conflated:

| Figure | Computed from | Trust |
|---|---|---|
| **Gross profit** | `netTotal` (or `total`) − Σ(`unitCost` × qty) on sale lines | Computed from data the system controls. Trustworthy where cost is known. |
| **Stock at cost** | Σ(quantity × unitCost) | Trustworthy where cost is known. |
| **Net profit** | Gross profit − expenses | **Only as complete as what the owner typed.** |

**Net profit is the dangerous direction of error.** `KNOWN-LIMITATIONS.md` L-12
overstates VAT owed, which is safe — the shop pays more than it should, never
less. Net profit fails the other way: a shop that forgets to log transport sees
profit that is **too high**, and prices, restocks or files against it.

Three rules follow:

1. **Gross and net are labelled differently and never summed into one
   headline.** Gross profit says how much it is computed from; net profit says
   it depends on expenses being complete.
2. **Cost completeness is stated, not assumed.** A period where some sale lines
   carry no `unitCost` reports the proportion covered. This is the fix to §2's
   guard, generalised.
3. **A period that cannot be computed completely refuses rather than
   estimating.** `KNOWN-LIMITATIONS.md` L-11 — reports see only the newest 1,000
   sales — applies in full. A day or a week is fine; a month for a busy shop is
   past the window, and `salesCoverageFromMs()` already answers that question and
   is already wired into the monthly report. The profit surface reads it too.

---

## 12. What we are accepting

| Accepted | Consequence |
|---|---|
| Weighted average, not FIFO | Per-line profit is approximate where a product was bought at different prices; aggregate profit is right. Choosing otherwise means batch tracking through `completeSale()`, the offline queue, returns and voids. |
| Forward-only cost | Stock on hand before this ships has no cost, and periods before `costKnownFrom` cannot report a complete margin. No backfill, no invented opening cost. Same call as VAT. |
| `unitCost` unvalidated by rules | Per §5. A client bug that fails to write it produces a line read as cost-unknown — degraded, not wrong. Covered by a client test, not a rules test. |
| Cashier restock has no cost | Those units are absorbed at the prevailing average. Bounded inaccuracy, chosen over exposing margins to the till. |
| One purchase per product per delivery | The Purchase Book does not reconcile to a multi-line supplier invoice. §13 keeps the door open; §9 explains why the door is not opened now. |
| No accounts payable | A purchase is recorded as paid. A shop buying on supplier credit records the payment, not the debt. |
| Till-paid expenses do not adjust expected cash | §8.3. The field is there; the shift path is untouched in phase 1. |
| Net profit depends on self-reporting | §11. Mitigated by labelling, not by mechanism. |
| Stale cost on an offline sale | §5. The device records the cost it knew. |

**Keeping the ledger door open.** `RESEARCH-accounts.md` §11 concluded that
above TZS 100m double entry is compulsory, and that retrofitting a ledger onto a
single-entry store is the expensive version of this work. Three properties of
this design are chosen so a ledger can be layered over it rather than replacing
it: every money movement is a **document with a date, an amount and a store**
(not a mutation of a running total); `purchases` and `expenses` are separate
collections rather than fields on a product; and cost is recorded as a
**transaction** (`totalPaid` on a batch) with the product's `unitCost` as a
derived cache. A ledger posting can be generated from any of those later. It
cannot be generated from a mutable `costPrice` field, which is what exists
today.

---

## 13. Phases

Ordered so that each phase is independently shippable, and the ones that touch
existing paths come after the ones that cannot.

- **Phase 0 — the honest label.** Fix the `costKnown` guard in §2 from a
  presence test to a real known-cost test, so the margin tile stops claiming a
  100% margin is known. One line plus a test. Independent of everything below
  and worth shipping on its own.

- **Phase A — expenses.** `expenses` collection, `validExpense()`, rules, the
  category set, capture UI, a period list and total. Entirely additive; touches
  no existing path; offline for free. Chosen first because it is the safest
  thing here and immediately useful.

- **Phase B — purchases, captured.** `purchases` collection, `validPurchase()`,
  rules, and cost capture in the restock dialog and the product form.
  **Widen `validStockMovementUpdate()` first** (§9) and prove a non-owner
  restock passes against the emulator before any client change. Writes
  `costPrice` and `costKnownFrom` on the product with the §4.2 arithmetic and the
  §4.3 first-purchase rule.

- **Phase C — transfers carry cost.** §7. Recompute the destination's unit cost
  inside the existing transaction. Small, but it touches a path that has already
  had a double-click defect, so it gets its own phase and its own negative
  control.

- **Phase D — cost on the sale line.** §5. `unitCost` on sale items, in
  `completeSale()`, the offline queue, returns and voids. **The sale-path
  phase.** No rules change; a client test that fails if the field stops being
  written; and the four call sites audited the way `DESIGN-services.md` §3
  audited them, because this is the same shape of change.

- **Phase E — the profit surface.** Gross profit, stock at cost, net profit, all
  labelled per §11, all reading `costKnownFrom` and `salesCoverageFromMs()`
  before reporting a period.

**Later, not in this design:** input VAT computed and claimed; multi-line
supplier invoices; supplier balances; till-paid expenses in shift
reconciliation; the ledger.

**Deployment:** nothing here is deployed without an explicit go-ahead, and the
same isolation pattern applies as for the credit fix — branch from the deployed
commit, apply the subset, deploy from the branch, merge back. Phase 0 is a
plausible candidate for that treatment on its own, since it corrects a live
wrong number and touches nothing else.

---

## 13a. Phase 0 record — built 2026-08-21

Larger than the "one line plus a test" this document estimated, because the same
defect had three faces, not one, and fixing the caption while leaving the value
would have been the worse half of the job.

**What changed.** The coverage loop moved out of `renderAdminControl()` into
`summariseCostOfGoods(sales, costByProductId)` — a pure function returning
`{ cogs, costedLines, uncostedLines, anyCostKnown, allCostKnown }` — so the
arithmetic is testable without a DOM, per the `DESIGN-vat.md` order of work. The
guard now asks whether a cost is greater than zero rather than whether the key
is present. Three surfaces then follow it:

- **Gross margin** shows `—` with *"No cost prices recorded"* when nothing is
  costed, rather than a fabricated 100%; the danger tone is suppressed in that
  state, because there is no margin to judge. Where cost is partial it names the
  count: *"{missing} of {total} sold lines have no cost price."*
- **Stock at cost** shows `—` rather than TZS 0, and keeps retail value in the
  note, which is known either way.
- **The per-store column** applies the same rule.

**One thing the fix had to add that the design did not anticipate.** Service
lines are skipped rather than counted as unknown. A haircut has no cost of
goods, so it is not a gap in the data — and with Services on `main`, counting
it as one would have reported every bar and salon month incomplete for a hole
that does not exist. `isServiceLine()` already existed; this is the first
non-Services surface to need it.

**Nothing in `firestore.rules` changed.** Phase 0 is client-only.

**Proven, not asserted.** 102/102 in `tests/control-panel-math.test.mjs`, and
all 39 client suites green with a tally each. Five negative controls, each
reintroduced and each confirmed to turn the suite red:

| Defect reintroduced | Caught by |
|---|---|
| `has(productId)` presence test restored | 7 assertions, led by *"production today: cost of goods is not claimed to be zero"* |
| Service-line skip removed | *"a service line is skipped, not counted as uncosted"* |
| Margin tile shows a percentage regardless | *"with no known cost the margin tile shows a dash"* |
| Stock at cost prints TZS 0 again | *"stock at cost shows a dash rather than TZS 0"* |
| Voided sales allowed to contribute cost | *"a voided sale contributes no cost of goods"* |

The first case is named *production today* deliberately: real sales, a real
catalogue, and not one cost price anywhere — the exact state of the eight live
shops, which the old guard reported as a perfect margin.

**Stamp.** `tests/deployment-validation.test.mjs` refused the working tree until
`20260808p` was bumped, correctly: the stamp is the bundle's identity, not a
deploy marker. Now `20260808q` / `savia-shell-v115`, both verified unused in
history.

**Portability note if Phase 0 ships alone.** It calls `isServiceLine()`, which
production does not have. A release branch cut from `20260808o` must carry that
three-line helper across, or inline the `kind === "service"` test. On production
no sale carries `kind` at all, so the check is a no-op there — but it must
still be defined, or the panel throws.

---

## 13b. Phase A record — built 2026-08-21

**Stamp.** `20260808r` / `savia-shell-v116`.

### What landed

`firestore.rules`: `validExpense()`, `expenseImmutableFieldsUnchanged()`, and a
`match /expenses/{expenseId}` block. `app.js`: `EXPENSE_CATEGORIES`,
`summariseExpenses()` and `localMonthKey()` as pure functions,
`subscribeToExpenses()`, `saveExpense()`, `deleteExpense()`, `renderExpenses()`,
`openExpenseDialog()`, plus the state fields, the sign-in subscription, the
sign-out teardown, the `renderAll()` hook and the listeners. `app.html`: a nav
item, the view with three month tiles, and the capture dialog. 38 new string
keys in each language.

### Not quite "touches no existing path"

§13 called Phase A *"entirely additive; touches no existing path"*. That was
almost true and worth correcting. The collection is additive, but four existing
places had to change: `renderAll()`, the sign-in subscription block, the
sign-out teardown block, and one assertion in
`tests/services-sale-path.test.mjs`. None of them is on the sale path, which was
the property that mattered — but "additive" and "touches nothing" are not the
same claim.

### The nav item is in the wrong place, deliberately

Expenses sits at top level in the sidebar. The owner's stated end-state is an
**Accounts** section with a dropdown, and this belongs under it. Building the
dropdown for a single child would be premature; it folds under Accounts when
purchases join it in Phase B. Recorded here so the move is a planned step rather
than a discovery.

### Roles, as decided in §10

Owner and manager write; **a cashier neither reads nor writes**, because these
feed net profit and `wages` is a category. `subscribeToExpenses()` returns early
for a cashier rather than subscribing and being refused — otherwise every
cashier gets a permission-denied in the console on every sign-in, which teaches
everyone to ignore that error.

**Only the owner corrects.** A manager can create but not edit or delete. An
expense is a book entry; letting whoever spent the money rewrite the amount
removes the only control the collection provides. `rules-expenses.test.mjs`
pins this from the manager's own account, and the negative control confirms that
widening `allow update` to managers turns it red.

### Two decisions that showed up in the code

**`spentAt` is separate from `createdAt`.** Expenses are routinely entered late,
and a period keyed on the typing date puts last week's transport in this week's
total. The date input is parsed into local parts at midday rather than through
`new Date("2026-08-21")`, which is UTC midnight and therefore the previous day
west of Greenwich.

**`paidFrom` is captured and deliberately not wired.** §8.3. Nothing subtracts
till-paid spending from expected cash yet, and `reconcileShiftCash()` is
untouched. The tile says what the figure means rather than implying the shift
knows about it.

### Four defects found after the implementation looked finished

A subagent writing the client suite found these; all four were mine.

1. **The state default shipped the exact defect this document warns about.**
   `expenseMonthSelection: new Date().toISOString().slice(0, 7)`. Everything that
   *reads* the bucket uses local parts — but the value they were all compared
   against was a UTC slice. In Nairobi that disagrees between 00:00 and 03:00 on
   the 1st: the screen opens on last month's total and an expense recorded that
   morning is invisible. Writing the warning into §4.3 did not stop me writing
   the bug forty lines further down.
   Fixed by extracting **`localMonthKey()`** as the single definition, now used
   by the default, the totals and the row filter. The row filter and
   `summariseExpenses()` had been carrying two copies of the same arithmetic,
   which is how they would have drifted.
2. **`deleteExpense()` awaited while `saveExpense()` did not.** One collection,
   two offline behaviours depending on which button was pressed: offline the
   delete promise does not settle until reconnect, so the row vanished from the
   local cache and neither the success nor the failure toast ever fired.
3. **Unguarded `qs()`** in paths where every sibling used `?.`. Replaced with
   `clearExpenseErrors()` / `setExpenseError()`.
4. **`expenses.recordedBy` was defined in both dictionaries and rendered
   nowhere.** `firestore.rules` pins `recordedByUid` to the caller precisely so
   an owner reviewing a manager's spending can trust the name — so it is now
   shown, blank for the owner's own entries rather than echoing a raw uid.

### A test that failed on a fix rather than a defect

`tests/services-sale-path.test.mjs` asserted `renderServices(); renderManagerControl();`
as adjacent text, and went red the moment `renderExpenses()` was inserted
between them. This is the second time an adjacency regex in this repo has failed
on an unrelated insertion — `tests/offline-selling.test.mjs` did the same thing
when `subscribeToServices()` landed. Both are now written as membership of the
enclosing function rather than adjacency to a neighbour, and the negative
control confirms the loosened version still catches the real defect: removing
`renderServices()` from `renderAll()` turns it red.

### A false green worth recording

The first emulator run reported exit 0 and had **not started the emulator**.
Two independent causes, either of which alone would have been enough:

- The global `firebase` CLI (15.25.1) shadowed the pinned one
  (`^13.35.1` in `tests/package.json`). firebase-tools 14+ requires Java 21;
  this machine has 17. `emulators:exec` **exits 0** on that path.
- I piped the output to `tail`, so the exit code I read was `tail`'s.

Caught only because **no suite printed a tally**. That is the same detection
rule `OPERATIONS.md` already records, and it is why the tally is not optional.
`README.md` now carries the warning; running through npm avoids the shadowing.

The second run failed honestly — port 8085 was already held by an emulator left
running from an earlier session. The suites connect to that port directly, so
they were run against it without `emulators:exec` at all.

### Proven, not asserted

| Suite | Result |
|---|---|
| `rules-expenses.test.mjs` | **55/55** |
| `expenses.test.mjs` | **272/272** |
| All 40 client suites | green, every one with a tally |
| 8 emulator rules suites | access 20, services 39, workflow 50, multibranch 20, audit-log 66, stock-ledger 45, deletion 29 |
| `manager-paths-probe` | **18/18**, including *"manager CAN sell a 40-item basket"* |
| `sale-budget-probe` | 40 accepted, 41 denied — the designed cap, unchanged |

The last two are the §9 requirement: `validExpense()` added no expression cost
to the sale path.

**16 negative controls, all confirmed red and restored:**

- **Rules (9)** — manager allowed to edit; cashier let in; category set opened to
  free text; zero amount allowed; recorder no longer pinned to the caller;
  `paidFrom` opened; `spentAt` no longer a timestamp; manager allowed to write
  against any branch; immutable-field guard removed.
- **Client (7)** — the default month back to a UTC slice; the month rule
  re-implemented inline in the row filter; `summariseExpenses` bucketing by ISO
  slice; the delete awaiting again; the recorder name dropped; the owner's own
  entries attributed back to them; the note cell unescaped.

Restored cleanly after each, verified by a real tally rather than an exit code.

### Owed

The adversarial audit of this phase did not complete — the subagent running it
hit a session limit partway through. Its brief was security and roles, the
expression budget, timezone handling, offline, multi-store `"all"`, escaping and
lifecycle. Of those, everything except a fresh adversarial read is now covered
by the suites and probes above, but the audit itself is still owed and should be
run before Phase B builds on this.

---

## 13c. Phase B record — built 2026-08-21

**Stamp.** `20260808s` / `savia-shell-v117`.

### The trap, defused first

§9 named `validStockMovementUpdate()` as the change most likely to cause an
outage nobody sees in testing: adding `costPrice` to the restock write without
widening the affected-keys allowlist refuses **every non-owner restock**, while
the owner's own testing passes, because `isOwner()` takes the other branch. Per
§13 the rules went first and were proven from a cashier account before any
client change.

The split is asymmetric by design (§10), so a single widened allowlist was not
an option — a cashier who can write `costPrice` can read it back, and a cashier
who knows the buying price of every item knows the margin on every sale. What
landed instead:

```
stockMovementKeys()          quantity, sold30, sold90, updatedAt, movementReason
stockMovementWithCostKeys()  ...the same, plus costPrice and costKnownFrom
memberMayUpdateProduct()     ONE member read; the allowlist branches on m.role
```

`memberMayUpdateProduct()` collapses role, store access and which allowlist
applies into a single `get()`, the same collapsing `memberSellsInStore()` does
and for the same reason. A separate manager branch beside the existing staff
branch would have added a second document read on every cashier restock to
answer a question the first read had already answered. **It is one read fewer
than before**: the old branch called `isOwnerOrRole()` and `memberCanAccessStore()`
separately, and each of those does its own `get()`.

Re-measured after the change: `manager-paths-probe` 18/18 including *"manager CAN
sell a 40-item basket"*, and `sale-budget-probe` still denying at 41. The sale
path is untouched.

### A rules clause that would have refused ordinary deliveries

The batch invariant — what was paid must agree with what the batch says each
unit cost — was first written as equality:

```
d.unitCost * d.quantity == d.totalPaid
```

That is wrong, and it would have taken the restock transaction down on
perfectly ordinary input. `unitCost` is `totalPaid / quantity` kept unrounded on
purpose (§3), so it is routinely a repeating fraction: 33,333 over 100 units is
333.33…, and `333.33… * 100` is `33332.999999999996` in float64. Every such
delivery would have been refused.

It is now a **±1 shilling tolerance** — orders of magnitude above the
representation error (~1e-7 at the top of `moneyInRange`) and far below anything
a human would mis-key. Both directions are tested: three repeating fractions are
accepted, and a unit cost out by ten shillings is still refused. Two negative
controls guard it — tightening it back to equality goes red, and widening it
enough to hide a mis-key goes red.

### The arithmetic

`nextUnitCost()` is a pure function so it could be tested before anything called
it, per `DESIGN-vat.md`'s order of work. It carries both §4 rules and both edge
cases:

- **§4.3, first purchase sets.** Every product in production has no cost. Reading
  absent as zero and averaging would report 1,667 for 40 uncosted units meeting
  200 bought at 2,000 — understating cost and overstating profit on a shop's
  very first delivery.
- **§4.2, the shelf can be negative.** `stockCountInRange()` permits −1,000,000
  deliberately, because an offline oversell is taken and flagged rather than
  refused. At exactly `oldQuantity === −delivered` the denominator is zero.

The average is computed **inside the restock transaction**, from the quantity and
cost that transaction read — not from the cached product the dialog opened with,
which another till may have moved. That read was already there; the costing
method rides on it for free.

### Not done, and why

**Cost capture on the product form is deferred.** §13 lists it in Phase B. It is
not built. `saveProduct()` is 129 lines with a documented history of misfiling
products by `storeId` — the comment in it describes stock landing in the wrong
branch and being invisible to the person who added it — and it writes with
`setDoc`, not a transaction, so a purchase written alongside would not be
atomic. Bolting that on at the end of an already-large phase is the wrong risk
on a live system. Restock is the recurring path and the one the owner described;
product-create is its own step, with its own transaction question to answer.

Until it lands, a product created with opening stock has no cost until its first
restock — and Phase 0's tile correctly reports those units as uncosted rather
than free.

### Four assertions of mine that proved nothing

All four passed against deliberately broken code, and all four were found by
running the negative controls rather than by reading:

1. **The negative-shelf case chose numbers where both paths agree.**
   `(-5 × 2000 + 400000) / 195` is exactly 2000, which is also the batch price —
   so deleting the guard changed nothing. Re-cased with an old cost of 1000, where
   the two answers differ by 25.64.
2. **`productName` matched the wrong write.** `confirmRestock()` sets
   `productName` twice — once on the purchase, once on the stock movement — and
   an unscoped regex found the survivor. Fixed once by slicing from the purchase
   write; that still ran on into the stock movement, so it is now bounded at
   **both** ends. This is the third time in this repo an assertion has matched
   one of two similar sites and passed against half-broken code.
3. **`renderAll` matched past its own closing brace.** `[\s\S]*?` found the
   `renderPurchases()` call in the month-input listener instead. Now scoped to
   the function body.
4. **The zero-denominator backstop cannot be singled out.** With `delivered > 0`,
   a positive `oldQty` cannot produce a non-positive sum, so the guard above it
   always fires first. It is kept deliberately — so that deleting that guard
   degrades to the batch price instead of handing `Infinity` to a restock — and
   the test says so rather than pretending to cover it.

### Two test-harness limitations this phase exposed

**`extract()` breaks on destructured parameters.** The helper every suite shares
takes the first `{` after the function name as the body. `nextUnitCost({ … })`
takes a destructured object, so it returned the destructuring pattern and handed
`new Function` a fragment that would not parse. `purchases.test.mjs` walks the
parameter list to its closing paren first.

**`till-availability.test.mjs` evaluates the real `confirmRestock()`**, so it had
to gain the costing helpers — injected as the *real* functions lifted out of
`app.js`, not stubs, since a stub only proves it agrees with the assertion. It
also needed `Timestamp` in its mock firestore, which its own new assertion
caught: without it the costed path threw and wrote nothing.

That suite now also proves the thing that matters most about a costed restock: a
double-click writes the purchase **once**. A doubled purchase does not merely
add the delivery twice — it moves the weighted average twice off a delivery that
arrived once.

### Proven, not asserted

| Suite | Result |
|---|---|
| `rules-purchases.test.mjs` | **66/66** |
| `purchases.test.mjs` | **73/73** |
| `till-availability.test.mjs` | 40/40, including the costed double-click |
| All 41 client suites | green, every one with a tally |
| All 14 rules suites | green, every one with a tally |
| `manager-paths-probe` | 18/18 — *"manager CAN sell a 40-item basket"* |
| `sale-budget-probe` | 40 accepted, 41 denied |

**31 negative controls.** 13 on the rules — allowlist never widened; split
dropped so a cashier gets cost keys; cost unchecked; `costKnownFrom` untyped;
manager restocking any branch; batch invariant dropped, widened, and tightened to
equality; recorder unpinned; zero-cost batch; cashier admitted to the Purchase
Book; manager allowed to edit; purchase repointed at another product. 18 on the
client — first-purchase rule dropped; negative-shelf guard removed; delivered
guard removed; average and batch cost rounded; average taken from the cached
product; `costKnown` assumed; `costKnownFrom` restamped; cost shown to a cashier;
`canRecordCost` opened; product name blanked; ISO-slice bucketing; receipted
spending merged; cashier subscription allowed; `renderPurchases` dropped from
`renderAll`; listener not detached; Accounts heading left standing.

All red and restored, except the unreachable backstop above.

---

## 13d. The adversarial audit, and B2 — 2026-08-21

Phase B was committed, and then audited before Phase C could build on it. Three
read-only agents ran in parallel — one on the rules, one on the client, one on
consistency with everything this project has written down. **Every headline
finding was verified independently against the emulator or by direct reading
before anything was changed**, because a fresh reviewer asserting a bug is not
proof of one; the previous round had turned up four "findings" that were bad
tests rather than bad code.

This time they were real. Fourteen rules findings reproduced exactly as
described. The conclusion was that Phase B as committed was not fit to build on
— and Phase C touches `confirmTransfer()`, which one of the findings said was
already corrupting the invariant.

### What the audit found that the tests did not

The suites were green throughout. Worth understanding why, because it is the
same reason each time: **a test can only fail on a question it asks.**

- The owner-corrects-a-manager's-entry contradiction was invisible because
  `rules-expenses.test.mjs` only ever had the owner correct a document the owner
  had created. `mgr1` existed in the fixture and was never updated by the owner.
- Cost being readable by a cashier was invisible because every assertion was
  about *writes*. Nothing read a product document back as a cashier and looked
  at what came with it.
- `receiptDate` and `supplierTin` being permitted-and-never-written was
  invisible because no test asserted the client writes them. The rules allowed
  them, the design listed them, and both were satisfied.
- The offline restock hang was invisible because no test ran `confirmRestock()`
  with no connection. `OFFLINE-CAPABILITIES.md` had promised the refusal since
  before this feature existed and nothing had ever checked.

None of these needed a cleverer assertion. They needed a question nobody had
asked.

### The five fixes

**B2-a — cost left the product document.** `/products` is readable by every
cashier, the POS needs it in full, and Firestore has no field-level read
security, so the write-side role split was working only against an honest
client. Cost lives in `/productCosts` now, owner and manager only. This
*simplified* the rules: `stockMovementWithCostKeys()` and
`validStockMovementUpdate()` are gone, the product allowlist is one list again,
and the §9 trap is removed rather than guarded. Two findings closed by
construction — `confirmTransfer()`'s `{...rest}` spread can no longer carry
`costKnownFrom` to a branch that never bought anything, and `productCostKnown()`
stopped asking a product for two fields that could disagree.

**B2-b — deletion leaves a trace.** The owner decided both collections stay
deletable, because a mis-keyed delivery is a human error. That decision is what
makes the trail necessary: every other money-touching collection refuses
deletion outright, and a document that can vanish silently is a note rather than
a book. Four audit actions, split by who may do what, and the §9 table's last
unbuilt row — the purchase fields on `PRODUCT_RESTOCKED` — finally built.

**B2-c — the rules contradiction, and settled money.** The recorder pin moved to
create-only. Purchase money is pinned across updates because the weighted
average is a cached derivation nothing recomputes; a wrong amount is corrected
by deleting and re-recording, which is now audited. Plus `unitCost > 0`,
required `createdAt`, integer quantities, `keys().hasOnly()` on both validators,
and an upper bound on `spentAt`.

**B2-d — the client.** The offline guard and timeout the promise document had
been claiming for months. Re-subscription on role change, in both directions.
`receiptDate` and `supplierTin` captured at last, and `hasFiscalReceipt`
asserted by a checkbox rather than inferred from whether a text box was typed
in. Paperwork read once, outside the retryable transaction callback. VAT copy
gated on registration. The Accounts heading given a real container instead of
capturing Reports and the AI Advisor.

**B2-e — this record, and the rest of the written trail.** §2 now says it
describes production. `KNOWN-LIMITATIONS.md` gains **L-13**, and L-1, L-3 and
L-8 are corrected. `OFFLINE-CAPABILITIES.md` knows these screens exist and
resolves the conflict it had with §8.1. `RESEARCH-accounts.md` §6 and §7 no
longer say purchases and expenses are unbuildable.

### What is still owed

- **L-13.** Three unbounded subscriptions, on collections that grow
  monotonically forever. Cheap to bound, and the bound needs the L-11 coverage
  treatment or it under-reports silently.
- **Cost capture on the product form.** Deferred in §13c and still deferred.
- **The access-call budget of the four-write restock.** Firestore caps document
  reads at 20 per transaction and the emulator does not enforce it, so a green
  `rules-purchases.test.mjs` proves nothing about it. Not a regression — the
  manager sale has the same shape in production — but nothing measures it.
- **`accept-invite.js?v=20260731b` has shipped four different builds.** Outside
  both the release runbook and the deploy guard. Now recorded in `OPERATIONS.md`;
  the guard should derive its file list from the stamped references it finds
  rather than a hard-coded triple.
- **`npm test` cannot complete on this machine.** `sync-integrity` passes 22/22
  and then Node aborts in libuv teardown, so the chain stops at suite 18 of 21.
  Pre-existing, confirmed against the Phase 0 rules. `observability`,
  `invite-preview` and `api-contract` all pass when run directly.
- **The adversarial audit's own findings on the audit.** Two of its "worth
  considering" items — the ±1 tolerance being relative at small totals, and
  `productId` not being checked against a product in the same store — were
  judged and closed. The rest are in the list above.

---

## 13e. Phase C record — built 2026-08-21

**Stamp.** `20260808x` / `savia-shell-v122`.

§7 said a transfer-in is a cost event and the code did not treat it as one. Half
of that was already fixed by B2-a without touching the transfer path: cost left
the product document, so `confirmTransfer()`'s `{ id, ...rest }` spread can no
longer carry `costKnownFrom` to a branch that has never bought anything. What
remained was the half that actually corrupts figures — an existing destination
gained units and no cost at all.

**What landed.** The transfer transaction now reads both cost documents and
recomputes the destination's weighted average through `nextUnitCost()`, the same
function a restock uses, with the source's average as the batch price for the
arrival. Four reads now precede the first write, which Firestore requires.

Three things it deliberately does not do:

- **The source's average is untouched.** Removing units at the prevailing
  average does not change the average; only its own purchases do.
- **No `purchases` document is written.** A transfer moves cost between
  branches, it does not create any, and writing one would make the Purchase Book
  count the group's buying twice.
- **A source with no recorded cost carries nothing.** The destination keeps
  whatever it had rather than being averaged against a zero — the §4.3 rule,
  applied to the branch instead of the product.

`costKnownFrom` is stamped for a branch receiving costed stock for the first
time, because that is the moment cost became knowable *there*, and carried
forward otherwise — the rules pin it either way.

### The defect found on the way in

Before writing anything, the question B2 taught me to ask first: **who can do
this, and can they write what it needs?** Transfers are owner-or-manager and so
is `/productCosts`, so the roles align and there is no repeat of the §9 trap.

But `/products` create is owner-only, and a first transfer into a branch creates
the destination product. Probed against the emulator: a manager updating an
existing destination is accepted, a manager creating one is refused, the owner
is accepted. **A manager's first transfer into any branch has never worked**, on
a rule unchanged since `908eb03` — so it is live on all eight shops and predates
every feature in this document.

Recorded as **L-14**. Partly closed: the client now detects it before the
transaction and says what to do, rather than reporting a bare "your account is
not allowed to do this" after the dialog has taken the quantity. Properly fixing
it means letting a manager create products, which is a role expansion rather
than a bug fix, and rules cannot narrow it to "only as a transfer destination" —
they authorise each write independently and cannot see the `/transfers` document
in the same transaction. Same shape as L-2. **That is a permissions decision for
the owner.**

### Proven

`purchases` 132/132, `till-availability` 40/40, all 41 client and 20 emulator
suites green with a tally each. Seven negative controls, all red and restored.

One came back green: `if (false) transaction.set(destinationCostRef, …)` still
contains the text the assertion looked for. **Third time in this file** an
assertion has tested that code *exists* rather than that it *runs* — it now
requires the write to follow `nextUnitCost()` with only whitespace between, and
separately asserts nothing conditions it away.

The `till-availability` transfer harness needed the costing helpers too. They
were lifted out of `app.js` inside the restock block; both harnesses use them
now, so they moved to module scope. The transfer harness had also picked up a
stray `withCost` parameter from an earlier edit that it never used — replaced
with `asOwner`, which it now genuinely needs, since its `getDocs` returns empty
and that is exactly the case a manager is refused.

---

## 13f. Phase D record — built 2026-08-21, and not as designed

**Stamp.** `20260808y` / `savia-shell-v123`.

### Why §5 was abandoned

§5 specified a `unitCost` on every sale line, written at the moment of sale. It
argued the change was cheap: zero rules expressions, and a precedent in per-line
`taxClass`. Both were true and neither was the problem.

The problem is that §5 predates B2-a, and B2-a moved cost off the product
*specifically* so a cashier could not read it. Checked before building anything:

- **The till cannot write it.** A cashier cannot read `/productCosts`, so the
  client has nothing to put on the line. Cashiers make most sales, so "only the
  owner's sales carry cost" is not a feature.
- **The till could read it back.** `firestore.rules:978` lets a cashier read
  sales for their assigned store. A `unitCost` on the line would be visible to
  exactly the role B2-a moved cost away from.

So the design as written was unbuildable, and building it anyway would have
undone the owner's decision by a side door.

### What replaced it

A `productCostHistory` collection: one append-only record per change to a
product's weighted average, carrying the moment that average took effect. Profit
for a sale is quantity × the cost in force on that sale's own date.

Better on this system's own terms, not a compromise:

- **No sale-path change at all.** §8 rates the sale path as the highest-risk
  thing in this design to touch. This removes that risk rather than managing it.
- **Cost never enters a document a cashier can read.**
- **Historically exact**, which was §5's entire purpose. A delivery next week
  appends a record and leaves the old ones alone, so last month's margin still
  reads the same next month.
- **Cheap to write.** A weighted average moves only on restock and transfer-in,
  and both are already online-only transactions that read the cost document. One
  more append, no new reads.

Written in the *same transaction* as the average it records, so the current cost
and its history cannot disagree. `effectiveFrom` is a `serverTimestamp()`, not
the device clock: it decides which cost applied to a sale, and a sale's
`createdAt` is a server timestamp too — comparing one authority against another
is the only way the comparison means anything.

Append-only in the rules: no update, no delete, for anyone including the owner.
Everything a period report says about cost of goods rests on these records, so
they are held to the `/auditLogs` rule rather than the deletable-by-decision rule
`/purchases` and `/expenses` carry.

### The payoff

`summariseCostOfGoods()` no longer reads the current cost. Phase 0's tile was
honest but approximate — its own comment said cost of goods was *estimated*
because a price change rewrote history. It is now exact for any period after a
product's first recorded cost, and still says *unknown* rather than *zero* for
anything before it.

Stock value still uses the **current** average, because that is what the shelf is
worth now. Two different questions, two different sources, and the suites assert
they do not get crossed.

### What this cost in test hygiene

Four negative controls came back green, and every one was a weak assertion of
mine rather than missing code:

1. A sweep run against the wrong suite entirely.
2. The out-of-order fixture happened to give the right answer with the sort
   removed. Re-cased so an unsorted array is provably wrong.
3. `if (false) transaction.set(...)` still contains every word a presence regex
   looks for. **Fourth** assertion in this file with that flaw; both history
   writes now assert they are unconditioned as well.
4. My control for an unresolved local echo mutated it to *epoch*, which is
   harmless — the real hazard is treating it as **now**, where it would win
   every lookup on a figure the server has not confirmed. The code comment
   described the wrong hazard too, and was corrected.

### Still owed

`productCostHistory` is a fourth unbounded subscription and is now named in
**L-13**. It grows only when a cost changes rather than per transaction, so it is
the slowest-growing of the four — but a bounded window here is the most
dangerous of them, and needs the L-11 coverage treatment more than the rest: a
truncated history does not under-report a total, it silently answers with the
**wrong cost** for any sale older than the window.

---

## 13g. Phase E record — built 2026-08-21

**Stamp.** `20260808z` / `savia-shell-v124`. This completes the design as scoped
in §1.

### The surface

A **Profit** screen in the Accounts group, owner-strict. Four tiles for a chosen
month: revenue, gross profit, expenses, and what the shop kept.

§11 is the whole of it — the three figures are not equally trustworthy and the
screen is built so nobody has to remember that:

- **Revenue** is computed from sales the system wrote. Net of refunds, and net
  of VAT where the business collects it, because VAT is the Authority's money
  passing through and was never the shop's margin. A sale from before the
  business registered carries no `netTotal`, so its total *is* its net — outside
  the scheme rather than taxed at zero, exactly as `DESIGN-vat.md` has it.
- **Gross profit** is revenue less what those goods actually cost, from Phase
  D's history at each sale's own date. Where cost is partial it names the count
  of lines it could not cost; where nothing is costed it shows a dash rather
  than a figure.
- **Expenses** distinguishes *nothing recorded* from *nothing spent*, which are
  not the same claim.
- **What you kept** is gross less expenses, and it is the dangerous one. A
  forgotten expense makes it look **better**. L-12 overstates VAT owed, which is
  safe; this overstates what the shop kept, which is what someone prices and
  restocks against. It shows nothing at all until there is a recorded cost to
  work from, and its caption says plainly that it is only as complete as what
  was entered.

Gross and net are separate tiles and are never summed into one headline.

### It refuses rather than estimating

§11 rule 3, and the L-11 precedent applied before anything is computed rather
than after. `subscribeToSales()` holds the newest 1,000 sales; a month that has
fallen out of that window would total to **less than was taken**, and a profit
statement is exactly the document nobody should be handed a quiet under-count
on. The screen names the date it can see back to and suggests narrowing to one
branch.

### Owner-strict

The only view with its own clause in `canOpenView()`. Profit exposes buying
prices by inference, and a manager already sees revenue, shift variance and
staff performance without it. Decided by the owner on 2026-08-21, enforced in
three places: the nav gate, `canOpenView()`, and `renderProfit()` itself, which
empties rather than returning past a stale figure.

### Two negative controls came back green, and one was subtle

1. **A no-op mutation.** My control for "a refund stops reducing revenue" wrapped
   a `.map((x) => x)` around the reduce, which changes nothing. The real gap was
   that the VAT branch subtracts refunds *itself* rather than going through
   `summariseSales()`, and only the non-VAT path had a case. Both do now.

2. **An ordering assertion that passed because the code was deleted.**
   `indexOf` returns `-1` when the text is absent, and `-1` is less than every
   real index — so `indexOf(refusal) < indexOf(firstTile)` was *true* precisely
   when the refusal had been removed. The control that deleted the whole block
   came back green on exactly that. Presence is now asserted separately, along
   with the fact that the branch `return`s rather than falling through.

   Worth recording as a shape, not an incident: **every ordering assertion in
   this repo written with two `indexOf` calls has the same hole.**

### Where this leaves the module

The design is complete as scoped, and none of it is deployed. What it does
**not** do is unchanged from §1: no general ledger, no trial balance, no P&L or
balance sheet, no payroll, no fixed assets, no supplier balances, and no input
VAT computed or filed. `RESEARCH-accounts.md` §8 has those as separate work, and
§1 of this document lists them as deliberately out.

The gate in front of all of it is still **L-8, L-11 and L-13** — server-side
aggregation. Every figure this module produces is computed from a client-side
window, and the Profit screen refuses honestly when it cannot see a whole month
rather than pretending otherwise. That refusal is correct behaviour and it is
also the reason the module cannot yet serve a busy shop: for a business doing
2,000 sales a day, the window is half a day.

---

## 14. Test plan

Every phase closes with negative controls: reintroduce the defect, confirm the
suite goes red. A suite that cannot fail has not been shown to pass.

**Rules (emulator):**

- `validPurchase()` / `validExpense()`: required fields, bounds, `quantity > 0`,
  `amount > 0`, category in the closed set, oversized strings refused.
- A **cashier** restock still succeeds after `validStockMovementUpdate()` is
  widened — the §9 trap, tested from the role that would hit it.
- A cashier is refused a `purchases` read and an `expenses` write.
- `tenantNotFrozen()` applies to both new collections.
- **Budget probes re-run** (`rules-budget-probe.mjs`, `sale-budget-probe.mjs`,
  `manager-paths-probe.mjs` — *not* `rules-budget-probe2.mjs`, which is
  superseded and no longer compiles; its header says why)
  after every rules change, with the measured headroom recorded in the phase
  note. Measured, not assumed.

**Arithmetic (pure functions, before anything calls them):**

- Weighted average across a sequence of purchases at different prices; assert
  that total stock value equals the sum of what was actually paid, which is the
  invariant the whole feature is judged on.
- `oldQuantity <= 0` takes the batch price and does not divide by zero —
  including exactly `oldQuantity = -deliveredQuantity`.
- First purchase sets rather than averages; second averages.
- `totalPaid` that does not divide evenly: the batch total is preserved and the
  unit cost is fractional.
- VAT-registered and non-registered profit both computed from the same fixture,
  and `hasFiscalReceipt: false` treated as fully-borne cost.

**Client:**

- `unitCost` is written on every sale line, online and offline — matched at
  **every** call site, not the first one found. (This is the failure mode that
  recurred four times during the offline-selling work: an assertion that matched
  one of two sites and passed against half-broken code.)
- A sale line with no `unitCost` reports as cost-unknown, never as zero cost.
- A period beginning before `costKnownFrom` says so rather than reporting a
  confident margin.
- A period beyond `salesCoverageFromMs()` refuses, per L-11.
- Transfer into a branch that already stocks the item recomputes the
  destination's cost; transfer-out leaves the source's cost unchanged.
- The §2 guard: a product with cost present-and-zero reports cost as unknown.
