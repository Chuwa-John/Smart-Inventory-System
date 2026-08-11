// A product must always know which store it belongs to.
//
//   node product-store-scope.test.mjs
//
// Reported in UAT: a new user added stock, the app said it was saved, and it
// never appeared in their inventory -- while it turned up in the older account
// that had been used for testing.
//
// The cause was a missing guard rather than a missing feature. completeSale()
// has always refused BOTH "all stores" and "no store at all"; saveProduct()
// refused only the first. With no store resolved, the storeId assignment fell
// through every falsy branch and wrote an empty string, and an empty storeId is
// not a harmless blank -- it is a product filed where nobody can find it:
//
//   - the person who added it never sees it, because a staff subscription
//     filters where("storeId","in",[their stores]) and "" is in no such list
//   - the owner sees it appear under whichever store happens to be first,
//     because productStoreId() falls back to state.stores[0]
//
// So one person's stock silently became another account's, which is the worst
// available outcome for a multi-tenant inventory: not an error, a misfiling.
//
// The realistic way to reach it is a staff member with no store assigned, whose
// store list resolves to empty. That is an ordinary configuration mistake by
// the owner, so the client has to survive it rather than assume it away.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let depth = 0, i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

// The real productStoreId/storeProducts, run against a stub state.
function scope(products, currentStoreId, stores) {
  const state = { db: {}, products, currentStoreId, stores };
  return new Function("state",
    `let cachedStoreProducts = null, cachedStoreProductsSource = null, cachedStoreProductsStoreId = null;
     ${extract("productStoreId")}
     ${extract("storeProducts")}
     return { productStoreId, storeProducts };`
  )(state);
}

console.log("=== an empty storeId is a product nobody can find ===");
{
  const stores = [{ id: "storeA" }, { id: "storeB" }];
  const orphan = { id: "p1", name: "Orphan", storeId: "" };
  const owned = { id: "p2", name: "Owned", storeId: "storeB" };

  const atB = scope([orphan, owned], "storeB", stores);
  check("the orphan is missing from the store it was added in",
    atB.storeProducts().map((p) => p.id).join(",") === "p2",
    "this is the reported symptom: saved, confirmed, and not in the list");

  const atA = scope([orphan, owned], "storeA", stores);
  check("and it silently belongs to whichever store is first instead",
    atA.productStoreId(orphan) === "storeA",
    "productStoreId falls back to state.stores[0] -- how it surfaced in the older account");
  check("...so the owner sees it under a store nobody chose",
    atA.storeProducts().map((p) => p.id).join(",") === "p1");

  // The staff side of the same fact. Their subscription filters on an `in`
  // list, and no list of real store ids contains the empty string.
  check("no store-scoped query can ever match it",
    !["storeA", "storeB"].includes(orphan.storeId));
}

console.log("\n=== so the write refuses rather than guessing ===");
{
  const fn = noComments.slice(noComments.indexOf("async function saveProduct("));
  const body = fn.slice(0, fn.indexOf("\nfunction ") > 0 ? fn.indexOf("\nfunction ") : 20000);

  check("adding with no store selected is refused",
    /if \(!existing && state\.db && !state\.currentStoreId\) \{[\s\S]{0,400}?return;\s*\}/.test(body),
    "without this the storeId falls through to an empty string");
  // A staff member with no store will never succeed by waiting, so telling
  // them to try again in a moment sends them round that loop for good. The
  // owner is the one who has to act, and the message has to say so.
  check("a staff member with no store is told to ask the owner",
    /staffWithoutStore \? t\("toast\.noStoreAssigned"\) : t\("toast\.loadingStore"\)/.test(body));
  check("...and that is distinguished from an owner still loading",
    /state\.user\.uid !== state\.businessOwnerUid && !state\.stores\.length/.test(body),
    "an owner with no store really is mid-load, because ensureDefaultStore creates one");
  check("toast.noStoreAssigned exists in both languages",
    (src.match(/"toast\.noStoreAssigned"/g) || []).length >= 3);
  check("adding across all stores is still refused",
    /if \(!existing && state\.db && state\.currentStoreId === "all"\) \{/.test(body));

  const guardAt = body.indexOf("!state.currentStoreId");
  const assignAt = body.indexOf("product.storeId =");
  check("both guards run before the storeId is decided",
    guardAt !== -1 && assignAt !== -1 && guardAt < assignAt);

  // Editing must still work: an existing product has its own store, and the
  // refusal is scoped to new products so a shop viewing "all stores" can still
  // correct a price.
  check("editing an existing product is not blocked",
    /!existing && state\.db && !state\.currentStoreId/.test(body),
    "the guard is qualified on !existing, so an edit still goes through");

  // A product already saved with an empty storeId must be repairable. The
  // assignment keeps a falsy existing storeId falling through to the current
  // store, so the next edit files it correctly instead of preserving the fault.
  check("an already-orphaned product is repaired by the next edit",
    /product\.storeId = existing\?\.storeId \|\| product\.storeId \|\| state\.currentStoreId;/.test(body),
    "a truthiness check here is deliberate, not sloppy");
}

console.log("\n=== the sale path and the product path agree ===");
{
  // completeSale() had both guards all along. The asymmetry between the two
  // write paths is what let this through, so it is the asymmetry that is pinned
  // rather than either guard on its own.
  const sale = noComments.slice(noComments.indexOf("qs(\"#completeSaleButton\").addEventListener"));
  const saleBody = sale.slice(0, 6000);
  // Re-derived here: each section is its own block, so the copy in the section
  // above is not in scope.
  const productFn = noComments.slice(noComments.indexOf("async function saveProduct("));
  const body = productFn.slice(0, 20000);
  check("a sale refuses when no store is resolved",
    /if \(state\.db && !state\.currentStoreId\) return showToast\(t\("toast\.loadingStore"\)\);/.test(saleBody));
  check("a sale refuses across all stores",
    /if \(state\.db && state\.currentStoreId === "all"\) return showToast\(t\("toast\.selectStoreBeforeSale"\)\);/.test(saleBody));

  // Counted, not asserted with an `every` over a constant -- an earlier draft
  // of this line was vacuously true and would have passed against the bug.
  const productGuards = [
    /!state\.currentStoreId/,
    /state\.currentStoreId === "all"/
  ].filter((re) => re.test(body)).length;
  const saleGuards = [
    /!state\.currentStoreId/,
    /state\.currentStoreId === "all"/
  ].filter((re) => re.test(saleBody)).length;
  check("both write paths carry both guards", productGuards === 2 && saleGuards === 2,
    `saveProduct has ${productGuards}/2, completeSale has ${saleGuards}/2 — ` +
    "the asymmetry between them is what let this through");
}

console.log("\n=== a staff member with no stores is an ordinary mistake, not an impossible one ===");
{
  // resolveMemberStoreIds() returns [] both for a member with no assignment and
  // for a member whose doc could not be read. Either way the client ends up
  // with no current store, which is exactly the state the guard above must
  // survive -- so this pins that [] really is reachable.
  check("an unassigned member resolves to no stores",
    /return memberSnap\.exists\(\) \? \(memberSnap\.data\(\)\.storeIds \|\| \[\]\) : \[\];/.test(noComments));
  check("a failed member lookup also resolves to no stores",
    /defaulting to no access[\s\S]{0,80}return \[\];/.test(noComments));
  check("no stores means no products are subscribed",
    /if \(queryStoreIds !== null && queryStoreIds\.length === 0\) \{\s*state\.products = \[\];/.test(noComments),
    "which is why the person who added it could not see it either");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
