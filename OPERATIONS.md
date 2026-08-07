# Production Operations

## Services and ownership

- Firebase Hosting and Firestore: `sanitaryflow-erp` (Spark plan only).
- AI proxy: Render service `sanitaryflow-ai-proxy` (`srv-d8s1sfjeo5us73e0tmdg`).
- Source of truth: GitHub `main`.
- CI: GitHub Actions validates syntax, locked proxy dependencies, and high-severity dependency advisories. It has no deployment credentials and cannot deploy production.

  Reading a red CI run: the workflow is a single job, so **steps stop at the
  first failure and every step behind it is reported `skipped`, not failed**. A
  red X therefore does not tell you how much was verified. Open the run and
  check which steps actually executed before concluding anything passed. On
  2026-08-07 four commits merged against a red X that read as a dependency
  warning and in fact meant the proxy security suite, the Firestore rules
  suites, contrast and the no-JavaScript check had not run at all.

  The advisory check is pinned LAST for that reason. It still fails the build,
  but a CVE published overnight against a transitive dependency can no longer
  decide whether the test suite runs. Do not move it earlier for tidiness.

Do not enable Firebase Functions, Firebase Storage, or a Firebase billing upgrade for this application. The Anthropic API is the only paid integration.

## Release procedure

1. Keep the working tree clean and review `git diff --check`.
2. For every hosted frontend release, increment all of these together:
   - `app.html`: the `app.js?v=...`, `boot.js?v=...` and `styles.css?v=...` values.
   - `accept-invite.html`, `privacy-policy.html`, `terms.html`: the `styles.css?v=...` value.
   - `sw.js`: `CACHE_NAME`, and the `app.js`, `boot.js` and `styles.css` entries
     in `APP_SHELL`.

   Note `index.html` is NOT in that list. It is the landing page, its CSS is
   inline, and it references no versioned asset — this procedure named it three
   times and never named `app.html` until 2026-08-07, which is the file that
   actually points at the bundle. A release made by following the old wording
   would have bumped nothing and shipped a shell pointing at the previous
   build. `tests/deployment-validation.test.mjs` now fails if the list here and
   the files that really carry stamps disagree.

   This prevents an old shell from referencing a new app bundle or vice versa.

   The stylesheet carries a version for the same reason the bundle does, and
   the reason is worth keeping: the service worker serves the app shell
   cache-first, so an unversioned `styles.css` is taken from the previous
   cache on the first load after a deploy. The CSS is correct on the server
   and stale in the browser, and the fix appears not to have worked until the
   user loads a second time. That has cost real debugging twice. The
   `APP_SHELL` entry must use the identical URL the page requests, or the
   worker pre-caches one copy and serves another.

   Why the `?v=` matters more than it looks: hosting serves every `.js` and
   `.css` as `public, max-age=31536000, immutable`, so a browser keeps them for
   a year and never asks again. That is safe *only* because the URL changes on
   release. An asset referenced without a `?v=` is therefore pinned in a user's
   browser for a year with no way to recover by deploying —
   `tests/cache-policy.test.mjs` fails if any page ever references one.

   The reverse applies to `app.html` and `sw.js`, which carry no version and are
   served `no-cache`. They are the pointers: `app.html` says which build to
   fetch, `sw.js` decides what the offline shell holds. Firebase's default of
   `max-age=3600` on HTML meant a deploy took up to an hour to reach a returning
   shop, including a fix on the sale path. Both rules are pinned by the same
   test, including their ORDER — `sw.js` must come after the blanket `js|css`
   rule in `firebase.json`, because Firebase takes the last matching value and a
   reordering would silently make the service worker immutable for a year.

   Verify a release by checking the DEPLOYED file, not the local one --
   `curl` the hosted asset and grep it for the change. "The deploy said
   success" is not evidence the change is live.
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
4. **Roll forward on a NEW version stamp. Never reissue the one you withdrew.**
   See below — this is the rule the rehearsal existed to find.
5. For a proxy rollback, redeploy the prior healthy Render deploy through the Render dashboard or CLI, then verify `/health`.

### Why step 4 exists

`?v=` is a cache key, not a build selector. Firebase serves whatever `/app.js`
currently is for *every* query string — verified live during the drill, where
`?v=20260807a`, `?v=20260807b` and `?v=99999999z` all returned identical bytes.

`app.js` is served `immutable` for a year. So any browser that loaded
`?v=X` while a bad build was live has that response pinned until 2027. If you
roll forward reusing `X`, those browsers never re-fetch: they keep running the
withdrawn code under a stamp everyone believes is the fix, and no deploy can
dislodge it. **A rollback burns its version string permanently.**

Reissuing a stamp for the *same* bytes is fine, and is exactly what step 2
does — the revert brings the previous stamp and the previous file back
together. `tests/deployment-validation.test.mjs` walks the git history of
`app.html` and fails if any one stamp has ever meant two different builds.

### Rehearsal record

Rehearsed end to end on 2026-08-07 against production, not a preview channel.

| Leg | Elapsed | Verified |
| --- | --- | --- |
| Deploy v90 | 43s | shell, `sw.js`, banner present |
| Decision → rollback live (v90 → v89) | **62s** | shell reverted, banner gone, both bundles 200 |
| Roll forward (v89 → v91, fresh stamp) | 8m32s | shell, `sw.js`, banner and `controllerchange` restored |

The 62 seconds is the number to plan against: `git revert` plus
`firebase deploy --only hosting`, decision to live. The roll-forward leg is not
comparable — it included writing the stamp-reuse guard and running the whole
suite, which a real roll-forward would not. Its deploy alone was ~45s.

The rollback path works and is fast. What it does *not* do on its own is reach a
till that never reloads — the browser only re-checks `sw.js` on navigation. That
is what the update banner added in the same phase is for, and it is the reason a
rollback is not finished when hosting says "release complete".

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
