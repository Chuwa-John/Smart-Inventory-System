# Security audit — DukaSmart

Date: 2026-07-29. Covers `app.js`, `firestore.rules`, `proxy/server.js`,
`firebase.json`, CI, and dependencies.

Status keys: **DONE** verified by an automated test or a live check ·
**PARTIAL** implemented with a stated gap · **GAP** not implemented ·
**N/A** does not apply, with reasoning.

This file is excluded from Firebase Hosting (see `firebase.json` ignore list)
and is not served publicly.

---

## 0. F-1 to F-4 — resolution status

All four open findings were addressed on 2026-07-29.

| # | Status | Outcome |
|---|---|---|
| **F-1** | **FIXED AND LIVE** | Full six-phase deletion lifecycle: freeze + session revocation + staff lockout, 30-day restorable grace period, classification, anonymisation of retained financial records, recursive purge, 7-year retention limit. Policy in [DATA-DELETION.md](DATA-DELETION.md); 29 assertions in `tests/rules-deletion.test.mjs`. `DELETION_JOB_SECRET` is set on Render and in GitHub Actions, and the scheduler was verified end-to-end on 2026-07-29 (HTTP 200, 0 tenants due). Runs daily at 03:17 UTC. |
| **F-2** | **VERIFIED, awaiting console toggle** | App Check tokens confirmed minting on the live site (953-char JWT). They were failing before the CSP fix, so enabling enforcement earlier would have locked out every user. Safe to enable now: Firebase Console → App Check → Authentication → Enforce. |
| **F-3** | **FIXED** | `/api/staff/accept-invite` now requires `email_verified` on the signed token. Enforced server-side, so it cannot be skipped by calling the endpoint directly. |
| **F-4** | **MITIGATED — prevention not reachable** | See the revised F-4 entry below. Direction-coupling was implemented, tested, found to be both breakable and outage-prone, and removed in favour of an honest detective control. |

---

## 1. Findings — open

### F-1 Account deletion orphans all tenant data — **FIXED 2026-07-29**

Retained below for the record; superseded by [DATA-DELETION.md](DATA-DELETION.md).

`confirmDeleteAccount()` in `app.js` reauthenticates and calls Firebase Auth
`deleteUser()`. That removes the *login*, not the data. Everything under
`users/{uid}/…` — products, sales, customers with names and phone numbers,
audit logs, member records — remains in Firestore permanently, now orphaned
with no account able to reach it.

This is a right-to-erasure (GDPR Art. 17) failure, and it also means the
"Delete Account" button does materially less than a user would reasonably
assume from its label.

Client-side deletion cannot fix it: Firestore rules deny a client the
recursive delete, and the account is gone by then anyway. Remediation is a
proxy endpoint using the Admin SDK already configured there
(`firestoreDb`) to recursively delete the subtree, called *before*
`deleteUser()`, with the audit entry written to a retained store.

**Not implemented deliberately.** Recursive, irreversible deletion of a live
business's entire dataset is exactly the change that should not be written
unattended — it needs an explicit decision on retention window (immediate vs.
30-day soft-delete), on what must survive for tax/accounting obligations, and
on what happens to staff members attached to a deleted owner. Flagging for
your decision rather than guessing.

### F-2 Auth rate limiting is bypassable (MEDIUM — pre-existing, documented)

`/api/auth/check-limit` enforces 5 attempts / 15 min per email, but it is
advisory: the client calls it before `signInWithEmailAndPassword`. An attacker
holding the public Firebase Web API key can call Google's Identity Toolkit REST
endpoints directly and never touch the proxy.

This is already documented in a comment in `server.js` and is a genuine Spark-plan
constraint — Auth Blocking Functions require Blaze. **The free mitigation is App
Check enforcement for Authentication** (Firebase Console → App Check →
Authentication → Enforce), which rejects requests not originating from your app.

Related: App Check tokens were failing entirely until this session because CSP
blocked reCAPTCHA (now fixed). Verify tokens are minting before enabling
enforcement, or you will lock out every user at once.

### F-3 No email-verification requirement on privileged actions (LOW)

`verifyFirebaseToken` accepts any validly signed token. A user with an
unverified email can accept a staff invite and transact. The invite flow binds
to an email address the owner typed, which limits the exposure, and a banner
prompts verification. Consider requiring `email_verified` on
`/api/staff/accept-invite` specifically.

### F-4 Stock decrements cannot be bound to a sale (LOW — inherent) — **MITIGATED**

Firestore authorizes each write independently, so `validStockMovementUpdate()`
cannot verify that a stock decrement was accompanied by a matching sale document
in the same transaction. A cashier can write stock down without recording a sale.

