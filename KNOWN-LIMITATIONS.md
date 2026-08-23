# Known limitations and technical debt — SaviaSmart

Things deliberately not fixed, and why. Every entry is a conscious tradeoff
rather than an oversight; anything discovered and left open belongs here on the
day it is discovered, not on the day someone remembers it.

Each entry records: what the limitation is, why it was not fixed now, the risk
level, the workaround or compensating control that stands in for the fix, and
the milestone the real fix is planned for.

Status keys: **OPEN** no fix scheduled · **PLANNED** fix has a milestone ·
**INHERENT** cannot be fixed at this layer, compensating control only.

This file is excluded from Firebase Hosting and is not served publicly.

---

## L-1 Expected cash in a shift close cannot be proven — **INHERENT**

**Limitation.** A shift is reconciled with

```
variance     = countedCash - expectedCash
expectedCash = openingFloat + cashSales - cashRefunds + cashRepayments
```

`firestore.rules` now pins `openingFloat` to the opening document, requires
`expectedCash` to equal the derivation above, and requires `variance` to equal
`countedCash - expectedCash` (`shiftExpectedCashIsDerived`, and
`tests/rules-shift-variance.test.mjs`). What it still cannot do is prove
`cashSales`. Firestore rules authorise one write at a time and cannot aggregate
a shift's sales, so the figure arrives from the client and no arrangement of
rules will change that.

A cashier who is willing to lie can therefore still understate `cashSales`,
write the matching `expectedCash`, and close a short drawer as balanced.

**Why not fixed now.** The real fix is to derive `expectedCash` server-side —
the proxy sums that shift's cash sales with the Admin SDK and writes the closing
document, after which rules pin it the way they pin `openingFloat`. That is a
new endpoint, a new failure mode at close of day (a till that cannot close
because the proxy is unreachable is worse than a till that closes with a figure
the owner can check), and an offline story that has to be designed rather than
assumed. It did not fit this release.

**Risk: Medium.** Bounded by the fact that the lie is now *falsifiable*. Before
the rules change, a cashier could write `variance: 0` directly and nothing
contradicted it — the number that judged the drawer was chosen by the person
holding it, and no other record disagreed. Now any concealment must be spent in
`cashSales`, which is reconcilable against the `sales` collection for the same
store and window. The attack moved from invisible to detectable.

**Compensating control — BUILT.** The owner's shift history now carries an
"Against sales" column: for each closed shift it recomputes the expected cash
from the sales record between `openedAt` and `closedAt` and names any
divergence (`reconcileShiftCash()`, `tests/shift-reconciliation.test.mjs`).
A shift closed on understated figures reads *"50,000 unaccounted"* rather than
*"Balanced"*.

**Till-paid expenses, 2026-08-21.** An expense recorded with
`paidFrom: "till"` is money that left the drawer, and `reconcileShiftCash()`
does not read it. The mechanism above is unaffected — `unaccounted` compares
stated cash sales against cash sales recomputed from the `sales` collection, and
an expense touches neither term, so this control raises no new false positive.

What changed is the wording a shop now sees on two screens. The Expenses screen
says *"Counted separately — the drawer will be short by this much"*; a shift
close says *"{amount} unaccounted"*. Same shillings, opposite framings, and
neither screen points at the other. Before Phase A a drawer raid was simply
undocumented; it is now documented in a collection the cash-control surface does
not consult, and shops are being encouraged to record more of them. Wiring
`paidFrom: "till"` into expected cash is its own phase — `DESIGN-purchases.md`
§8.3 — precisely because this function is the cash-control surface and must not
gain a term as a ride-along.

Two things bound what this proves:

- **It only reports what it can see.** The sales subscription holds the newest
  `SALES_HISTORY_LIMIT` sales, so a shift older than that window shows "not
  checked", never a discrepancy. A tool that accused a cashier because the app
  had not loaded far enough back would spend the owner's trust on false
  positives and then be ignored on the true one. Both states render the same
  neutral mark deliberately — an unverified shift must never read as a
  verified one.
- **It is detective, not preventive, and it is only as good as the reading.**
  Nothing forces an owner to look at the column.

**Remaining risk: Low**, down from Medium. Concealment now requires
understating `cashSales`, which leaves a visible divergence against the sales
collection on the owner's own screen.

**Planned:** the equivalent stock view for L-2 — same report shape, different
collection.

---

## L-2 A stock decrement cannot be bound to a sale — **INHERENT**

Carried from `SECURITY-AUDIT.md` F-4, recorded here so the whole set is in one
place. Rules authorise each write independently and cannot verify that a stock
decrement was accompanied by a matching sale document in the same transaction,
so a cashier can write stock down without recording a sale.

**Risk: Low**, and unchanged. **Compensating controls:** the sale record and the
`auditLogs` entry, both required and both owner-readable, plus physical stock
reconciliation. `movementReason` exists to make the audit trail say *why* stock
moved rather than showing a bare number change.

Direction-coupling (rejecting a "restock" that decreases stock) was implemented,
tested, found to be both evadable and outage-prone, and removed. See F-4 for the
full reasoning — it is a good record of why the obvious fix was the wrong one.

**Why there is still no reconciliation view — investigated 2026-08-02.** L-1's
equivalent was buildable because a shift carries its own opening float and a
closing count, so the sales record can be compared against a stated figure.
Stock has no such anchor. A product document holds a current `quantity` and
nothing else: no opening balance, no movement history, no snapshot. Expected
stock is `baseline + restocks - sales + returns ± transfers`, and there is no
baseline to start the sum from, so "what should be on the shelf" is not
derivable from the data that exists.

