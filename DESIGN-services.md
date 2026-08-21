# Design — services for bar/restaurant and salon/beauty

Status: **Phases A–D built and tested; nothing deployed.** Written 2026-08-11
ahead of any code; A and B built the same day, C and D on 2026-08-12. Phase E
(the nav tab and the screen for authoring a menu) is the remainder.

Production is on `20260808i` and carries none of this. The working tree is
ahead deliberately — see the deployment note at the end of §9.

Requested by the shop owner: a `bar`/`restaurant` or `salon`/`beauty` store
sells more than stocked goods — a haircut, a plate of food — and today has no
way to price and sell those through the POS at all. Nothing in `products`
should represent them; a haircut has no shelf quantity to reorder against.

This touches `completeSale()`, the return path, the void path, and the offline
queue — the same four places `DESIGN-offline-selling.md` and `DESIGN-vat.md`
each had to reckon with, because every one of them currently assumes a sale
line is a stocked product. That assumption is about to become false for two
business types, and the document exists so the audit of what breaks happens
before the code does, not after.

---

## 1. Scope

**In:** a per-store list of sellable items with no stock — name, price,
category — sold through the same POS cart and the same sale document as
products, for stores whose `businessType` is `bar` or `salon`.

**Out, deliberately:**

| Excluded | Why |
|---|---|
| Any other business type | `duka`, `hardware`, `pharmacy`, `general` stay product-only. Nothing here changes for them. |
| Per-line return of a service | See §6. Undecided, and likely "no" — see the open question. |
| Recipes / ingredient consumption | A plate of food notionally consumes stocked ingredients. Out of scope: that is a second feature (bill-of-materials) layered on top of this one, not a prerequisite for it. |
| Staff commission / tips per service | Common in both industries, not asked for, not built here. |
| Service duration / booking / calendar | This is a price list for the till, not an appointment system. |

---

## 2. Why `products` is the wrong home

`validProduct()` in firestore.rules requires `stockCountInRange(d.quantity)` on
every write. A service has no quantity — not zero, *none*. Zero would be worse
than a separate collection: `stockStatus()` would read it as permanently
out-of-stock, it would show up in every low-stock and reorder surface, and
`reconcileProductStock()` would try to explain a shelf count that was never
real. The category-suggestion templates already key off `businessType`
(`CATEGORY_TEMPLATES`, `app.js:168`) precisely because a salon's list and a
bar's list are different vocabularies; a service is a third vocabulary again,
not a category within the first.

So: a new collection, sibling to `products`.

```
users/{ownerUid}/services/{serviceId}
{
  id, name, price, storeId,
  category?,        // "Hair", "Nails", "Mains", "Drinks" -- free text, same as product.category
  taxClass?,         // present only for a VAT-registered business, same enum as products
  active: bool,      // false hides it from POS without deleting sale history that referenced it
  createdAt, updatedAt
}
```

Owner-write, staff-read scoped by `memberCanAccessStore(storeId)` — the same
shape `validProduct()`/`match /products/{productId}` already uses. This is the
cheap half of the feature: one new collection, one new rules block, no
existing rule touched.

---

## 3. The expensive half: mixed line items on one sale

A sale's `items` array needs a discriminator:

```
{ kind: "product" | "service", ... }
```

`kind` defaults to `"product"` when absent, so every sale ever written — which
has no such field — is read correctly without a migration.

This is where `validSaleItems()` in firestore.rules matters, and it is good
news: it no longer validates item *shape* at all. QA's own comment on it
explains why —

> Per-item content validation used to live here as `validSaleItem()` applied
> across 40 manually unrolled slots. It had to go: Firestore caps a single
> rule evaluation at 1000 expressions, and that unroll blew the cap for any
> STAFF sale of two or more line items.

What remains is `items is list && items.size() > 0 && items.size() <= 40` —
nothing that names `productId` or forbids a new field. **A sale document
carrying `kind` on its items needs no rules change.** The cost is entirely on
the client, in four places that currently assume every item is a product and
were never written to be told otherwise.

### The four call sites, audited