**What was tried and rejected.** A `movementReason` field was added, with rules
requiring the direction of change to agree with the stated reason — a "restock"
could not reduce stock, a "sale" could not inflate it. Two implementations were
written and both failed under test:

- Keyed on field *presence*: `movementReason` persists on the document once
  written, so a later write that omitted it inherited the stale value. A product
  left reading `"restock"` then rejected the next sale outright — a silent till
  outage for any client on a cached bundle.
- Keyed on `diff().affectedKeys()`: only fires when the value *changes*, so
  consecutive sales (the normal case, same value each time) skipped validation
  entirely, while a `sale`→`restock` transition was judged against a stale
  quantity.

Both were caught by `tests/rules-deletion.test.mjs`, not by inspection.

**Why it was dropped rather than fixed.** The security value was negligible in
either form: anyone writing stock down to cover theft simply omits the field or
labels the write `"sale"`. It would have imposed real outage risk on the revenue
path to deter nobody.

**Why prevention is not reachable at all.** Binding the decrement to a sale
would require the sale to be committed *before* the stock write so a rule could
`get()` it. That breaks transactional atomicity — a sale could be recorded with
no stock movement — and it breaks offline selling, which is a headline feature
of this product. A server-mediated sale endpoint has the same problem: it cannot
work offline.

**What is in place.** `movementReason` is retained and validated as an enum
(`sale` / `restock` / `return` / `void`), stamped by all four client stock paths.
It does not prevent anything; it makes the audit trail precise enough to
reconcile, which is the actual control — the same way real retail manages
shrinkage. The owner-facing reconciliation view belongs to the admin dashboard
(Phase 5) and is the remaining work on this finding.

---

## 2. Findings — fixed this session

| # | Severity | Issue |
|---|---|---|
| 1 | **CRITICAL** | Branch-scoped staff could not read any store. A `list` query cannot bind the `{storeId}` wildcard, so the rule was unprovable and denied. Cascaded to empty POS, no store switcher, no inventory. Roaming (`"all"`) members were unaffected, which is why manual testing missed it. |
| 2 | **CRITICAL** | No one but the owner could complete a sale. The stock rule was increase-only and field-limited to `quantity`+`updatedAt`, but a sale decrements and writes `sold30`/`sold90`; the write was denied inside the sale transaction, rolling it back. |
| 3 | HIGH | Type-confusion in input validation. `String(req.body.x \|\| "")` coerces rather than validates — `String(["a@b.com"])` is `"a@b.com"`, so array payloads passed email validation. All request fields now use a strict `readString()`. |
| 4 | HIGH | 11 dependency advisories (5 high) → 0, via `overrides` pinning `brace-expansion` and `uuid`. |
| 5 | MEDIUM | `firestore.rules`, `firestore.indexes.json`, `OPERATIONS.md` (which contains the Render service ID and infrastructure topology), `RECOVERY.md`, and `system-architecture.md` were all publicly served. Deployed file count 24 → 17. |
| 6 | MEDIUM | No rate limit on the only endpoint that costs money per call (`/api/ai/advisor`). Now 8/min per user. |
| 7 | MEDIUM | CSP omitted `https://www.google.com` from `connect-src`, so reCAPTCHA could never complete and App Check tokens always failed. Harmless in monitor mode; total lockout if enforcement were enabled. |
| 8 | LOW | `role: "Owner"` written into every staff member's profile document. Not an escalation (authorization reads `members/{staffUid}`), but a field a later change could wrongly trust. |
| 9 | LOW | `accept-invite` limit 10 → 5 per 15 min; `/api/staff/invite` now rejects non-owners. |
| 10 | LOW (a11y) | Inputs set `outline: none` with no replacement — no visible keyboard focus indicator anywhere (WCAG 2.4.7). |

---

## 3. Requested checklist

### Input sanitization and injection prevention — **DONE**
Strict type checking via `readString()`; length clamps on every field; 64 KB
body cap with `strict: true` and `type: "application/json"`; per-field
validators (`validateAdvisorRequest`, `compactSnapshot`, `validateStoreIds`).
Firestore rules independently re-validate every field, type and length on write.

*Injection classes:* no SQL (Firestore, no query string concatenation). No
`eval`, `Function`, or `innerHTML` on unescaped user data — output goes through
`esc()`. Prompt injection is addressed: business data is wrapped in
`<business_snapshot>` delimiters with an explicit instruction to treat the
contents as data, never commands.

Verified by 27 assertions in `tests/proxy-security.test.mjs`.