`sold30`/`sold90` cannot substitute. They move in lockstep with `quantity` under
the same `validStockMovementUpdate()` rule, so anyone writing stock down to
cover a shortfall adjusts both in one write and the two still agree. Comparing
them proves nothing about the shelf.

Closing this properly needs an append-only `stockMovements` collection — one
document per movement, carrying delta, reason, actor and a link to the sale or
transfer that caused it. That turns the shelf into a running total that can be
replayed and compared against a physical count. It is a schema addition and a
write on every stock change, so it is a deliberate piece of work rather than a
view someone can add to a panel.

**Compensating control — BUILT 2026-08-02.** The `stockMovements` ledger now
exists. Every one of the seven paths that moves stock — sale, restock, return,
void, transfer out, transfer in, and an owner's counted correction — writes an
append-only entry recording the shelf on both sides of the movement, inside the
same transaction as the movement itself.

The chain is what makes it a control rather than a log: `firestore.rules`
requires `quantityAfter == quantityBefore + delta`, so the newest entry for a
product states what should be on the shelf. Stock that moved without an entry
leaves the product's own quantity disagreeing with the ledger by exactly the
amount that went missing, and the owner's movement panel names it.

Prevention is still not reachable, exactly as F-4 says — a client can decline to
write the entry. What it can no longer do is decline invisibly.

Three limits worth stating:

- **Everything predates the ledger.** On the day this ships no product has an
  entry, so the whole catalogue reads as unchecked and stays that way until each
  item next moves. "No entry" renders as nothing, never as a finding.
- **The view reads the newest 500 entries.** A product whose last movement falls
  outside that window is unchecked, not discrepant.
- **It is detective, and only as good as the reading.** Nothing forces an owner
  to look.

**Remaining risk: Low**, down from Low-but-unmitigated. The physical stocktake
F-4 names is still the ultimate check; this makes the common case visible
without one.

**Planned:** nothing outstanding. A future refinement would replay the full
delta chain rather than comparing only the newest entry, which would locate
*when* a shelf diverged rather than only that it has.

---

## L-9 The till cannot sell without a connection — **LARGELY CLOSED, unproven on a real device**

**Status 2026-08-04.** Phases A–E of `DESIGN-offline-selling.md` have shipped. A
**cash** sale is now queued on the device and replayed on reconnect; the cashier
sees a count of sales still waiting to reach the server, and the owner gets a
*Sold While Offline* report naming the products whose counts can no longer be
trusted. Credit sales, returns, voids, transfers and shift open/close are still
refused offline, honestly and by design.

**What keeps this entry open rather than resolved.** Phase E's replay,
idempotency, bound, load and `madeOffline` tests are written and have now **run
and passed** (`tests/offline-replay.test.mjs`, 14/14). They sat unproven for a
period because the environment they were written in could not reach the emulator
jar host; that is resolved.

**What remains is the only thing left.** Nothing has proved that Firestore replays a real
queue after a real outage on a real phone.** Every write in that suite is issued
directly; the SDK's persistence layer is assumed rather than exercised. That
trial is the difference between "the code is shaped correctly" and "the feature
works". Until it is done, do not sell this to a customer whose branches run on
mobile data. The procedure and its pass criteria are written out in
`DESIGN-offline-selling.md` §15 — follow it as a checklist rather than
improvising, because step 7 (the shelf exactly three lower) is the one that
decides it and is easy to eyeball wrongly.

**The original limitation, for context.** A sale required a Firestore
transaction. Transactions do not queue offline the way plain writes do, so when
the connection dropped the sale was refused: the banner read *"No internet
connection. You can keep browsing, but sales cannot be recorded until the
connection returns."* The `local-` sale path in `app.js` was never an offline
mode — it exists for the case where Firestore is absent entirely (no config,
signed out), which is demo mode, and it still is.

**Why this entry did not exist until now.** It was not merely undocumented — it
was documented backwards. `SECURITY-AUDIT.md` F-4 described offline selling as
"a headline feature of this product" and used that to rule out a server-mediated
sale endpoint. Corrected there on 2026-08-02, and pinned by
`tests/offline-selling.test.mjs` so the claim cannot drift back.

**Risk: HIGH for the market this serves.** Tanzanian mobile connectivity is
intermittent by default. A queue of customers and a till that will not ring up a
sale is the most visible failure this product can have, and it is the one
failure a shopkeeper cannot work around — they can count cash by hand, but they
cannot reconstruct what the app refused to record.

**What is right about it as it stands.** The refusal is honest and immediate:
the message names the real cause ("no internet connection", not the SDK's
"unavailable"), the banner is in both languages, and nothing is silently lost.
An offline mode that recorded sales locally would be worse than this until it is
designed properly — see the trap below.

**The trap for whoever builds offline selling.** Local sales never reach
Firestore, so they write no `stockMovements` entry. The L-2 reconciliation
compares a product's quantity against the newest ledger entry and reports the
difference as unaccounted stock. A well-meant offline fallback bolted onto the
existing paths would therefore start **accusing cashiers of theft** for every
sale made during an outage. Offline selling and the stock ledger must be
designed together: queued sales need queued ledger entries, replayed in order,
with the reconciliation aware that a replay is pending.

