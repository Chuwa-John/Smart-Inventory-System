# Cashier permissions

Decided with the owner on 2026-09-11. This extends the three roles (owner,
manager, cashier). It does not replace them. A cashier can be given extra
permissions, and can lose three that every cashier has today.

## 1. The owner's decisions

- A cashier with a permission **records, and edits their own records, but
  cannot see the books**. That means no expense book, no purchase book, no
  totals, and no one else's entries.
- **A cashier's delivery waits for approval** from a manager or the owner.
  Stock and cost move only when it is approved.
- The permission list below was accepted as proposed.

## 2. One change to what was asked, and why

*"Edit their own records"* is bounded:

- **Same day only.** The screen allows edits until the local midnight after the
  record was made. The rules allow 24 hours from `createdAt` as a hard ceiling.
  Rules cannot know a shop's time zone, so they must be looser than the screen,
  never stricter.
- **A delivery request is editable only while it is pending.** Once decided, it
  is locked.
- **Never delete.** A request can be *cancelled*, which is a status. An expense
  mistake is corrected by editing it the same day; after that it is the owner's.
- **Every edit is audited** with the previous and new amount.
- **Managers get the same own-record, same-day edit.** Until now managers could
  not edit any expense. Giving cashiers more correction power than managers
  would invert the hierarchy.

Why it is bounded at all: the classic till fiddle is recording a fake or inflated
expense "paid from the till" to cover missing cash. An amount that can be
rewritten at any time later is not evidence. The day's edit window covers honest
mistakes, and the audit entry makes any change visible to the owner.

## 3. The permissions

Stored on `users/{owner}/members/{uid}` as `permissions: { key: bool }`.
**An absent map, or an absent key, means the default.** Every member document
that exists today has no map, so the 8 live shops behave exactly as before.

| Key | Default | What it grants | Enforced by |
|---|---|---|---|
| `recordExpenses` | off | Create an expense in an assigned branch. Read and edit only their own, same day. | rules + UI |
| `receiveDeliveries` | off | Create a delivery **request** (quantities, supplier, reference, optional invoice total). Edit or cancel their own while pending. | rules + UI |
| `processReturns` | off | Item-by-item return on a sale in their branch (capped and monotonic, as for managers). Discount password still required. | rules + UI |
| `viewStock` | off | Inventory screen, quantities only. No edit, restock, adjust, transfer or delete. | UI (products are already readable by every cashier) |
| `viewTodaySales` | off | Today's count and takings for the branch, by payment method. No cost, no profit. | UI (sales are already readable by every cashier) |
| `sellOnCredit` | **on** | Credit as a payment method at the till. | rules + UI |
| `takeRepayments` | **on** | Record a customer payment, and any decrease of a balance. | rules + UI |
| `giveDiscounts` | **on** | Discount controls and price edits at the till. Password still required. | **UI only**, see §5 |

Never grantable to a cashier: voiding a whole sale, stock adjustments and
write-downs, transfers, any cost or profit figure, the purchase or expense
book, deleting anything, staff, settings.

Permissions apply only to **cashiers**. A manager already holds or exceeds every
one of them, and the rules ignore the map for managers. One set of permissions
covers all of a cashier's branches.

## 4. Delivery requests

A new collection, `deliveryRequests/{id}`:

```
storeId, requestedByUid, requestedByName, status: pending|approved|rejected|cancelled,
supplierName, reference?, note?, invoiceTotal?, receivedAt,
lines: [{ productId, name, qty }]  (1..60),
createdAt, updatedAt?,
decidedByUid?, decidedAt?, deliveryId?, rejectReason?
```

- The cashier creates it as `pending`, and may edit or cancel it while pending.
- Approval opens the existing delivery dialog, pre-filled with the request's
  lines, supplier, reference and note. The approver enters costs. `receiveDelivery()`
  reads the request **inside its own transaction** and refuses unless it is still
  pending, then marks it `approved` with the new `deliveryId` in the same commit.
  Two managers approving together cannot both receive it: one transaction
  retries, sees `approved`, and stops.
- The rules require `existsAfter()` on the named delivery for an approval. A
  request cannot be marked approved without the delivery landing in the same
  write.
- Rejection records a reason. Nothing is ever deleted.

A cashier can already restock quantity-only at the rules level; the sale path
needs that product write. That button is **not** offered to a cashier, so
deliveries go through approval as decided.

## 5. What the rules cannot enforce, stated plainly

- **Discounts.** A sale's price per line is not visible to the rules; they stopped
  iterating items to stay under the 1000-expression cap. A refusal on
  `discountType` alone could also reject an *offline* cash sale on replay, hours
  later, if the permission was removed in between. That is the silent loss of a
  completed sale this codebase refuses everywhere else. So `giveDiscounts` hides
  the controls, and the discount password remains the control, as before.
- **`viewStock` and `viewTodaySales`** unlock screens over data a cashier's till
  already reads. They are conveniences, not a security boundary.
- **Audit entries.** A cashier may write `EXPENSE_RECORDED` and the other new
  actions whether or not they hold the permission. An entry written without the
  permission is noise in an owner-only log, not access.

`sellOnCredit` **is** enforced at sale create. It is safe because credit sales
are refused offline, so no queued sale can be rejected on replay.

## 6. Getting permissions onto a member

- **At invite:** after choosing Cashier and branches, the dialog shows the
  permissions. The proxy keeps only known keys with boolean values, stores them
  on the invite, and copies them to the member document on acceptance.
  **The proxy must be deployed before the hosting build.** An old proxy ignores
  the field, and the cashier would arrive with defaults.
- **Afterwards:** a Permissions button on the staff roster. The owner writes the
  map directly; the rules already let an owner write member documents.
- **Live:** `subscribeToOwnMembership()` reacts to a permissions change as it does
  to a role change. It resubscribes, re-renders, and moves the cashier off any
  screen they may no longer open.