### Authentication, authorization, roles, permissions — **DONE**
Firebase Auth; three roles (owner/manager/cashier); store-scoped via `storeIds`
with an `"all"` roaming sentinel. Authorization is `get()`-based against
`members/{staffUid}` in rules, **not** custom claims, so revocation is immediate
rather than waiting for token expiry. `businessOwnerUid` is a custom claim used
**only** as a client routing hint and never for an access decision.

Verified by 51 assertions in `tests/rules-*.test.mjs`, including privilege
escalation and cross-tenant attempts.

### Session management and token expiry — **DONE**
Firebase ID tokens expire hourly and auto-refresh; `forceRefresh` used where a
freshly-set claim must be visible. 30-minute idle timeout signs out unattended
POS terminals. Reauthentication required before account deletion and before
changing the discount password.

### Secrets management — **DONE**
No hardcoded secrets (full-tree scan). All secrets in environment variables;
`.env` gitignored with only `.env.example` placeholders committed. Service
account passed base64-encoded. `private/security` (bcrypt discount-password
hash) is denied to **every** client including the owner — only the Admin SDK
can read it, so the hash cannot be pulled client-side and brute-forced offline.

*Note:* `firebase-config.js` contains a Firebase Web API key. This is **public
by design** — it identifies the project, it is not a credential. Security comes
from rules and App Check.

*Not done:* no secret rotation schedule. Rotate `ANTHROPIC_API_KEY` and the
service account key periodically.

### HTTPS, TLS, certificate rotation — **DONE**
HTTP → HTTPS 301 verified live. HSTS `max-age=31536000; includeSubDomains;
preload` on both Hosting and proxy. TLS termination and certificate renewal are
fully managed by Firebase Hosting and Render — automatic, no rotation work.

### Rate limiting and abuse prevention — **DONE**

| Route | Limit |
|---|---|
| global (all routes) | 60/min per IP |
| all `/api/` authenticated | 20/min per uid |
| `/api/auth/check-limit` | **5 / 15 min per email** |
| `/api/ai/override-verify` | 5 / 15 min |
| `/api/settings/override-password` | 5 / 15 min |
| `/api/staff/accept-invite` | 5 / 15 min |
| `/api/staff/invite` | 20 / 15 min |
| `/api/account/request-deletion` | 5 / 15 min |
| `/api/account/cancel-deletion` | 5 / 15 min |
| `/api/ai/advisor` | 8/min (cost control) |
| `/jobs/process-deletions` | shared secret, constant-time compare |

Meets your "5 attempts per 15 minutes on all authentication routes"
requirement. See **F-2** for the bypass caveat.

### Dependency scanning and patching — **DONE**
0 vulnerabilities. CI fails on `--audit-level=high`. Frontend has no build step
and no runtime npm dependencies; third-party scripts are CDN-loaded with SRI
hashes and `crossorigin`/`referrerpolicy` set.

### Multi-tenancy and data isolation — **DONE**
Every document lives under `users/{ownerUid}/…`; every rule is anchored on that
path segment. Cross-tenant reads and writes are explicitly tested (an outsider
cannot read products or stores, or create a sale, in another business).

### Audit trails — **PARTIAL**
`auditLogs` captures sale completion, void, return, restock, product create/
edit/delete, payments, credit-limit changes, staff removal, account deletion.
Entries are append-only by rule (`allow update, delete: if false`) and record
`request.auth.uid`, which cannot be forged (asserted by test).

**Gap:** append-only is not tamper-*evident*. The project owner has full
console access and could delete entries out-of-band. True tamper evidence needs
hash-chaining or off-site log shipping.

### Error handling and graceful degradation — **DONE**
Global error handler returns generic messages; no stack traces leak (asserted).
The app falls back to local AI recommendations when the proxy is unavailable,
and to offline/local mode when Firestore is unreachable. Listener errors are
surfaced by name and collection rather than swallowed.

### Idempotency — **DONE**
Sales use a deterministic document id (`ord_{staffId}_{orderNumber}`) so a
retried submission resolves to the same path and is rejected by create-vs-update
semantics rather than double-decrementing stock. Deliberate re-entry gets a
distinct id.

### Concurrency and race conditions — **DONE**
All multi-document mutations (sale, return, void, restock, transfer, payment,
invite acceptance) use Firestore transactions with reads before writes.
Invite acceptance is transactional, so a token cannot be redeemed twice.

### Caching strategy and invalidation — **DONE**
Service worker caches only the app shell — never Firestore or cross-origin
traffic. `Cache-Control: no-cache` on JS/CSS. `app.js?v=` and `CACHE_NAME` must
bump together; **this is now enforced in CI** because missing it can serve a
stale bundle that silently un-gates role-restricted controls. Session-scoped
member-document cache is a read cache only and never affects authorization.

