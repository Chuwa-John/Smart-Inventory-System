// The catalogue is bounded by the branch you are looking at.
//
//   node catalogue-scope.test.mjs
//
// `products` and `productCosts` are the only two live subscriptions that grow
// with the size of the business. Everything else is bounded -- sales 1000,
// purchases 1000, movements 500 -- so this pair is the entire vertical ceiling,
// and for an owner both were fetched with no `where` and no `limit`: every
// branch's catalogue, on every cold start, while looking at one branch.
//
// Measured by bench-catalogue.mjs at 2,000 SKUs across 3 branches: 12,000
// documents, 24% of a day's Spark read quota, spent by one person opening the
// app once. At 10,000 SKUs a branch one cold start exceeds the whole quota.
//
// Two things must stay true, and both are silent when broken:
//   1. IT MUST ONLY EVER NARROW. This sits in front of the query that decides
//      what a person reads. Widening it past resolveQueryStoreIds() would hand
//      a staff member another branch's catalogue -- a permission bug wearing a
//      performance fix's clothes.
//   2. IT MUST NARROW ON THE COLD START. Products subscribe before the stores
//      snapshot arrives, so at that moment no branch is selected. If only the
//      switcher re-subscribed, the scoping would work when somebody changed
//      branch and never on the load that actually costs the reads.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const results = [];
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function extract(name) {
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  if (start === -1) throw new Error(`${name} not found`);
  let i = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

// The real function, over a stubbed permission answer and a chosen branch.
function scopeFor(allowed, selected) {
  return new Function("resolveQueryStoreIds", "state", `
    ${extract("catalogueStoreIds")}
    return catalogueStoreIds;
  `)(async () => allowed, { currentStoreId: selected })();
}

console.log("=== an owner loads one branch, not all of them ===");
{
  // null from resolveQueryStoreIds means "roaming, no filter needed".
  check("owner on branch A loads branch A", await scopeFor(null, "branchA"), ["branchA"]);
  check("owner on branch B loads branch B", await scopeFor(null, "branchB"), ["branchB"]);
  // The reporting view. An owner who asks to see across branches gets across
  // branches -- this is where they go when they need the whole picture, and it
  // is the only place the full catalogue is loaded.
  check("owner on All branches still loads everything", await scopeFor(null, "all"), null);
  // Before the stores snapshot arrives there is no branch to scope to.
  check("no branch chosen yet loads everything", await scopeFor(null, ""), null);
  check("...and undefined behaves the same", await scopeFor(null, undefined), null);
}

console.log("\n=== it can only ever narrow ===");
{
  // THE assertion. Whatever comes back must be a subset of what permission
  // already allowed, or this is a permission bug wearing a performance fix's
  // clothes.
  const cases = [
    [["branchA", "branchB"], "branchA", ["branchA"]],
    [["branchA", "branchB"], "branchB", ["branchB"]],
    // A branch the member cannot read: scoping to it would produce an EMPTY
    // catalogue, not a smaller one -- a till with nothing on it. Their own
    // scope is kept instead.
    [["branchA"], "branchC", ["branchA"]],
    [[], "branchA", []]
  ];
  for (const [allowed, selected, expected] of cases) {
    const got = await scopeFor(allowed, selected);
    check(`allowed ${JSON.stringify(allowed)} on ${selected} -> ${JSON.stringify(expected)}`, got, expected);
    if (Array.isArray(got) && Array.isArray(allowed)) {
      check(`...and every id was already permitted`,
        got.filter((id) => !allowed.includes(id)), []);
    }
  }
  // Never turns a filtered scope into an unfiltered one.
  for (const selected of ["branchA", "branchC", "all", ""]) {
    const got = await scopeFor(["branchA"], selected);
    check(`a staff scope stays filtered on "${selected}"`, got !== null, true);
  }
}

console.log("\n=== both growing subscriptions use it ===");
{
  // The catalogue itself is still a live subscription -- a till has to know
  // when a price or a stock count changes. Costs are not; see below.
  for (const fn of ["subscribeToProducts", "loadProductCosts"]) {
    check(`${fn} scopes to the branch`, /await catalogueStoreIds\(\)/.test(extract(fn)), true);
    check(`...and no longer asks for the whole permitted set`,
      /const queryStoreIds = await resolveQueryStoreIds\(\)/.test(extract(fn)), false);
  }
  // Everything else must keep asking the permission question, because those
  // collections are bounded already and are read across branches on purpose.
  for (const fn of ["subscribeToSales", "subscribeToPurchases", "subscribeToExpenses"]) {
    check(`${fn} still uses the permission scope`,
      /await resolveQueryStoreIds\(\)/.test(extract(fn)), true);
  }
}

console.log("\n=== it narrows on the cold start, not only on a switch ===");
{
  const settle = extract("applyStoresSnapshot");
  check("the branch being settled re-subscribes", /resubscribeCatalogue\(\)/.test(settle), true);
  // Only when it actually changed, or every stores snapshot would re-fetch the
  // catalogue -- turning a saving into a cost.
  check("...only when the branch actually changed",
    /state\.currentStoreId !== previousStoreId\) resubscribeCatalogue\(\)/.test(settle), true);
  const switcher = extract("switchStore");
  check("changing branch re-subscribes too", /resubscribeCatalogue\(\)/.test(switcher), true);
  const re = extract("resubscribeCatalogue");
  check("it re-fetches products", /subscribeToProducts\(\)/.test(re), true);
  // Costs are not re-fetched here, only dropped: the new branch's costs are
  // fetched if and when somebody asks for a cost figure. Re-fetching them on
  // every branch change would reinstate exactly the cost this removed.
  check("...and drops the cost map rather than refetching it",
    /invalidateProductCosts\(\)/.test(re), true);
  // Kept apart from the role-change path, which clears collections this must
  // not touch.
  check("it is not the role-change path", /unsubscribeExpenses/.test(re), false);
}

