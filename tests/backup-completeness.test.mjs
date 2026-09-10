// The backup has to contain the whole business.
//
//   node backup-completeness.test.mjs
//
// On the free plan there are no server-side backups and no point-in-time
// recovery: the version retention window is one hour. So the file an owner
// downloads from Settings is, in practice, THE recovery path for their
// business. If a collection is missing from it, that data is simply gone in any
// scenario that loses the database.
//
// This list has drifted twice. `members` and `shifts` were missing once -- a
// business restored without `members` came back with nobody able to sign in but
// the owner. By 2026-09-10 it had fallen NINE collections behind: every one
// added since. The worst of those was `productCosts`, because COGS is resolved
// from it, so a restored business would have shown no cost of sales and no
// margin anywhere.
//
// A hand-maintained list beside a growing schema will drift again, so this
// derives the collections from firestore.rules -- which cannot be out of date,
// because a collection that is not in the rules cannot be written at all -- and
// fails when one of them is not in the backup.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass && detail) console.log(`      ${detail}`);
}

// --- what the schema actually has -----------------------------------------
// Everything matched directly under users/{userId}. Subcollections of a
// document (a customer's or supplier's payments) are handled separately by the
// backup and are asserted on their own below.
const tenantBlock = rules.slice(rules.indexOf("match /users/{userId}"));
const collections = new Set(
  [...tenantBlock.matchAll(/match \/([a-zA-Z]+)\/\{[a-zA-Z]+\}/g)].map((m) => m[1])
);

// Diagnostic, not business data: restoring last month's faults helps nobody.
collections.delete("errorLog");
// A subcollection, not a tenant collection -- covered by its own assertion.
collections.delete("payments");
// The tenant root itself, not a collection under it. Its profile document is
// exported on its own line and asserted below.
collections.delete("users");

