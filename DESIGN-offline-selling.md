# Design — offline selling (L-9)

Status: **phases A, B, C and D built. E proposed.** Written 2026-08-02.

Phase A (rules only) landed 2026-08-02: `stockCountInRange` permits bounded
negative `products.quantity`, and `stockMovements` accepts an `offline: true`
entry carrying a delta and no chain. Three pre-existing assertions asserted the
old guard and were updated deliberately — see §12.

Phase B (reader only) landed 2026-08-02: `reconcileProductStock()` treats a
product whose newest ledger entry was made offline as **unknown**, never as a
discrepancy. Checking the newest entry alone is sufficient — see §5 for why a
chained entry anchors everything behind it.

Phase C (the writer) landed 2026-08-02: offline **cash** sales are queued with
`increment()` rather than refused. The transaction path is untouched and still
serves every online sale, keeping atomicity and the oversell guard. Non-cash
sales offline are refused with their own message. The offline banner was
rewritten in the same change — it said sales could not be recorded, which
became untrue the moment the queue existed.

Phase D (UX, client only) landed 2026-08-04: the *flag it* half. An unsynced
count with its own banner separate from the connection one, a per-sale
`madeOffline` marker distinct from a transient `pendingSync` marker, and an
owner's "Sold while offline" report grouped by product. Two things were found
while building it and are recorded in §13.

