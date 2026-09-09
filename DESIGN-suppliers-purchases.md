# Suppliers, purchase credit, stock movements and reports

Driven by `AviaSmart_Prototype_Specification.docx` (received 2026-09-09), a
20-section specification from the largest prospective client. This document
records what that spec actually asks for beyond what already ships, and the
decisions taken before writing any code.

The spec's product name, "AviaSmart", is a typo. Nothing is rebranded.

---

## 1. What the spec asks for that already exists

Roughly half. Recording it so nobody rebuilds a working module against a
document that describes it:

| Spec | Status |
|---|---|
| §2 Navigation | All nine items exist. "Accounts" is currently a nav **group heading**, not a ledger module |
| §4.1 Products | Most fields; missing Unit and Active/Inactive; `sku` is permitted by the rules but has no input |
| §4.5 Weighted-average valuation | Live — Stock Valuation report |
| §6 POS | Live |
| §6.1 COGS at sale | Live. The spec's worked example (sell 20 @ 2,500 against average cost 2,000 → gross profit 10,000) already computes correctly |
| §7 Direct / indirect expenses | Live, shipped 2026-09-08 |
| §8 Weighted-average costing engine | Live, with landed costs folded in |
| §10 Profit & Loss | Live in the `DESIGN-landed-costs.md` §9 shape, **not** the periodic shape this spec wants |
| §14 Validation | Most rules present |
| §15 UX | Live |

## 2. Scope decision

The owner chose on 2026-09-09: **build A, B, D and E; hold C.**

- **A — Suppliers and purchase credit** (§5)
- **B — Stock movements and adjustments** (§4.2–4.4)
- **C — Double-entry accounting** (§12, §13, and the Balance Sheet / Trial
  Balance / General Ledger / Cash Flow in §9) — **HELD**
- **D — Reports** (§9)
- **E — Smaller items** (§4.1, §6, §10, §11, §16)

### 2.1 Why C is held

`RESEARCH-accounts.md` (2026-08-21) found that **Tax Administration Act
s.35(7)**, as amended by the Finance Act 2023, requires a taxpayer's primary
data server — explicitly including a *virtual* server — to be inside Tanzania.
The books live in Firestore, which is not.

That research concluded the Accounts module must not be designed until the owner
answered the question, and predicted this exact moment: the question "arrives
with the biggest clients, whose auditors ask it."

Building a general ledger does not sidestep this. It makes SaviaSmart the system
of record for a taxpayer's statutory books, which is precisely what invites the
question. So C waits for a decision on residency, not for engineering capacity.

**A, B, D and E are all needed whichever way C is decided**, and none of them
make us the system of record for statutory books.

### 2.2 Reports — the safest reading

The owner had Reports pruned on 2026-09-08 to "only what actually helps a
business", and this spec asks for ~25. Asked to take the safest decision, the
rule adopted is:

> **Group by section as §9 specifies, and build only reports with real
> transaction data behind them. Say plainly which ones need the ledger.**

A report that renders a plausible-looking figure it cannot actually support is
worse than an absent one — that is the defect this project already shipped once,
when revenue was drawn as profit. Financial Reports (Balance Sheet, Trial
Balance, General Ledger, Cash Flow) are ledger-dependent and are therefore
**named as unavailable, not faked**.

---

## 3. Phases

1. **Suppliers as records** (§5.4) — a supplier master, replacing free text.
2. **Purchase header, payment status, returns** (§5.1–5.3, 5.5) — invoice
   reference, Paid / Partially Paid / Credit, amount due, supplier balances and
   statements, purchase returns.
3. **Stock movements and adjustments** (§4.2–4.4) — adjustment reasons, Opening
   Stock as its own class, per-product In / Out / running balance.
4. **Reports** (§9) — grouped, data-backed only.
5. **Smaller items** (§4.1, §6, §10, §11, §16) — product Unit and
   Active/Inactive, an SKU input, Bank as a payment method, the periodic P&L
   presentation with margins, AR/AP dashboard tiles, and seed data.

---

## 4. Phase 1 — Suppliers

### 4.1 The problem

A supplier is a **free-text string** today. `purchases.supplierName` is typed per
purchase and `products.supplier` is a separate free-text field, so "Twiga
Cement", "Twiga cement" and "TWIGA" are three suppliers to every report that
groups by them. There is nowhere to record a phone number, a TIN, or what is
owed. §5.4 asks for all of it, and §5.1's Amount Due is meaningless without it.

