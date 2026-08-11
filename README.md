# SaviaSmart ERP

Inventory, point of sale and staff management for a Tanzanian shop floor. Plain
HTML, CSS and JavaScript ES modules,no framework and no build step,on
Firebase Spark-plan services, with an optional Node proxy for the AI advisor.

English and Kiswahili throughout. Prices are whole Tanzanian shillings.

## What it does

- **Point of sale**: cash, mobile money, card and customer credit; discounts
  behind a manager override; returns and voids.
- **Inventory**:stock levels, a movement ledger whose chain can be
  reconciled against the shelf, transfers between branches, low-stock alerts.
- **Multiple branches**: stores, per-branch staff assignment, roaming access.
- **Roles** : owner, manager and cashier, enforced in Firestore rules rather
  than only in the UI.
- **Shifts** : open with a float, close with a count, variance recorded.
- **Customer credit** : balances, repayments, and a credit ceiling that costs a
  manager override to cross.
- **VAT** : inclusive at 18%, per-product tax class, off by default. See
  `DESIGN-vat.md`.
- **Offline selling** : a cash sale completes with no connection and replays
  once when it returns. See `DESIGN-offline-selling.md` and `OFFLINE-CAPABILITIES.md`.
- **AI advisor** :answers on the shop's own numbers, metered per business.

## Run locally

A static site, so any file server works:

```bash
python -m http.server 5173
```

Then open `http://localhost:5173`. The landing page is `index.html`; the
application itself is `app.html`.

## Firebase setup

1. Copy `firebase-config.sample.js` to `firebase-config.js` and fill in your
   Firebase web app config. **This file is not a template to edit in place** ,
   it decides which project the app talks to and is served `no-cache` for that
   reason (see `OPERATIONS.md`).
2. Copy `.firebaserc.example` to `.firebaserc` and set your project ID.
3. Enable Firebase Auth (Email/Password), Firestore and Hosting. Do **not**
   enable Cloud Functions, Cloud Storage or a billing upgrade — this build is
   deliberately Spark-only, and `OPERATIONS.md` says why.
4. Deploy the rules: `firebase deploy --only firestore:rules`.

Data lives under `users/{ownerUid}`. Staff accounts are members of an owner's
tree rather than tenants of their own, so a shop is one tree with several
people in it.

## The AI proxy

`proxy/` is a small Express service holding the Anthropic key, the per-business
quota and the override-password check. It is optional: without it the advisor
falls back to local answers and price overrides fall back to the shared
password. See `proxy/README.md`.

## Tests

```bash
npm --prefix tests ci
npm --prefix tests test
```

The emulator-backed suites need Java 17. Two further checks run a headless
Chromium:

```bash
node tests/contrast.headless.mjs
node tests/compatibility.headless.mjs
```

## Documents worth reading before changing anything

| File | What it is for |
| --- | --- |
| `OPERATIONS.md` | Release procedure, the caching contract, rollback — rehearsed, with timings. |
| `KNOWN-LIMITATIONS.md` | What this system does **not** do, recorded on the day it was found. |
| `DESIGN-vat.md` | The four commercial decisions behind VAT, and why fiscal numbers are not ours. |
| `DESIGN-offline-selling.md` | The offline queue, and §15 — the handset trial that no suite substitutes for. |
| `SECURITY-AUDIT.md` | Findings and their resolutions. |
| `RECOVERY.md` | What to do when something has already gone wrong. |
| `DATA-DELETION.md` | The account deletion lifecycle and its grace period. |

Two rules that are load-bearing and easy to get wrong:

- **Bump the version stamp on the change, not on the deploy.** Any edit to
  `app.js`, `styles.css` or `boot.js` moves `?v=` even if you are not deploying.
- **A rolled-back stamp is burned.** Roll forward on a new one, never reissue.

Both are explained in `OPERATIONS.md` and enforced by
`tests/deployment-validation.test.mjs`.
