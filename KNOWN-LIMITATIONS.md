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

## L-3 The audit log is append-only but not tamper-evident — **OPEN**

Carried from `SECURITY-AUDIT.md`. Rules forbid update and delete, and as of the
Phase 2 QA pass `action` is a closed, role-scoped set with a closed document
shape (`tests/rules-audit-log.test.mjs`) — so no client can forge or flood
entries. But the project owner has full Firebase console access and can delete
entries out of band. Append-only is not the same as tamper-evident.

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

## L-6 The access-during-grace audit entry is documented but never written — **OPEN**

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

**Why not fixed now.** It needs a decision rather than a patch: what counts as
"access" worth recording (every app open while frozen? every write attempt? the
first per session?), and how to avoid a frozen tenant's client writing an audit
entry on a loop. That is a small design, not a one-liner, and it touches
`app.js`, so it carries a version bump and a Hosting deploy.

**Risk: Low** operationally — nothing is broken and no data is wrong. It is a
**documentation-accuracy** risk: `DATA-DELETION.md` describes a control that
does not exist, and the gap survived a security audit because a test named the
action for it. If the deletion policy is ever shown to a regulator or a customer
as evidence of practice, it currently overstates what happens.

**Workaround.** None needed. Deletion, freezing and restoration all work and are
audited; only the access-attempt trail is absent.

**Planned:** Phase 5, alongside the admin dashboard's audit log viewer — the
entry is only useful once there is somewhere to read it.

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

## L-5 No load, stress or chaos testing — **OPEN**

Carried from `SECURITY-AUDIT.md`, which marks this a GAP. Correctness under
concurrency is covered by `concurrency-integrity.test.mjs` and
`sync-integrity.test.mjs`; behaviour under volume is not tested at all. Nobody
has measured what happens at 250,000 products, a million sales, or fifty tills
against one tenant.

**Risk: Medium and unquantified**, which is the problem with it. The first
customer large enough to find the ceiling will find it in production.

**Planned:** before onboarding any business materially larger than the current
pilot.
