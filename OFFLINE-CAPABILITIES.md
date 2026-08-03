# What SaviaSmart does and does not do without a connection

Written 2026-08-02 from the code, not from intent. Every line below is traceable
to `app.js`, `sw.js` or `firestore.rules`, and the behaviour is pinned by
`tests/offline-selling.test.mjs`.

This exists so nobody promises a shopkeeper something the software does not do.
A retailer who is told "it works offline", loses signal at 4pm on a Friday and
cannot serve a queue will not care which sentence was technically true.

**The one-line version: a cashier can keep taking CASH sales with no
connection, and they sync when it returns. Everything else that records new
activity still needs a connection.**

> Changed 2026-08-02 (L-9 phase C). This document previously said no sale could
> be taken offline. That was true until cash sales began queueing on the device.
> Credit sales, returns, voids, transfers and shift open/close are still
> refused offline.

---

## Safe to promise

| Capability | Why it works |
|---|---|
| **Taking a cash sale** | Queued on the device with relative stock updates and replayed on reconnect. Stock may go negative if another till sold the same item meanwhile — that is the agreed policy, and the owner is shown it. |
| The app opens and runs with no connection | The service worker caches the app shell (`sw.js`, `CACHE_NAME`), so the interface loads from the device. |
| Yesterday's and today's data is still there | Firestore `persistentLocalCache` with multi-tab support is enabled, so products, sales, customers, stores and shifts are served from the device. |
| Browsing stock, prices and stock levels | Reads come from that local cache. |
| Searching and filtering the catalogue | Runs entirely in the browser against loaded data. |
| Looking up a customer and their balance | Cached like everything else. |
| Reading reports and dashboards already loaded | Computed in the browser from cached sales. |
| Staying signed in through an outage | The session persists locally; a drop does not sign anyone out. |
| Multiple tabs staying consistent | Multi-tab cache coordination is enabled. |
| Nothing is silently lost when a write is refused | A refused sale is refused visibly, with a message naming the real cause. |

---

## Must NOT be promised

**A cash sale is no longer on this list. Everything else here still is.**

| Capability | What actually happens |
|---|---|
| **Completing a CREDIT sale** | **Refused**, with its own message: credit needs the customer's real balance, and exceeding a limit needs an authorisation the proxy has to give. |
| Restocking | Refused until the connection returns. |
| Processing a return or refund | Refused. |
| Voiding a sale | Refused. |
| Transferring stock between branches | Refused. |
| Opening or closing a shift | Refused — so a drawer cannot be reconciled during an outage. |
| Recording a customer payment | Refused. |
| Signing in for the first time on a device | Requires a connection. An existing session survives; a new one cannot be created. |
| A staff member's first sync | Requires a connection. A new cashier's phone cannot be set up offline. |

### Why the rest specifically cannot queue

Every operation above is written inside a Firestore **transaction**. Transactions
need a live connection — unlike plain writes, they do not queue and replay — and
each of them genuinely needs what the transaction gives it. A return must not
restore stock unless the refund is recorded. A shift close computes expected cash
from the sales it is reconciling against, which offline is unknowable. A credit
sale needs the customer's real balance.

A cash sale was moved off that path deliberately (L-9 phase C): it queues as
relative stock updates rather than a read-then-write transaction, so two tills
that both sell during an outage merge instead of overwriting each other. The
online path still uses the transaction, and still refuses to oversell while
connected.

---

## The awkward middle: operations that DO queue

These use plain writes, which Firestore queues offline and replays on
reconnection:

- Adding or editing a product
- Deleting a product
- Creating, renaming or archiving a store
- Setting a customer's credit limit
- Changing store currency or business type
- Settings toggles

**Do not sell this as a feature.** It is real, but it is a trap for the seller:
these are the operations a shopkeeper least needs during an outage, and a queued
product edit landing hours later has its own hazards. `saveProduct()` already
carries a guard against exactly this — a stock figure that was not touched is
not written back, because a queued edit landing later would otherwise reverse
every sale made in between.

The honest framing for a customer: *"Some admin changes will catch up when you
reconnect. Do not rely on it."*

---

## What to say to a customer

**Accurate, and now a much better story:**

> "If your internet drops, your till keeps selling. Cash sales are saved on the
> device and sync the moment you reconnect. You can also still look up stock,
> check prices, find a customer's balance and see your reports. Credit sales,
> refunds and closing a shift do need a connection."

**Still do not say:** "everything works offline", "you can do anything offline",
"stock counts stay accurate offline."

**If asked what happens to stock during an outage, answer honestly:** two tills
selling the same item offline can both succeed, so a count can go negative. The
system shows the owner exactly which sales were made offline so the shelf can be
checked. That is a deliberate choice — a refused sale costs real money, a wrong
count costs a stocktake.

---

## Who this hurts most

A single-branch shop with reliable power and a router is barely affected. The
exposure rises with:

- Mobile-data-only branches
- Rural branches
- Market-day peaks, when connectivity congests exactly when sales spike
- Branches where a staff phone is the till

If the pilot customer is any of these, treat L-9 in `KNOWN-LIMITATIONS.md` as a
release blocker for that customer rather than a general limitation.

---

## Fixed on 2026-08-02

Staff sessions used to degrade badly offline. `resolveBusinessOwnerUid()` forced
an ID token refresh, which needs the network; offline it threw and fell back to
the signed-in user's own uid. For an owner that is harmless — their uid is the
business. For **staff** it pointed every subscription at their own empty tree,
so a cashier reopening the app offline saw an empty shop rather than cached
data, with the inventory screen telling them there was no stock.

It now falls back to the **cached** ID token, which already carries the
`businessOwnerUid` claim, before giving up. Staff keep their employer's cached
data through an outage.

---

## What has been built, and what has not

Built (L-9 phases A–C, `DESIGN-offline-selling.md`):

1. A queue that survives a page reload — Firestore's own, already enabled.
2. Merge rather than overwrite when two tills sell the same item offline.
3. Ledger entries marked `offline`, carrying a delta and no shelf claim.
4. Reconciliation that reads those products as *unknown* rather than as theft.
5. The oversell decision: sell anyway and flag it.

Not built yet:

- **Phase D** — the owner's "sold while offline" view, and an unsynced count at
  the till. Until it exists, the flagging half of *sell anyway, flag it* is only
  in the data, not on a screen. Both are needed before this is sold as a feature.
- **Phase E** — end-to-end replay tests, and a real-device trial with airplane
  mode. Everything asserted so far is structural: that the code queues, does not
  await, and marks entries correctly. **No test yet proves Firestore actually
  replays a queue after a genuine outage on a real phone.** Do that before it
  reaches a shop.

One thing no design fixes: Firestore's queue survives reload and restart, but
**not** an uninstall or a wiped device. Sales unsynced at that moment are gone.
