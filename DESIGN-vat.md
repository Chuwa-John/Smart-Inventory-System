# VAT — design before any of it is written

Status: design agreed 2026-08-07; all five steps built, tested and deployed the
same day. Phase 24's remaining half.

Rounding was settled earlier in phase 24 and is not revisited here. This is
about whether tax is modelled at all, and the four decisions below were taken
commercially rather than technically.

## The four decisions

1. **VAT is inclusive.** The shelf price is exactly what the customer pays; the
   tax is extracted from inside it. This is how Tanzanian retail quotes prices,
   and it keeps the payable amount a whole shilling, which the drawer requires.
2. **Tax class is per product** — `standard` (18%), `zeroRated`, `exempt`.
   A general duka genuinely has mixed supplies, and zero-rated and exempt are
   different lines on a VAT return.
3. **Fiscalisation-ready, not integrated.** Store what a fiscal receipt needs.
   Do not talk to TRA yet.
4. **Per business, forward-only.** Off by default. A business turns it on with
   its VRN, and sales recorded before that moment are never reinterpreted.

## The rate

18% standard. It lives in one constant, `VAT_RATE`. If TRA changes it, a
business's existing sales must keep the rate they were rung up at — which is
why the rate is written onto every sale rather than looked up when a report is
drawn. A report of last year's trading must not silently re-rate itself.

## The arithmetic

Everything is whole shillings, as established in phase 24.

For an inclusive line amount `P` at the standard rate:

```
vat = round(P × 18 / 118)
net = P − vat
```

`net` is derived by **subtraction, never by its own rounding**. Rounding both
independently is how `net + vat != total` gets shipped, and a VAT return that
does not reconcile to takings is worse than no VAT feature at all.

Zero-rated and exempt lines have `vat = 0` and `net = P`. They differ only in
reporting: zero-rated supplies are taxable at 0% and belong in taxable
turnover; exempt supplies do not. That distinction is the entire reason the two
are separate classes rather than one "no tax" flag.

### Discounts

A discount reduces the amount actually charged, so it reduces the tax. Because
a basket may mix tax classes, a basket-level discount has to be **apportioned
across the lines pro rata** before any tax is extracted — otherwise a discount
on a zero-rated item would reduce the VAT owed on a standard-rated one.

Apportionment is by largest remainder, so the apportioned parts sum to exactly
the discount with no shilling lost or invented. The alternative — apportioning
each line independently and rounding — leaves a residue that shows up as a
total that does not match the sum of its own lines.

### The invariant

For every basket, in every combination of classes and discounts:

```
netTotal + taxTotal == total
```

Not approximately. This is the property the whole feature is judged on, and it
is what `tests/vat.test.mjs` exists to hold down.

## What is stored on a sale

Written at the time of sale, never recomputed later:

- `vatRegistered: true` — this sale was rung up by a registered business
- `vrn` — the registration number in force then, so a receipt reprinted next
  year shows the number the sale was actually made under
- `vatRate` — the rate in force at that moment
- `taxTotal`, `netTotal`
- `taxBreakdown` — `{ standard: {net, vat}, zeroRated: {net}, exempt: {net} }`
- per line: the class it was sold under

`netTotal` is derived at the sale from the total **actually being written**,
not from the tax helper's own total. The two agree today because prices are
whole shillings, but the rules enforce `netTotal + taxTotal == total`, so a
divergence would not be a wrong figure someone notices at month end — it would
be a rejected write and a till that has stopped selling with a customer
standing there. Deriving it makes that impossible rather than unlikely.

A sale from before the business registered carries none of these. It is not
untaxed-at-zero; it is outside the scheme, and reports must say so rather than
showing a confident 0.

## Fiscal receipt numbers — deliberately not ours

A fiscal invoice number must be sequential and gapless per business. This app
cannot issue one, and should not pretend to:

- `nextAutoOrderNumber()` is `String(Date.now()).slice(-10)`. It is unique and
  it is *not* sequential. It was never a fiscal number.
