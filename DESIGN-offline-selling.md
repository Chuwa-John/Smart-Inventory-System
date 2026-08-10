# Design — offline selling (L-9)

Status: **phases A–G built and tested; F and G awaiting deploy.** Written 2026-08-02,
phases A–E completed 2026-08-04, phases F and G 2026-08-08. The only step outstanding
is the handset trial in §15.

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

Phase E is **written and run** (2026-08-04): `tests/offline-replay.test.mjs`
covers replay, idempotency, the bound, load and the `madeOffline` type against
the emulator — 14 assertions, all passing — and the excluded-path regression
landed in `tests/offline-selling.test.mjs`. It sat unproven for a period because
the emulator could not run in the environment it was written in; that is
resolved.

Phase F (detection) landed 2026-08-08, out of user acceptance testing: **"sales
don't work when the user is offline."** Everything above was reached only when
`navigator.onLine === false`, and that flag does not mean what this feature
needed it to mean. It reports whether the device has a network interface with a
route, so it stays `true` on shop wifi with a dead uplink, behind a captive
portal, and when DNS stops resolving. The UAT console log was the third case:
`ERR_QUIC_PROTOCOL_ERROR`, then run after run of `ERR_NAME_NOT_RESOLVED` against
`firestore.googleapis.com`, while the browser reported being online throughout.

So `isOfflineNow()` said online, the sale skipped the queue, and it went to
`runTransaction()` — which cannot complete without a server. The promise never
settled, `#completeSaleButton` stayed disabled behind it, and the till stopped
selling. Phases A–E were correct and were never reached: the outage they were
built for was one the trigger could not see. Note that §14's list of untested
failure modes already named "a captive portal answering requests with a login
page"; this is that class of failure, arriving by DNS instead.

`isOfflineNow()` now also consults `state.serverReachable`, which is Firestore's
own view via `snapshot.metadata.fromCache` on a one-document listener
(`watchServerConnection()`, on the signed-in user's own profile — readable by
every role). That is the authoritative signal here because it is the same fact
that decides whether a transaction can complete. `includeMetadataChanges` is
required, not incidental: a connection dropping changes no data, so without it
the callback never fires and the till never learns.

The flag is deliberately **one-way until proven** — it starts `null` and only
reaches `false` once a live connection has been seen and then lost. A snapshot
served from cache during ordinary startup is not an outage, and treating it as
one would queue cash sales that could have been transacted against a real stock
check, and refuse credit sales with "cash only" on a good connection. An outage
noticed a moment late costs nothing; a phantom outage costs a sale. A failed or
denied listener returns to `null`, never to `false`, for the same reason.

Phase G (the mid-transaction outage) landed 2026-08-08, immediately after F and
at the shop owner's request. F closes the case where the outage is already known
when the sale starts; G closes the one where it begins *during* the transaction,
which F cannot see. `runTransaction()` needs a server round trip, so a
connection dying after it starts leaves a promise that never settles and
`#completeSaleButton` disabled behind it — the same dead till, reached later.

The sale transaction is now started rather than awaited, and raced against
`SALE_TRANSACTION_TIMEOUT_MS` (10s) by `awaitSaleTransaction()`, which resolves
to `"committed"` or `"unconfirmed"`. A rejection still rejects, so real failures
are reported exactly as before. Ten seconds is well clear of a slow-but-working
sale — one to three on poor mobile data — because giving up early has a real
cost: the fallback is a queued write with no server-side stock check, so a
premature timeout trades the oversell guard for nothing.

On `"unconfirmed"`, a **cash** sale is queued; a non-cash sale is not, for the
§1 reason, and is reported as *unconfirmed* rather than failed — the transaction
may still commit, so "unknown" is the only true statement. The cashier is told
to check the sales list before re-entering.

Two properties make the fallback safe, and both are now pinned by tests rather
than argued:

1. **One id.** The sale id is minted once, above the point where the offline and
   online paths diverge, and passed into `queueOfflineSale()`. This is not
   cosmetic: the `duplicate` case appends `Date.now()`, so an id computed
   separately per path would differ and *both would commit* — the exact
   double-sale the deterministic id exists to prevent.
2. **The loser is refused whole.** `firestore.rules` permits an update to a sale
   only in void or return shape, so a queued `set()` over a committed sale
   fails; because the queued writes are one batch (§6, QA-114), the stock
   decrements fail with it. In the other direction the transaction's own
   `exists()` check throws. Exactly one sale, either way.