**Planned:** designed 2026-08-02 — see `DESIGN-offline-selling.md`. Scope is
cash sales only; returns, voids, transfers, shift close and credit sales stay
online-only and refuse honestly. Oversell policy agreed with the owner: sell
anyway and flag it, because a refused sale costs money a wrong count does not.

The design surfaced a blocker that would have made a naive attempt worse than
no attempt: `countInRange` forbids negative stock, so a queued offline sale
taking stock below zero is rejected **at replay time**, silently, hours after
the customer has left. Selling offline therefore requires a bounded-negative
`products.quantity`, taken knowingly.

Phase order is load-bearing: reconciliation must learn to treat offline ledger
entries as *unknown* **before** anything writes one, or the first outage
produces a screen accusing a cashier of theft. It was built in that order.

**Built 2026-08-02 to 08-04.** A (rules), B (reader), C (writer), D (the
flagging UX). Phase C shipped alongside a genuinely sale-breaking bug in the
stock ledger that no suite caught, because the emulator suites verify write
shapes against the rules and never execute the client's sale code — see the
2026-08-04 entry in `DESIGN-offline-selling.md` §13 and the structural guards
now in `tests/offline-selling.test.mjs`. That blind spot is itself an argument
for phase E rather than a reason to consider this closed.

---

## L-3 The audit log is append-only but not tamper-evident — **OPEN**

Carried from `SECURITY-AUDIT.md`. Rules forbid update and delete, and as of the
Phase 2 QA pass `action` is a closed, role-scoped set with a closed document
shape (`tests/rules-audit-log.test.mjs`) — so no client can forge or flood
entries. But the project owner has full Firebase console access and can delete
entries out of band. Append-only is not the same as tamper-evident.

**The money collections, 2026-08-21.** `purchases` and `expenses` are the only
money-touching collections in the schema that can be **deleted** — `sales`,
`stockMovements` and `auditLogs` all refuse it outright. That is a deliberate
decision by the owner, because a mis-keyed delivery is a human error and a shop
must be able to remove it, and it is why deletion is audited: `EXPENSE_RECORDED`,
`EXPENSE_UPDATED`, `EXPENSE_DELETED` and `PURCHASE_DELETED` are written by
`moneyAuditEntry()` in the same batch as the change itself, so the record and
the evidence land together or not at all
(`tests/rules-audit-log.test.mjs`, `tests/expenses.test.mjs`).

For a period of about a day between Phase A and B2-b, neither collection wrote
any audit entry at all, which an adversarial audit found. It is closed. What it
does **not** close is this entry's own point: the trail records that a deletion
happened, and the owner can still delete the trail from the console. Append-only
is still not tamper-evident, and for an audit pack those are not the same claim.

**Why not fixed now.** True tamper evidence needs hash-chaining or off-site log
shipping. Both are real work, and the threat model is the owner attacking their
own records, which is a different and much weaker motive than staff attacking
them.

**Risk: Low** for the owner-operated single-business case this product serves
today. It rises if SaviaSmart is ever used where an owner must prove their books
to a third party — a lender, an auditor, a tax authority, a buyer. Revisit this
entry the first time a customer asks whether the logs are admissible.

**Planned:** unscheduled.

---

## L-4 Two proxy-dependent test files are not run in CI — **OPEN**

`tests/invite-preview.test.mjs` and `tests/api-contract.test.mjs` boot the real
proxy against the emulator. They pass locally but were not executed during the
2026-08-02 QA pass, because the sandbox running it had no egress and
`proxy/server.js` never reached `app.listen`.

**Cause — corrected 2026-08-02.** An earlier version of this entry blamed
blocked egress and proposed deferring "whatever network call blocks
`app.listen`". That was wrong, and would have sent someone hunting a bug that
does not exist. The proxy makes no network call at startup: the credential
branch only warns when `FIREBASE_SERVICE_ACCOUNT_KEY_BASE64` is absent, and
`createRemoteJWKSet` is lazy.

The real cause is disk latency. When `proxy/node_modules` is read across a
cloud-synced mount, module loading alone takes `express` 15s, `firebase-admin`
11s, `jose` 10s — the imports complete, but not before the test's readiness
wait gives up, so the proxy looks hung when it is merely slow. On any normal
local filesystem — a developer machine, or the CI runner — it boots and both
files pass.

**Risk: Low.** Lower than first recorded. These two are the only files needing
a spawned proxy, and they are coupled to the rest of the codebase by a handful
of static string assertions (that `app.js` still destructures `authorized`,
that `accept-invite.js` still branches on `ok`/`code`, that the proxy still
emits those discriminators). Those can be, and have been, checked directly
without booting anything.

**Compensating control:** run `cd tests && npm test` in full on a developer
machine or via CI before every rules or proxy deploy — never judge a change on
the non-emulator subset alone. Push regularly rather than in batches, so CI is
verifying one change at a time instead of six.

**Planned:** nothing. This is an environment property, not a defect. Recorded so
the next person who sees the proxy "hang" recognises it as slow I/O and does not
go looking for a network bug.

---

## L-6 The access-during-grace audit entry is documented but never written — **CLOSED 2026-08-02**

**Limitation.** `firestore.rules` explains that `auditLogs` is deliberately not
gated on `tenantNotFrozen()` because "the deletion request itself, the restore,
and any access attempt during the grace period are exactly the events an erasure
audit needs". `rules-deletion.test.mjs` asserts a frozen owner can still append
an entry, and passes.

