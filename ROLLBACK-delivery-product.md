# Rollback plan — a delivery can create its own product

The restore point is a TAG, not a branch, for the reason `ROLLBACK-cogs.md`
records: `git checkout main` is only a rollback while `main` still points at the
live build, and a fast-forward merge of this branch makes `main` *become* the
new work. A tag cannot drift like that.

## The restore point

| | |
|---|---|
| Tag | `pre-delivery-product` |
| Commit | `d10965d` |
| Stamp | `app.js?v=20261012a`, `savia-shell-v193` |
| Deployed to production | 2026-10-12 |

Those are the bytes currently serving the live shops.

## To roll back

```bash
git checkout pre-delivery-product
```

Instant, not destructive, and correct whether or not `delivery-creates-product`
has been merged. The new work stays wherever it already is.

If the working tree is dirty and you want the live state back exactly:

```bash
git reset --hard pre-delivery-product
```

## If it has already been deployed to production

Git and Firebase Hosting are separate, so restoring the code is half of it:

```bash
git checkout pre-delivery-product
firebase deploy --only hosting
```

Firebase Console → Hosting keeps a release history and can roll back directly,
which is faster in an incident and needs no working checkout.

**The stamp is safe to roll back to.** Restoring `20261012a` restores the bytes
that stamp has always meant, so no browser ends up holding one stamp for two
different builds.

**Two stamps are already burned and must never be reissued.** `20261027a` was
deployed to the preview channel and then superseded; `20261028a` is the current
build. If this work is fixed and re-shipped again it needs a new stamp.

## What there is to undo, and what there is not

Nothing in this change alters an existing document, adds a collection, or
migrates anything. Rolling the code back is the whole rollback.

What it does add is a path that WRITES a product document from inside the
delivery transaction. So:

- **Products created while it was live stay.** They are ordinary product
  documents — the same shape `saveProduct()` writes, minus the fields a delivery
  cannot know (brand, barcode, shelf, reorder level, unit, tax class). They keep
  working after a rollback, in the till and in every report, and they can be
  edited from Inventory like any other product.
- **Their stock, cost and purchase records are unaffected.** Quantity, the
  weighted average in `/productCosts`, the `/productCostHistory` entry, the
  purchase line and the stock movement were all written by the code that was
  already there, in the same transaction, exactly as they are for a delivery
  against an existing product.
- **No rules were changed, so none need reverting.** `allow create` on
  `/products` already admitted an owner or an assigned active manager through
  `memberMayCreateProduct()`. `tests/delivery-creates-product.test.mjs` asserts
  that against `firestore.rules` rather than assuming it, so if the rules are
  ever tightened the suite fails instead of a shop's delivery.

The only thing a rollback takes away is the ability to create a product from the
delivery form. A shop would be back to entering it in Inventory first — the
double entry the change exists to remove.

## Also in this build (same rollback, same tag)

Adding a product in Inventory now prefills Quantity as `0` and explains that the
box is opening stock. That is a form default and a note; there is nothing to
undo beyond the code.

## One defect this work already hit, and what it means for old records

Found on the preview on 2026-10-28, before any of this reached production.

The created product did not carry its own id as a FIELD, only as its document
path. `productImmutableFieldsUnchanged()` compares
`request.resource.data.id == resource.data.id` on every OWNER update, so the
owner could not sell or edit the product -- while a cashier still could, because
`memberMayUpdateProduct()` does not call that function. The delivery itself
succeeded, because the create path never calls it either; the refusal only
surfaced later, at the till.

Fixed by writing `id: line.productId` into the payload, which is what
`saveProduct()` has always done.

**A product created by the BROKEN build stays broken.** The missing field is not
added retroactively by anything. Such a product can still be sold by a cashier
and can be deleted by the owner, but the owner cannot sell or edit it. Only one
such record exists -- "Sunlight Dishwash 400ml" on the test tenant -- because the
broken build never left the preview channel. Deleting and re-receiving it is the
remedy if one is ever found.
