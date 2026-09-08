# Design — landed costs, the delivery, and the Profit Report

Status: **COMPLETE as designed. Phases 1-7 all built 2026-09-07.
Nothing deployed.**

Source: `SaviaSmart_Inventory_Expense_Prototype_Design.docx` and the flow diagram
that came with it, both supplied by the owner on 2026-09-07.

This document extends `DESIGN-purchases.md`, it does not replace it. Everything
that file built — the batch-shaped purchase, the weighted average, the
forward-only cost, the cost history, the owner-strict profit surface — stands.
What the owner has asked for is the part that file put out of scope in §1:
**costs that are incurred on a delivery as a whole rather than on one product**,
and the reporting shape that follows from them.

---

## 1. The one sentence that matters

> *"The main issue is not whether inventory cost is recorded; it is where the
> cost goes and when it becomes an expense."*

Today SaviaSmart records what a batch of one product cost. It has nowhere to put
the 1,800,000 of freight, duty, clearing and transport that made that batch
usable, so a shop that pays those has exactly two options and both are wrong:

- **Log them as expenses.** They reduce profit in the month they were paid,
  rather than in the month the goods sell. Inventory is undervalued; margin on
  those goods reads too high; the month of the delivery reads too low.
- **Do not record them at all.** Inventory is undervalued by the same amount and
  the money is invisible.

The direction of error is the dangerous one, and it is the same one
`DESIGN-purchases.md` §11 flags for net profit: **margin looks better than it
is**, and a shop prices against it.

---

## 2. What is in and what is out

**In:**

- A `deliveries` collection: the goods-received note. Supplier, reference, date,
  store, the **additional cost lines**, and the allocation basis used.
- Allocation of additional costs across the products on that delivery, by
  **value**, by **quantity**, or **manually**.
- `goodsCost` and `landedCost` on each purchase line, with `totalPaid` becoming
  the **landed** total — so the existing `unitCost × quantity ≈ totalPaid`
  invariant survives and COGS picks landed cost up with no change to the sale
  path.
- A multi-product **Receive Stock** screen, which is what a delivery actually is.
- A **direct / indirect** axis on operating expenses.
- The **Profit Report** in the docx §9 shape, and the §10 product drill-down.

**Out, deliberately:**

| Excluded | Why |
|---|---|
| Allocation **by weight** | The docx offers it; the product has no weight field, and adding one to feed a single allocation basis is a product-schema change for the least-used option. By value is the docx's own recommendation for the first prototype. |
| Retrospective landed cost on past deliveries | Forward-only, the same call `DESIGN-purchases.md` §4.3 and `DESIGN-vat.md` made. A cost that lands after the goods have sold cannot be un-sold. |
| Accounts payable, supplier balances | Unchanged from `DESIGN-purchases.md` §1. A delivery is recorded as paid. |
| The general ledger | `RESEARCH-accounts.md` §8. §9 below records what this design does to keep that door open. |
| Renaming Profit to "Statement of Profit and Loss" | The docx says the same: **"Profit Report"** at this stage. |

---

## 3. The delivery, and why it is a header rather than an array

A landed cost has to attach to something that owns more than one product, or
there is nothing to allocate it across. Two shapes were available.

**An array of lines inside one document** is how most systems model a goods
received note. It is refused here for a reason this repo has already paid for:
`firestore.rules` in this project is written flat and constant-cost on purpose —
the note above `validExpense()` says so, and `rules-budget-probe.mjs` exists
because the expression budget has been hit before. Validating an unbounded array
of line items means iteration, and iteration in rules is where the budget goes.

**A header document plus the existing purchase lines** keeps every rule flat:

```
deliveries/{deliveryId}
  storeId          string     the branch the stock landed in
  reference        string     optional, the supplier's invoice or GRN number
  supplierName     string     optional
  supplierTin      string     optional
  receivedAt       timestamp  the day the goods arrived, not the day it was typed
  goodsCost        number     sum of the line goods costs, >= 0
  freight          number     REQUIRED, >= 0   -- explicit zero, see 11.1
  importDuty       number     REQUIRED, >= 0
  clearing         number     REQUIRED, >= 0
  transport        number     REQUIRED, >= 0
  handling         number     REQUIRED, >= 0
  insurance        number     REQUIRED, >= 0
  otherCost        number     REQUIRED, >= 0
  additionalTotal  number     sum of the seven above -- stored, not derived
  totalCost        number     goodsCost + additionalTotal
  allocationBasis  string     'value' | 'quantity' | 'manual'
  lineCount        number     how many purchase lines belong to this delivery
  recordedByUid    string
  createdAt        timestamp
```

The additional cost types are a **closed set of named number fields**, not a
list. Seven fields is flat, constant-cost, and reportable — an open list of
`{type, amount}` pairs is neither, and a free-text cost type cannot be mapped to
a tax treatment later for the same reason expense categories are closed
(`DESIGN-purchases.md` §8.2).

`additionalTotal` and `totalCost` are **stored rather than derived** so a rules
clause can check the arithmetic without summing seven optional fields in an
expression, and so the Purchase Book can total a period without opening every
line.

Each purchase line gains:

```
purchases/{purchaseId}
  deliveryId       string     optional -- absent on every purchase recorded before this
  goodsCost        number     optional -- what the supplier charged for this product
  landedCost       number     optional -- this line's allocated share of additionalTotal
  totalPaid        number     goodsCost + landedCost      (UNCHANGED FIELD, NEW MEANING)
  unitCost         number     totalPaid / quantity        (UNCHANGED)
```

### 3.1 Why `totalPaid` carries the landed cost

This is the decision the whole design turns on.

`unitCost` is what flows into the product's weighted average, and from there
into COGS at the moment of sale. The docx §7 is explicit: Product A's cost per
unit is **11,800**, not 10,000. So `unitCost` must be the landed unit cost.

`firestore.rules` already enforces `unitCost × quantity ≈ totalPaid` within a
shilling — the invariant the feature is judged on. There are two ways to keep it:

1. `totalPaid` stays the goods cost and a second field carries landed unit cost.
   Then the invariant is checking the wrong number against the wrong number, two
   unit costs exist, and every reader has to know which one it wants.
2. `totalPaid` becomes the **landed** total. The invariant holds unchanged, one
   unit cost exists, and the Purchase Book totals 11,800,000 — the real cost of
   getting the inventory ready, which is the number the docx §2 says the book
   should show.

Option 2, and `goodsCost` is kept alongside so the drill-down in §7 can show
"original inventory cost" and "landed costs" separately, exactly as asked.

**Backwards compatible with no migration.** A purchase written before this has
no `deliveryId`, no `goodsCost` and no `landedCost`. Absent reads as
`goodsCost = totalPaid`, `landedCost = 0` — which is precisely true of a
delivery that had no additional costs. Nothing in production needs rewriting.

### 3.2 A delivery with no additional costs is still a delivery

If every additional field is zero, allocation gives every line zero, `totalPaid`
equals `goodsCost`, and the result is byte-identical to what the restock path
writes today. That is intentional: the Receive Stock screen in Phase 4 subsumes
restock rather than sitting beside it as a second dialect, and the
no-landed-cost case must go through the same code so it is the case that is
exercised most.

---

## 4. Allocation

### 4.1 The bases

| Basis | Share | When |
|---|---|---|
| **value** | line `goodsCost` / total `goodsCost` | Default. The docx's own recommendation for the first prototype. |
| **quantity** | line `quantity` / total `quantity` | Right when the cost tracks units — per-carton clearing, per-item handling. |
| **manual** | typed per line | The escape hatch. Must sum to `additionalTotal` exactly or it is refused. |

Weight is out — §2.

### 4.2 The residual, and why it may not be dropped

`allocateLandedCosts()` returns amounts that **sum to `additionalTotal` exactly.**
Not approximately.

The docx's own example divides evenly — 1,800,000 across 5m/3m/2m out of 10m
gives 900,000 / 540,000 / 360,000 — and it is the only case that does. Take
1,000,000 of freight across three equal lines: 333,333.33... each, and three of
those is not 1,000,000. Drop the residual and the delivery no longer reconciles
to the invoice, which is the same trap `DESIGN-purchases.md` §3 defused for unit
cost, arriving from the other direction.

So: shares are computed unrounded, and **the largest line absorbs the
difference** between their sum and `additionalTotal`. Largest, not first, because
the correction is then the smallest fraction of any line it could be applied to,
and because "first" depends on the order the user happened to type the products
in — the same delivery would allocate differently on two screens.

The invariant, and the thing the tests are built around:

> Σ of allocated landed costs === `additionalTotal`, and
> Σ of line `totalPaid` === `goodsCost + additionalTotal` === `totalCost`.

Every shilling the shop paid is on a product. None of it is invented.

### 4.3 The edge cases

| Case | Behaviour |
|---|---|
| `additionalTotal === 0` | Every allocation is 0. §3.2. |
| One line | It takes everything. No residual arithmetic runs. |
| Total goods cost is 0, basis `value` | Cannot allocate by a zero denominator. Falls back to **quantity**, and the fallback is reported to the caller so the delivery records the basis it actually used, not the one that was asked for. |
| A line with `goodsCost` 0 among priced lines, basis `value` | Gets zero landed cost. Correct: free goods did not attract the freight in proportion to a value they do not have. If the shop disagrees, that is what `manual` is for. |
| Manual amounts that do not sum to `additionalTotal` | **Refused**, with the difference named. Silently correcting a manual allocation would defeat the only reason to choose it. |
| A negative amount anywhere | Refused. A negative landed cost is a discount, and a discount belongs in `goodsCost`. |
| Non-finite input | Treated as 0 by `safeNumber()`, same as everywhere else in this file. |

---

## 5. Expenses: the direct / indirect axis

The docx §4 asks for three tiers, not two: **inventory / landed costs**,
**direct operating expenses**, **indirect operating expenses**. The first tier is
§3 above and never enters the expense collection — it is capitalised into stock.
The other two are one new field.

```
expenses/{expenseId}
  nature   string   'direct' | 'indirect'    -- absent reads as 'indirect'
```

Categories widen to carry the docx's direct items, which have nowhere to go
today:

| New category | Nature | Docx line |
|---|---|---|
| `commission` | direct | Sales commission |
| `delivery` | direct | Delivery directly related to a sale |
| `packaging` | direct | Sales packaging |

The nine existing categories keep their meaning and default to `indirect`, with
two — `transport` and `wages` — offered as overridable, because they are
genuinely both: a boda delivering a customer's order is direct, a boda to the
bank is not; a sales commission is direct, an office salary is not.

**Why the default is safe.** Direct and indirect operating expenses both sit
*below* gross profit in the docx §9 statement and both subtract from it.
Misclassifying one as the other **cannot change gross profit and cannot change
net profit** — only the split between two lines that add to the same total. This
is the rare field where getting it wrong is presentational. Contrast a landed
cost misfiled as an expense, which moves money between COGS and opex across a
period boundary and does change reported margin.

**Landed costs appear in Expenses, read-only.** The docx §4 asks for this
explicitly: *"The Expenses module can still display these costs for reporting."*
They are shown in their own section, labelled as capitalised into inventory, and
they are **never added to the operating expense total** — that would count the
freight once in COGS and once in opex and understate profit by the whole of it.

---

## 6. The Profit Report

Docx §9, verbatim in structure:

```
Sales Revenue                        45,000,000
Cost of Goods Sold                 (27,000,000)
GROSS PROFIT                         18,000,000
Direct Operating Expenses           (2,000,000)
Indirect Operating Expenses         (8,000,000)
NET PROFIT                            8,000,000
```

`summariseProfit()` already produces revenue, COGS, gross and net. What changes:
COGS becomes a stated line rather than an intermediate, expenses split in two,
and the surface becomes a statement rather than four tiles.

**Every trust rule from `DESIGN-purchases.md` §11 survives unchanged.** Gross and
net are still labelled differently and never summed into one headline. Cost
completeness is still stated. A period beyond `salesCoverageFromMs()` still
**refuses rather than estimating** — L-11. A statement is exactly the document
nobody should be handed a quiet under-count on, and turning tiles into a
statement makes that more true, not less.

---

## 7. The drill-down

Docx §10, per product, for the period: units sold, average cost, COGS, original
inventory cost, landed costs, revenue, gross profit, gross margin %.

The `goodsCost` / `landedCost` split on the purchase line is what makes the two
middle columns answerable. Without it, "landed costs" for a product cannot be
recovered from anything the system stores — which is the second reason §3.1 keeps
both numbers rather than only the landed total.

Owner-strict, like the Profit view it lives under: it exposes buying prices per
product, which is a stronger disclosure than the aggregate figures above it.

---

## 8. Phases

Ordered so each is independently shippable, and so everything that touches an
existing path comes after everything that cannot.

- **Phase 1 — allocation arithmetic. BUILT, §10.** `allocateLandedCosts()` and
  `deliveryAdditionalTotal()` as pure functions, with the §4.2 invariant and
  every §4.3 edge case under test. No rules, no UI, no writes. Nothing calls
  them yet, which is the point: the arithmetic is proven before anything depends
  on it, the order `DESIGN-vat.md` established.

- **Phase 2 — the delivery document. BUILT, §11.** `deliveries` collection, `validDelivery()`,
  the widened `validPurchase()` for `deliveryId` / `goodsCost` / `landedCost`,
  role and freeze clauses, emulator tests, and the budget probes re-run with the
  measured headroom recorded. Rules before client, per OPERATIONS.md.

- **Phase 3 — the write path. BUILT, §12.** One transaction that receives a multi-product
  delivery: stock up, cost history, product costs, purchase lines, the delivery
  header. Built against the existing restock transaction's shapes, not beside
  them.

- **Phase 4 — the Receive Stock screen. BUILT, §13.** The docx §5/§6 UI: supplier, reference,
  date, store, product lines, additional costs, and the Allocate step with a live
  preview of the §6 table before it is committed.

- **Phase 5 — expenses gain a nature. BUILT, §14.** `nature` field, three new categories,
  rules widening, capture UI, and the read-only landed-cost section.

- **Phase 6 — the Profit Report. BUILT, §15.** The §6 statement shape, replacing the tiles.

- **Phase 7 — the drill-down and the report set. BUILT, §16.** Docx §10, then the §12 reports
  that are still missing: stock valuation, stock movement, supplier, and the
  direct/indirect expense reports.

**Deployment:** unchanged. Nothing here ships without an explicit go-ahead, and
the branch-from-the-deployed-commit isolation applies.

**Owed from the previous design and still owed:** the stage-2 cost migration
(`DESIGN-purchases.md` §13h, KNOWN-LIMITATIONS L-15) was due 2026-08-30 and has
not run. It is independent of this work and is not folded into it.

---

## 9. What we are accepting

| Accepted | Consequence |
|---|---|
| Landed cost is allocated once, at receipt, and never recomputed | A freight invoice that arrives a week after the goods cannot be capitalised onto them. It has to be recorded as a cost on the next delivery or borne as an expense. Recomputing would mean rewriting a weighted average that has already priced sales. |
| No allocation by weight | §2. The least-used basis, and it needs a product-schema change. |
| `totalPaid` changes meaning for new purchases | Old rows read as `landedCost = 0`, which is true of them. But a report spanning the changeover mixes two definitions of "what this delivery cost" — one that includes freight and one that never could. The Purchase Book says which. |
| Direct / indirect is self-classified | §5. Cannot move gross or net profit; only the split. |
| Landed costs are shown in Expenses but excluded from its total | A reader who sums the screen by eye gets a different number from the one the screen reports. Mitigated by labelling and by never placing them in the same total row. |
| One delivery, one store | A shipment split across two branches is two deliveries. Allocating one freight bill across branches is a transfer-pricing question, and §7 of `DESIGN-purchases.md` already decided transfers move cost at the source's average. |

**Keeping the ledger door open.** Unchanged from `DESIGN-purchases.md` §12, and
strengthened: a delivery is a **document with a date, an amount and a store**,
its additional costs are named fields that map one-to-one onto ledger accounts
(freight, duty and clearing are each a real account), and the allocation is
recorded as data rather than applied as an untraceable adjustment. A journal
posting can be generated from it.

---

## 10. Phase 1 record — built 2026-09-07

Two pure functions in `app.js`, next to `nextUnitCost()` because they are the
same kind of thing and the same suite will grow to cover both.

`deliveryAdditionalTotal(costs)` sums the seven named cost fields through
`safeNumber()` and **floors a negative field at zero** rather than letting it
subtract. A negative freight is a mis-key or a discount; either way, letting it
reduce the total would quietly move money out of inventory, and §4.3 refuses
negatives at the line level for the same reason.

`allocateLandedCosts({ lines, additionalTotal, basis, manualAmounts })` returns
`{ amounts, basis, ok, error }`. Four things about it are deliberate:

**It reports the basis it used, not the one it was asked for.** A delivery of
free samples with a freight bill asks for `value`, gets `quantity`, and the
returned `basis` says `quantity` — so the delivery header records what actually
happened. A header claiming `value` over an allocation done by quantity is a
book that lies about its own arithmetic.

**The residual goes to the largest line, chosen by allocated share.** Ties break
on the lowest index so the function is deterministic — two runs on the same
delivery must produce the same document, or an offline replay would disagree
with the write it is replaying.

**Manual is refused, never corrected.** `ok: false` with the shortfall in
`error`. §4.3.

**The invariant is asserted inside the function, not only in the tests.** After
the residual is applied the sum is compared to `additionalTotal` and a
disagreement beyond 1e-6 returns `ok: false`. A pure function that can silently
produce an allocation which does not reconcile is the failure this whole design
exists to prevent, and the test suite is not present at the till.

### Proven, not asserted

`tests/landed-costs.test.mjs`, run against the function extracted from `app.js`
rather than a reimplementation — the `purchases.test.mjs` convention, because a
reimplementation only proves the copy agrees with itself.

- The docx §6 table reproduced exactly: 5m/3m/2m goods, 1.8m additional, by
  value, giving 900,000 / 540,000 / 360,000 and final costs of 5.9m / 3.54m /
  2.36m.
- The docx §7 sale: Product A's unit cost is 11,800, 100 units sold at 15,000
  gives 320,000 gross profit and 4,720,000 of remaining stock value.
- **The residual invariant** across a range of awkward splits, including
  1,000,000 across three equal lines and primes that cannot divide evenly:
  the allocation always sums to `additionalTotal` **exactly**.
- Zero additional costs; a single line; zero goods cost falling back to
  quantity and saying so; a free line among priced ones; manual that balances
  and manual that does not; negative inputs; non-finite inputs; and an empty
  line list.
- Determinism: the same delivery allocated twice, and allocated again with the
  lines in a different order, puts the residual on the same product.

### Two negative controls came back green, and the reason is worth keeping

Per §14 of `DESIGN-purchases.md`, each defect was reintroduced and the suite
re-run. Eight controls; **two passed on the first attempt**, which means the
suite as first written could not have caught them:

1. **Dropping the residual entirely** — green.
2. **Putting the residual on the first line rather than the largest** — green.

The cause is the same for both. The invariant was asserted with a `near()`
helper at a 1e-9 tolerance, and the **measured drift on a realistic delivery is
about 1.5e-11** — a hundredfold inside it. Worse, five of the six cases in the
residual table drift by *exactly zero*: 1,000,000 across three equal lines,
33,333 across 100 units and the rest all sum back to the total unaided in
float64. Only the seventeen-line case drifts at all. A tolerance that a reader
would call conservative was swallowing the entire thing the test existed to
check.

Three changes followed:

- The invariant is asserted with `===`, not a tolerance. The design says
  *exactly*; the assertion now says exactly too.
- The residual table asserts that **at least one of its own cases genuinely
  drifts** without the correction. A table where every case reconciles unaided
  would pass with the residual logic deleted and prove nothing, and five of six
  of them do exactly that.
- The determinism group was rebuilt on the seventeen-line fixture — the only one
  with real drift — and now checks *which index* was corrected, and compares
  per-product allocations across a reversed line order by exact equality.

With those in place all eight controls turn the suite red:

| # | Defect reintroduced | Caught by |
|---|---|---|
| 1 | Residual dropped instead of assigned | the exact-sum invariant |
| 2 | Residual to the first line, not the largest | the corrected-index and reorder checks |
| 3 | Manual allocation silently rescaled to fit | the refusal test |
| 4 | A negative additional cost allowed to subtract | `deliveryAdditionalTotal` negatives |
| 5 | The manual length check removed | the short-list test |
| 6 | The zero-value fallback to quantity removed | the free-goods delivery |
| 7 | Fallback applied but the requested basis reported | the `basis !== "value"` assertion |
| 8 | Money with no lines silently dropped | the orphan-total test |

Control 5 is there because it is a defect the *first version of the function
had*: a manual list shorter than the line list read its missing entries as zero
and could still balance, so a caller that lost a line would have received a
plausible allocation with one product silently carrying no landed cost. The test
found it before anything called the function.

**Honest about what the residual is worth.** The correction is float-error
sized — it will never move a shilling on a real delivery. It is kept for two
reasons: the invariant is then exactly true rather than approximately true, so
the assertion can be exact and the negative controls can bite; and a later phase
that rounds allocations for display or storage would start losing real money
without it, at which point the mechanism is already there and already tested.

### Not done in this phase, on purpose

Nothing calls these functions — and a test asserts it, so a later phase wires
them in deliberately rather than discovering the coupling in production. No
rules changed, no document written, no screen altered. `git diff` for this phase
touches `app.js`, one new test file, the runner list, the version stamp and this
document — the sale path, the restock transaction and `firestore.rules` are
untouched, which is the property that would make it safe to ship on its own.

**The version stamp was bumped to `20260907a`.** `deployment-validation.test.mjs`
went red the moment `app.js` changed under `20260824a`, which is a stamp that has
already meant a shipped build: a browser holding it under `immutable` would never
have fetched the new bytes. Caught in the working tree, before a commit existed,
which is what that test was rewritten to do.

### Not deployed

Nothing in this programme goes to the live site until the whole of it is proven.
The eight shops stay on production. When it is ready, the release follows
`OPERATIONS.md` — branch from the deployed commit, rules before client — and the
existing customers are told what changed and that they need to take the update,
because a service worker holding the old build will not pick it up on its own.

---

## 11. Phase 2 record — built 2026-09-07

Rules only. No client, no screen, no document written by anything that ships.
`app.js` is not touched by this phase at all.

### 11.1 The seven cost types became required, mid-implementation

§3 originally had them optional. Writing the clause changed that.

The header has to add up to itself — `freight + importDuty + … == additionalTotal`
— or a delivery can state a breakdown that contradicts its own total, and every
report downstream inherits the contradiction. With optional fields that sum is
seven `('freight' in d) ? d.freight : 0` terms, which is exactly the kind of
expression this file's budget has been blown by before. **Required, with explicit
zeros, makes the sum one line.** The cost is seven zero fields on one document
per delivery, which is nothing.

The schema block in §3 was corrected rather than left describing an earlier
intention. `validDelivery()` refuses a delivery missing any of the seven, and
`rules-deliveries.test.mjs` asserts that for each field by name — a loop, so
adding an eighth cost type and forgetting to require it fails.

### 11.2 What the ruleset now says

- **`validDelivery()`** — flat, no iteration. The closed key set; `moneyInRange`
  on all eight amounts; `totalCost > 0` (a delivery that cost nothing is not a
  delivery); both header sums bounded to a shilling rather than tested for
  equality, for the same float reason the `unitCost` invariant is; the basis
  closed to `value | quantity | manual` with **`weight` deliberately absent**;
  `receivedAt` a timestamp with the same two-day local-noon slack `spentAt` has.
- **`lineCount` is capped at 100** — **WRONG, corrected to 80 in §12.1.** The
  count below omitted `recordStockMovement()`: it is five writes a line, not
  four, so 100 lines is 502 against Firestore's 500-write transaction cap. Left
  here as written rather than quietly edited, because the phase 3 record explains
  how it was found. *(Original text: receiving a delivery writes four documents
  per line — the product, its cost, its cost history and the purchase — inside one
  transaction, against Firestore's 500-write cap. 100 lines is 401 documents with
  the header.)*
- **`validPurchase()` widened** with `deliveryId`, `goodsCost`, `landedCost`, all
  optional, plus two invariants: **both-or-neither**, and
  `goodsCost + landedCost ≈ totalPaid`. The second is the one that matters. A
  client that computed the landed share but forgot to fold it into `totalPaid`
  would produce a line whose `unitCost` was the *goods* unit cost — COGS would
  understate and every margin would read high. That exact payload is a test case.
- **`purchaseImmutableFieldsUnchanged()`** gained the three fields via
  `.get(key, sentinel)` rather than an `in` test on both sides. They are absent
  on every purchase written before this design, and reading a missing field
  directly in rules is an error rather than a null.
- **`/deliveries` is scoped exactly like `/purchases`** — owner and store-scoped
  manager read and create, owner-only correction of the paperwork, everything
  monetary immutable once written. A delivery header states what a shipment cost,
  which is the same disclosure the Purchase Book carries, so it gets the same
  scope and not one notch looser.

### 11.3 Delete is refused, and phase 3 has to say so out loud

A mis-keyed delivery must be removable, exactly as a mis-keyed purchase is. It is
**refused anyway in this phase**, because `/purchases` pairs deletion with a
`PURCHASE_DELETED` audit entry and there is no `DELIVERY_DELETED` — phase 2 ships
no client that could write one, and `audit-actions-agree.test.mjs` would fail an
enum entry the client cannot produce, correctly.

Rules deploy ahead of clients (OPERATIONS.md), so permitting it here would put an
untraceable delete on a money document live with nothing to record it. Phase 3
opens it together with the audit action. The refusal is **pinned by two
assertions** so that is a deliberate flip rather than an inherited permission —
the same staging pattern `DESIGN-purchases.md` §13h used for the cost refusal.

### 11.4 A free line among priced ones cannot be written, and the client must catch it

Found while writing the rules, not while writing the design.

`allocateLandedCosts()` allocates zero to a zero-value line when the basis is
`value` — §4.3, and correct. But `validPurchase()` has required `totalPaid > 0`
and `unitCost > 0` since phase B, so that line's purchase document is **refused
at write time**: goods cost zero plus landed cost zero is a total of zero.

The rule is right and is not being relaxed — a million units at no cost each is
exactly what it was written to refuse. **Phase 3 owes the check on the client
side**: a delivery containing a line that would end up costing nothing must be
refused at the screen, with the reason named, rather than failing inside the
transaction after the shop has typed the whole delivery in. Recorded here so it
is designed for rather than discovered.

### Proven, not asserted

`tests/rules-deliveries.test.mjs`, against the emulator: **83/83**. The whole
rules suite re-run alongside it, all green — `rules-purchases` 126/126,
`rules-expenses` 65/65, `rules-access` 20/20, `rules-audit-log` 88/88,
`rules-deletion` 29/29, `rules-stock-ledger` 45/45, `rules-vat` 28/28,
`rules-multibranch` 20/20, `rules-workflow` 52/52.

Ten negative controls, each reintroduced and each confirmed to turn the suite
red: the two header sums; `weight` admitted to the basis set; cashier read on
`/deliveries`; both-or-neither dropped; the split no longer reconciling to
`totalPaid`; deletion permitted; the landed split made editable; the recorder pin
dropped; and the line cap raised past the transaction limit.

**One of those ten came back green on the first run** — the cashier-read control.
The cause was the patch not matching, not a gap in the suite: the `perl` used to
inject the defect silently made no substitution, so the "defect" was never
present. Re-applied with the substitution verified against `git diff` first, it
goes red. A negative control that does not verify it actually changed anything is
a negative control that always passes, which is worse than none.

### Budget probes — measured, not assumed

Re-run per `DESIGN-purchases.md` §14. `rules-budget-probe.mjs` and
`sale-budget-probe.mjs` are unchanged: the sale path still accepts 40 items and
denies 41, which is the designed cap. Expected — `/deliveries` is its own match
block and `validPurchase()` is not on the sale path — but expected is not
measured, and this was measured.

`manager-paths-probe.mjs` reports **17/18, failing on `manager CANNOT create a
product`.** This is **pre-existing and not caused by this phase**: the same probe
against `git show HEAD:firestore.rules` fails identically. It is a **stale probe
expectation**, not a permission hole — `memberMayCreateProduct()` grants an
active manager product creation in an assigned store deliberately, and the probe
predates that grant. Left alone: correcting it is not this phase's work, and
silently editing a probe to go green is how a real finding gets buried.

### An emulator message that looks like a defect and is not

Several refusals in `rules-deliveries.test.mjs` report
`evaluation error at L…:… for 'update'` alongside the expected `false`. That
reads like a rule throwing, and it was chased down before being accepted.

It is not this ruleset. A rule as trivial as
`allow update: if request.resource.data.b == 999` produces the same message,
while `allow update: if false` produces none: the emulator evaluates the write
along a create-shaped path as well, and that pass touches `resource.data` when
`resource` is null. It appears throughout the pre-existing probes on rules this
phase never touched. The `.get()` formulation and the `in`-based alternative were
compared side by side on a minimal ruleset and behave identically.

Recorded so the next person to see it spends a minute rather than an hour.

### Owed by phase 3

- `DELIVERY_DELETED` in `ownerAuditActions()` and `auditLogFields()`, a client
  that writes it, and the two pinned assertions flipped.
- The client-side refusal of a line that would cost nothing — §11.4.
- The write path itself: one transaction, stock up, cost history, product costs,
  purchase lines, delivery header.

### Not deployed

Unchanged. The eight shops stay on production, and a ruleset is the one artefact
in this repo that reaches them without any client change at all — which is
exactly why nothing here goes near `firebase deploy` until the whole programme is
proven and the customers have been told to take the update.

---

## 12. Phase 3 record — built 2026-09-07

The write path. Three functions in `app.js`, six changes in `firestore.rules`,
and one number from phase 2 corrected.

### 12.1 The cap in phase 2 was wrong, and it was wrong in the dangerous direction

