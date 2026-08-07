# VAT — design before any of it is written

Status: design agreed 2026-08-07. Phase 24's remaining half.

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
- `vatRate` — the rate in force at that moment
- `taxTotal`, `netTotal`
- `taxBreakdown` — `{ standard: {net, vat}, zeroRated: {net}, exempt: {net} }`
- per line: the class it was sold under

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