`Promise.race` leaves the loser running, so the abandoned transaction carries a
`catch` that logs and files a fault if it later fails — an unhandled rejection
reads to the browser as a crash, and a late failure means the queued fallback is
the only record of that sale.

**The airplane-mode trial on a real handset is still owed, and is the part no
suite substitutes for.** Every write in the replay suite is issued directly, so
Firestore's own persistence layer is assumed rather than exercised. Nothing here
proves a real queue drains after a real outage on a real phone.
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
| E | End-to-end and load tests, then the excluded paths re-verified | **DONE 2026-08-04** — replay suite run, 14/14; real-handset trial still owed, see §14 |

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

The tidier fix is a rule — `!('madeOffline' in d) || d.madeOffline is bool`.
It was deliberately **not** in phase D: that phase was client-only, so no
emulator suite needed re-running, and adding a rule would have meant shipping a
`firestore.rules` change without running the suites that exist to check exactly
that. Filed rather than smuggled in.

**Now done.** The emulator became available on 4 Aug; the rule is in
`validSale()` and `offline-replay.test.mjs` pins all three shapes — a boolean
accepted, a string refused, a number refused. The expression budget was
re-measured on the same run, since `validSale()` is the hottest write in the
schema: a 40-line sale still evaluates and 41 is still refused by the item cap
rather than by exhausting the budget.

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

## 14. Phase E record — written, then proven

`tests/offline-replay.test.mjs` covers the four categories that needed a server:
a queued sale landing against a shelf that moved under it (asserting
`increment()` gives 3 where a read-then-write replay would write 7 and restore
four genuinely sold units); two tills both selling the last unit offline, where
**both** writes must land and the shelf must read −1 rather than 0; the
deterministic sale id refusing a queue drained twice; 150 queued writes draining
without stalling or losing any; and the negative bound still holding at replay
time, which is the one place an absent bound would surface since nothing on the
client re-checks it.

**It has now been run, and passes.** For a period it could not be: the
environment it was written in reached neither the npm registry (403) nor the
emulator jar host (`blocked-by-allowlist`), so `firebase-tools` could not be
installed for Linux and the emulator binary could not be fetched at all. It was
marked unproven rather than quietly counted as passing, which is the only honest
position to hold about a suite that has never executed.

On 4 Aug the emulator became available and it ran: 14 assertions, zero failures,
including the three added for the `madeOffline` rule that §13 had also filed.
The full chain re-ran alongside it — 36 suites, 1,066 assertions, plus 40 in the
two headless browser checks.

Worth keeping the sequence in mind: the suite was correct when written and
proved nothing until it ran. The phase C bug is the argument — sale-breaking,
shipped, with every emulator suite green throughout, because none of them
execute the client sale path.

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

---

## 15. The handset trial — the procedure, and what counts as a pass

Everything else in this document is done. This is the only step left, and it is
the one no suite substitutes for: every write in `offline-replay.test.mjs` is
issued directly, so Firestore's own persistence layer is *assumed* to queue and
replay. Nothing has watched it actually do so on a phone that lost signal.

Run it on a real Android handset on mobile data, not on a desktop with the
network panel throttled. The failure modes that matter here — the SDK evicting a
queue under memory pressure, a background tab being killed mid-queue, a captive
portal answering requests with a login page — do not reproduce on a laptop.

**Before starting.** Confirm the device is on the current build: open the app,
and in the browser menu use Find on Page for the version, or check that the
Sold While Offline panel exists in the owner view at all. The live build as of
2026-08-04 is `app.js?v=20260804b` / `savia-shell-v88`. Sign in as a **cashier**,
not the owner — the cashier is who this is for, and the role gating is part of
what is being tested.

Note the shelf count of one product before you begin. Call it *P*.

### The sequence

1. **Sell one unit of P while connected.** Confirm the shelf count drops by one
   and no offline banner appears. This is the control: if this fails, stop —
   nothing after it means anything.

2. **Turn on airplane mode.** Within a few seconds the red banner should appear
   saying the connection is gone. Wait for it before continuing; if it never
   appears, `watchConnection()` is not firing and the rest of the trial is
   testing something other than what you think.

3. **Sell two units of P, cash, as two separate sales.** Each should complete —
   a receipt, a cleared cart, no error. The shelf count should drop by two.
   **A spinner that never resolves is a failure**, and specifically the failure
   `queueOfflineSale()` was written to avoid by not awaiting the write.