§11.2 set `lineCount <= 100` and showed the sum: four writes a line, plus the
header, is 401 against Firestore's 500-write transaction cap.

**It is five writes a line, not four.** The count omitted
`recordStockMovement()` — which a delivery must write, or units appear on a shelf
with nothing explaining them and `stock-ledger-reconciliation.test.mjs` has
nothing to reconcile against. With the audit entry as well:

```
100 x 5 + 2 = 502     one over the cap
 80 x 5 + 2 = 402     with room for a sixth per-line document
```

A hundred-line delivery would have been refused by Firestore itself, **after the
shop had typed the whole thing in**. Corrected to 80 in both `firestore.rules`
and `DELIVERY_MAX_LINES`, and `landed-costs.test.mjs` now asserts that the two
numbers agree *and* that `n × 5 + 2 ≤ 500` — so the next person to raise the cap
has to satisfy the arithmetic rather than their intuition. The phase 2 ceiling of
100 is pinned as refused, so the correction cannot quietly drift back.

### 12.2 `prepareDelivery()` — everything decided before the transaction opens

Pure, and deliberately separate from the transaction. Firestore re-runs a
transaction callback on contention, so anything decidable once must be decided
once; and a refusal that only surfaces from inside the transaction surfaces after
the shop has typed the delivery in, as a bare permission error with nothing
pointing at the cause.

It returns error **codes**, not sentences — phase 4 owns the wording. Three of
its refusals are worth naming:

- **`duplicateProduct`.** Two lines for the same product each read the same
  shelf, and the second write lands on top of the first — so one of the two
  deliveries is silently lost, quantity and cost alike, inside a transaction
  that reports success. Refused rather than merged, because merging two lines
  the shop typed separately guesses at which price was meant.
- **`lineCostsNothing`** — §11.4, the phase 2 finding, now closed. A free line
  among priced ones allocates to zero by value, correctly, and then has nothing
  to record; `validPurchase()` has refused `totalPaid > 0` since phase B. The
  same delivery allocated **by quantity** is accepted, and there is a test for
  both: the refusal is about the outcome, not about free goods being forbidden.
- **`manualMismatch`**, carried through from `allocateLandedCosts()` with the
  shortfall intact, so the screen can name the difference.

### 12.3 `receiveDelivery()` — one transaction, reads in parallel

A transaction rather than a `writeBatch`, unlike the product-form cost capture in
`DESIGN-purchases.md` §13i. That was a batch because a product created a moment
ago has no shelf count to race against. A delivery is the opposite: every line
adds to a quantity and averages against a cost another till may be moving.

**All reads before any write, and issued concurrently.** Sequentially, an
eighty-line delivery is 160 round trips before the first write, which is how a
correct transaction times out anyway. `Promise.all` over `transaction.get()`
makes it two. The timeout is 45s against a restock's 15s, because the wire time
is a multiple of one restock's.

The weighted average is recomputed from the quantity read **inside** the
transaction, not from the copy the screen opened with — the same rule the restock
path has followed since phase B. `totalPaid` fed to `nextUnitCost()` is the
**landed** total, which is the whole point of §3.1: the freight reaches the
average, and from there COGS, and the sale path never learns any of it.

One audit entry per delivery, not one per line. A per-line entry is a sixth
document each, which costs the transaction its headroom under the 500-write cap —
and the per-product trail is `/stockMovements`, which already exists and which
the stock ledger reconciles against.

Product updates reuse `movementReason: "restock"`. A delivery line *is* a
restock, and inventing a reason would mean widening the one closed allowlist
`DESIGN-purchases.md` §9 calls the trap.

### 12.4 `deleteDelivery()` takes the lines with it

Deleting the header alone would leave the Purchase Book holding lines for a
delivery that no longer exists — and re-recording it, which is how a wrong amount
is corrected, would then count the money twice. The lines are **queried from the
server** rather than read out of `state.purchases`, because that cache is windowed
to the newest N and a delivery old enough to have fallen out of it would have its
lines silently left behind.

What cannot be undone is the weighted average those lines already fed. That is a
cached derivation computed once inside the transaction, and `DESIGN-purchases.md`
§12 accepted the same limitation for `/purchases` before this. Correcting a cost
means recording a new delivery, not deleting an old one.

### 12.5 The rules changes, and the pinned assertions flipped