But nothing writes it. `ACCOUNT_ACCESS_DURING_GRACE` appears only in
`firestore.rules` and in two test files — never in `app.js`, never in
`proxy/server.js`. The permission exists, the test exercises the permission, and
the writer was never built, so the evidence trail the deletion policy describes
is empty in production.

Found by `tests/audit-actions-agree.test.mjs` on its first run, comparing the
rules enum against what the client can actually emit. It was invisible before
that, because the test asserting the capability supplied the action name itself.

**Fixed.** `recordGraceAccess()` writes the entry once per sign-in when the
owner's profile carries `status: "pending_deletion"`, latched so a reload does
not turn an evidence trail into a flood. Owner-only, matching the rules enum —
staff accounts under a frozen tenant have already been disabled and had their
tokens revoked by the deletion request. A failure to record is swallowed with a
warning: an evidence entry must never be the reason someone cannot get back into
the account they are trying to recover.

**The decision taken, recorded for review.** "Access" means *a sign-in while
frozen*, not every write attempt and not every render. One entry per session
answers the question the trail exists to answer — did someone come back during
the grace period — without volume. If an auditor ever needs finer granularity,
that is a deliberate change rather than a gap.

**How it hid.** `rules-deletion.test.mjs` asserts a frozen owner can append an
audit entry, and passes — because the test supplied the action name itself.
Coverage of the permission looked like coverage of the behaviour.
`tests/audit-actions-agree.test.mjs` now compares the rules enum against what
`app.js` can actually emit, which is what surfaced it, and it fails if a writer
disappears again.

---

## L-7 `sold30` and `sold90` are lifetime counters with windowed names — **OPEN**

**Limitation.** The stored fields are named for 30- and 90-day windows they have
never had. Every write adds on a sale and subtracts on a return or a void;
nothing decays them, anywhere. As lifetime net-sold totals they are correct —
only the names lie.

**Fixed where it mattered (2026-08-02).** Everything that made a decision on
them now computes the real window from the sales record via
`unitsSoldInWindow()`: the movement chart, the dashboard fast/slow/no-sales
counts, restock ranking, and the product snapshot sent to the AI advisor. That
last one mattered most — the model was being handed a multi-year total under
the name `sold30` and asked about recent demand.

Before the fix, "fast moving" (`sold30 >= 50`) was a label a product could only
ever gain, so given enough trading every product earned it and the chart stopped
distinguishing anything. It failed worst for the shops trading longest.

**What remains.** The field names in Firestore still say `sold30`/`sold90`.
Renaming means a migration and a `firestore.rules` change, since
`validStockMovementUpdate()` names these fields explicitly. The counters also
stay in the documents deliberately — the rules validate stock writes against
them.

**Risk: Low.** No live decision reads them as windows any more. The risk is that
the next person to use them believes the name.

**Workaround.** Use `productUnitsSold(product, days)` for anything time-based.
`tests/stock-movement-window.test.mjs` fails if a classification site goes back
to reading the raw counter.

**Planned:** rename to `soldTotal`/`soldTotalNet` with a migration, unscheduled.

---

## L-8 The products subscription is unbounded — **OPEN**

**Limitation.** `subscribeToProducts()` streams the whole catalogue and holds
it in memory, and every render walks it. It carries no `limit()`, where sales
takes 1000, transfers 2000, shifts 20 and the stock ledger 500.

*Corrected 2026-08-21.* This entry used to open "every other collection the
client subscribes to carries a `limit()`". That stopped being true when
`expenses`, `purchases` and `productCosts` arrived — all three are unbounded
too. They are **not** covered by this entry, because L-8's reason for leaving
products unbounded does not transfer to them. See **L-13**.

**Why not fixed now.** Unlike the others, the product list is not a feed that
can be truncated — the POS searches it, the inventory table pages through it,
stock alerts scan it. Bounding it means paging or server-side search, which is
a design change to several screens rather than adding an argument to a query.

**Measured, not estimated.** Against a local emulator with **no network in the
path**, a catalogue of 10,000 products carrying realistic fields (name,
category, brand, supplier, sku, barcode, description, prices, levels):

| catalogue | cold read | payload |
|---|---|---|
| 800 products | 2,049 ms | — |
| **10,000 products** | **6,604 ms** | **4.55 MB of JSON** |

4.55 MB is the number that matters. On a Tanzanian mobile connection that is
tens of seconds — plausibly 30–60 — before the till can ring up its first sale.

**What softens it:** `initializeFirestore` enables `persistentLocalCache` with
multi-tab support, so this is a **cold-start cost, not a per-open cost**. A
device that has synced before serves from IndexedDB and pulls only deltas. The
cost lands on first sign-in on a device, after a cache clear, and on a new
staff phone.

**What does not soften it:** the product owner's stated target is **over 10,000
SKUs per branch**. This limitation is therefore above, not below, the intended
market.

**Risk: HIGH.** Deliberately not recorded as Medium. Every other entry in this
file describes something unlikely or bounded; this one describes the expected
customer.

**Fixed in part (2026-08-02).** Not the load — the lie. While the catalogue was
arriving, the inventory table displayed *"No inventory yet. Add your first
material or product to start tracking stock."* For the full cold-start window an
owner was told their stock was gone and invited to re-enter it. That is a trust
failure and a data-corruption invitation, not a slow screen. Both the inventory
table and the POS list now distinguish "not loaded yet" from "genuinely empty",
and `tests/load-client.test.mjs` fails if the unqualified empty state returns.