4. **Try a credit sale.** It must be refused, with a message naming credit as
   the reason rather than a generic error. Same for a return and for opening a
   shift. These are excluded by design; a silent failure here is a defect.

5. **Check the queue count.** The unsynced banner should say two. Close the
   browser entirely — not just the tab — and reopen the app, still in airplane
   mode. **The count must still say two.** If it resets to zero, the queue did
   not survive the process being killed, and the feature does not work in the
   only situation that matters.

6. **Turn airplane mode off.** Watch the unsynced count. It should fall to zero
   within seconds of the connection returning. The red banner should clear.

7. **Reload, and check the shelf count of P.** It must be exactly three lower
   than where it started. Four would mean the queue was replayed twice; two
   would mean a sale was lost.

8. **Open the owner view.** *Sold While Offline* should name P with two units.
   The two sales should carry the offline marker. The stock reconciliation must
   **not** report P as a discrepancy — that is phase B's whole purpose, and
   reporting it would be the app accusing the cashier of theft for selling
   during an outage.

### Pass

Steps 3, 5, 6 and 7 all behave as written. Step 7 is the one that decides it:
**three lower, not two, not four.**

### If it fails

Capture, in this order: which step, what the screen said, and the browser
console if reachable (`chrome://inspect` from a desktop with the phone on USB).
The fault log in the owner view may also have caught it — that is what phase 30
built it for, and a fault there with a build stamp is worth more than a
description from memory.

Do not retry before capturing. A second attempt with a queue already in an
unknown state produces evidence about nothing.

### What a pass does and does not establish

A pass means the queue survives a real outage and a real process death on one
device, on one network. It does not establish behaviour across a multi-hour
outage, across two tills queueing simultaneously against the same shelf, or
under the storage pressure of a phone that is nearly full. Those are worth
knowing before this is sold to a customer whose branches run on mobile data,
and none of them are blocking for a pilot with a shop you can telephone.

---

## 16. Phase F and G record — the detection gap, and closing the hang

Phase F is described at the top of this document. Two things belong in the
record rather than the summary.

**Why no suite caught it.** Every offline test in the repo either sets
`navigator.onLine = false` in a harness or issues writes directly against the
emulator. Both start from the premise that the app has already decided it is
offline. Nothing tested *how* it decides, so the one line that made the decision
was the one line with no coverage — the same shape as the phase C defect
recorded in §14, which shipped with every emulator suite green because those
suites assert write shapes and never execute the client's sale code.
`tests/offline-selling.test.mjs` now drives `watchServerConnection()` through
the state machine, including the phantom-outage case, and
`tests/error-messages.test.mjs` compiles the real `isOfflineNow()` rather than
stubbing `navigator` away.

**The remaining hang, and what closing it cost.** If the connection dies *after*
`runTransaction()` has started, that promise does not settle and
`#completeSaleButton` stays disabled until the page is reloaded. F made this
much rarer — an outage lasting more than a second or two is now detected before
the sale starts — but did not remove it. It was recorded here as the owner's
call, because the fallback changes how *online* sales behave, and taken up
immediately: phase G, described at the top of this document.

Two things from building it belong in the record.

**The safety argument had a hole in it.** The version of this section written
before G said the fallback was safe because "both paths derive the same document
id from `staffId` + `orderNumber`". That is true only when `duplicate` is false.
When the cashier has confirmed *record again anyway*, the id appends
`Date.now()` — so the two paths, computing it at two different moments, would
have produced two different ids and both would have committed. A double sale, in
the mechanism whose entire job is preventing one. The id is now minted once
before the paths diverge. The general lesson is the narrower one: an idempotency
argument that says "both paths derive the same id" has to be checked against the
code that derives it, in every branch, not read once and believed.

**Testing the mechanism is not testing its use.** The first version of the G
tests exercised `awaitSaleTransaction()` directly and passed with the call site
deleted from `completeSale()` — the helper was correct and unreachable. The same
was true of the shared id: the assertion matched the first
`queueOfflineSale({ saleId, ...})` call site and never looked at the second,
which is the one that matters. Both were caught by deliberately reintroducing
each defect and confirming the suite went red; neither would have been caught by
reading. Any assertion about this path is worth that check, because the failure
it guards against is silent.