Phase E (2026-08-07) is **written but not yet run**: `tests/offline-replay.test.mjs`
covers replay, idempotency, the bound and load against the emulator, and the
excluded-path regression landed in `tests/offline-selling.test.mjs`. The
emulator cannot run in the environment it was written in, so the replay suite is
unproven until `npm test` is run on a developer machine. The airplane-mode trial
on a real handset is still owed and is the part no suite substitutes for.
Decisions taken: oversell policy = *sell anyway, flag it* (owner's call).

This touches `completeSale()`, which is the most dangerous function in the
system. The document exists so the argument happens before the code does.

---

## 1. Scope

**In:** completing a **cash** sale while offline, and syncing it on reconnect.

**Out, deliberately:**

| Excluded | Why |
|---|---|
| Returns, voids | The two fraud-sensitive paths. Neither is urgent mid-outage — a return can wait ten minutes; a customer at the till cannot. |
| Transfers | Two branches, two stock positions, no way to agree on either while offline. |
| Shift open/close | A close computes expected cash *from the sales it is reconciling against*. Offline, that figure is unknowable, and L-1 already covers how badly a wrong one behaves. |
| Credit sales | A credit limit check needs the customer's real balance, and exceeding it needs the override endpoint, which is online-only. An offline credit sale can silently blow a limit with no authorisation trail. |
| Discounted sales requiring override | Override verification is a proxy call. No proxy, no authorisation. |

Cash sales alone are the overwhelming majority of transactions and by far the
smallest blast radius. Everything excluded above stays exactly as it is today:
refused, with an honest message.

---

## 2. Why it does not work today

`completeSale()` uses `runTransaction`. Transactions perform a server read to do
optimistic concurrency, so they cannot queue — offline they throw, the catch
toasts and returns. Plain writes (`setDoc`, `updateDoc`, `addDoc`) *do* queue in
IndexedDB and replay on reconnect; that machinery is already enabled via
`persistentLocalCache`.

So the change is not "add offline support". It is **stop needing a transaction on
the sale path**.

---

## 3. The mechanism: relative writes

Today, everywhere: *read quantity 12 → write 9*. That requires the read.

Instead: `quantity: increment(-3)`. The client never reads. Firestore queues the
delta and applies it server-side atomically on replay, so two tills that both
sold offline **merge** rather than one overwriting the other. `app.js` currently
uses `increment()` nowhere — this is the substantive code change.

Rules still work: the server evaluates them against the *computed result*, so
`validStockMovementUpdate()`'s `hasOnly` and range checks apply unchanged.

Writes per offline sale, all queued, all replay-safe:

1. `sales/{deterministicId}` — the sale
2. `products/{id}` — `quantity: increment(-qty)`, `sold30/90: increment(qty)`
3. `stockMovements/{auto}` — the ledger entry (see §5)
4. `auditLogs/{auto}` — `SALE_COMPLETED`

---

## 4. Blocker found: the rules forbid negative stock

`countInRange(v)` requires `v >= 0`, and it gates `quantity` on every staff stock
write.

**Consequence as things stand:** a queued offline sale that takes stock below
zero is **rejected at replay time** — silently, hours later, long after the
customer has gone. The cashier sold it, the money is in the drawer, and the
record dies on reconnect. That is the worst failure mode available: undetectable
at the till, and it destroys exactly the reconciliation the ledger exists to
support.

**Required change:** permit bounded negative quantity.

```
function stockCountInRange(v) {
  return v is number && v >= -1000000 && v <= 1000000;
}
```

Applied to `products.quantity` **and to the ledger's `quantityBefore` /
`quantityAfter`**. The second was not in the first draft of this design and was
found while building phase A: once a shelf can be negative, the very next
*online* movement legitimately starts from a negative `quantityBefore`. A
restock of 10 onto a shelf of −4 must be recordable, or the chain cannot
re-anchor after an outage and L-2 stays suspended forever.

Everything else keeps `countInRange` and stays non-negative: `reorderLevel`,
`sold30`/`sold90`, and transfer quantities. A sale line of −3 units, a negative
reorder level, or a negative number of units sold all remain nonsense rather
than signal.

This is a real loosening of a guard, taken knowingly because the alternative is
silently discarding completed sales. Negative stock is a *signal*, not a
corruption: it means the shelf sold more than the system believed it had, which
is precisely what the owner needs to see.

---

## 5. The hard part: the ledger

The current entry carries `quantityBefore` and `quantityAfter`, and the rule
enforces `quantityAfter == quantityBefore + delta`. That chain is what makes L-2
a control: the newest entry states what should be on the shelf, and a difference
is unexplained stock movement.

**Offline, `quantityBefore` is a guess** — read from a cache that may be stale by
the time the write lands. Left alone, after an outage the chain would not match
reality, and the reconciliation would report the difference as unaccounted
stock. **The anti-theft control would accuse cashiers of theft for every sale
made during the outage.**

### Design: an offline entry states less, rather than stating something false

```
stockMovements/{id} {
  productId, storeId, reason: "sale",
  delta: -3,                 // always known
  offline: true,             // new
  // quantityBefore / quantityAfter ABSENT
  saleId, uid, createdAt
}
```

Rule becomes, in effect: *either* the entry carries the full chain and satisfies
`quantityAfter == quantityBefore + delta`, *or* it is marked `offline: true` and
carries neither. It may never carry a chain that does not add up, and it may
never carry a chain while claiming to be offline.

### Reconciliation becomes chain-aware

`reconcileProductStock()` currently returns `matched` / `mismatch` / `unknown`.
It gains one rule, consistent with the restraint already established: **if any
ledger entry for that product since its last chained entry is marked `offline`,
the status is `unknown`, never `mismatch`.**

The chain re-establishes itself naturally: the next *online* movement for that
product writes a full `quantityBefore`/`quantityAfter` pair, anchoring the shelf
again. No repair job, no rewriting of immutable records, no new infrastructure.

**Cost, stated plainly:** during an outage and until the next online movement per
product, L-2's detection is suspended for the affected products. That is the
honest price of selling offline, and it is far better than the alternative of a
control that fires on innocent people. Anything that cannot be checked must read
as unchecked — the same principle as the shift view and the stock view.

---

## 6. Replay safety

Already solved, and worth not breaking: sales use a **deterministic id** derived
from `staffId` + the staff-entered order number, so a retried or replayed
submission resolves to the same document path and Firestore's create-vs-update
semantics reject the duplicate. Offline replay inherits this for free.

`increment()` is *not* idempotent — but it is only ever queued once per sale,
and Firestore replays the queue once. The risk is a client that writes the same
increment twice, which the deterministic sale id does not protect against.
**Mitigation:** the ledger entry carries `saleId`; a replayed increment without a
corresponding new sale document is detectable in reconciliation.

---

## 7. What the people using it see

**Cashier.** The banner stops saying sales cannot be recorded and starts saying
they are being held: *"No internet. Sales are being saved on this device and will
sync when you reconnect."* Each offline sale is marked in the day's list. A count
of unsynced sales is always visible — a cashier must never wonder whether the
sale took.

**Owner.** A *"Sold while offline"* report: sales made during outages, grouped by
product, with the note that stock counts for those products are unverified until
their next online movement. This is the "flag it" half of *sell anyway, flag it*,
and without it the policy is just overselling.

**Both.** Negative stock displays as negative, not clamped to zero. It means
"more was sold than we thought we had" and hiding it defeats the point.

---

## 8. What we are accepting

| Accepted | Consequence |
|---|---|
| Overselling | Two tills offline can both sell the last unit. Stock goes negative. This is what every offline POS does. |
| Suspended detection | L-2 cannot check a product between an offline sale and its next online movement. |
| Loose stock bound | `products.quantity` may be negative within a bounded range. |
| Device loss | Firestore's queue survives reload and restart, **not** uninstall or a wiped device. Sales unsynced at that moment are gone. No design fixes this; it needs saying out loud. |
| No credit, no override offline | Scoped out above. |

---

## 9. Test plan

Nothing ships without these.

- **Rules:** offline entries accepted without a chain; entries with a *wrong*
  chain still rejected; an entry claiming `offline` while carrying a chain
  rejected; negative quantity accepted for `products.quantity` and still refused
  for reorder levels and sale lines.
- **Replay:** a queued sale applied against stock that has since changed lands
  correctly via `increment()`; two simulated tills both selling the last unit
  both land and the result is negative, not lost.
- **Reconciliation:** a product with an offline entry reads `unknown`, never
  `mismatch` — the single most important assertion in this document. Then reads
  `matched` again after the next online movement anchors it.
- **Idempotency:** the same order number cannot produce two sales.
- **Regression:** the excluded paths still refuse offline, still with an honest
  message.
- **Load:** a large offline queue replaying does not stall the till.

---

## 10. Phases

Each is independently shippable and independently safe.

| # | Work | Ships safely because |
|---|---|---|
| A | Rules: `offline` ledger entries, bounded negative `products.quantity`, plus tests | Nothing writes either yet — **DONE 2026-08-02** |
| B | Reconciliation becomes chain-aware — treats offline entries as `unknown` | Must land **before** anything writes an offline entry, or the first outage accuses someone — **DONE 2026-08-02** |
| C | Client: `increment()` on the sale path, queued writes, offline ledger entry | The boundary is already proven by A and B — **DONE 2026-08-02** |
| D | UX: banner, per-sale offline marker, unsynced count, "sold while offline" report | The policy's "flag it" half — **DONE 2026-08-04** |
| E | End-to-end and load tests, then the excluded paths re-verified | **WRITTEN 2026-08-07, replay suite not yet run** — see §14 |

**B before C is not negotiable.** Shipping the writer before the reader means the
first outage produces a screen accusing a cashier of stealing.

---

## 11. Recommendation

Build it, in that order, as its own project rather than folded into QA phases.
It is the single largest gap between what this product is and what its market
needs — but it is on the revenue path, and the failure modes are the kind that
lose a customer permanently rather than annoy them.

Until then, `OFFLINE-CAPABILITIES.md` is the honest sales position.


---

## 12. Phase A record — guards deliberately loosened

Three tests failed when phase A landed. All three were correct before it and
wrong after it, and each was updated with the reasoning inline rather than
quietly flipped:

| Test | Asserted | Now |
|---|---|---|
| `rules-stock-ledger` | a ledger entry cannot record a negative shelf | it can — a restock *after* an oversell legitimately starts from a negative `quantityBefore`. The chain arithmetic is still enforced. |
| `rules-workflow` | a cashier cannot drive stock negative | they can. The field whitelist, the bound, and the price-change guard are unchanged. |
| `concurrency-integrity` | rules are a second line of defence against negative stock | they are not, deliberately. The transactional sale path still refuses to oversell **while online**, which is asserted immediately above it in the same file. |

That last one is the real cost of phase A and should not be glossed: a
defence-in-depth layer was removed. It was removed because it did not defend
anything a connected till was not already refusing, and because offline it
silently discarded completed sales at replay time. But an attacker with a valid
cashier token can now write negative stock directly, where previously the rules
refused it.

What still stands between that and a corrupted shelf: the write is bounded, it
is confined to `quantity`/`sold30`/`sold90`/`updatedAt`/`movementReason` by
`hasOnly`, it is store-scoped, and — from phase C onward — it leaves a
`stockMovements` entry. The compensating control is detection, not prevention,
which is the same conclusion F-4 reached about stock generally.

Revisit if the threat model ever includes a cashier willing to use developer
tools, rather than one willing to pocket cash.


---

## 13. Phase D record — what building the UX turned up

**`madeOffline` is unconstrained by the rules.** Phase C added the field to the
sale document; `validSale()` has no `hasOnly` on sales, so the write passes —
but nothing constrains its *type* either. A client writing `madeOffline: "no"`
would be accepted, and a truthiness check in the report would then mark a normal
sale as rung up blind. Every read of the field in phase D therefore tests
`=== true` explicitly, which closes the practical hole.

The tidier fix is a rule — `!('madeOffline' in d) || d.madeOffline is bool` —
and it is deliberately **not** in this phase. Phase D is client-only, so no
emulator suite needed re-running; adding a rule would have meant shipping a
`firestore.rules` change without running the 15 suites that exist to check
exactly that. Filed rather than smuggled in. It tightens a field every existing
client already writes correctly, so it is safe whenever an emulator run is
available.

**Negative stock had a second consequence nobody had followed.** Phase A allowed
`products.quantity < 0`; `reorderRecommendation()` still read `quantity === 0`
as the empty case, so a shelf at −6 divided straight through and reported a
*negative* number of days until stockout — for the one product most certainly
already out. Fixed to `<= 0`. Worth noting as a pattern rather than a typo: a
loosened bound propagates to every arithmetic that assumed the old one, and
those call sites do not announce themselves.

**The banner's static fallback still carried the phase C lie.** The i18n string
was corrected when the queue landed; the hard-coded English in `app.html` — what
a user sees before `translateStaticDom()` runs, and permanently if it fails —
still said sales could not be recorded. Both are now pinned by test.


---

## 14. Phase E record — written, partly unproven

`tests/offline-replay.test.mjs` covers the four categories that needed a server:
a queued sale landing against a shelf that moved under it (asserting
`increment()` gives 3 where a read-then-write replay would write 7 and restore
four genuinely sold units); two tills both selling the last unit offline, where
**both** writes must land and the shelf must read −1 rather than 0; the
deterministic sale id refusing a queue drained twice; 150 queued writes draining
without stalling or losing any; and the negative bound still holding at replay
time, which is the one place an absent bound would surface since nothing on the
client re-checks it.

**It has not been run.** The environment it was written in cannot reach the npm
registry (403) or the emulator jar host (`blocked-by-allowlist`), so
`firebase-tools` cannot be installed for Linux and the Firestore emulator binary
cannot be fetched at all. The suite is therefore in the same category as the
`madeOffline` rule filed in §13 — written honestly, marked unproven, and owed a
run on a developer machine rather than quietly counted as passing.

**The regression half found a real defect.** `confirmProcessReturn()` caught its
transaction error and toasted a flat "could not process the return" whatever had
gone wrong, so the likeliest cause in this market — no signal — was the one
message it never produced. Every other online-only path already routed through
`describeOperationError()`; this one had been missed. Fixed, and the check that
found it now scans **catch blocks specifically** rather than the whole file: the
first version flagged two bare-string toasts that were entirely correct (a
missing dialog in the markup, an order number that failed validation before
anything was attempted), and a check that cries wolf gets deleted rather than
heeded.

**What no suite here proves.** That Firestore's own queue survives a genuine
outage on a real handset. Every write in the replay suite is issued directly;
the SDK's persistence layer is assumed, not exercised. The phase C bug — a
sale-breaking defect that shipped with every emulator suite green, because they
assert write shapes against the rules and never execute the client's sale code —
is the standing argument for why that trial is not optional.
