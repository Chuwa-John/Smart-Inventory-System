# What SaviaSmart does and does not do without a connection

Written 2026-08-02 from the code, not from intent. Every line below is traceable
to `app.js`, `sw.js` or `firestore.rules`, and the behaviour is pinned by
`tests/offline-selling.test.mjs`.

This exists so nobody promises a shopkeeper something the software does not do.
A retailer who is told "it works offline", loses signal at 4pm on a Friday and
cannot serve a queue will not care which sentence was technically true.

**The one-line version: SaviaSmart keeps working offline for everything except
recording new activity. It cannot take a sale without a connection.**

---

## Safe to promise

| Capability | Why it works |
|---|---|
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

**Taking a sale is the headline. Everything else in this table is secondary.**

| Capability | What actually happens |
|---|---|
| **Completing a sale** | **Refused.** The banner reads *"No internet connection. You can keep browsing, but sales cannot be recorded until the connection returns."* |
| Restocking | Refused until the connection returns. |
| Processing a return or refund | Refused. |
| Voiding a sale | Refused. |
| Transferring stock between branches | Refused. |
| Opening or closing a shift | Refused — so a drawer cannot be reconciled during an outage. |
| Recording a customer payment | Refused. |
| Signing in for the first time on a device | Requires a connection. An existing session survives; a new one cannot be created. |
| A staff member's first sync | Requires a connection. A new cashier's phone cannot be set up offline. |

### Why sales specifically cannot queue

Every operation above is written inside a Firestore **transaction**. Transactions
require a live connection — unlike plain writes, they do not queue and replay.
That is a deliberate design consequence, not an oversight: a sale must decrement
stock, write the sale, write the audit entry and write the stock-ledger entry
together or not at all. Making it queue means designing an offline queue with
conflict resolution for stock that moved on another till meanwhile.

`completeSale()` catches the failure, shows the message and **returns**. It does
not fall back to recording the sale locally. That is the correct behaviour today
— see the warning below for why a naive fallback would be worse than the refusal.

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

**Accurate, and still a good product:**

> "SaviaSmart keeps working when your internet drops — you can look up stock,
> check prices, find a customer's balance and see your reports. What it will not
> do is take a sale while you are offline, because it will not record a sale it
> cannot guarantee. The moment your connection is back, you carry on."

**Do not say:** "it works offline", "you can sell offline", "it syncs your sales
later", "your staff can keep selling during an outage."

**If asked directly whether they can sell during an outage: the answer is no.**
Say it plainly. A shopkeeper who hears "no" up front will plan around it. One who
discovers it mid-queue on a Friday afternoon will tell other shopkeepers.

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

## What would have to be built for "works offline" to be true

Not small, and not a switch:

1. An offline sale queue that survives a page reload.
2. Conflict resolution for stock that moved on another till during the outage.
3. Queued `stockMovements` ledger entries, replayed in order — **critical**: a
   local sale that never writes a ledger entry makes the L-2 stock
   reconciliation report the difference as unaccounted stock. A fallback bolted
   onto today's paths would accuse cashiers of theft for every sale made during
   an outage.
4. Reconciliation that understands a replay is pending.
5. A decision on what a cashier is allowed to do when the shelf count cannot be
   trusted — sell into negative stock, or refuse.

Tracked as L-9. Scope it properly before starting; it touches the revenue path.