### 4.2 Shape

`users/{ownerUid}/suppliers/{supplierId}`:

| Field | Notes |
|---|---|
| `name` | required, 1–80, matches the customer convention |
| `phone` | optional, ≤ 20 — a supplier is often chased by phone, but unlike a customer they are not created *by* a phone number, so it is not required |
| `email` | optional, ≤ 120 |
| `address` | optional, ≤ 200 |
| `tin` | optional, ≤ 40 — the TRA taxpayer number, already captured per-purchase as `supplierTin` |
| `openingBalance` | number ≥ 0, what was already owed at onboarding |
| `balanceOwed` | number ≥ 0, maintained by phase 2 |
| `active` | boolean |
| `storeId` | scoping, as every other collection |
| `createdAt` / `updatedAt` | timestamps |

### 4.3 Backward compatibility, which is the whole risk

Eight shops are live and every purchase they have ever written carries
`supplierName` as a string. So:

- `supplierName` **stays** on the purchase, denormalised. It is what old records
  have and what reports already read.
- `supplierId` is **added and optional**, exactly as `deliveryId` / `goodsCost` /
  `landedCost` were added in `DESIGN-landed-costs.md` §3.
- Reports group by `supplierId` when it is present and fall back to
  `supplierName` when it is not, so history keeps working and does not silently
  split into two suppliers.

This is forward-only. Nothing is migrated and no existing document is rewritten.

### 4.4 Rules

A new `match /suppliers/{supplierId}` block, flat and iteration-free like the
rest. Read for owner/manager/cashier scoped to their stores (a cashier does not
buy stock, but the POS product list already denormalises a supplier name and a
denied read would break rendering); write for owner and manager only —
purchasing is not a till function. The expression budget is re-probed after.

### 4.5 Phase 1 record — built 2026-09-09

Suppliers are records. `users/{ownerUid}/suppliers/{supplierId}` carries name,
phone, email, address, TIN, opening balance, balance owed, active and storeId.
A panel inside Purchases lists them with what has been bought from each; a
dialog adds and edits.

**The link is a name match, not a required picker.** `supplierLinkFor(name)`
resolves a typed supplier name to a `supplierId` and returns `{}` when nothing
matches. The delivery, restock and product forms keep their free-text boxes —
now backed by a `<datalist>` of the recorded names — and still write
`supplierName` exactly as before. So:

- a shop mid-flow in those forms is unaffected;
- a device that has been offline and holds no supplier list still records the
  purchase;
- an old purchase with only a typed name keeps working, and reports fall back to
  that name rather than splitting one supplier into two.

`validPurchase()` is a `hasOnly()` whitelist, so `supplierId` had to be added to
it or every linked purchase would have been refused. That widening is asserted
directly, along with the whitelist still refusing an unknown field.

Deliberately **not** done in this phase: the delivery *header* also carries a
supplier, and linking it needs `validDelivery()` widened. That belongs with the
purchase header in phase 2 rather than widening two schemas at once.

**Coverage.** `suppliers.test.mjs` (61) over the real helpers, and
`rules-suppliers.test.mjs` (36) driving real writes against the rules on the
emulator — role split, field bounds, the no-delete rule, and the purchase
widening. Seven negative controls, each confirmed red then reverted.

Suite: **3,597 assertions across 70 suites, all green.**

**Not yet verified in a browser.** The click-through needs a signed-in session
and the local one had lapsed; the panel's presence and its cashier gating were
confirmed in the live DOM, but adding a supplier and watching a purchase link to
it has not been done by hand.

---

## 5. Phase 2 — purchase credit, supplier balances, returns (2026-09-09)

### 5.1 Where payment terms live

The spec's §5 "Purchase" is a header with a supplier, an invoice reference, many
product lines and a payment status. **That document already exists here: it is a
Delivery.** So the terms were added to the delivery header rather than building a
second, overlapping "purchase" concept beside it — which is precisely the
disconnected-pages failure §20 warns against.

`amountPaid`, `paymentMethod` and `supplierId` are all **optional**. Deliveries
shipped on 2026-09-08 and the live shops already hold headers carrying none of
them, so **absent `amountPaid` reads as PAID IN FULL** — the reading that claims
no debt nobody entered. Paid / Partially paid / On credit is **derived** from the
money and never stored: a status somebody can set by hand is a status that
disagrees with the figures.

### 5.2 The balance is stored, and that was forced