- Making it sequential means a counter document read and then written inside
  the sale transaction. That is exactly the read-then-write that offline
  selling forbids — offline writes are relative (`increment()`) precisely
  because they cannot read first. A gapless sequence and offline selling cannot
  both be true.

Offline selling is shipped and tested through phases A–E. It is not being
traded for a number that nothing currently consumes. **When fiscalisation
arrives, the EFD/VFD assigns the fiscal number** — that is what the device is
for. Our records carry the data the device needs and a stable reference
(`orderNumber` plus the deterministic sale id) to reconcile against.

If TRA integration is ever taken on, this is the decision to revisit first, and
the question to answer then is what an offline sale does about fiscalisation —
not what it does about numbering.

## Deliberately out of scope

- The TRA VFD API, certification, and per-business credentials.
- Backfilling historic sales. Nothing a shop has already filed changes.
- VAT on returns and voids beyond mirroring the original sale's treatment.
- Reverse-charge, imports, and capital goods. A duka does not meet them.

## Order of work

1. The arithmetic, as pure functions, with the reconciliation invariant tested
   exhaustively before anything calls it. ← proves the risky part first
2. Product tax class, and the business-level VAT settings.
3. Firestore rules for the new fields, with the expression budget re-measured.
4. The sale path.
5. Receipt and reports.

Step 1 comes first because the sale path is where this project has been bitten
before, and because a tax calculation that is wrong is worse than absent: it is
wrong on a document a shop is audited on.

## What it cost, in hindsight

All five steps landed on 2026-08-07. Three things were caught by tests rather
than by review, and all three would have failed quietly in production:

- The audit action enum and the closed audit field allowlist in
  `firestore.rules` did not know about `VAT_REGISTRATION_ENABLED` or the fields
  the entry carries. The setting would have saved while its audit record was
  silently rejected, because that write sits in a `try/catch`.
- A version stamp was committed unchanged over a changed bundle, on the
  reasoning that the new code was inert. It is not a deploy marker; see
  OPERATIONS.md.
- `vat-sale-path.test.mjs` shipped with an assertion loose enough to pass when
  the discount was removed from the tax call. Mutation testing found it; the
  check now reads the call's own arguments.

The arithmetic itself, written first and exhaustively, needed no correction.

---

# The VAT record — two-sided

Written 2026-08-24. Decided by the owner the same day: Accounts gets a VAT
record next, and **Accounts is the book while Reports links to it**.

`RESEARCH-accounts.md` §6 marked VAT records "Partly — output only, and
overstated". The output half is unchanged. The input half is newly possible, and
that is the whole reason this is next: `DESIGN-purchases.md` Phase B/C started
capturing `hasFiscalReceipt`, `receiptNumber` and `receiptDate` on every
purchase, and §5.3 of the research is explicit that the six-month input-VAT
window runs from **the date on the receipt**, not the day it was recorded.

Every other book on the list makes a shop tidier. This one gives it money back.

## What it is

One screen, per month, for a VAT-registered business:

    Output VAT      what was charged to customers
    Input VAT       what was paid to suppliers, and is claimable
    ---------------------------------------------------------
    Net payable     output less input

Not a filing. Not a return submitted anywhere. A record the business reads
before it files, and hands to an auditor to make an objection unnecessary
(§11 position 3: reconciliation, not reports).

## Input VAT is a claim, and a claim has conditions

This is the part that must not be generous. An overstated claim is not an
untidy book; it is an underpayment, and §3.7 prices those. Four conditions,
all of which must hold:

1. **The business is VAT registered.** `vatSettings().registered`. An
   unregistered duka has no claim and must not be shown one.
2. **The purchase has a fiscal receipt.** `hasFiscalReceipt === true`. Not
   "there is a number in the box" — asserted, for the reason
   `DESIGN-purchases.md` already gives about that field.
