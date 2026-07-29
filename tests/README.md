# Firestore security rules tests

These run the real `firestore.rules` against the Firestore emulator and assert
who can do what. They exist because two production-breaking bugs shipped that
reading the rules by eye did not catch:

1. **Branch-scoped staff could not list the `stores` collection.** A `list`
   query cannot bind the `{storeId}` path wildcard, so
   `memberCanAccessStore(userId, storeId)` was unprovable and the whole query
   was denied. A roaming (`storeIds: ["all"]`) member was unaffected, because
   `("all" in ids)` short-circuits true without ever needing `storeId` — which
   is exactly why manual testing missed it. Symptom: empty store switcher,
   empty POS, "cashier can't see their own branch".

2. **No one but the owner could complete a sale.** `validRestockUpdate()`
   required `quantity >= resource.data.quantity` (increase-only) and
   `hasOnly(['quantity','updatedAt'])`, but a sale *decrements* quantity and
   also writes `sold30`/`sold90`. The stock write was denied inside the same
   transaction that created the sale, so the transaction rolled back.

Both were found by these tests, not by inspection. Run them before deploying
any rules change.

## Running

Requires Java 17+ (the emulator is a JVM binary) and a one-time install:

```bash
cd tests && npm install
```

```bash
cd tests && npm test
```

Both suites must print `N/N passed` and exit 0. A non-zero exit means a rule
changed behaviour — investigate before deploying.

## What's covered

- `rules-access.test.mjs` — read paths: the stores list-vs-get distinction,
  per-document store scoping, member self-read isolation, void/return role
  split, restock field limits, list-query store filtering, monthlyReports
  owner-only.
- `rules-workflow.test.mjs` — the write paths a till actually uses: completing
  a sale, stock movement in both directions, audit logging, credit customers
  and payments, transfers, plus owner-only surfaces, privilege-escalation
  attempts and cross-tenant isolation.

## Known limitation, by design

Rules authorize each write independently, so they cannot verify that a stock
decrement was accompanied by a matching sale document in the same transaction.
A cashier can therefore write stock down without recording a sale. The
compensating controls are the sale record and the `auditLogs` entry (both
required, both owner-readable) plus physical reconciliation — not the rules.
