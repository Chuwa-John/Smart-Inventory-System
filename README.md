# SanitaryFlow ERP

Modern plumbing and sanitary inventory management platform built with HTML, CSS, JavaScript, Firebase Spark-plan services, and an optional external Anthropic proxy.

## Run Locally

This app can run as a static site.

```bash
python -m http.server 5173
```

Open `http://localhost:5173`.

## Firebase Setup

1. Copy `firebase-config.sample.js` to `firebase-config.js`.
2. Replace the placeholder values with your Firebase web app config.
3. Enable Firebase Auth, Firestore, Hosting, Analytics, and optionally Storage.
4. In Firebase Auth, enable the Email/Password sign-in provider.
5. Deploy the Firestore rules in `firestore.rules`.

Also copy `.firebaserc.example` to `.firebaserc` and replace `YOUR_FIREBASE_PROJECT_ID` with your real Firebase project ID.

The app works with demo data until Firebase is configured. After Firebase connects, each signed-in user gets a private inventory under `users/{uid}`. Products, POS sales, and audit logs sync to Firestore for that account only.

## Anthropic AI Proxy

This version avoids Firebase Functions so it can run on Firebase Spark. The AI Advisor can call the external Node proxy in `proxy/`.

Do not place an Anthropic key in browser JavaScript for production.

```bash
cd proxy
copy .env.example .env
npm install
npm run dev
```

Put your Anthropic key in `proxy/.env`, not in frontend files. If the proxy is unavailable, the app falls back to local inventory recommendations.

## Deploy Everything

```bash
firebase login
firebase use YOUR_FIREBASE_PROJECT_ID
firebase deploy --only hosting,firestore:rules
```

## Included Modules

- Operations dashboard with KPI cards and charts.
- Inventory table with filtering, sorting, stock states, CSV export, and add-product modal.
- Email/password signup and login for small-team onboarding.
- Per-user Firestore inventory with create, edit, delete, export, and POS stock deduction.
- Smart stock alerts and reorder recommendations.
- POS screen with cart and stock deduction.
- Purchase orders workflow view.
- Suppliers and customers dashboards.
- Warehouse and branch overview.
- Reports catalog.
- AI business advisor with external Anthropic proxy and local Spark-plan fallback.