console.log("\n=== the rules did not move ===");
{
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  // This is a client-side narrowing. If it ever needed a rules change, that
  // would mean it had widened something.
  check("products are still gated by store access",
    /match \/products\/\{productId\}/.test(rules), true);
  check("nothing here grants a new read",
    /catalogueStoreIds/.test(rules), false);
}



console.log("\n=== costs are fetched when asked for, not held all day ===");
{
  // One cost document per product means this collection is the same size as
  // the catalogue. Held live, every manager and owner paid for all of it every
  // session to render a single dashboard tile.
  check("the live cost listener is gone", /subscribeToProductCosts/.test(src), false);
  check("...replaced by a fetch", /async function loadProductCosts/.test(src), true);
  const load = extract("loadProductCosts");
  check("it uses getDocs, not onSnapshot",
    /getDocs\(/.test(load) && !/onSnapshot\(/.test(load), true);
  check("it is still scoped to the branch", /await catalogueStoreIds\(\)/.test(load), true);
  check("a till never loads costs at all", /isManagerOrOwnerRole\(\)/.test(load), true);
  // A failed fetch must not look like a shop with no costs recorded.
  check("a failure leaves it UNLOADED, not loaded-and-empty",
    /console\.warn\("\[productCosts\]"[\s\S]{0,120}?productCostsLoaded = false/.test(load), true);

  const ensure = extract("ensureProductCosts");
  check("asking twice fetches once",
    /if \(state\.productCostsLoaded \|\| state\.productCostsLoading\) return;/.test(ensure), true);
}

console.log("\n=== nothing claims 'no costs recorded' while they are merely unfetched ===");
{
  // THE trap. An unloaded cost map makes every product look uncosted, which is
  // indistinguishable from a business that has never recorded a buying price --
  // and the app says exactly that in words. Reporting its own laziness as the
  // shop's bookkeeping is the failure this guards.
  const panel = extract("renderAdminControl");
  check("the tile checks loaded before judging",
    /state\.productCostsLoaded\s*\n?\s*&& state\.products\.some/.test(panel), true);
  check("...and offers to fetch instead", /showStockValueButton/.test(panel), true);
  check("...saying so while it fetches", /control\.stockValueLoading/.test(panel), true);
  // Retail value needs no costs, so it stays on the tile either way -- the tile
  // is still worth reading before anyone asks for cost.
  check("retail value is shown regardless", /control\.stockAtRetail/.test(panel), true);
  for (const key of ["control.showStockValue", "control.stockValueLoading"]) {
    const n = (src.match(new RegExp(`"${key.replace(/\./g, "\.")}":`, "g")) || []).length;
    check(`${key} is in en and sw`, n, 2);
  }
  // The report is the other reader, and opening it IS the request.
  check("the valuation report asks for costs",
    /ensureProductCosts\(\);\s*\n\s*const valuation = summariseStockValuation/.test(src), true);
}

console.log("\n=== a written cost drops the cached map ===");
{
  // Without a live listener nothing pushes a new cost at us, so every path that
  // writes one has to say so or the dashboard keeps reporting the old figure.
  for (const fn of ["receiveDelivery", "confirmRestock", "saveProduct"]) {
    check(`${fn} invalidates the cost map`,
      /invalidateProductCosts\(\)/.test(extract(fn)), true);
  }
  const inv = extract("invalidateProductCosts");
  check("invalidating clears the flag", /productCostsLoaded = false/.test(inv), true);
  check("...and the stale figures with it", /state\.productCosts = \[\]/.test(inv), true);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