**The real fix, and its trigger.** A server-maintained per-store summary
document — counts and alert lists computed on write — so the client can page
products instead of holding all of them. Roughly 15 call sites currently depend
on having the whole catalogue (low-stock and expiry alerts, movement
classification, dashboard recommendations, restock ranking, barcode lookup, POS
search, ledger-gap reconciliation, AI snapshot selection); paging without the
summary does not degrade those, it breaks them. It also adds a write on every
stock change and needs its own reconciliation against drift, exactly as the
stock ledger did.

**Do this before onboarding any customer above ~3,000 SKUs per branch.** That
threshold is a decision, not a measurement: it is where cold start passes
roughly ten seconds on a decent mobile connection.

**Workaround.** None in-product. Practically, the shops this serves hold
hundreds to low thousands of SKUs.

**Planned:** paged inventory and server-side product search, before onboarding
any catalogue materially past a few thousand.

---

## L-5 Load, stress and chaos testing — **CLOSED 2026-08-02**

Carried from `SECURITY-AUDIT.md`, which marks this a GAP. Correctness under
concurrency is covered by `concurrency-integrity.test.mjs` and
`sync-integrity.test.mjs`; behaviour under volume was not tested at all.

**First measurement, 2026-08-02 — and it found a real regression.** The movement
classification and dashboard counts were rewritten to compute true 30- and
90-day figures from the sales record (see L-7). That replaced an O(1) counter
read with a full scan of the sales for *each* product, and both panels classify
every product three times. Measured cost of one render pass:

| catalogue | before | after |
|---|---|---|
| 200 products × 1000 sales | 201 ms | 15 ms |
| 2,000 | 1,239 ms | 6.6 ms |
| 10,000 | 6,073 ms | 14.3 ms |
| 50,000 | ~30 s (unusable) | 71 ms |

`renderAll()` fires on every snapshot, so at 2,000 products the app would have
spent over a second rebuilding two panels on every product, sale, customer or
transfer change — on a desktop. On the phones this actually runs on, several
times worse. Fixed by computing the whole map in one pass over the sales and
caching it per snapshot; `tests/stock-movement-window.test.mjs` now asserts the
map and the per-product read agree, and that no classification site rescans.

Worth noting how it got in: the change that caused it was correct, tested, and
shipped green. Nothing in a correctness suite notices an algorithm going
quadratic.

**The data layer, measured** — `tests/load-volume.test.mjs`, against a seeded
tenant of 800 products, 1,600 sales and 600 ledger entries:

| query, as `app.js` issues it | measured |
|---|---|
| products, unbounded (owner) | 2,049 ms / 800 docs |
| products, store-scoped (cashier) | 1,249 ms |
| sales, `limit(1000)` of 1,600 | 808 ms |
| stockMovements, `limit(500)` of 600 | 1,156 ms |
| 10 concurrent till transactions | 1,301 ms, 10/10 succeeded |

Bounded windows are shown not to degrade as history grows behind them, which is
the property that matters for a shop trading for years. The unbounded products
read is the outlier, and it is L-8.

**Chaos, as failure injection.** A ledger entry is written inside the sale
transaction — a deliberate choice with a stated cost: a rejected entry rolls the
sale back. That was argued when it shipped and is now proved. Injecting a forged
ledger write shows the entry refused, the stock movement rolled back with it,
and no orphan entry surviving. A half-applied sale — stock down with no sale, or
a sale with no ledger entry — would be worse than the refusal, because it is
silent.

**Index coverage** is checked statically against `firestore.indexes.json`,
because the emulator builds composite indexes on demand and would let a missing
production index pass in silence. All five `where` + `orderBy` pairings `app.js`
issues are declared.

**Why this counts as closed.** The limitation was that no load, stress or chaos
testing existed. It exists, it runs in `npm test`, and it carries budgets that
fail on regression. The assertions are deliberately **ratios rather than
milliseconds** — a CI runner and a developer laptop differ by more than any sane
wall-clock threshold, but shape does not: if ten times the data costs far more
than ten times the time, something has gone superlinear on any hardware.

**Deliberately not attempted, and why:** a million-row tenant (emulator seeding
cost exceeds any reasonable test runtime — the shape is proven at a scale that
runs in seconds), multi-hour memory drift, and network fault injection. These
are narrower questions than "is anything measured at all", and none of them is
the ceiling this system hits first — L-8 is.

**Risk: Low**, and quantified in both layers.

---

## L-11 Reports see only the newest 1,000 sales — **GUARDED, not solved**

Found by an external QA pass on 2026-08-07 (QA-102), recorded the day it was
found per this file's convention.

`subscribeToSales()` asks for the newest `SALES_HISTORY_LIMIT` (1,000) sales.
At fifty sales a day that is twenty trading days, so by the 25th of a busy
month the previous month has already fallen out of the loaded set.

**What made this urgent rather than untidy.** `computeMonthlyMetrics()` fed an
AI narrative and was then written to `monthlyReports` as an authoritative
record, and `computeVatReport()` fed a VAT return. Reporting on the visible
remainder therefore stored an understated revenue figure and an understated VAT
liability filed against it — a penalty exposure the owner had no way to detect,
because the report looked complete. A month entirely outside the window
reported zero transactions, so the owner was told "no sales data" for a month
they had traded.