`DELIVERY_RECEIVED` in `managerAuditActions()` (a manager receives deliveries),
`DELIVERY_DELETED` in `ownerAuditActions()` (removal is a correction, and
corrections are the owner's), `deliveryId` in `auditLogFields()` and in
`auditStringsBounded()`, the line cap corrected, and `/deliveries` delete opened
to the owner.

The two assertions phase 2 pinned were **flipped, not deleted**, and four more
added around them: a manager, a cashier and an outsider still cannot delete; a
manager can write `DELIVERY_RECEIVED` but not `DELIVERY_DELETED`. Pinning the
refusal in phase 2 is what made opening it in phase 3 a deliberate act.

### Proven, not asserted

`landed-costs.test.mjs` **228/228**; `rules-deliveries.test.mjs` **104/104**
against the emulator. Whole rules suite re-run green, and the budget probes
unchanged — the sale path still accepts 40 items and denies 41.

The last group of `rules-deliveries.test.mjs` is the one worth having: it
evaluates `prepareDelivery()` out of `app.js` and writes its **actual output**
through the **actual ruleset** — the docx delivery, a delivery whose allocation
does not divide evenly, and one at the line cap. Every other case in that file is
a payload the test author typed, which proves the rules accept what a test author
believes the client sends. This proves the client and the rules agree.

### Three negative controls came back green, and two were real

Nine controls. Six went red immediately. Of the other three:

- **One patch never applied** (the `deleteDelivery` line-removal, wrong
  indentation) — the same failure phase 2 hit. The control harness now **exits
  non-zero when its own patch does not match**, so a control that tests nothing
  reports itself instead of passing.
- **Two were genuine holes in my tests:**

  **The purchase line's `totalPaid`.** The assertion searched the whole of
  `receiveDelivery()` for `totalPaid: line.totalPaid` — and matched the one
  inside the `nextUnitCost({...})` call. A control that made the purchase record
  the **goods** cost instead of the landed total passed against it, which is the
  single most consequential defect this phase could ship: `unitCost` would be the
  goods unit cost, COGS would understate, and every margin would read high. The
  assertion is now scoped to the purchase write itself, with a bound on the
  window's size so it cannot silently widen back to the function.

  **The audit action.** Auditing a deletion as `EXPENSE_DELETED` was caught only
  once `audit-actions-agree.test.mjs` was added to the control run — the two
  delivery suites had no opinion on it. It is in the control set now.

All nine controls turn the suite red.

### Owed by phase 4

- The Receive Stock screen, and with it the wording for `prepareDelivery()`'s
  error codes: `duplicateProduct`, `lineCostsNothing`, `manualMismatch`,
  `tooManyLines`, `badQuantity`, `badGoodsCost`, `noStore`, `needsConnection`,
  `unconfirmed`, `transactionFailed`.
- `receiveDelivery()` and `deleteDelivery()` have **no callers**, and
  `landed-costs.test.mjs` asserts it — so wiring the screen up is a deliberate
  act, not a coupling discovered later.
- A live-preview of the §6 allocation table before the delivery is committed.

### A false green from phase 1, found here

`landed-costs.test.mjs` asserted that the sale path does not reference the
delivery arithmetic, anchored on `"async function completeSale"`. **There is no
such function** — the sale transaction is an inline handler inside
`bindEvents()`. `indexOf()` returned `-1`, `slice(-1, 19999)` returned the last
character of the file, and the assertion passed against one character for two
phases.

It is now anchored on `await awaitSaleTransaction(attempt)`, which exists, with a
check that the resulting window is a real window rather than a stub. The claim it
was always meant to make — that landed cost reaches COGS without the sale path
changing — is now actually tested.

### Not deployed

Unchanged. Nothing in this programme has been deployed, and the customer notice
remains part of the eventual release step.

---

## 13. Phase 4 record — built 2026-09-07

The Receive Stock screen. A `deliveries` view, a wide dialog, 94 translation
keys in both locales, a Firestore index, and the first test in this programme
that renders anything.

### 13.1 The preview is the same function the write path calls

The centrepiece is the docx §6 table, recomputed on every keystroke.
`renderDeliveryPreview()` calls **`prepareDelivery()`** — not a second
implementation of the allocation, and not `allocateLandedCosts()` directly. A
preview computed a second way is a preview that can disagree with what is saved,
and the number being previewed is the one a shop reconciles against its
supplier's invoice. `landed-costs.test.mjs` asserts both halves: the preview
calls `prepareDelivery()`, and it does **not** reach past it to the allocation.

Everything the screen refuses, it refuses **before** the dialog closes:
`prepareDelivery()` returns codes, `deliveryErrorMessage()` turns each one into a
sentence, and Record delivery is disabled while any of them stands. The §11.4
case — a free line among priced ones — now reads *"Product B would cost nothing
at all. Give it a price, or spread the additional costs by quantity so it carries
a share."* and switching the basis to quantity clears it. The refusal is about
the outcome, not about free goods being forbidden, and the screen says which.

### 13.2 Where it sits, and why not under Inventory

The docx puts Receive Stock under Inventory. It is in the **Accounts** group,
above Purchases, and that is deliberate: a delivery writes the purchase lines the
Purchase Book lists, and Inventory is a screen about what is on the shelf while
this one is about what was paid. The docx sentence is a description of the flow,
not of the nav. Same manager-and-owner gate as Purchases; deletion is the
owner's, matching `firestore.rules`.

### 13.3 Things this phase had to add around the edges

- **A composite index.** `where("storeId","in",…) + orderBy("createdAt","desc")`
  needs one, and the emulator does not enforce index requirements while
  production does — the same class of trap the stage-2 migration pre-flight
  checked for. Added to `firestore.indexes.json` beside the identical `purchases`
  entry.
- **`resubscribeRoleGatedCollections()` did not clear `state.deliveries`.**
  Found while fixing a test, not by the test. `subscribeToDeliveries()` empties
  it for a cashier anyway, so this was belt and braces — but the belt is what
  that block is: a demoted manager must not keep a screenful of buying prices in
  memory because a subscribe call happened to take an early return.

### 13.4 Two assertions in other suites were brittle, and one was mine

`purchases.test.mjs` asserted `subscribeToPurchases(); subscribeToProductCosts();`
as an **adjacency regex**, and inserting `subscribeToDeliveries()` between them
turned it red on a change that did not touch the claim at all. The same shape
appeared twice. Both were rewritten to assert each call **individually within the
right function** — which is what they always meant, and which now names the
missing call instead of reporting "the sequence changed". A genuinely missing
call in the middle would have looked identical to a harmless insertion.

The three phase-3 assertions that pinned `receiveDelivery()` and
`deleteDelivery()` at **zero callers** were flipped to **exactly one** each.
Pinning them in phase 3 is what made wiring the screen a deliberate act; each is
still called once, because two places that can record a delivery means a second
one that forgets a field.

### 13.5 Every Python edit had quietly rewritten the repo to CRLF

The dev server refused to serve `app.js`:

```
500 /app.js -- emulator patch "connect Firestore emulator" matched 0 times,
expected exactly 1. app.js has moved; refusing to serve a half-patched build.
```

The anchor was still there, character for character. What had changed was every
line ending in the file: `io.open(path, "w")` in Python applies newline
translation on Windows, so each of the scripted edits across phases 1–4 rewrote
its whole file from LF to CRLF. Git hid it — `core.autocrlf` normalises on the
way in, so `git diff` showed only the real changes — and `dev-server.mjs`, which
reads raw bytes and matches an exact `\n`, did not.

Nine files were normalised back to LF. The dev server's refusal is the reason
this was caught at all: it fails loud on a patch that matches zero times rather
than serving an unpatched build, and its own comment says that is what it is for.

### Proven, not asserted

`tests/deliveries.headless.mjs` — **34/34** — is the first test here that renders
anything. It lifts the real render functions, the real `DICTIONARY`, the real
`esc()`/`money()`, and the dialog markup **out of `app.html` itself** rather than
a retyped copy, and drives them in Chromium against the real `styles.css` with
every external request blocked.

It measures four things a source-grep cannot:

- **The docx §6 table, cell by cell**, including Product A at *TZS 11,800.00* and
  a TOTAL row of *TZS 11,800,000.00*.
- **That no untranslated key reaches the screen** — a missing dictionary entry
  renders as `deliveries.thAllocation`, and this is the only thing that would
  have caught it.
- **That the refusals appear in words**, that the stale preview is cleared beside
  them, and that Record delivery is disabled while one stands.
- **That it is legible** — no horizontal page scroll at 1280px or at 390px, the
  preview scrolling inside its own container, the TOTAL row set apart, and a
  delivery line collapsing to two columns on a phone.

Alongside: `landed-costs.test.mjs` 231/231, `purchases.test.mjs` 236/236,
`rules-deliveries.test.mjs` 104/104, the rules suite green, and the two
pre-existing headless harnesses (`contrast`, `compatibility`) still passing.

### The harness found two defects, and one of them was real

**The fallback notice was an empty paragraph.** `renderDeliveryPreview()` toggled
`hidden` on `#deliveryBasisFellBack` and never set its text, so a delivery of
free goods announced its basis fallback by showing a gap. Every source-level
assertion in this programme would have passed it, because the element was there
and the visibility logic was correct. Rendering it is what showed it.

**The TOTAL row's styling was fine and my assertion was not.** The rule is
`.delivery-preview-total td`; the check read `fontWeight` off the `<tr>`, which
inherits 400, and reported missing styling that was applied correctly one level
down. The border passed only because it happened to be read from a cell. Both
now read from the cell.

The harness itself also 404'd its own page at first: `normalize("/harness.html")`
returns `\harness.html` on Windows, so the route never matched. Recorded because
the symptom — `window.harness is undefined` — points at the page rather than at
the server serving it.

### Owed by phase 5

Expenses gain a `nature` (direct / indirect) and the three new categories, and
the read-only landed-cost section the docx §4 asks for. Nothing in phase 4
depends on it.

### Not deployed

Unchanged. Nothing in this programme has been deployed; the version stamp on the
working tree is `20260907a`, which has never been served. The customer notice
remains part of the eventual release step.

---

## 14. Phase 5 record — built 2026-09-07

Expenses gain a `nature`, three categories, and the panel the docx §4 asks for.

### 14.1 The field is safe to add because of what it cannot do

`nature` is `'direct' | 'indirect'`, optional, and **self-classified**. Both lines
sit below gross profit in the docx §9 statement and both subtract from it, so
misclassifying one as the other **cannot move gross profit and cannot move net
profit** — only the split between two lines that add to the same total. That is
why the box is editable rather than derived from the category and pinned.

What is not presentational is a **third** value, and `validDelivery()`'s sibling
clause refuses one: inventory and landed costs are the docx's third tier and they
never reach this collection at all. An expense claiming to be one would be
charged once in COGS and once in operating expenses.

**No migration.** `expenseNature()` falls back to the category's default, and
every category that existed before this phase defaults to `indirect` — so an
expense written before the field existed reads identically whether the fallback
is the map or a bare `"indirect"`. `expenses.test.mjs` asserts that property by
name for all nine, so if a direct-by-default category is ever added to that list
the suite goes red — which it should, because history would then depend on which
fallback was used.

### 14.2 Three categories that had nowhere to go

`commission`, `delivery`, `packaging` — the docx §11 direct column. Until now
they went to `other`, which is the one category no report can act on.

`transport` and `wages` stay `indirect` by default and are the genuinely
ambiguous pair: a boda delivering a customer's order is direct, a boda to the
bank is not. Indirect is the safer half of the guess — it does not claim a cost
was attributable when nobody said so.

**Choosing a category resets the type of cost to that category's default, every
time.** Not "unless the box has been touched". Predictable beats clever: *pick a
category, then correct the type if it is wrong* is one rule a shop can hold,
where the alternative silently keeps a classification chosen for a different
category. §5's "two overridable" wording is implemented as "always editable,
always pre-filled", because greying out a control for nine of twelve categories
with no visible reason is worse than trusting the shop with a field that cannot
move its profit.

### 14.3 The landed-cost panel, and why it is a panel

The docx §4: *"The Expenses module can still display these costs for
reporting."* Display, and nothing else — the freight is already inside each
product's unit cost and reaches the profit statement as cost of sales when the
goods sell. Adding it here as well would charge it twice and understate profit by
the whole of it, which is §1's error arriving from the opposite direction.

So it is a **separate panel, never rows in the table**. In the table it would sit
under the same column headings as spending that does reduce this month's profit,
and the only thing keeping them apart would be a label in a cell. A reader
summing the screen by eye must not be able to reach a different number from the
one the screen reports. It carries an eyebrow reading *"Not an expense"*, a
TOTAL CAPITALISED row, and a closing line saying the total is **not** included in
the figures above and that counting it twice would understate profit. It hides
itself entirely when there is nothing to show, because a shop that has never
recorded a landed cost should not meet a distinction it has not run into.

`summariseLandedForMonth()` never touches the expense summary, and
`renderLandedCostSection()` never calls `summariseExpenses()`. Both are asserted,
because the separation is otherwise one edit away from collapsing.

### Proven, not asserted

`expenses.test.mjs` **411/411** (was 344), `rules-expenses.test.mjs` **90/90**
(was 65), `deliveries.headless.mjs` **49/49** (was 34), `purchases.test.mjs`
236/236, `landed-costs.test.mjs` 231/231, rules suite green.

The assertion worth naming: **`direct + indirect === total`**, on a fixture that
mixes a stored direct, a stored indirect, an expense with **no nature at all**,
and one overridden away from its category default. Two lines of a statement that
add to the line above them.

The panel is checked **in a browser**, because its entire design is a visual
separation. The harness reads its rendered rows — Freight 800,000; Import duty
500,000; Clearing 300,000; Transport 200,000; TOTAL CAPITALISED 1,800,000 —
confirms it is not inside `#expenseTotals`, confirms the exclusion sentence is on
screen, and confirms it hides itself and empties rather than leaving stale rows
when there is nothing to show.

Seven negative controls. Five reintroduced defects all turned the suite red:
every expense counted as indirect; the docx direct categories defaulting to
indirect; an invented `nature` trusted rather than falling back; the rules
accepting any string; and `entertainment` admitted to the category set. **Two
were deliberate no-ops** — a `void 0` and a `total += 0` — and both correctly
stayed green, which is what shows the harness reports a real defect rather than
any edit at all.

### Two suites broke, and both were right to

`expenses.test.mjs` asserted **nine** categories and the exact set; widening it
to twelve is a schema decision that should be made in the test as well as the
code, which is what that assertion is for. And `purchases.test.mjs` failed with
`expenseNature is not defined` — `summariseProfit()` calls `summariseExpenses()`,
which now reads the map, so the suite that evaluates it had to lift the map out
of `app.js` too. Restating it there would have created a second copy of the table
that decides which line of the Profit Report a cost lands on.

### A local check that lied, and why it did not become a fix

The Expenses table header rendered as the raw key `expenses.thNature` in the
browser while the key was present in `app.js` **and** in the file the dev server
was serving. The cause was the **service worker**, holding the previous build
under the same `?v=20260907a` stamp: `dev-server.mjs` sends `no-store`, but the
service worker intercepts before the network is reached. Unregistering it and
clearing the caches rendered everything correctly.

Recorded because the obvious reaction — "the key is missing, add it" — would have
added a duplicate key to fix a bug that did not exist. During local work on an
unshipped stamp, the service worker is the first thing to rule out.

### Owed by phase 6

The Profit Report in the docx §9 shape. `summariseProfit()` already produces
revenue, COGS, gross and net; what it does not yet do is read the split this
phase captured. Nothing else in phase 5 is left over.

### Not deployed

Unchanged.

---

## 15. Phase 6 record — built 2026-09-07

The Profit Report: the docx §9 statement, replacing four tiles.

```
Sales revenue                          TZS 45,000,000.00
Cost of goods sold                    (TZS 27,000,000.00)
GROSS PROFIT                    TZS 18,000,000.00 · 40%
Direct operating expenses              (TZS 2,000,000.00)
Indirect operating expenses            (TZS 8,000,000.00)
NET PROFIT                              TZS 8,000,000.00
```

Renamed to **Profit Report**, in the nav and the heading, in both locales — the
docx §9 names it, contrasting it with "Statement of Profit and Loss", which is
what it deliberately is not yet.

### 15.1 What changed, and what deliberately did not

**Cost of goods sold is now a stated line.** It was an intermediate the reader
had to infer from revenue minus gross. The docx asks for it by name, and it is
also the line the cost-completeness caption belongs to — it is the figure the
completeness is *about*.

**Expenses became two lines**, which is the whole reason phase 5 captured a
`nature`. `summariseProfit()` gained `directExpenses` and `indirectExpenses`;
they add to `expenses` and to nothing else.

**Every trust rule from `DESIGN-purchases.md` §11 survives, and two are easier to
honour as a statement than as tiles:**

- *Gross and net are never summed into one headline.* As rows they are two, each
  with its own caption, ruled off from the lines they sum. Side by side as tiles
  they read as two competing headlines.
- *A figure that cannot be computed shows a dash on its own row* rather than
  being folded into a neighbour.
- *Cost completeness is stated, not assumed* — carried on the cost-of-goods line.
- *A period beyond `salesCoverageFromMs()` refuses outright* (L-11), before any
  figure is built, and empties the container rather than leaving a stale one.

**Unknown cost blanks three rows, not one.** Cost of goods, gross and net are all
derived from it. Printing revenue against a zero cost would report the whole of
revenue as profit — precisely the defect `DESIGN-purchases.md` §2 found live on
the control panel. The expense lines stay, because they are recorded facts
rather than derived ones.

**Deductions are bracketed**, per the docx, and through `t()` rather than
hard-coded brackets: it is punctuation carrying meaning — *this is subtracted* —
and that is a translatable decision. Only the three deduction lines are
bracketed; the subtotals are not, so a negative net profit reads as a loss rather
than as another deduction.

Rendered as a real `<table>` with `<th scope="row">`: this is tabular data, and a
screen reader should say *"Gross profit, 18,000,000"* rather than read two
unrelated columns.

### Proven, not asserted

`purchases.test.mjs` **269/269** (was 236), `deliveries.headless.mjs` **88/88**
(was 49), and the rest of the suite green.

The arithmetic is checked against the docx §9 figures built from **real sales and
real expenses**, so the statement is derived rather than asserted against itself:
revenue 45m, COGS 27m, gross 18m, direct 2m, indirect 8m, net 8m. Three
identities go with it — `gross === revenue - cogs`, `net === gross - direct -
indirect`, and `direct + indirect === the expense total`.

The one worth naming: **flipping every expense's classification leaves net profit
and gross profit unchanged**, and only swaps the two lines. That is the property
that makes the phase 5 box safe to hand a shop, demonstrated rather than argued.

The statement is checked **in a browser**, six rows read label by label and
figure by figure, because a statement is a *shape* — six lines in one order,
deductions in brackets, subtotals set apart — and none of that is visible from
the source. Also measured there: the subtotals heavier than the lines they sum
and ruled off above them, figures right-aligned with tabular digits so the column
lines up, and no horizontal page scroll.

Eight negative controls, all caught: both expense lines reporting the whole
total; cost of goods, gross, and net each printed when no cost is known; the
brackets removed; the direct line always zero; the L-11 refusal removed; and the
CSS specificity bug below reintroduced.

### The browser found two defects the source could not

**`--danger` and `--warn` do not exist.** The tone colours were written against
tokens this stylesheet has never defined — it uses `--red` and `--amber`, which
`.control-table td.warn` already uses. An undefined custom property makes the
declaration invalid, so `color` silently resolved to nothing and a negative gross
profit would have rendered in the ordinary text colour. Caught by grepping the
token names before trusting them.

**The subtotal weight never applied.** `.statement-total td` loses to
`table.statement td` on specificity — two elements and a class beats one element
and a class — so the *border* applied and the *font-weight* did not, which is the
worst kind of half-styling: it looks deliberate. The rendered weight came back
`550`, identical to an ordinary line. Now written as
`table.statement .statement-total td`, and the negative control that restores the
short form turns the suite red.

### Two assertions in `purchases.test.mjs` were re-anchored

`grid.innerHTML = [` and the `profit.gross` / `profit.net` key pair are both
gone. Their claims are not: the L-11 refusal must still be reached *before* any
figure is built, and gross and net must still be separate. Re-anchored on
`const rows = [` and the new `profit.stGross` / `profit.stNet` keys, keeping both
halves of the original — presence *and* ordering — for the reason that test's own
comment gives: an ordering check alone passes exactly when the thing it guards
has been deleted. Four assertions were added alongside, for the cost-of-goods,
direct and indirect lines the docx asks for by name.

### The service worker lied again, and did not become a fix

The nav and heading rendered as "Profit" while `app.js` **and** the file the dev
server was serving both said "Profit Report" — the same stale-service-worker
symptom recorded in §14, on the same unshipped `?v=20260907a` stamp.
Unregistering it and clearing the caches rendered both correctly. Twice in two
phases: during local work on an unshipped stamp, the service worker is the first
thing to rule out, not the last.

### Owed by phase 7

The docx §10 product-level COGS drill-down, and the §12 reports still missing:
stock valuation, stock movement, supplier, and the direct/indirect expense
reports. The `goodsCost` / `landedCost` split on the purchase line — kept since
phase 2 precisely for this — is what makes the drill-down's two middle columns
answerable.

### Not deployed

Unchanged.

---

## 16. Phase 7 record — built 2026-09-07

The docx §10 drill-down, and three of the §12 reports. **The programme is
complete as designed.**

### 16.1 The drill-down, and the one decision it turned on

Docx §10 asks for, per product: units sold, average cost, COGS, **original
inventory cost**, **landed costs**, revenue, gross profit, margin. The two bold
columns are the entire reason §3.1 kept `goodsCost` and `landedCost` on the
purchase line rather than only the landed total.

**The split is applied as a ratio, not a sum, and that is the phase's real
decision.** `goodsCost` and `landedCost` are properties of what was **bought**;
units sold are a property of what was **sold**. Putting a period's purchases
beside the same period's sales on one row is a category error — a delivery
received on the 30th would appear in full against a month of sales it barely
touched.

So across everything ever recorded for a product,
`landedCost / (goodsCost + landedCost)` is the share of its unit cost that is
freight, duty and clearing rather than the supplier's price; that share is
applied to the period's cost of sales. It answers the question a shop actually
has: *of the cost of goods I sold, how much of it was getting them here?*

It is an **attribution, not a measurement**, and the surface says so in as many
words. A product bought before the split has a ratio of `null` — not zero —
because "nothing was capitalised onto these units" and "we have no basis to
attribute" are different statements, and the count of such products is reported.

Everywhere a figure cannot be known, it is `null` and renders as a dash: average
cost, gross profit and margin for an uncosted product, and both attributed
columns for one with no split. `DESIGN-purchases.md` §11 rule 2, applied per row.

### 16.2 The three reports

- **Stock Valuation** — Σ(quantity × unit cost). *At cost is the headline*:
  what a shop paid is what its stock is worth, and reporting what it hopes to
  sell for as "value" is how inventory gets overstated. Retail is shown beside
  it, labelled as what the shelves would bring in rather than what they are
  worth. Negative stock — real here, since an offline oversell is taken and
  flagged — counts in the unit total and is excluded from the money, because a
  negative valuation is not a valuation. Products with no cost are named and
  their units counted, rather than silently dropped from a total presented as
  complete.
- **Supplier Report** — keyed on the supplier name **as typed**, trimmed and
  case-folded, because `supplierName` is free text and there is no supplier
  record to join to; that is the whole of what can be done without inventing a
  collection. Goods come off the purchase lines and landed cost off the
  **delivery header**, never off the lines — the lines carry an allocated share
  each, and summing both would count the freight twice. A legacy purchase with
  no split counts its `totalPaid` as goods, which is exactly true of it.
- **Direct & Indirect Expense Report** — phase 5 put the two totals on the
  Expenses screen; this is the breakdown by category inside each, which is what
  makes a total actionable rather than merely true.

All three are manager-and-owner — the same gate `/purchases` and `/productCosts`
already carry, so none widens a disclosure. The drill-down is owner-strict by
inheritance from `#profit`, and `renderProfit()` clears its table as well as
hiding its panel for a non-owner: it names a buying price against a selling price
per product, which is the strongest disclosure in the app.

### 16.3 Not built, and why

The docx §12 list also names **Stock Movement** and **Low Stock**. Both already
have surfaces — the movement-classes panel and the low-stock KPI with Smart
Alerts on the dashboard — so a second report would be new UI over the same data
with a different name. Recorded as a decision rather than left as an omission.

### Proven, not asserted

`purchases.test.mjs` **324/324** (was 271), `deliveries.headless.mjs` **97/97**
(was 88), the whole fast suite green, and the full rules suite green — 90, 126,
104, 88, 20, 29, 28, 20, 52 and 24 across ten emulator files.

The drill-down is checked **end to end against the docx's own numbers**: the §6
allocation (Product A at 11,800 landed, of which 10,000 goods and 1,800 freight)
followed through the §7 sale (100 units, 1,500,000 revenue, 320,000 gross
profit), and then read **off the rendered table** — `TZS 180,000.00` in the
landed column, which is 100 units at 1,800 each. That is the docx's arithmetic
surviving intact from the delivery screen in phase 4 to a shop's profit
breakdown in phase 7.

Eleven negative controls, all caught: the landed ratio forced to zero; a product
with no split reporting zero rather than unknown; gross profit and average cost
reported for an uncosted product; the service guard removed; the month filter
removed; a voided sale counted; stock valuation treating uncosted products as
free; negative stock reducing the valuation; supplier landed costs dropped; and a
legacy purchase contributing nothing to its supplier.

### A green control that was correct, and a redundant guard kept on purpose

Deleting `if (isServiceLine(item)) continue;` from the drill-down changed
nothing, and the suite stayed green. That turned out to be **right**: the
sale-item builder gives a service line `serviceId` and omits `productId`
entirely, so the `if (!productId) continue;` guard below already excludes every
service. `summariseCostOfGoods()` needs its copy for a reason this function does
not — there the cost lookup runs *before* any productId test, so a service would
count as an uncosted line and report every salon month as incomplete.

The guard is kept, the comment now says why it is redundant here and load-bearing
there, and the test fixture was sharpened to carry a service line with **both**
`kind: "service"` and a `productId` — a shape the builder does not produce, but
the only one that can tell the two guards apart. With it, the control turns the
suite red.

Also caught in passing: one control's patch printed **PATCH DID NOT MATCH** and
was re-run against the real source. That guard has earned its place three phases
running.

### Not deployed

Unchanged, and now the whole programme is in this state: phases 1–7 built,
nothing shipped, the working tree on `20260907a` which has never been served.
Production is still `20260823d`.

The release, when it is authorised, follows `OPERATIONS.md` — branch from the
deployed commit, **rules before client** — and the eight existing shops are told
what changed and that they must take the update, because a service worker holding
the old build will not pick it up on its own. That last point is not theoretical:
this programme hit it twice during local work, in §14 and §15.

---

## 17. End-to-end walkthrough — 2026-09-07

The whole programme driven through the real UI, in a real browser, against a
Firestore emulator loading the **real `firestore.rules`** — including the stage-2
tightening applied the same day. Not a unit test and not a fixture: every step
below went through the actual form, the actual transaction and the actual rules.

**Environment.** Dev server on `:5173` with `app.js` patched to
`connectFirestoreEmulator(..., 8080)` (verified in the served bytes, not
assumed); emulator on `:8080` with `firestore.rules` and `firestore.indexes.json`
loaded via a dev-only config in `.claude/`. Auth and App Check stayed **real** --
the localhost App Check debug token was registered by the owner, and the token
exchange to `content-firebaseappcheck.googleapis.com` returned 200.

### What was exercised, and what it proved

| Step | Result |
|---|---|
| Sign-in | user + store documents written **through the stage-2 rules** |
| Add 3 products via the real form | saved with **no `costPrice`** -- client and tightened rules agree |
| Receive delivery (docx §5 numbers) | live preview reproduced the **docx §6 table exactly** |
| Commit | 1 delivery, 3 purchases, 3 productCosts, 3 costHistory, 3 stockMovements, 1 audit entry, stock 0 → 500/200/100 |
| Sell 100 × Product A | stock 500 → **400**, the docx §7 remainder |
| Profit Report | revenue 1,500,000, COGS **(1,180,000)**, gross **320,000 · 21%** |
| Drill-down | 100 units at 11,800; **1,000,000 goods / 180,000 landed** = 100 × 1,800 |
| Two expenses | `commission` auto-defaulted **direct**, `rent` **indirect** |
| Statement with expenses | 320,000 − 50,000 − 300,000 = **−30,000**, warn tone, complete-data caption |
| Landed panel | 1,800,000 shown, and the expense total stayed **350,000** |
| Stock valuation | A **4,720,000** -- the docx §7 remaining inventory, to the shilling |
| Supplier report | goods 10,000,000 + landed 1,800,000 = 11,800,000, freight counted **once** |

### The invariant the whole design rests on, measured on live data

```
stock at cost   10,620,000
cost of sales    1,180,000
                -----------
                11,800,000   =  what the delivery actually cost
```

Every shilling of the freight, duty, clearing and transport typed into the
Receive Stock screen is now either **on a shelf** or **in cost of sales**. None
of it was lost, none double-counted, and none charged as an operating expense.
That is the sentence in §1 of this document, demonstrated rather than argued.

### Two observations, neither a defect

**A brief empty list after committing a delivery.** The toast fires when the
transaction commits; the list repaints when the `onSnapshot` round-trip lands.
Reading the DOM 2.5s after submit caught the gap. It self-corrects, and it is
ordinary Firestore behaviour -- recorded because it looked like a bug for a
minute and the next person should not spend that minute again.

**The POS tile still read "500 available" immediately after the sale.** Same
cause; the emulator showed 400 and the next render agreed.

### 17.1 Multi-branch transfer — 2026-09-08

A second store, then 100 units of Product A moved from Main Branch to Branch B.
The question this answers is one nothing else had: **does landed cost survive a
branch move?**

| Check | Result |
|---|---|
| Source stock | 400 → **300** |
| Destination product | created in Branch B at **100** |
| Destination `productCosts` | **11,800** — the landed unit cost, carried |
| Cost history | a `transfer-in` entry at 11,800 against Branch B |
| Source cost | unchanged at 11,800 |
| **Purchases** | **still 3** — a transfer is not a purchase |
| Ledger | one `transfer-out` and one `transfer-in` movement |

`DESIGN-purchases.md` §7 is explicit that a transfer must move cost without the
Purchase Book counting the group's buying twice, and that the source's average
must not move. Both hold.

**The invariant, measured:** combined stock at cost was **10,620,000 before the
transfer and 10,620,000 after**. Value moved between branches; none was created
or destroyed.

### 17.2 Offline selling — 2026-09-08

Not simulated with a flag. The emulator was **exported, then killed**, so
Firestore genuinely could not reach a server; the sale was taken; the emulator
was restarted from the export and the write replayed on its own.

That matters because `queueOfflineSale()` does not maintain a queue of its own —
it writes one unawaited `writeBatch` and relies on the SDK's buffer. Faking
`navigator.onLine` alone would have exercised the branch choice and nothing else,
because the batch would have committed immediately against a reachable emulator.

| Check | Result |
|---|---|
| Sale taken with the server down | accepted; stock 200 → **190** locally |
| Banner | *"1 sale is saved on this device and has not reached the server yet."* |
| After the server returned | banner cleared **by itself** |
| On the server | **2 sales**, stock B **190**, two `sale` ledger entries |
| Offline marking | the replayed sale carries **`madeOffline`**; its ledger entry carries **`offline: true`**; the online sale carries neither |
| Sale ids | distinct deterministic `ord_{uid}_{orderNumber}` ids — the dedupe key held |

**And the cost followed it.** The offline sale reached the Profit Report at the
**landed** unit cost, not the supplier price: Product B, 10 units at 17,700 =
177,000, split 150,000 goods / 27,000 landed. This is the case the design most
needed to survive, because `DESIGN-purchases.md` §13f removed `unitCost` from the
sale line — cost is resolved at report time from `costInForceAt()`, so a sale
that was written while offline has to find its cost afterwards. It does.

### 17.3 The whole thing, reconciled

After a landed-cost delivery, an online sale, a branch transfer and an offline
sale that replayed:

```
stock at cost (both branches)   10,443,000
cost of sales to date            1,357,000
                                -----------
                                11,800,000   =  what the delivery cost
```

Statement: revenue 1,750,000 − COGS 1,357,000 = gross **393,000 · 22%**, less
direct 50,000 and indirect 300,000 = net **43,000**. Supplier report still shows
11,800,000 with the freight counted once.

Four different paths into inventory and out of it, across two branches and an
outage, and **not one shilling created or lost**.

### 17.4 Staff roles against the new screens — 2026-09-08

The rules suite proves what the **server** refuses. This is the other half: what
the **client** does about it — a different question, and the one a shop sees. A
screen merely hidden by CSS while its figures sit in the DOM has protected
nothing, and a listener that subscribes for a cashier puts a permission-denied in
the console on every sign-in.

Both role helpers read one string, `state.currentUserRole`, so the **real**
`isOwnerRole()`, `isManagerOrOwnerRole()` and `canOpenView()` are driven here,
not stubs of them, against the real DOM and stylesheet.

**`canOpenView()`, all 24 role × view combinations.** Cashier reaches `pos` and
nothing else. Manager reaches everything except **`profit`**, which stays
owner-strict because the statement exposes buying prices by inference and the
drill-down names one against a selling price outright.

**A wrong role EMPTIES the screen — it does not merely hide it.**

| Screen | Wrong role | Result |
|---|---|---|
| Deliveries | cashier | table and totals **emptied**; no supplier or amount left in the DOM |
| Profit Report | **manager** | statement emptied, note cleared, drill-down panel hidden **and its table emptied**; no buying price left in the DOM |
| Cost reports | cashier | panel hidden; stock valuation, supplier report and expense breakdown all **emptied** |

**And a cashier never asks.** `subscribeToDeliveries()` returns before any query
is issued, empties `state.deliveries`, and its role check precedes the
`onSnapshot` attachment — asserted by index, not by presence. A demotion clears
`state.deliveries`; a promotion re-subscribes.

Five negative controls, all caught: the Profit Report opened to managers; the
deliveries render for a cashier; the drill-down hidden but left in the DOM; the
cost reports shown to a cashier; and every view opened to everyone.

`deliveries.headless.mjs` **139/139**, `landed-costs.test.mjs` **237/237**, and
the role-relevant rules suites green (`rules-deliveries` 104, `rules-purchases`
127, `rules-expenses` 90, `rules-access` 20, `rules-role-propagation` 15,
`rules-multibranch` 20, `rules-audit-log` 88).

**What this does not prove.** No second Firebase account was signed in — Auth is
real here and creating one is the owner's to do. So this covers the client's
gating logic and the server's refusals, but not a real cashier session end to
end. The gap is narrow and worth naming rather than glossing.

### 17.5 Returns and voids against a delivered product — 2026-09-08

**A void was always right. A return was not, and this walkthrough found it.**

**Voids.** Voiding the Product B sale removed 250,000 of revenue and 177,000 of
cost together; the drill-down row disappeared; stock went 190 back to 200.
`summariseCostOfGoods()` skips a voided sale entirely, so both sides fall at
once. The void transaction also nets already-returned units before restoring
stock, so a return-then-void cannot restore twice.

**Returns, before the fix.** Returning 20 of the 100 units of Product A:

| | Reported | Should have been |
|---|---|---|
| Revenue | 1,450,000 | 1,450,000 |
| Cost of goods sold | **1,357,000** | 1,121,000 |
| GROSS PROFIT | **93,000 · 6%** | 329,000 · 23% |

Understated by **236,000** — exactly 20 x 11,800, the landed unit cost of the
returned goods. And because those goods go back on the shelf, they were counted
in stock valuation **and** in cost of sales at the same time:

```
stock at cost   10,856,000
cost of sales    1,180,000
                -----------
                12,036,000   against 11,800,000 ever paid   (+236,000)
```

**The cause.** `summariseSales()` has always netted revenue (`total - refunded`).
`summariseCostOfGoods()` had no equivalent — it used `item.qty`, the original
quantity, and never read `sale.returns`. `saleReturnedQtyMap()` already existed
and the void path already used it; the cost path simply never consulted it.

This **predates the landed-costs programme** — it is in `summariseCostOfGoods()`
from `DESIGN-purchases.md` phase 0/E — but `summariseProductProfit()` was written
in the same shape and inherited it.

**The fix.** Both functions now net returned units. The drill-down nets **both**
sides, cost and revenue, in the same proportion: netting only the cost would
leave a row whose margin disagrees with the two columns beside it.

The map is **consumed rather than read**, because it totals per *product* across
the sale. A product on two lines would otherwise have the whole returned
quantity subtracted from each of them.

After the fix, on the same live data:

```
Sales revenue                    1,200,000
Cost of goods sold                (944,000)
GROSS PROFIT                 256,000 · 21%

stock at cost   10,856,000
cost of sales      944,000
                -----------
                11,800,000   =  what the delivery cost.  Discrepancy: ZERO.
```

**A negative control came back green, and it found a second gap.** Removing the
`Math.min(soldQty, outstanding)` passed against every single-line fixture,
because the `netQty <= 0` guard already floors an over-return. The min is
load-bearing only when a return **spans two lines of the same product**: 20 sold
across two lines with 15 returned must cost 5 units, and without the min the
first line absorbs all 15, is skipped, and the second is charged in full — 10
units, double. That case is now a test, and the control turns it red.

Five controls in total, all biting: the original defect; the map not consumed;
`Math.min` removed; the drill-down ignoring returns; and the drill-down netting
cost but not revenue.

`purchases.test.mjs` **345/345**, `control-panel-math` 104/104,
`refund-identity` 35/35, `offline-selling` 114/114, `deliveries.headless`
139/139, and the rules suites green.

**How the return and void were performed.** Both are gated behind
`verifyOverridePassword()`. That gate is real and it fired — so the two
transactions were written directly to the emulator, replicating exactly what
`confirmProcessReturn()` and the void transaction write. This proves the
**reporting** arithmetic; it does not exercise the authorisation path, which
remains covered by the rules suite and unexercised end to end.

### 17.6 The 80-line delivery cap — 2026-09-08

Phase 3 set `DELIVERY_MAX_LINES` at 80 from arithmetic: five writes a line, plus
the header and its audit entry, against Firestore's 500-write transaction cap.
That sum had never been executed.

**80 lines committed, in one transaction, in 11 seconds.** Eighty products seeded
and received at 10 units each with 800,000 of freight spread by value.

| Written by that ONE transaction | |
|---|---|
| products stocked to 10 | **80 of 80** |
| productCosts | **80** |
| productCostHistory | **80** |
| purchase lines | **80** |
| stockMovements | **80** |
| delivery header + audit entry | **2** |
| **total** | **402** — the predicted `80 x 5 + 2`, against a cap of 500 |

Every invariant held at that size: goods 8,000,000 + landed 800,000 = totalPaid
8,800,000 on the lines, matching the header exactly; 800,000 of freight split
evenly across 80 equal lines at 10,000 each; unit cost 11,000.

**81 is refused, and the message says what to do about it:** *"A delivery can
carry at most 80 products. Record the rest as a second delivery."* The 81st line
is never added to the form. Server-side, `rules-deliveries.test.mjs` pins both
`81` and the old phase 2 ceiling of `100` as refused.

**The invariant across everything, after two deliveries, a sale, a transfer, an
offline sale, a return and a void:**

```
stock at cost   19,656,000
cost of sales      944,000
                -----------
                20,600,000   =  11,800,000 + 8,800,000 ever paid.  Discrepancy: ZERO.
```

The Supplier Report agrees, with the freight counted once per supplier:
Festive Ltd 11,800,000 over 3 lines and 1 delivery; Cap Test Supplier 8,800,000
over 80 lines and 1 delivery.

**One note on method.** The first attempt drove the 80 product selects with a
synthetic `change` event and the preview stayed empty, because the delegated
line listener is bound to `input`. That is the harness being wrong, not the app:
a real `<select>` fires `input` before `change`. Recorded because an empty
preview against a correct goods total looks like an allocation bug for a minute.

### Still not covered

Sign-up itself; a real second-account cashier or manager **session** (the gating
logic and the rules are covered — §17.4 — but not a live staff sign-in); returns
and voids against a delivered product; a delivery at the 80-line cap; and a real
handset, which `OFFLINE-CAPABILITIES.md` still lists as owed.

---

## 18. UI changes and pre-release verification — 2026-09-08

Seven changes were asked for after the walkthrough. All are in, all are covered,
and two **pre-existing live defects** were found while covering them.

### 18.1 What changed

| Change | Where |
|---|---|
| Reports pruned to what a business acts on | Top Customers and Daily Staff Report removed; Order Lookup kept (it is the only route to Return/Refund) and Sold While Offline kept (it names which shelves to recount after an outage) |
| Settings view | `#settings` — Account, Branch & business, Staff, Security, Your data, Language. Every control **moved**, ids unchanged, so existing gating and handlers kept working |
| Duplicate "Add Product" removed | Only `#inventoryAddButton` remains; the topbar button is gone |
| Navigation icons | Inline SVG, `aria-hidden`, with the i18n key moved to an inner `<span>` — `translateStaticDom()` assigns `textContent`, which would have erased the icon |
| Product drill-down | Sales **and** transfers **and** purchases/additions |
| Profit bar chart | Replaced the stock-levels line chart |
| Owner's name at sign-up | New `ownerName`; Settings shows the person, not the Gmail |

### 18.2 The owner's name is not `displayName`

`displayName` holds the **business** name on every account created before this,
and three call sites read it as the business-name fallback. Pointing it at the
person would silently rename those businesses — including on the invitation
email a member receives. So `ownerName` is a new field, read back off the stored
profile on every later sign-in (`cachedProfile` is only ever written from what
`ensureUserProfile()` just wrote, so without the read-back the name would exist
only in the tab that created it). Existing owners are unaffected and keep
ringing sales up exactly as before; a Settings control lets them set one.

### 18.3 Two live defects found while writing the tests

Both were present at `HEAD` — shipped, and visible to all eight shops.

**1. A duplicate i18n key.** `movement.noSales` was defined **twice per locale**,
1,000 lines apart: once as a dashboard category label ("No sales recorded") and
once as the product dialog's empty state ("No sales recorded for this product
yet."). The later definition silently wins in a JS object literal, so the
**Movement classes** panel printed a whole sentence where a two-word label
belonged. Observed live before the fix:

```
Movement classes  0 Fast-moving products  0 Slow-moving products
                  0 No sales recorded for this product yet.
```

Fixed by giving the dialog its own key, `movement.noSalesForProduct`.

**2. Three untranslated VAT options.** `vat.classStandard`, `vat.classZeroRated`
and `vat.classExempt` carried `data-i18n` but were **never defined in either
locale**. `t()` falls back to the key itself, so the VAT-treatment dropdown
showed users the literal text `vat.classStandard`. Confirmed in the browser
before and after; now real words in English and Kiswahili.

Neither is findable by reading the file — one needs the keys counted, the other
needs markup checked against the dictionary. `tests/i18n-dictionary.test.mjs`
now does both, plus en/sw parity and every `t()` call resolving.

### 18.4 Verified against real data

A fresh fixture (product with a recorded cost, then a sale) exercised, in one
pass:

- **Drill-down**: sales row `Robert Bahati · 6 · #8852388463 · Cash`; transfers
  empty-state; `Twiga Cement · 100 · TZS 1,500,000.00 · each TZS 15,000.00 ·
  landed —`. Landed shows as **absent, not zero** — stock added by hand has no
  freight, and zero would claim carriage was free.
- **Owner name** reaching a real sale's attribution.
- **Stock** 100 → 94 on a sale of 6.
- **Profit chart, both directions.** Canvas pixels sampled: with a loss, a red
  bar hangs from the zero line down (top pinned at zero, y=48→244); with this
  profitable fixture, a green bar rises from it (y=50→267). The chart it
  replaced assumed every value was positive.

### 18.5 Release hygiene

Stamp `20260907a` → **`20260908a`** (never deployed, so not burned), and
`CACHE_NAME` `v132` → **`v133`**. The cache name had been left at the live value
while the shell URLs moved — `activate()` deletes every cache whose key is not
`CACHE_NAME`, so the old shell would never have been evicted. Nothing caught it,
because the stamp and the cache name were checked independently and it is the
**pair** that has to move. `deployment-validation.test.mjs` now asserts both
directions.

### 18.6 Cost of an operational mistake

Clearing "leftover" emulator ports killed the Firestore emulator on 8080 that
the local build talks to, destroying the walkthrough tenant (no export, no seed
script). Production and the repo were untouched, and §17's findings stand — they
were measured and recorded when observed — but the fixture had to be rebuilt.
**A seed script is owed**, so a local dataset is reproducible rather than
hand-made.

### 18.7 Suite

**3,500 assertions across 68 suites, all green**, emulator block included and
confirmed to have run. Four new suites: `owner-name` (37), `profit-chart` (51),
`product-history` (35), `i18n-dictionary` (11). Every new suite was checked with
negative controls — the defect reintroduced, the suite confirmed red, the
control reverted.

### Still not covered

Sign-up **itself** (the field and its wiring are covered; a real account has not
been created through it since the change); a live second-account staff session;
the return/void password prompt (`window.prompt` is not implemented in the test
browser); and a real handset.