| Site | What it does today | What happens to a service line, unguarded |
|---|---|---|
| `completeSale()` transaction, `app.js:10196` | `productSnaps.forEach` — `if (!snap.exists()) throw new Error(txerror.itemGone)` | **Hard failure of the whole transaction.** One service line in the cart fails every product line beside it. This is the sharpest edge in the whole feature. |
| Return dialog, `app.js:3566` | `productSnaps.forEach` — `if (!snap.exists()) return;` (silently skips) | Tolerant by accident, not by design. The refund total and record still process; only the stock-restoration half is skipped. Acceptable only because a service was never meant to be individually returned — see §6. |
| `undoLastSale()` (void), `app.js:6075` | Same silent skip on a missing product doc | Same as above: the void still marks the sale voided and writes the audit entry; a service line's "stock" restoration is a no-op because there was never any stock. This one is actually the *correct* behaviour already, for free. |
| `queueOfflineSale()`, `app.js:6773` (§5 of `DESIGN-offline-selling.md`) | `batch.update(doc(products, item.productId), {...})` on every item | **Silent failure of the entire batch.** `update()` on a document that does not exist fails outright in Firestore, and this batch is fire-and-forget by construction — the whole point of phase C was that nothing here is awaited. A queued offline sale with one service line in it would fail sale-plus-every-product-line together, and nobody would know until the fault log caught the rejection, if it caught it at all. |

Three of these four need an explicit `kind === "product"` guard added around
the product-ref mapping. One (`completeSale`) is the one that must never ship
without it — a bar ringing up a plate of food next to a bottled beer is the
first sale this feature will ever process, and today that sale throws.

The guard is the same shape in each place: filter cart/sale items to
`kind === "product"` before building `productRefs`, run the existing logic
unchanged against that filtered list, and skip stock/ledger entries for
service lines entirely. Nothing about totals, discounts, tax, or the sale
record itself needs to know the difference — those already operate on
`lineTotal`/`total`, which a service line populates exactly like a product
line does.

---

## 4. POS

One cart, both kinds. Adding a service to the cart is the existing
`state.cart.push({ ...item, qty, sellingPrice })` shape (`app.js:5612`) with
`kind: "service"` added and no `quantity`/`reorderLevel`/`sku` fields to carry.
The quantity-availability check that gates a product's qty input
(`app.js` cart quantity handler, `qtyEditInput` — `nextQty > product.quantity`)
does not apply to a service; a haircut has no ceiling.

Cart rendering (`renderCart()`) needs one branch: a service line shows no
"X of Y available" note, because there is no Y.

---

## 5. Nav and business-type gating

One new nav item, hidden by default and shown per the existing "hide, don't
disable" convention already used for owner-only controls
(`applyStoreOwnerControlsVisibility()`) — re-evaluated on every store switch
alongside `renderStoreSwitcher()`, because `businessType` is per-store, not
per-account. A multi-branch owner with one salon and one duka must see the tab
change when they switch stores, not carry it everywhere or nowhere.

Label swaps by business type, same pattern as `CATEGORY_TEMPLATES`:

```
{ salon: "Services", bar: "Menu" }
```

Everything under the tab — form, table, delete/edit — is identical between
the two; only the string differs.

---

## 6. Returns and voids: the open question

A **void** of a whole sale (wrong item rung up, walked out before paying)
makes sense for a service exactly as it does for a product, and — per §3 —
already works correctly by accident, because the existing code silently skips
stock restoration for a line whose product doc doesn't exist.

A **per-line return** of a service is a different question and I don't think
it has an obvious answer. "Return three of the ten screws" is a real shelf
action. "Return one haircut" is not — the service already happened. The
closest real-world equivalent is a discount or a goodwill refund, which this
system already has a path for (a manager-authorised price edit, or a void of
the whole sale), not a partial return.