**What is fixed.** `salesCoverageFromMs()` already existed and answered exactly
this question; only `reconcileShiftCash()` was asking it. The monthly report now
refuses, with a named reason, when the requested period starts before the
boundary — before the AI is paid to narrate it and before anything is
persisted. The VAT panel still renders, because refusing would leave the owner
with nothing, but states the date it can see back to and that the figure is not
for filing.

**What is not.** Complete history needs server-side aggregation — the same work
L-8 describes. Until then a shop with more than 1,000 sales in a period cannot
produce a full report from this client at all, only an honest partial one.

**Risk: Medium.** The silent under-report is closed; the ceiling is not.

**Workaround:** generate month-end reports early in the following month, while
the period is still inside the window. Narrowing to a single store also helps,
since the subscription is store-scoped for branch-assigned members.

**Milestone:** with the L-8 summary-document work.

---

## L-12 A refund does not reduce the VAT owed on it — **OPEN, conservative**

Found while closing QA-103 on 2026-08-07.

Revenue surfaces now all net refunds out (`saleNetTotal()`), so the control
panel, the monthly report, the trend chart, per-store and per-staff figures and
the payment-method report agree on a day's takings. The **VAT return does not**:
it sums the tax each sale was rung up with and never reduces it when goods come
back.

**Why it is not simply fixed.** VAT owed on a refund depends on the tax class of
the lines actually returned. Until this build, `saleItems` did not record a
class per line — `DESIGN-vat.md` described one from the start and it was never
implemented, so for any sale rung up before 2026-08-07 the class of a returned
line is unknowable from the sale document. Per-line `taxClass` is now written,
which makes a correct fix possible for sales from here on.

Apportioning the refund pro rata across classes would be a plausible-looking
approximation and wrong for any mixed basket — and wrong on a figure that gets
filed. A tax return also has to be internally consistent: netting refunds only
for sales new enough to carry the data would make the return depend on when each
sale happened, which is worse than a uniform, explainable position.

**Direction of the error.** It **overstates** VAT owed — the shop pays more than
it should, never less. That is the safe direction, and it is why this is
acceptable to carry rather than rush.

**Risk: Medium.** Wrong figure, safe direction, and it grows with refund volume.

**Workaround:** deduct VAT on refunds manually at filing. The Returns column on
the payment report gives the refunded totals for the period.

**Milestone:** once enough trading has happened under per-line `taxClass` that a
consistent period can be computed from it — realistically the first full month
after 2026-08-07.

---

---

## L-13 The expenses, purchases and product-cost subscriptions are unbounded — **BOUNDED 2026-08-23**

Found by an adversarial audit on 2026-08-21, the day the collections shipped,
and recorded the same day per this file's convention.

**Limitation.** `subscribeToExpenses()`, `subscribeToPurchases()`,
`subscribeToProductCosts()` and `subscribeToProductCostHistory()` each carry
`where("storeId","in",…)` for staff and nothing at all for an owner.

*Widened 2026-08-21* to include the cost history added by Phase D. It grows
only when a cost changes rather than per transaction, so it is the
slowest-growing of the four — but a bounded window there is the most
dangerous of them and needs the L-11 coverage treatment more than the rest: a
truncated history does not under-report a total, it silently answers with the
**wrong cost** for any sale older than the window. No `orderBy`, no `limit()`. Every expense, every
delivery and every product cost the business has ever recorded is streamed to
the client and held in memory.

**Why this is not L-8 widened.** L-8's reason for leaving `products` unbounded
is that the catalogue is not a feed that can be truncated — the POS searches it,
the inventory table pages through it, stock alerts scan it. None of that is true
here:

- Both screens already filter to **one month**. They *are* feeds.
- A catalogue grows with the range a shop stocks and then plateaus. Spending and
  deliveries grow **monotonically with trading volume and never plateau** — the
  same curve as `sales`, which is exactly why `sales` carries
  `SALES_HISTORY_LIMIT`.
- The worst case is the owner, who subscribes to every branch at once.

So the fix is cheap where L-8's is not: `orderBy("createdAt","desc")` plus a
limit, and the L-11 treatment on top of it.

**The L-11 treatment is the part that matters.** A bounded window without a
coverage boundary is worse than an unbounded one, because a month that has
fallen outside the window would silently total to *less than was spent* — a
confident, wrong figure on the number that feeds net profit. `salesCoverageFromMs()`
already exists for exactly this shape of problem and the monthly report already
uses it. Whatever bound is chosen, the surfaces must refuse a period they cannot
see all of rather than under-reporting it.

**Risk: Medium now, High within a year of trading.** A duka recording a handful
of expenses a week will not notice for a long time. A busy shop recording
deliveries daily across several branches will.

**Workaround.** None in-product, and none needed yet.

**Milestone.** With the L-8 and L-11 server-side aggregation work.
`RESEARCH-accounts.md` §9 already names L-8 and L-11 together as the gate for
the whole Accounts module; this belongs to the same gate.

---

---

**Bounded 2026-08-23.** The three feeds now carry `orderBy` + `limit`
(`ACCOUNTS_HISTORY_LIMIT`, 1000), mirroring `SALES_HISTORY_LIMIT`:

- `expenses` and `purchases` order by `createdAt` desc.
- `productCostHistory` orders by **`effectiveFrom`** desc, not `createdAt` —
  `effectiveFrom` is the field `costInForceAt()` searches, so the newest N by
  that field is the window that actually answers the question. Ordering by
  `createdAt` would let a backdated record fall outside the window while a
  newer-but-later-dated one stayed in it.