// --- what the backup exports ----------------------------------------------
const listed = new Set(
  (src.match(/const rootCollections = \[([\s\S]*?)\];/) || [, ""])[1]
    .split(",").map((c) => c.trim().replace(/["']/g, "")).filter(Boolean)
);

console.log("=== the backup covers the whole schema ===");
{
  check("firestore.rules was readable", collections.size > 10,
    `only found ${collections.size} collections`);
  check("the backup's list was readable", listed.size > 0);

  const missing = [...collections].filter((c) => !listed.has(c));
  check("every collection in the schema is in the backup", missing.length === 0,
    `MISSING FROM THE BACKUP: ${missing.join(", ")} -- data in these is unrecoverable`);

  // The reverse is a smaller mistake, but a backup naming a collection that
  // does not exist reads as a failed export every time it runs.
  const phantom = [...listed].filter((c) => !collections.has(c));
  check("the backup names nothing that does not exist", phantom.length === 0,
    `not in the rules: ${phantom.join(", ")}`);
}

console.log("\n=== the collections that would hurt most, named individually ===");
{
  // Each of these was missing on 2026-09-10, and each breaks something specific
  // on restore. Named so a failure says WHAT is lost, not just that a set
  // differs.
  const consequences = [
    ["productCosts", "COGS is resolved from this -- without it every margin reads unknown"],
    ["productCostHistory", "the cost timeline COGS uses at the moment of each sale"],
    ["purchases", "the Purchase Book: what was bought and what it cost"],
    ["expenses", "every expense, and therefore net profit"],
    ["deliveries", "delivery headers, landed costs and what is still owed on them"],
    ["suppliers", "who is owed money, and how much"],
    ["purchaseReturns", "goods sent back, which offset both stock and debt"],
    ["stockMovements", "the stock ledger -- the only record of why a shelf changed"],
    ["services", "the menu a salon or bar sells from"]
  ];
  for (const [name, why] of consequences) {
    check(`${name} is backed up`, listed.has(name), why);
  }
}

// Scoped to the backup function rather than the whole file. recordSupplierPayment()
// builds the very same subcollection path, so a whole-file match reported the
// export as present after it had been deleted -- the assertion passed for the
// wrong reason, which is worse than no assertion. Found by a negative control
// that came back green.
function backupBody() {
  const start = src.indexOf("async function downloadAccountBackup(");
  if (start === -1) throw new Error("downloadAccountBackup not found in app.js");
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

console.log("\n=== subcollections are not forgotten ===");
{
  const backup = backupBody();
  // A subcollection does not come with its parent document; it has to be
  // fetched per parent.
  check("customer payments are exported", /customers", customer\.id, "payments"/.test(backup));
  check("supplier payments are exported", /suppliers", supplier\.id, "payments"/.test(backup),
    "a restored business would know what it owes but not what it has already paid");
  check("both are written into the file",
    /customerPayments: Object\.fromEntries/.test(backup) && /supplierPayments: Object\.fromEntries/.test(backup));
}

console.log("\n=== the file says what it is ===");
{
  const version = Number((src.match(/schemaVersion: (\d+)/) || [, 0])[1]);
  // Older files genuinely lack these collections, so anything restoring one has
  // to be able to tell "absent because empty" from "absent because the export
  // predates the field".
  check("schemaVersion was raised past the incomplete format", version >= 3,
    `schemaVersion is ${version}; a version 2 file has no cost, purchase or supplier data`);
  check("the export is dated", /exportedAt: new Date\(\)\.toISOString\(\)/.test(src));
  check("it names the account it came from", /accountUid: state\.user\.uid/.test(src));
  // users/{uid} is the tenant root, not a collection under it -- it carries the
  // business name, the language and the consent record, and is exported on its
  // own rather than through rootCollections.
  check("the profile document is exported too",
    /profile: profileSnap\.exists\(\) \? backupSerializable\(profileSnap\.data\(\)\) : null/.test(src));
}

console.log("\n=== a backup leaves a record that it happened ===");
{
  const backup = backupBody();
  // Until 2026-09-10 nothing recorded whether a tenant had EVER taken a backup.
  // On a plan with no server-side backups and one hour of version retention,
  // that was the single most important fact about a shop and it was unknowable:
  // you could not tell a shop their last backup was months old, spot one that
  // had never taken any, or say after a loss whether a file existed at all.
  check("the download is audited", /action: "BACKUP_DOWNLOADED"/.test(backup),
    "otherwise nothing anywhere records that a backup happened");
  check("...and the profile is stamped", /lastBackupAt: serverTimestamp\(\)/.test(backup),
    "the stamp is what Settings and a support query read without trawling the log");
  check("the rules accept that action", /'BACKUP_DOWNLOADED'/.test(rules));

  // Order matters. A stamp written before the file exists marks a backup that a
  // failed export never produced, and the shop is then told it is covered when
  // it is not.
  // BOTH anchors verified present before comparing. indexOf returns -1 for a
  // missing needle and -1 is less than any real index, so deleting the download
  // entirely made the ordering assertion PASS. This project has shipped that
  // exact false green once before; a negative control caught it again here.
  const clickAt = backup.indexOf("link.click()");
  const stampAt = backup.indexOf("BACKUP_DOWNLOADED");
  check("the record is written AFTER the file is handed over",
    clickAt !== -1 && stampAt !== -1 && clickAt < stampAt,
    `link.click() at ${clickAt}, the record at ${stampAt}`);
  // And failing to record must not fail a download that already succeeded.
  check("a failed stamp does not fail the backup", /catch \(stampError\)/.test(backup));
  // The count makes the entry worth reading rather than a bare timestamp.
  check("the entry says how much was exported", /itemCount: documentCount/.test(backup));
}

console.log("\n=== Settings says when it last happened ===");
{
  const start = src.indexOf("function renderLastBackup(");
  let i = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  const render = src.slice(start, i + 1);

  check("there is a line to render into", html.includes('id="lastBackupLine"'));
  // Never and stale are different conversations: one needs a phone call, the
  // other a reminder.
  check("never is called out separately from stale",
    /backup\.never/.test(render) && /backup\.stale/.test(render));
  check("...and a healthy backup reads plainly", /backup\.last/.test(render));
  check("both bad states are visually marked", /cell-warn/.test(render));
  // Cost figures and business health -- not a cashier's business.
  check("it is owner-only", /isOwnerRole\(\)/.test(render) && /line\.hidden = true/.test(render));
  check("it is repainted with the account panel", /renderLastBackup\(\);/.test(src));

  // A sign-in must not drop the stamp, or a backed-up business reports as
  // never backed up.
  check("the stamp survives a fresh sign-in", /stored\?\.lastBackupAt/.test(src));
  check("...and is cached where the renderer reads it",
    /businessName, ownerName, lastBackupAt \}/.test(src));
}

console.log("\n=== it stays the owner's alone ===");
{
  // Whole-business export, including every cost and every margin.
  check("the backup button is owner-gated", /"downloadBackupButton"/.test(src));
}

console.log("\n=== the prompt to back up must not lie about why ===");
{
  // It read: "If this phone is lost, so is your business record." That is not
  // true and it is not a small slip -- records live in Firestore, so a lost
  // phone loses nothing at all. Sign in on another handset and everything is
  // there. Reported by the owner, who spotted the contradiction: he was signed
  // in on a new device looking at his own data while being told that data
  // depended on a phone.
  //
  // Scaring somebody into a good habit with a false reason is still telling
  // them something untrue about their own business, and this app refuses to do
  // that everywhere else -- it blanks a margin it cannot compute rather than
  // printing a confident zero.
  const never = (src.match(/"backup\.never": "([^"]*)"/g) || []);
  check("the message exists in both languages", never.length === 2, `found ${never.length}`);
  for (const line of never) {
    check("...and does not claim a lost phone loses the records",
      !/phone is lost, so is|ikipotea, kumbukumbu ya biashara yako inapotea/.test(line), line.slice(0, 80));
  }

  // The real reason, which is the one this plan actually has: there is no
  // point-in-time recovery and no server-side backup, so a deletion is
  // permanent. That is what a downloaded copy protects against.
  const en = (src.match(/"backup\.never": "([^"]*)"/) || [])[1] || "";
  check("it says the records survive a lost phone",
    /lost phone loses nothing|kept online/i.test(en), en.slice(0, 90));
  check("...and gives the reason that is true: a deletion cannot be undone",
    /deletion cannot be undone/i.test(en), en.slice(0, 90));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