### PII handling and retention — **DONE**
PII collected is minimal and purpose-bound: staff emails, customer names and
phone numbers for credit accounts. Versioned consent is captured at signup.
Owners can export their full dataset. Erasure, anonymisation and a 7-year
retention limit on anonymised financial records are implemented and tested --
see [DATA-DELETION.md](DATA-DELETION.md). **Remaining gap:** no documented
breach-notification process (a procedure, not code).

### GDPR / Tanzania PDPA — **PARTIAL**
Present: lawful-basis consent with version tracking (Art. 6), published privacy
policy and terms, data portability (JSON export, Art. 20), access (Art. 15),
data minimisation (Art. 5), encryption in transit and at rest, **right to
erasure with anonymisation of legally-retained records (Art. 17 and 6(1)(c))**,
and storage limitation via the 7-year retention clock.
Missing: breach-notification procedure (Art. 33), records of processing
(Art. 30), and a Data Processing Agreement if you take on EU customers. All
three are documentation and process, not code.

### HIPAA — **N/A**
This is retail and hospitality software. It is not a covered entity or business
associate and does not process PHI. **Do not claim HIPAA compliance** — doing so
would be inaccurate and creates legal exposure. If you ever sell to a pharmacy
handling patient records, that is a separate compliance programme (BAA, audit
controls, encryption attestations, staff training), not a code change.

### Tests — **PARTIAL**

| Type | Status |
|---|---|
| Security rules (integration) | **DONE** — 80 assertions, real emulator |
| Proxy security/API (integration) | **DONE** — 34 assertions, real HTTP |
| Regression | **DONE** — both suites gate CI; both critical bugs have permanent tests |
| Unit tests for `app.js` | **GAP** — ~6,400-line ES module with no exports; needs refactoring into importable modules before it is unit-testable |
| End-to-end (browser) | **GAP** — no Playwright/Cypress; sign-in flows are currently verified by hand |
| Coverage thresholds in CI | **GAP** — no coverage instrumentation; suites are behavioural, not coverage-measured |

### Load, stress, chaos — **GAP**
None performed. Firestore and Hosting scale as managed services; the realistic
bottlenecks are the Render free-tier proxy (cold starts ~50s, single instance)
and Spark-plan Firestore quotas (50k reads/day). The member-doc cache added this
session cut per-sign-in reads roughly 6×. Recommend a k6 or Artillery run against
the proxy before any material growth in staff accounts.

### RTO / RPO and disaster recovery — **DONE (documented)**
`RECOVERY.md` defines scenarios, targets and procedures. **Untested** — a
documented DR plan that has never been rehearsed is a hypothesis. Recommend one
restore drill from a downloaded backup.

### Accessibility — **PARTIAL**
Fixed this session: visible keyboard focus on all controls (WCAG 2.4.7);
44px touch targets (Material 48dp guidance for a finger-operated till);
`prefers-reduced-motion` honoured; tabular numerals so figures align.
Pre-existing: semantic landmarks, `aria-label`s on icon controls, real `<button>`
and `<table>` elements, both themes shipped.
**Not verified:** colour-contrast ratios have not been measured against WCAG AA,
and there has been no screen-reader pass.

### Code review process — **GAP**
No branch protection, no required reviewers, no CODEOWNERS. Everything is
committed straight to `main` (including by me, this session, at your direction).
For a solo project this is a reasonable trade-off, but CI now gates the
behaviours that matter most. Consider requiring PRs once anyone else contributes.

### Architecture diagrams and ADRs — **PARTIAL**
`system-architecture.md` and `OPERATIONS.md` exist. Design decisions are captured
densely in code comments (the reasoning behind get()-based authorization,
hide-don't-disable, the stock-movement trade-off) but there is no formal ADR log.

---

## 4. Remaining work, in order

1. **Set `DELETION_JOB_SECRET`** in the Render environment and as a GitHub
   Actions secret. Until both are set, accounts freeze and can be restored but
   are never purged -- which is itself a retention violation.
2. **Enable App Check enforcement for Authentication** (Console → App Check →
   Authentication → Enforce). Tokens are verified minting, so this is now safe.
3. One DR restore drill. A recovery plan that has never been rehearsed is a
   hypothesis, not a control.
4. Owner-facing stock reconciliation view -- the detective control that closes
   out **F-4**. Belongs with the Phase 5 admin dashboard.
5. Colour-contrast audit against WCAG AA, and a screen-reader pass.
6. E2E tests for sign-in and the sale path, the areas still only checked by hand.
7. Breach-notification procedure and records of processing (documentation).