`productCosts` is deliberately left unbounded and there is now a test asserting
so: it holds one document per product per store, which is catalogue-shaped and
plateaus, so the L-8 argument for `/products` applies to it unchanged. Bounding
it would silently drop the cost of whichever products fell outside the window.

**The wrong-cost fear above turns out not to apply, and the reason is worth
keeping.** `costInForceAt()` returns the latest record *at or before* the sale,
so when truncation removes a product's older records the lookup finds nothing
at-or-before and returns `null` — "cost unknown", which the Profit screen
already reports as an uncosted line. Truncation therefore degrades to *less
costed*, never *wrongly costed*. That property depends entirely on the
at-or-before search and on ordering by `effectiveFrom`; change either and the
original fear becomes real.

**Composite indexes.** The staff branch adds `where("storeId","in",…)` to that
`orderBy`, which needs a composite index per collection; all three are declared
in `firestore.indexes.json`. This is the sharp edge: the owner's branch carries
no `where()` and needs no composite index, so a missing index fails **only for
staff**, with `failed-precondition`, after passing every test the owner ran.
`tests/purchases.test.mjs` now asserts that every bounded query has its index
declared — verified by negative control (removing the expenses index fails
exactly that assertion and nothing else).

**Still open.** This is a bound, not server-side aggregation. A shop doing 2,000
transactions a day still outruns a 1,000-record window; the difference is that
it now truncates predictably and says so rather than streaming everything into
memory. L-8 and L-11 are unchanged.

## L-14 A manager cannot make the FIRST transfer into a branch — **CLOSED 2026-08-23**

Found while building `DESIGN-purchases.md` Phase C on 2026-08-21, and verified
against the emulator before being written down.

**Limitation.** A transfer into a branch that does not yet stock the item
**creates** the destination product — `confirmTransfer()` writes a new document
when the SKU lookup comes back empty. `/products` carries
`allow create: if isOwner(userId)`, and always has: the rule predates every
feature in this file and has not changed since `908eb03`. So a manager who is
assigned to both branches, and who passes every check the transfer rule itself
imposes, is refused on the product write.

**What the shop saw.** A bare *"Your account is not allowed to do this. Ask the
business owner."* — after the dialog had already taken the quantity, and with no
indication that the problem is the destination branch rather than the transfer.
The same manager transferring the same item into a branch that already stocks it
succeeds, which makes it read as intermittent.

Verified: a manager updating an existing destination product is accepted; the
same manager creating one is refused at the rule; the owner doing the same is
accepted.

**Partly closed 2026-08-21.** `confirmTransfer()` now detects the case before
the transaction and says what to do — *"{branch} does not stock this yet, and
only the owner can add it there. Ask them to add it once, then transfers will
work."* The transfer is still refused; it just refuses honestly, early, and
without claiming the account is at fault.

**Why not fixed properly.** The fix is to let a manager create a product, and
that is a genuine expansion of the role rather than a bug fix — a manager who
can create products can create them anywhere they have access, for any reason,
not only as a transfer destination. Narrowing it to "only when it is a transfer
destination" is not expressible in rules, which authorise each write
independently and cannot see that a `/transfers` document is being written in
the same transaction. That is the same limitation L-2 describes for binding a
stock decrement to a sale.

**Risk: Low, and old.** Every shop has lived with it since the feature shipped.
The workaround is one action by the owner, once per product per branch.

**Workaround.** The owner adds the product to the destination branch once — with
quantity zero if they like — after which every later transfer of that item into
that branch works for anyone.

**Decision owed from the owner:** whether a manager should be able to create
products at all. It is a permissions question, not a technical one.

---

**Closed 2026-08-23 by owner decision.** `/products` create is no longer
owner-only: a manager may create a product in a store they are assigned to,
through `memberMayCreateProduct()` — one member read, the same
expression-budget shape as `memberMayUpdateProduct()`. A cashier still cannot,
and that unchanged case is what keeps this from being a general widening.

The product validator applies to a manager exactly as it does to the owner, so
this grants a role, not an exemption. Verified against the emulator: a manager
creates in an assigned store, is refused in a store they are not assigned to,
and is refused an invalid product. `tests/rules-workflow.test.mjs` carried
`"manager CANNOT create a product"` and now carries the three cases above —
flipped and annotated rather than deleted, so the change is visible to whoever
reads it next.

## L-15 Legacy `costPrice` on product documents — **OPEN, blocks the cost refusal**

Found on 2026-08-23 while checking whether `firestore.rules` could be deployed
ahead of the client, and verified against the emulator with the deployed
client's exact payload before being written down.

**Limitation.** B2-a made `validProduct()` refuse `costPrice` outright, because
Firestore has no field-level read security and a cashier's POS reads
`/products` in full — so a cost stored there is a cost every cashier can read.
That refusal cannot be deployed yet, for two independent reasons:

- The deployed client (`20260808o`) assigns `costPrice = 0` inside the
  `numericFields` loop of its product form whether or not the form has the box.
  Its own comment says so: *"costPrice has no input in this form today and
  arrives as 0; it is checked anyway so adding the field later cannot quietly
  skip the bound."* Every product it saves therefore carries the field.
- Every product document already in production carries it, for the same reason.
  Firestore validates an update against the **resulting** document, so
  `!('costPrice' in d)` refuses any owner write to such a document — including
  the stock decrement a sale performs.

