# Rollback plan — opening stock gets a ledger entry

Restore point is a TAG, for the reason the other two rollback files record: a
branch pointer follows the work, a tag does not.

## The restore point

| | |
|---|---|
| Tag | `pre-opening-movement` |
| Commit | `a32fb9c` |
| Stamp | `app.js?v=20261028b`, `savia-shell-v196` |
| Deployed to production | 2026-10-28 |

Those are the bytes the live shops were served before this work.

## To roll back

```bash
git checkout pre-opening-movement
```

If it has already reached production:

```bash
git checkout pre-opening-movement
firebase deploy --only hosting
```

Firebase Console → Hosting also keeps a release history and rolls back directly,
which is faster in an incident.

**Burned stamps, never to be reissued:** `20261027a`, `20261028a`, `20261028b`
and now `20261102a`. Restoring `20261028b` restores the bytes that stamp has
always meant, so that direction is safe; shipping *new* bytes needs a new stamp.

## What this changed

One `else if` branch in `saveProduct()`. When a product is CREATED with a
quantity above zero, it now writes one stock movement:

    reason: "adjustment", adjustmentReason: "opening",
    delta: <the opening quantity>, quantityBefore: 0

Nothing else. No rules change, no migration, no new collection, and the
edit-correction branch above it is untouched.

## Why, and what it is NOT

`reconcileProductStock()` anchors a shelf against the newest ledger entry's
`quantityAfter`. A product with no entry at all returns `"unknown"` — correctly
never a discrepancy, but never *verified* either. So a product entered with
stock sat unverified until it next moved, while the same product arriving on a
delivery was verified immediately, because `receiveDelivery()` records a restock
from an empty shelf.

**This is not a bug fix.** Nothing was broken. `"unknown"` is an honest status,
and the reconciliation view deliberately refuses to read a missing entry as
theft — the comment there says a view that did so "would be wrong about the
entire catalogue at once". This closes an asymmetry: two ways of putting stock on
a shelf produced two different reconciliation verdicts.

## What a rollback leaves behind

**Opening movements already written stay written, and that is harmless.** They
are ordinary stock movements with an allowlisted reason, the same shape the
Adjust dialog has always produced. Nothing reads `adjustmentReason: "opening"`
specially. After a rollback, products created *while this was live* keep their
opening entry and go on reconciling as `"matched"`; products created *after* the
rollback go back to `"unknown"` until they next move.

So the rollback is the code only. There is nothing to unwind in the data, and no
state that becomes inconsistent.

## The one judgement call, recorded

Strictly, an opening balance is not a *movement* — there is nothing before it.
The app already treats opening stock as an adjustment in the Adjust dialog
(`adjustmentReason: "opening"`), so recording it is the consistent choice, and
the reconciliation gain is concrete. If that reading is ever rejected, removing
this branch is a clean one-block revert and the stale entries do no harm.
