// Stage 2 of KNOWN-LIMITATIONS.md L-15: remove the legacy `costPrice` and
// `costKnownFrom` fields from every product document, in every tenant.
//
// WHY THIS EXISTS
//
// Cost belongs in /productCosts, which a cashier cannot read. Firestore has no
// field-level read security and a cashier's POS reads /products in full, so a
// cost stored on a product document is a cost every cashier can read.
// firestore.rules therefore wants to REFUSE the field outright -- and cannot
// yet, because the client deployed before 20260822c assigned costPrice = 0 on
// every product save, so existing documents carry it. Firestore validates an
// update against the RESULTING document, so refusing the field would refuse
// every owner write to such a document, including the stock decrement a sale
// performs. The refusal is staged behind this migration.
//
// ORDER, AND IT MATTERS
//
//   1. Every client is on 20260822c or later. That build has no code path that
//      writes either field. Service workers mean this is not instant: a shop
//      that has not opened the app since the deploy is still on the old build,
//      and it will re-add costPrice: 0 the next time someone edits a product.
//   2. Run this with --apply until a verify pass reports zero remaining.
//   3. ONLY THEN restore in validProduct():
//          && !('costPrice' in d)
//          && !('costKnownFrom' in d)
//
// Running it before step 1 is harmless but pointless -- old clients put the
// field straight back. Tightening the rules before step 2 completes is the
// thing that breaks shops.
//
// SAFETY
//
// Dry run unless --apply is passed. Idempotent: it only ever removes two
// fields, so a repeated or interrupted run is safe. It touches nothing else --
// no other field is read, written, or deleted.
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, FieldPath } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const LEGACY_FIELDS = ["costPrice", "costKnownFrom"];
const EXPECTED_PROJECT = "sanitaryflow-erp";
const PAGE = 300;          // documents read per page
const BATCH = 400;         // writes per commit; Firestore's hard cap is 500

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const VERIFY_ONLY = args.includes("--verify");
const tenantArg = args.find((a) => a.startsWith("--tenant="));
const ONLY_TENANT = tenantArg ? tenantArg.split("=")[1] : null;

// Two ways in, and neither requires pasting a key anywhere it would be logged:
//
//   FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 -- the convention server.js already
//   uses. Base64 because Render's env UI mangles the private key's newlines.
//
//   GOOGLE_APPLICATION_CREDENTIALS -- the standard Google mechanism, pointing
//   at the service-account JSON file on disk. Preferred when running this by
//   hand: the key stays a file, and the path is not a secret.
const keyB64 = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 || "";
const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

if (!keyB64 && !adcPath && !usingEmulator) {
  console.error("No credentials. Set one of:");
  console.error("  GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json   (simplest by hand)");
  console.error("  FIREBASE_SERVICE_ACCOUNT_KEY_BASE64=<base64 of that file>      (as server.js uses)");
  console.error("Refusing to guess at credentials for a script that can rewrite production documents.");
  process.exit(2);
}

if (!getApps().length) {
  if (usingEmulator) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || EXPECTED_PROJECT });
  } else if (!keyB64 && adcPath) {
    // The project check below cannot read a file we were only handed a path
    // to, so verify it explicitly rather than skipping the guard.
    const sa = JSON.parse(readFileSync(adcPath, "utf8"));
    if (sa.project_id !== EXPECTED_PROJECT && !args.includes("--force-project")) {
      console.error(`Credentials are for "${sa.project_id}", expected "${EXPECTED_PROJECT}".`);
      process.exit(2);
    }
    initializeApp({ credential: applicationDefault() });
  } else {
    const serviceAccount = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8"));
    if (serviceAccount.project_id !== EXPECTED_PROJECT && !args.includes("--force-project")) {
      console.error(`Service account is for "${serviceAccount.project_id}", expected "${EXPECTED_PROJECT}".`);
      console.error("Pass --force-project only if you genuinely mean to migrate a different project.");
      process.exit(2);
    }
    initializeApp({ credential: cert(serviceAccount) });
  }
}

const db = getFirestore();

function legacyFieldsOn(data) {
  return LEGACY_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(data || {}, f));
}

// A collection-group sweep, paged by document path. Ordering by __name__ needs
// no composite index and gives a stable cursor, which is what makes an
// interrupted run resumable simply by running it again.
async function sweep(onDoc) {
  let cursor = null;
  let scanned = 0;
  for (;;) {
    let q = db.collectionGroup("products").orderBy(FieldPath.documentId()).limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned++;
      // users/{uid}/products/{id} -- segment 1 is the tenant.
      const tenant = doc.ref.path.split("/")[1];
      if (ONLY_TENANT && tenant !== ONLY_TENANT) continue;
      await onDoc(doc, tenant);
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }
  return scanned;
}

async function run() {
  const mode = VERIFY_ONLY ? "VERIFY" : (APPLY ? "APPLY" : "DRY RUN");
  console.log(`mode: ${mode}${ONLY_TENANT ? `  tenant: ${ONLY_TENANT}` : "  all tenants"}` +
              `${usingEmulator ? "  (emulator)" : ""}`);

  const perTenant = new Map();
  let affected = 0;
  let batch = db.batch();
  let pending = 0;
  let committed = 0;

  const scanned = await sweep(async (doc, tenant) => {
    const present = legacyFieldsOn(doc.data());
    if (!present.length) return;
    affected++;
    perTenant.set(tenant, (perTenant.get(tenant) || 0) + 1);
    if (VERIFY_ONLY || !APPLY) return;

    const patch = {};
    for (const f of present) patch[f] = FieldValue.delete();
    batch.update(doc.ref, patch);
    pending++;
    if (pending >= BATCH) {
      await batch.commit();
      committed += pending;
      console.log(`  committed ${committed}`);
      batch = db.batch();
      pending = 0;
    }
  });

  if (APPLY && !VERIFY_ONLY && pending > 0) {
    await batch.commit();
    committed += pending;
  }

  console.log(`\nproducts scanned      : ${scanned}`);
  console.log(`carrying legacy cost  : ${affected}`);
  for (const [tenant, n] of [...perTenant.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${tenant}  ${n}`);
  }

  if (VERIFY_ONLY) {
    console.log(affected === 0
      ? "\nVERIFIED CLEAN -- safe to restore the refusal in validProduct()."
      : "\nNOT CLEAN -- do NOT tighten the rules yet. Run with --apply, then verify again.");
    process.exit(affected === 0 ? 0 : 1);
  }

  if (!APPLY) {
    console.log("\nDry run. Nothing was written. Re-run with --apply to remove the fields.");
    process.exit(0);
  }

  console.log(`fields removed from   : ${committed} documents`);
  console.log("\nNow run with --verify. Do not tighten the rules until it reports clean.");
  process.exit(0);
}

run().catch((error) => {
  console.error("migration failed:", error);
  process.exit(1);
});
