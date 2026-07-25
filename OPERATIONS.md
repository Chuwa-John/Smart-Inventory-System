# Production Operations

## Services and ownership

- Firebase Hosting and Firestore: `sanitaryflow-erp` (Spark plan only).
- AI proxy: Render service `sanitaryflow-ai-proxy` (`srv-d8s1sfjeo5us73e0tmdg`).
- Source of truth: GitHub `main`.
- CI: GitHub Actions validates syntax, locked proxy dependencies, and high-severity dependency advisories. It has no deployment credentials and cannot deploy production.

Do not enable Firebase Functions, Firebase Storage, or a Firebase billing upgrade for this application. The Anthropic API is the only paid integration.

## Release procedure

1. Keep the working tree clean and review `git diff --check`.
2. For every hosted frontend release, increment both values together:
   - `index.html`: the `app.js?v=...` value.
   - `sw.js`: `CACHE_NAME`.
   This prevents an old shell from referencing a new app bundle or vice versa.
3. Run:

   ```powershell
   node --check app.js
   node --check sw.js
   node --check proxy/server.js
   npm.cmd --prefix proxy ci
   npm.cmd --prefix proxy audit --audit-level=high
   ```

4. Commit and push to `main`. Confirm the GitHub Actions workflow passes.
5. Deploy Hosting and Firestore rules only when those files changed:

   ```powershell
   firebase deploy --only hosting,firestore:rules
   ```

   A frontend-only release may use `firebase deploy --only hosting`.
6. Render auto-deploys proxy changes from `main`. For an explicit release, create a deploy for `srv-d8s1sfjeo5us73e0tmdg` and wait for status `live`.
7. Verify production:

   ```powershell
   Invoke-RestMethod https://sanitaryflow-ai-proxy.onrender.com/health
   Invoke-WebRequest https://sanitaryflow-erp.web.app
   ```

## Rollback

1. Identify the prior known-good Git commit and Firebase Hosting release.
2. Revert the faulty commit with a new commit; do not use destructive Git reset commands.
3. Deploy the reverted Hosting/Firestore configuration, then verify the two production endpoints above.
4. For a proxy rollback, redeploy the prior healthy Render deploy through the Render dashboard or CLI, then verify `/health`.

## Secret and access governance

- Keep `ANTHROPIC_API_KEY` and `PRICE_OVERRIDE_PASSWORD_HASH` exclusively in Render environment variables.
- Never commit `.env`, Firebase service-account files, API keys, or credentials.
- Use least-privilege repository access, require MFA for production owners, and rotate Render/GitHub/Firebase credentials after suspected exposure or personnel changes.
- Keep production deployment access limited to designated maintainers; CI is verification-only.

## Firebase App Check verification

The web client initializes Firebase App Check with reCAPTCHA v3 and automatic token
refresh. Do not remove this initialization merely to hide an App Check warning.

If `appCheck/throttled` or a 403 appears in a browser console:

1. Re-test in a new browser profile/session after the throttle period; a throttled
   App Check session can retain its failed state even after the underlying problem
   is corrected.
2. In Firebase Console, verify that web app
   `1:1051743582406:web:cc1b04fe2e308894c03fc7` has the intended reCAPTCHA v3
   provider registered and that its site key matches `app.js`.
3. In Google reCAPTCHA administration, allow both
   `sanitaryflow-erp.web.app` and `sanitaryflow-erp.firebaseapp.com` for that key.
4. Check App Check enforcement for Authentication and the Firebase products in use;
   record any intended enforcement change in the release notes.

On 2026-07-25, Firebase Console confirmed that the production web app is
registered with the standard reCAPTCHA v3 provider. Cloud Firestore and
Authentication App Check are in monitoring mode. The matching reCAPTCHA key allows
both `sanitaryflow-erp.web.app` and `sanitaryflow-erp.firebaseapp.com` (the latter
was added during this review). Fresh sessions on both Hosting domains produced no
App Check warning or throttling error in the browser console.