**Recommended default: the return dialog does not offer service lines as
selectable at all** — filtered out of `returnableItems` the same way a voided
sale's items already are, rather than accepted and silently no-opped. Silent
tolerance (§3's table, row 2) is an accident worth keeping as a safety net,
not a designed behaviour worth building the UI around.

This is a business decision, not a technical one, and needs an answer before
`openReturnDialog()` is touched.

---

## 7. Tax

If a service carries `taxClass`, it prices and reports exactly like a product
line does — `computeSaleTax()` already operates on
`{ inclusive, taxClass }` pairs (`DESIGN-vat.md` §2) and does not care what
generated them. No new tax mechanism; a service is just another taxable or
exempt line. Whether a haircut is VAT-standard, zero-rated, or exempt in
Tanzanian practice is outside what I know to decide here — default to
`standard`, same as an unclassified product.

---

## 8. What we are accepting

| Accepted | Consequence |
|---|---|
| No recipe / ingredient consumption | Selling "Chicken and Chips" does not decrement chicken or chips from inventory. A restaurant tracking raw ingredient stock separately from menu items is a different, larger feature. |
| No per-line return | Per §6's recommendation. Whole-sale void remains the only undo. |
| `kind` defaults silently | Every historical sale is read as all-product, correctly, with no migration — but also means a bug that fails to set `kind` on a new service line is not caught by any rule; it is caught only by the client always setting it. Worth a client-side test, not a rules one. |
| One list per store, not per business | A store's `businessType` decides which tab shows, but nothing stops a `duka` store from having `services` documents if some other path writes one. Not gated in rules because the value of gating it there is unclear against the cost of another rule clause; revisit if it turns out to matter. |

---

## 9. Phases

- **Phase A (rules + collection).** `services` collection, `validService()`,
  matching read/write rules. No client change yet; testable in isolation
  against the emulator.
- **Phase B (POS + sale write).** Cart accepts service lines, `kind` written
  on every sale item, `completeSale()`'s transaction filters to
  `kind === "product"` before touching stock. This is the phase that must not
  ship without the guard in §3 — it is the one call site that hard-fails today.
- **Phase C (return/void guard, made deliberate).** *Built 2026-08-12.*
  `saleReturnableItems()` drops service lines, which is the single choke point
  both the dialog and `confirmProcessReturn()` read — filtering at only one of
  them would let a manager select a service and then have it silently dropped.
  `undoLastSale()` filters to stock lines before building product refs, and
  indexes that filtered list rather than `sale.items`; the old indexing was
  already wrong the moment a service sat earlier in the basket, restoring the
  wrong quantity to the wrong shelf with nothing raised. A void still voids the
  whole sale, services included, because the sale document's own `voided` flag
  is what removes it from every takings figure.

  One thing found while building it: an empty return list had a single message,
  *"All items on this order have already been returned."* For a services-only
  sale that is not a limitation, it is a false statement — nothing was returned
  and nothing can be. It now has its own message, the same distinction the
  inventory empty state draws between "no stock" and "a filter is hiding it".
- **Phase D (offline).** *Built 2026-08-12.* `queueOfflineSale()` skips service
  lines before the product update and therefore before the ledger entry. The
  design called this the riskiest to skip and that was right: `update()` on a
  document that does not exist fails the write, the batch is atomic, and
  nothing in that function is awaited — so one service line would have taken
  the sale, every stock decrement and every ledger entry down with it, hours
  later, with no toast and nobody watching. The sale document still carries
  every line, services included: what was sold is what was sold, and takings
  must not change because of how stock happens to be accounted.
- **Phase E (nav + UI).** The tab itself, gated per store, labelled per
  business type.

Each phase is independently testable and independently shippable in that
order; B cannot safely ship before A, and D is the one most worth its own
emulator test given how quietly it fails.

**Where A–D leaves it.** Every path that touches money or stock is now guarded,
so this is safe to deploy from a data-integrity standpoint — which is a
different question from whether it is finished. It is not: without Phase E
there is no screen for authoring a menu, so a service can only be created by
writing to Firestore directly. A `bar` or `salon` store would see an empty
"Menu"/"Services" panel in the POS and no way to fill it. Everyone else sees
nothing at all, since `storeSellsServices()` is false for every other type.

Not deployed, at the owner's instruction, until the local build has been
exercised by hand.

---

## 10. Test plan

Nothing ships without these.

- **Rules:** a service document is readable within the assigned store scope
  and refused outside it, matching the existing product-scope tests exactly.
- **Sale construction:** a cart mixing product and service lines produces one
  sale document; `kind` is present and correct on every line; total/tax/
  discount arithmetic is identical to an all-product cart of the same totals.
- **The four call sites, each with a mixed cart:**
  - `completeSale()` commits, decrements stock for product lines only, writes
    no ledger entry for service lines.
  - A return dialog opened on a mixed sale does not offer the service line
    (per §6's default) and correctly restores stock for the product lines it
    does offer.
  - `undoLastSale()` on a mixed sale voids the whole sale and restores stock
    for product lines only.
  - `queueOfflineSale()` on a mixed cart, replayed: the batch commits, the
    product lines decrement, the service lines write no product update — and
    a **negative control** confirming that without the `kind` guard, the
    exact silent full-batch rejection described in §3 reproduces.
- **Nav:** the tab is hidden for every business type except `bar`/`salon`, is
  present for both, and re-evaluates on store switch without a reload.
- **Regression:** every existing sale-lifecycle, VAT, and offline test still
  passes with `kind` absent — the default-to-product path is exercised by the
  entire existing suite, not a new one.