**What it would have looked like.** Deploying the rules alone would have broken
Add Product, Edit Product, and owner-driven selling, on all eight tenants, the
moment it landed. A cashier or manager selling would have been unaffected,
because their path goes through `validStockMovementShape()` and never reaches
`validProduct()` — so in a shop with staff it would have looked like "the owner
cannot sell but the till can", which is not a hypothesis anyone reaches quickly.

Verified: the deployed client's product payload is refused under the tightened
rule and accepted with `costPrice` removed; an owner's stock decrement on a
document carrying `costPrice: 0` is refused, and accepted on one without it.

**Staged 2026-08-23.** Stage 1 is deployed in `firestore.rules`: the field is
*tolerated* on a product — bounded by `moneyInRange` and type-checked — rather
than refused. What stage 1 does **not** relax is the part that matters: a
cashier or manager still cannot write cost onto a product, because that refusal
comes from `stockMovementKeys()` via `validStockMovementShape()` and is
untouched. Only the owner's own writes tolerate the legacy field.

**Residual risk while stage 1 stands.** An owner's client could put a real cost
on a product document, where a cashier could read it. Neither the deployed
client nor the current one ever writes a non-zero value there — the current one
has no code path that writes the field at all — so in practice the value stays
at the legacy `0`. It is a hole in the guarantee, not in the behaviour.

**Stage 2, still owed.** Once every client is on the new build and `costPrice`
and `costKnownFrom` have been migrated off existing product documents, restore
in `validProduct()`:

```
&& !('costPrice' in d)
&& !('costKnownFrom' in d)
```

`tests/rules-purchases.test.mjs` asserts the stage-1 behaviour explicitly rather
than leaving it untested, so those assertions flip back to `false` when stage 2
lands — a deleted test would not have told anyone the behaviour had changed.

**The migration is written: `proxy/migrate-strip-product-cost.mjs`** (written
2026-08-23, not yet run against production). It sweeps
`collectionGroup("products")` across every tenant, removes only `costPrice` and
`costKnownFrom`, and touches nothing else.

    node migrate-strip-product-cost.mjs                    # dry run, the default
    node migrate-strip-product-cost.mjs --tenant=<uid>     # one tenant first
    node migrate-strip-product-cost.mjs --apply
    node migrate-strip-product-cost.mjs --verify           # exit 0 only when clean

It needs `FIREBASE_SERVICE_ACCOUNT_KEY_BASE64`, the same variable and encoding
`proxy/server.js` already uses, and refuses to run without it rather than
guessing at credentials. It also refuses a service account whose `project_id`
is not `sanitaryflow-erp` unless `--force-project` is passed.

Verified against the emulator by `proxy/migrate-check.mjs` (10 checks): a dry
run writes nothing; both fields go; every other field on the document survives;
an already-clean product is untouched; a second tenant is migrated too; a
**non-product** document carrying `costPrice` is left alone; `--verify` gates on
clean; and a second `--apply` is a no-op. That harness refuses to run unless
`FIRESTORE_EMULATOR_HOST` is set, because it seeds documents.

**The ordering is the whole point, and it is not "run it and tighten".** Old
clients put the field back. A shop that has not opened the app since the deploy
is still on the pre-`20260822c` build behind its service worker, and the next
product edit there re-adds `costPrice: 0`. So: wait until every client has
updated, run `--apply`, run `--verify`, and only tighten `validProduct()` when
verify reports clean. If verify is dirty, something is still writing it — find
that before tightening, because tightening against a live writer is what breaks
selling.

## L-10 A cashier can write off a customer's debt — **OPEN, detective fix owed**

Raised by an external QA pass (QA-111) on 2026-08-07 and confirmed against the
emulator the same day.

`validCustomerBalanceUpdate()` restricts the affected keys to `balanceOwed`,
`oldestUnpaidAt` and `updatedAt`, and requires the balance to be non-negative.
It places **no relationship between the new value and the old**, and requires no
document in the `payments` subcollection. A cashier can set any customer's
`balanceOwed` to zero in a single write, and the receivables report will agree
with them.

**Why it is not simply fixed.** This is the credit-side twin of L-2: Firestore
rules authorise one write at a time and cannot bind a balance change to the
payment that would justify it. Restricting decreases to managers does not help
either — taking a repayment is a cashier's job, and it is a decrease.

**Why the detective fix is buildable.** `payments` is create-only with `update`
and `delete` both denied, so a payment record cannot be forged after the fact or
tidied away, and it is owner-readable. Expected balance for a customer is
therefore the sum of `balanceDue` across their credit sales minus the sum of
their payments; anything else is a gap. That is the same shape as
`reconcileShiftCash()` and `reconcileProductStock()`, both of which already
exist and work.

Two things that view must inherit from `reconcileShiftCash()`: it must report
**unknown** rather than a discrepancy when the sales window does not reach far
enough back (L-11), and it must stay off any path that gates a till. A control
that accuses a cashier because of a subscription limit is worse than no control.

**Risk: High** — straightforward insider fraud, and for a duka extending credit
to regulars the receivable is the highest-value balance in the system.

**Workaround:** the owner can read each customer's `payments` subcollection
against their balance manually. `tests/rules-refund-boundary.test.mjs` asserts
this hole deliberately, so if it ever becomes preventable that test fails and
this entry should close.

**Milestone:** next release, in the shape of `reconcileShiftCash()`.
