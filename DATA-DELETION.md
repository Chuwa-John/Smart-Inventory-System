# Account deletion and data retention policy

Implements GDPR Articles 5, 6(1)(c) and 17, and the Tanzania Personal Data
Protection Act (data minimisation and purpose limitation).

The policy exists to satisfy two obligations that pull in opposite directions:
personal data must be erased on request, and financial records must be kept.
Anonymisation is what resolves them — the financial row survives, the person in
it does not.

Code: `proxy/server.js` (endpoints and purge), `firestore.rules`
(`tenantNotFrozen`), `app.js` (`confirmDeleteAccount`, `cancelAccountDeletion`).
Tests: `tests/rules-deletion.test.mjs`.

---

## Phase 1 — Request (immediate)

`POST /api/account/request-deletion` — owner only, requires reauthentication.

1. `users/{ownerUid}.status = "pending_deletion"`, with `deletedAt` and
   `deletionScheduledFor = now + 30 days`.
2. Owner's refresh tokens revoked — live sessions die at once rather than
   lingering until token expiry.
3. Every staff Firebase Auth account disabled and their tokens revoked.
4. Tenant becomes read-only, enforced by `tenantNotFrozen()` in
   `firestore.rules` on every write path.
5. `ACCOUNT_DELETION_REQUESTED` written to `auditLogs`.

**On "disable authentication access immediately":** the owner's login is *not*
disabled, deliberately. Disabling it would make Phase 2 self-service
restoration impossible — they could not sign in to change their mind. Access is
instead removed in the way that matters: sessions killed, all writes refused,
staff locked out entirely. Staff logins *are* disabled outright, since they have
no restoration rights.

**Why the freeze is on writes only:** every `get()` inside a security rule is a
billed read, and a POS reads far more than it writes. Gating reads would tax
every screen for an edge case. Staff read lockout is achieved instead by
disabling their auth accounts, which is free and takes effect faster than any
rule.

## Phase 2 — Grace period (30 days)

Data is fully retained and readable by the owner. Nothing is processed or
modified except for compliance purposes.

`POST /api/account/cancel-deletion` restores the tenant: status back to
`active`, deletion fields cleared, staff accounts re-enabled,
`ACCOUNT_DELETION_CANCELLED` logged. Returns `410 Gone` once
`deletionScheduledFor` has passed — after the purge there is nothing to restore,
and offering it would be a promise the data cannot keep.

An owner who signs in during this window sees a red countdown banner stating the
days remaining and offering restoration. A frozen account that silently refuses
writes is indistinguishable from a broken one.

## Phase 3 — Classification

Encoded directly in `anonymiseAndPurgeTenant()` so policy and implementation
cannot drift apart.

**A. Personal data — deleted**
`customers` (names, phones) and its `payments` subcollection · `members` (staff
emails, roles) · `staff` (names) · `invites` (invited emails) · `private`
(security material)

**B. Legally required — retained, anonymised**
`sales` · `auditLogs`

**C. Non-personal — deleted**
`products` · `transfers` · `monthlyReports`

Category C is deleted rather than kept: retention is optional, and there is no
purpose left to justify holding it once the business is gone.

## Phase 4 — Anonymisation

On every retained `sales` document: `staffName` → `"Deleted Staff"`;
`cashierUid`, `staffId`, `customerName`, `customerPhone`, `customerId` removed;
`anonymised: true` with a timestamp. Monetary figures, line items, dates and
order numbers are untouched — that is the point of retaining the record.

On every retained `auditLogs` entry: `uid` → `"Deleted User"`,
`performedByUid` removed. Audit entries are anonymised rather than deleted
because they are the evidence trail for this deletion.

Re-identification: the linking identifiers are removed, not hashed, so there is
no key to reverse. The `auditLogs` collection is append-only by rule
(`allow update, delete: if false`), which the Admin SDK bypasses for this
one-time anonymisation.

## Phase 5 — Purge

1. Categories A and C deleted recursively. Recursion matters: deleting a
   Firestore document does **not** delete its subcollections, which is precisely
   how orphaned personal data appears — `customers/{id}/payments` outliving its
   customer. `deleteCollectionRecursively()` walks `listCollections()` on each
   document before deleting it.
2. All staff Firebase Auth accounts deleted, then the owner's.
3. `deletedTenants/{ownerUid}` written **outside** the tenant tree, so it
   survives the purge and stays findable when the retention clock expires.
4. Tenant document reduced to `status: "deleted"` plus the retention window;
   `email`, `businessName` and `uid` removed.

## Phase 6 — Retention limit

Anonymised financial records are held for **7 years**, the conservative figure
across Tanzania Revenue Authority guidance and normal commercial practice, then
permanently deleted by `purgeExpiredRetention()`.

Adjust `FINANCIAL_RETENTION_YEARS` in `proxy/server.js` if your accountant
advises a different figure for your jurisdiction.

## Scheduling

Phases 5 and 6 run from `POST /jobs/process-deletions`, authenticated by the
`DELETION_JOB_SECRET` shared secret with a constant-time comparison. It sits
outside `/api/` so it bypasses Firebase token verification — the caller is a
scheduler, not a person.

Triggered daily by `.github/workflows/process-deletions.yml`. Render's free tier
has no cron, and Cloud Scheduler needs Blaze, so GitHub Actions is the
zero-cost option.

**Required setup — the policy does not complete without this:**

1. Generate a secret: `openssl rand -hex 32`
2. Set `DELETION_JOB_SECRET` in the Render environment.
3. Add the same value as a GitHub Actions secret named `DELETION_JOB_SECRET`.

Until both are set the endpoint returns `503` and no purge ever runs. Phase 1
and 2 still work — accounts freeze and can be restored — but data would be
retained past the grace period, which is itself a compliance failure. Verify
after setup by checking the workflow's run log.

**Also required: the `users` composite index** (`status` ASC +
`deletionScheduledFor` ASC), in `firestore.indexes.json`. The due-tenant query
combines an equality with a range across two fields, which Firestore cannot serve
without it. Its absence was the first live failure of this job — a `500` that,
because the endpoint originally returned a generic message, was indistinguishable
from a credentials problem. The endpoint now returns the underlying Firestore
error, and the workflow prints it.

**Verified end-to-end 2026-07-29:** HTTP 200, 0 tenants due, 0 retention-expired.

The job is idempotent and batched (10 tenants per run), so a missed day is
harmless.

## Properties

- **Irreversible after Phase 5.** Identifiers are removed, not encrypted.
- **Fully logged.** Request, cancellation, and purge summary all recorded.
- **No orphaned personal data.** Recursive deletion covers every subcollection.
- **Client cannot interfere.** `status`, `deletedAt` and `deletionScheduledFor`
  are rejected on client writes, so an owner can neither freeze themselves nor
  clear a pending deletion to escape the purge. Asserted by test.

## Operational note

If the tenant schema gains a collection, add it to the correct category in
`anonymiseAndPurgeTenant()`. A collection absent from all three lists is
silently retained forever — the exact orphaned-data failure this policy fixes.