`subscribeToDeliveries()` and `subscribeToPurchases()` are both capped at
`ACCOUNTS_HISTORY_LIMIT` (L-13). A client adding up the deliveries it happens to
hold would therefore **understate** what is owed to any supplier with more
history than the window — and understating a debt is the direction that loses
money. So `supplier.balanceOwed` is a running figure maintained inside the
delivery transaction and the payment transaction, exactly as the customer credit
book works.

That third write is why the delivery arithmetic moved from `n×5+2` to **`n×5+3`**
(80 lines = 403 writes against Firestore's 500 cap). Updated in `app.js`, in the
rules comment, and in the test that checks the sum.

### 5.3 Returns

`purchaseReturns` is a separate collection, never an edit to the purchase: the
purchase records what was actually bought and paid, and rewriting it would
destroy the history the Purchase Book exists to keep. A return values the goods
at **that purchase's own unit cost**, not today's weighted average — the supplier
credits back what they charged. It relieves only what is **still owed**
(`min(amount, owed)`), because goods already paid for come back as cash or a
credit note, which this app does not model, and a negative balance would invent a
debt the supplier owes us.

`supplier-return` is its own stock-movement reason. `return` already means a
*customer* bringing goods back, which **increases** stock; labelling one as the
other would make the ledger read backwards. Added to both allowlists.

## 6. Phase 3 — stock movements and adjustments (2026-09-09)

Adjustments take a **closed set** of reasons (count / damaged / expired / lost /
theft / correction / opening / other) because this is the field an owner filters
on: "Damaged", "damaged" and "broke it" are three answers to one question. The
client list and the rules list are asserted to be **the same set in both
directions** — a legal choice refused on write, after the shop has counted the
shelf, is the worst possible time to find a mismatch.

The form asks for the **new** quantity and derives the difference, because a shop
counting a shelf knows what is on it, not how far it has drifted. The delta is
recomputed **inside the transaction** against what is actually stored, so an
adjustment cannot undo a sale that happened while the dialog sat open.

Spec §4.2 asks that current stock not be freely edited. The quantity box is now
read-only when **editing** a product and open when **adding** one — that first
number is opening stock, and there is no ledger to derive it from yet.

The product drill-down gained a **running-balance ledger**, oldest first (a
running total only reads forwards). The balance column is the ledger's own
`quantityAfter`, never a total this code adds up: an entry written offline
carries no chain (L-9) and says so rather than showing an invented figure.

That query filters by `productId` and orders by `createdAt`, which needed a
**composite index that did not exist**. `load-volume.test.mjs` caught it — the
emulator builds indexes on demand, so this fails only in production. Declared,
and the test now requires the index rather than forbidding the query.

## 7. Phase 4 — reports (2026-09-09)

Grouped as §9 groups them: Financial / Sales / Purchases / Inventory / Expenses.
Built: Sales by Customer, Sales Returns, Purchase Summary, Purchases by Product,
Purchase Returns, Supplier Balances, Stock Summary, Stock Adjustments, Expenses
by Category.

**Balance Sheet, Trial Balance, General Ledger and Cash Flow are named as
unavailable, not rendered.** They are statements of a double-entry ledger this
system does not keep, and the panel says so and offers Profit & Loss instead.
Every cost-bearing report sits behind the owner gate and **empties** rather than
hides for a wrong role.

One defect found here: `summarisePurchases` **already existed** for the Purchases
screen's month totals. Two function declarations of one name do not collide
loudly in JavaScript — the later simply wins — so the new report was quietly
reading a different function's shape. Renamed to `summarisePurchaseTotals`.

## 8. Phase 5 — the smaller items (2026-09-09)

Product **Unit**, **SKU** and **Active/Inactive** (§4.1); `active` absent reads
as active, or eight live catalogues vanish from the till at once. A `<select>`
hands back the string `"true"`, which the rules refuse — coerced to a boolean.

**Bank** as a payment method (§6). Adding it to the till was the easy half; the
half that mattered was that `summariseSales` accumulates `if (method in s)` and
the staff breakdown summed `collected` from cash + mobile + card only — so bank
takings would have **silently dropped out of Collected**. Both fixed, and the
tests that pinned "seven columns" and a three-term formula were re-anchored on
the claim (header count equals body-cell count; collected sums exactly the
methods the loop tracks) rather than the literals.

**Net margin** on the P&L (§10), guarded on revenue because 0/0 is `NaN` and
"NaN%" is how an owner stops trusting a statement. Gross margin was already
there.

**Accounts Receivable / Payable** tiles on the dashboard (§11), owner-only, and
shown only when there is something to show.

### Not done, and why

- **§12–13 double-entry ledger** — held on the owner's decision, pending
  s.35(7). See §2.1.
- **§10 periodic P&L presentation** (Opening Inventory + Net Purchases − Closing
  Inventory) — closing inventory is computable today, opening inventory is not:
  it needs a historical stock valuation this system has never snapshotted.
  Deriving it would mean inventing the figure the statement turns on.
- **§16 sample data** — a seed script is still owed, and is now owed twice over
  (see `DESIGN-landed-costs.md` §18.6).

## 9. Coverage

**3,792 assertions across 72 suites, all green**, emulator rules block included.
New: `suppliers` (61), `rules-suppliers` (36, real writes against real rules),
`purchase-credit` (87), `stock-and-reports` (107). Negative controls run for
every one — 7 + 9 + 11 + 3, each confirmed red then reverted.

Nothing is committed or deployed. Local verification by hand is still owed: the
App Check debug token for the preview browser has to be registered in the
Firebase console before anyone can sign in on localhost.

---

## 10. Live walkthrough, and what it found — 2026-09-09

Driven by hand in the browser against the emulator, signed in as the owner.

### 10.1 A defect the tests could not have caught

The supplier statement read:

```
Bought from them          1,560,000
Paid to them                400,000
STILL OWED                  600,000
```

Three correct figures that **visibly do not add up**. The stored balance was
right; the page was missing a line. Money handed over *at delivery time* lives on
the delivery header, not in the payments book, so 560,000 had nowhere to appear.

Only findable by opening the screen and reading it — every assertion in
`purchase-credit.test.mjs` passed while it was wrong, including the one that
says the stored balance is the authority. Fixed with a "Paid when the goods
arrived" line, and four assertions added that pin the reconciliation.

### 10.2 What the walkthrough proved

| Step | Result |
|---|---|
| Supplier created | Appears, and is offered by the delivery form's datalist |
| Delivery 1,560,000 with 560,000 paid | **Partially paid**, 1,000,000 due; supplier balance moved by exactly the shortfall |
| Landed cost | Unit cost 15,600 = (1,500,000 + 60,000) / 100 |
| Overpaying a supplier | Refused, naming what is actually owed |
| Payment of 400,000 | Balance 1,000,000 → 600,000 |
| Return of 10 units | Refused above what remains; stock 100 → 90; ledger reads `supplier-return`; debt 600,000 → 444,000 (10 × 15,600) |
| Adjustment 90 → 87, damaged | No-op refused; live delta hint; shelf 87 |
| Product ledger | `restock +100 → 100`, `supplier-return −10 → 90`, oldest first |
| Sale of 5 paid by **Bank** | Reaches *Collected* in the staff breakdown — the bug caught before it shipped |
| P&L | COGS 78,000; gross 22,000 · 22%; after a 45,000 direct expense, net −23,000 · **−23%** |
| Every §9 report | Correct against the fixture |
| **Delivery saved with the payment box untouched** | Reads **Paid**, owes nothing, supplier balance unmoved |

That last row is the one that protects the eight live shops.

### 10.3 Every control audited

`tests/button-audit.mjs` walks the markup *and* the row templates app.js builds
at runtime: **116 buttons with an id, 43 `data-` actions, 12 nav items, 24
dialogs — none unwired, none orphaned, all closable.** Verified by injecting a
dead button and by deleting a live handler; both were caught. Every nav item and
dialog-opener was then clicked in the browser and confirmed to open what it
claims. Destructive controls (sign out, delete account, archive, delete) were
audited but deliberately not fired.

## 11. Accounts becomes a menu — 2026-09-09

The owner asked for it: the Accounts heading was a `<p>`, which is why clicking
it did nothing. It is now a `<button>` with `aria-expanded`/`aria-controls` and a
chevron, opening **Purchases, Expenses and Profit Report**.

Deliveries moved out to top level — it feeds the Purchase Book but is a
stock-flow screen — and VAT with it, since it is hidden entirely for an
unregistered business and should not need a menu opened to reach it.

The care is in one rule: **the menu opens itself whenever one of its own screens
is showing**, regardless of the remembered preference. Reaching Profit from the
command palette or a role redirect would otherwise leave the current screen
hidden inside a collapsed menu, which reads as the nav having lost it. Verified
by reaching Profit from the Reports panel with the group shut. The open/closed
choice is remembered per device, in a `try/catch` because `localStorage` itself
throws in a private window.

### A second render defect, found by a fixture

Adding the net margin surfaced that `renderProfit()` interpolated the percentage
directly: a summary missing the field printed **`TZS 8,000,000.00 · undefined%`**
on the money screen. Both margins now go through `withMargin()`, which prints the
percentage only when there is a real one.

**Suite: 3,798 assertions across 72 suites, all green.** Nothing committed or
deployed.

---

## 12. Forgot password — 2026-09-09

The button worked; what it *said* did not. Three defects, one of them the same
class as the sign-in problem reported the same day.

**1. Every failure was reported as success.** The handler caught everything and
fell through to "a password reset link has been sent" — so a dead uplink, a
blocked App Check token or a misconfigured project all looked exactly like a
delivered email. The shop then waited on mail that was never sent, on the one
screen where they are already locked out and have no other way in.

Now only the codes that would **disclose whether an address has an account**
(`user-not-found`, `invalid-recipient-email`, `email-not-found`) are swallowed
behind the neutral sentence — telling those apart is how someone tests a list of
addresses against this business. Everything else is named: too many attempts,
offline, a malformed address (on the field, not in a toast), and a catch-all
failure.

**2. Offline, it claimed to have sent an email.** Now refused up front, before
anything is claimed.

**3. The reset link was a dead end.** With no `actionCodeSettings` the link
finishes on Firebase's own page: English only, unbranded, with no way back to
the app. It now carries a continue URL to `/app.html`.

That URL must be an **authorised domain** on the project, and an unauthorised one
rejects the *whole request* — so a domain nobody remembered to authorise would
have broken password reset outright. The send is retried without the continue
URL in that case: the link back is a courtesy, getting the email out is not.

**Coverage.** `forgot-password.test.mjs` (34) runs the real handler over stubs
that record what it did, with the enumeration boundary asserted hardest: all
three silent codes must be indistinguishable from success, and every other code
must not be. Six negative controls, each confirmed red — including
"a missing account is reported differently from success".

Verified live: a malformed address marks the field and shows no toast; an
address with no account gets the neutral message and a real request (200); the
button re-enables either way.

**Suite: 3,832 assertions across 73 suites, all green.**

---

## 13. The seed script — 2026-09-09

`proxy/seed-demo-tenant.mjs`. Spec §16 asks for a populated prototype; this
project owed one twice over, the second time after a hand-built local dataset
was destroyed by killing the emulator that held it
(`DESIGN-landed-costs.md` §18.6).

```
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
  node proxy/seed-demo-tenant.mjs --uid <ownerUid> [--reset]
```

### 13.1 It cannot reach production

This writes sales, stock and balances; against the live project it would corrupt
eight real businesses. So it refuses unless `FIRESTORE_EMULATOR_HOST` is set
**and** that host answers the way a Firestore emulator does. The Admin SDK only
speaks to the emulator when that variable is set, so a production run is not a
matter of care — it is unreachable. Both refusals verified, along with a host
that is not listening and a host that answers but is not an emulator.

The probe uses `node:http` with `agent: false` rather than `fetch()`. A safety
gate must halt immediately, and `fetch()` leaves its connection in a keep-alive
pool, which made that immediate `process.exit()` trip a libuv assertion on
Windows — so a correct refusal was followed by what looked like a crash, which
is exactly how somebody talks themselves into working around the guard.

### 13.2 The data reconciles, which is the point

A fixture with incoherent numbers is worse than none: every report reads wrong
and the next person spends a day chasing a defect that only exists in the seed.
So nothing is typed that can be derived. The script walks a 40-day timeline,
chains every stock movement, recomputes the weighted average at each stock-in
the way `nextUnitCost()` does, and derives every balance from the documents it
just wrote. It refuses to seed at all if any shelf would go negative.

Verified by reading the tenant back: for all five products
`quantity == sum(deltas) == last quantityAfter` with an unbroken chain; all three
supplier balances match what the deliveries, payments and returns imply
(XYZ at 1,884,836 to the shilling); and cost history lands before the sales that
consume it, so COGS resolves instead of reporting revenue as profit.

Names are spec §16's: Water/Soda/Juice 500ml, Rice 25kg, Sugar 1kg; ABC Traders,
XYZ Distributors, Sunrise Suppliers; Customer A and B plus walk-in sales. It
prints the shelf, the balances and the totals on completion, so the invariants
can be read rather than trusted.