3. **The receipt date is inside the six-month window.** §5.3. Measured from
   `receiptDate`, and a purchase whose receipt date is missing has no provable
   window and is not claimable.
4. **The purchase is on or after the business registered.** Forward-only, the
   same rule as output VAT (decision 4 in this document). A shop cannot claim
   input tax from before it was in the scheme.

Anything failing these is still shown — as *recorded but not claimable*, with
the reason. Silently omitting it would leave the owner unable to see why their
claim is smaller than their spending.

## The open decision: how we know the VAT on a purchase

A purchase records `totalPaid` and nothing about its tax treatment. Three ways
to get from one to the other:

**A. Derive it: `totalPaid × 18/118`.** One line of code, no new field, and
wrong for anything exempt or zero-rated — which in Tanzania includes a great
deal of food. It would overstate a claim by default, which is the direction
that costs the shop a penalty rather than a refund. **Rejected.**

**B. Capture a tax class on the purchase**, prefilled from the product, and
derive from that. Correct per class, one dropdown. But it asks the shopkeeper
to classify a supplier's goods, which is the supplier's job and is already
printed on the receipt they are holding.

**C. Capture the VAT amount printed on the fiscal receipt**, prefilled with the
standard-rated derivation so the common case is one glance and a tab. This is
what an accountant does and what an auditor checks: the receipt states the VAT,
and the claim is that number. A mixed basket — some exempt, some standard — is
handled correctly with no apportionment logic at all, because the supplier
already did it.

**Recommendation: C**, with B's dropdown deliberately not built. The field is
optional; a purchase without it is recorded and not claimable, which is exactly
what a purchase with no receipt already is.

## The output side is overstated, and the screen must say so

L-12: a refund does not reduce the VAT owed on it, because the tax class of a
returned line is unknowable for any sale rung up before 2026-08-07, and
apportioning pro rata would be a plausible-looking wrong answer on a filed
figure.

The consequence is that **output VAT is conservatively high** — the shop is
shown as owing more than it does. That is the safe direction, and it stays.
What is not acceptable is showing that figure without saying so. The screen
names the refund total it did not net out, so the person filing can see the size
of the discrepancy rather than discovering it in an audit.

## It refuses rather than estimating

§11 position 2, and the L-11 precedent already applied on the Profit screen.
`subscribeToSales()` holds the newest 1,000 sales; a month that has fallen out
of that window would produce a VAT return that is **too low**, which is the
dangerous direction for a figure a business files. The screen names the date it
can see back to and refuses the period rather than under-reporting it.

Input VAT has the same exposure through `ACCOUNTS_HISTORY_LIMIT` on purchases,
and refuses on the same rule.

## Reports links, it does not duplicate

Decided 2026-08-24. Reports keeps the operational VAT line it already shows for
a day's trading; the formal monthly record lives in Accounts, and Reports links
across to it. One computation, one place. Two screens computing the same
statutory figure is how they come to disagree, and being shown two different
numbers is the worst thing an auditor can be handed.

## Deliberately out of scope

Unchanged from the list above, plus:

- **Filing.** Nothing is submitted to TRA. §5.5 alone justifies waiting.
- **Reverse charge, imports, capital goods.** Out for the same reason as before,
  and now explicitly out for the input side too.
- **Backfilling.** A purchase recorded before this ships has no VAT amount and
  is not claimable. Forward-only, like everything else in this document.
- **Bad-debt relief**, and any adjustment that is not a purchase or a sale.

## Order of work

1. The claimability rules as pure functions — the four conditions, the window,
   and the period totals — tested before anything renders them.
2. The purchase field (decision C), in rules and both capture paths (restock
   and the Add Product form), with the expression budget re-measured.
3. The screen, including the refusal and the L-12 disclosure.
4. The Reports link.

Step 1 first, for the same reason it was first last time: a tax figure that is
wrong is worse than one that is absent, because it is wrong on a document the
shop is audited on.
