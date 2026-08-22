// Verifies the expenses collection -- DESIGN-purchases.md 8 and 10 -- by
// evaluating the REAL functions out of app.js rather than a reimplementation,
// which would only prove the copy agrees with itself.
//
//   node expenses.test.mjs
//
// Two things carry the weight here. The arithmetic feeds net profit, so a
// month that quietly counts the wrong expenses misstates the owner's profit.
// And the role gating is a privacy decision, not a cosmetic one: 10 puts
// wages in the category list and makes the collection owner-and-manager only,
// so a cashier must neither subscribe to it nor render it.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const { summariseExpenses, expenseSpentAt, localDateInputValue, localMonthKey, moneyAuditEntry } = new Function(
  `${extract("safeNumber")}
   ${extract("expenseSpentAt")}
   ${extract("localMonthKey")}
   ${extract("summariseExpenses")}
   ${extract("moneyAuditEntry")}
   ${extract("localDateInputValue")}
   return { summariseExpenses, expenseSpentAt, localDateInputValue, localMonthKey, moneyAuditEntry };`
)();

const results = [];
function check(name, actual, expected) {
  const pass = actual === expected;
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : `\n      expected ${expected}, got ${actual}`}`);
}

// A local Date is what the capture path actually produces: saveExpense() parses
// the date input with new Date(y, m - 1, d, 12, 0, 0), never a UTC constructor.
const on = (y, m, d, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm, 0);
const expense = (over = {}) => ({
  storeId: "A", category: "other", amount: 10000, paidFrom: "other",
  spentAt: on(2026, 9, 12), ...over
});

console.log("=== a month of spending adds up ===");
{
  const s = summariseExpenses([
    expense({ amount: 250000, category: "rent" }),
    expense({ amount: 40000, category: "transport" }),
    expense({ amount: 10000, category: "transport" })
  ], "2026-09");
  check("the total is the sum", s.total, 300000);
  check("the count is the number of expenses", s.count, 3);
  check("nothing was paid from the till", s.fromTill, 0);
}

console.log("\n=== only the month that was asked for ===");
{
  // The owner picks a month and reads a figure off it. An expense from a
  // neighbouring month leaking in overstates that month's costs and understates
  // the other one, and neither figure can be reconciled against anything.
  const s = summariseExpenses([
    expense({ amount: 100000, spentAt: on(2026, 8, 31) }),
    expense({ amount: 200000, spentAt: on(2026, 9, 1) }),
    expense({ amount: 400000, spentAt: on(2026, 9, 30) }),
    expense({ amount: 800000, spentAt: on(2026, 10, 1) })
  ], "2026-09");
  check("only September is counted", s.total, 600000);
  check("...and only September is counted in the count", s.count, 2);
  check("the last day of August is excluded", s.total < 700000, true);
  check("the first day of October is excluded", s.total < 1400000, true);

  // Same month number, different year. Cheap to get wrong if the key were
  // built from getMonth() alone, and a year-old rent bill in this month's
  // total is not a rounding error.
  const crossYear = summariseExpenses([
    expense({ amount: 500000, spentAt: on(2025, 9, 12) }),
    expense({ amount: 300000, spentAt: on(2026, 9, 12) })
  ], "2026-09");
  check("last year's September is a different month", crossYear.total, 300000);

  const emptyMonth = summariseExpenses([expense({ spentAt: on(2026, 7, 4) })], "2026-09");
  check("a month with no spending is zero, not NaN", emptyMonth.total, 0);
  check("...and reports no count", emptyMonth.count, 0);
}

console.log("\n=== paidFrom separates what left the drawer ===");
{
  // 8.3: nothing subtracts this from expected cash yet, so this figure is the
  // only thing on any screen that explains a drawer coming up short. If it
  // counted non-till spending too it would explain a shortfall that never
  // happened, which is worse than the silence it replaces.
  const s = summariseExpenses([
    expense({ amount: 30000, paidFrom: "till" }),
    expense({ amount: 20000, paidFrom: "till" }),
    expense({ amount: 700000, paidFrom: "other" })
  ], "2026-09");
  check("till spending is summed separately", s.fromTill, 50000);
  check("bank and pocket spending stays out of the till figure", s.fromTill, 50000);
  check("...but is still part of the month total", s.total, 750000);

  // paidFrom is written by saveExpense() as strictly "till" or "other", but a
  // document from a future build, or one hand-written, must not be guessed at
  // as till money. Only the exact string counts.
  check("a missing paidFrom is not till money",
    summariseExpenses([expense({ amount: 5000, paidFrom: undefined })], "2026-09").fromTill, 0);
  check("an unrecognised paidFrom is not till money",
    summariseExpenses([expense({ amount: 5000, paidFrom: "Till" })], "2026-09").fromTill, 0);
  check("...and it still counts toward the month total",
    summariseExpenses([expense({ amount: 5000, paidFrom: "Till" })], "2026-09").total, 5000);
}

console.log("\n=== the largest category is the one worth naming ===");
{
  const s = summariseExpenses([
    expense({ amount: 250000, category: "rent" }),
    expense({ amount: 90000, category: "transport" }),
    expense({ amount: 90000, category: "transport" }),
    expense({ amount: 40000, category: "utilities" })
  ], "2026-09");
  check("the top category is the largest by total, not by frequency", s.topCategory, "rent");
  check("...and its amount is reported", s.topAmount, 250000);

  // Two expenses in one category have to be added before they are ranked.
  // Ranking single documents would make the biggest single payment win, which
  // is a different and much less useful statement.
  const summed = summariseExpenses([
    expense({ amount: 100000, category: "rent" }),
    expense({ amount: 60000, category: "transport" }),
    expense({ amount: 60000, category: "transport" })
  ], "2026-09");
  check("amounts within a category are added before ranking", summed.topCategory, "transport");
  check("...to their combined total", summed.topAmount, 120000);

  // The tile renders topCategory ? label : "—". null is what makes it show the
  // dash; a "" or "other" default would print a category the shop never used.
  const nothing = summariseExpenses([], "2026-09");
  check("nothing spent means no top category", nothing.topCategory, null);
  check("...and a top amount of zero", nothing.topAmount, 0);
  const wrongMonth = summariseExpenses([expense({ spentAt: on(2026, 5, 1) })], "2026-09");
  check("a month with nothing in it also has no top category", wrongMonth.topCategory, null);
}

console.log("\n=== malformed documents are skipped, not fatal ===");
{
  // These reach the client. An expense mid-write has a null spentAt until the
  // server stamp resolves, and a document from a future build may carry a shape
  // this client does not know. A throw here blanks the whole screen, including
  // the rows that are fine.
  const mixed = summariseExpenses([
    expense({ amount: 100000 }),
    { amount: 999999, spentAt: null },
    { amount: 999999 },
    { amount: 999999, spentAt: "not a date" },
    { amount: 999999, spentAt: {} }
  ], "2026-09");
  check("a good expense still counts alongside broken ones", mixed.total, 100000);
  check("...and the broken ones are not counted", mixed.count, 1);

  const nonNumeric = summariseExpenses([
    expense({ amount: "abc" }),
    expense({ amount: null }),
    expense({ amount: 5000 })
  ], "2026-09");
  check("an unparseable amount does not poison the total with NaN",
    Number.isNaN(nonNumeric.total), false);
  check("...and the good amount survives it", nonNumeric.total, 5000);
  check("no expenses at all is zero, not NaN", summariseExpenses([], "2026-09").total, 0);
}

console.log("\n=== month bucketing is LOCAL, not an ISO slice ===");
{
  // The regression this whole section exists for. Someone tidying the key
  // construction into at.toISOString().slice(0, 7) gets a shorter line that is
  // correct only at Greenwich. Tanzania is UTC+3 and every shop this serves is
  // east of UTC, so an expense recorded just after local midnight on the 1st
  // has a UTC instant still in the previous month -- it would vanish from the
  // month the owner picked and appear in one they have already closed.
  //
  // The trap is a Date-shaped stand-in rather than a real Date so that it
  // catches the rewrite on ANY machine, including a CI runner pinned to UTC
  // where no real instant can tell the two implementations apart. expenseSpentAt
  // returns whatever toDate() hands back without an instanceof check, so this
  // reaches summariseExpenses exactly as a Firestore timestamp would.
  const trap = {
    getFullYear: () => 2026,
    getMonth: () => 8,          // September, local
    getDate: () => 30,
    getTime: () => 1790000000000,
    toISOString: () => "2026-10-01T02:30:00.000Z"  // October, in UTC
  };
  check("the trap really does disagree with an ISO slice",
    trap.toISOString().slice(0, 7) === "2026-09", false);

  const rows = [{ amount: 75000, category: "transport", paidFrom: "till",
                  spentAt: { toDate: () => trap } }];
  check("a late-evening expense stays in its LOCAL month",
    summariseExpenses(rows, "2026-09").total, 75000);
  check("...and does not appear in the following month",
    summariseExpenses(rows, "2026-10").total, 0);
  check("...the count follows the same rule",
    summariseExpenses(rows, "2026-09").count, 1);
  check("...and so does the till figure that explains a short drawer",
    summariseExpenses(rows, "2026-09").fromTill, 75000);

  // The same claim with genuine Date objects on this machine's real clock
  // settings. One of these two instants differs from its ISO slice for any
  // timezone that is not UTC: west of Greenwich it is the late evening of the
  // last day, east of it -- where these shops are -- it is just after midnight
  // on the first. Both must bucket by their local month.
  const lastEvening = on(2026, 9, 30, 23, 30);
  const firstMorning = on(2026, 10, 1, 0, 30);
  check("23:30 on the last day of September is September",
    summariseExpenses([expense({ amount: 1000, spentAt: lastEvening })], "2026-09").total, 1000);
  check("...and is not October",
    summariseExpenses([expense({ amount: 1000, spentAt: lastEvening })], "2026-10").total, 0);
  check("00:30 on the first of October is October",
    summariseExpenses([expense({ amount: 2000, spentAt: firstMorning })], "2026-10").total, 2000);
  check("...and is not September",
    summariseExpenses([expense({ amount: 2000, spentAt: firstMorning })], "2026-09").total, 0);

  // The month key is zero-padded, because it is compared as a string against
  // the value of a <input type="month">, which is always "YYYY-MM".
  check("a single-digit month is padded to match the month input",
    summariseExpenses([expense({ amount: 3000, spentAt: on(2026, 3, 9) })], "2026-03").total, 3000);
  check("...and an unpadded key matches nothing",
    summariseExpenses([expense({ amount: 3000, spentAt: on(2026, 3, 9) })], "2026-3").total, 0);
}

console.log("\n=== the timestamp shapes that actually reach this screen ===");
{
  const real = on(2026, 9, 12, 14, 0);

  // Once the write lands, Firestore hands back a Timestamp.
  check("a Firestore timestamp is unwrapped",
    expenseSpentAt({ spentAt: { toDate: () => real } })?.getTime(), real.getTime());

  // Before it lands, the local echo of an offline write carries the plain Date
  // that saveExpense() built. This is the shape a shop with no signal sees, and
  // it is the whole reason the collection is a create with no read: a blank
  // date column here would make the offline case look broken.
  check("a plain Date is passed through",
    expenseSpentAt({ spentAt: real })?.getTime(), real.getTime());

  check("a parseable string is parsed",
    expenseSpentAt({ spentAt: real.toISOString() })?.getTime(), real.getTime());

  // null rather than an Invalid Date: every caller tests the result for
  // truthiness, and an Invalid Date is truthy and renders as "Invalid Date".
  check("a missing spentAt is null", expenseSpentAt({}), null);
  check("a null spentAt is null", expenseSpentAt({ spentAt: null }), null);
  check("an unparseable string is null", expenseSpentAt({ spentAt: "nonsense" }), null);
  check("an empty string is null", expenseSpentAt({ spentAt: "" }), null);
  check("a bare object with no toDate is null", expenseSpentAt({ spentAt: {} }), null);
  check("a missing expense is null, not a throw", expenseSpentAt(undefined), null);
  check("a null expense is null, not a throw", expenseSpentAt(null), null);
}

console.log("\n=== the date input is filled with a LOCAL day ===");
{
  // openExpenseDialog() prefills <input type="date">, which wants "YYYY-MM-DD".
  check("a plain date is formatted", localDateInputValue(on(2026, 9, 12)), "2026-09-12");
  check("a single-digit month is padded", localDateInputValue(on(2026, 3, 12)), "2026-03-12");
  check("a single-digit day is padded", localDateInputValue(on(2026, 12, 5)), "2026-12-05");
  check("both are padded together", localDateInputValue(on(2026, 1, 1)), "2026-01-01");

  // The same rewrite risk as the month key, one field wider. Editing an expense
  // recorded at 23:30 and re-saving it under an ISO slice would silently walk
  // its date backwards or forwards a day on every edit, in a screen whose whole
  // point is that spentAt is the date the money left.
  const trap = {
    getFullYear: () => 2026,
    getMonth: () => 8,   // September, local
    getDate: () => 30,
    toISOString: () => "2026-10-01T02:30:00.000Z"
  };
  check("the trap really does disagree with an ISO slice",
    trap.toISOString().slice(0, 10) === "2026-09-30", false);
  check("the local day wins over the UTC one", localDateInputValue(trap), "2026-09-30");

  // Real instants, for whichever direction this machine's offset runs.
  check("23:30 on the last day of the month keeps that day",
    localDateInputValue(on(2026, 9, 30, 23, 30)), "2026-09-30");
  check("00:30 on the first keeps that day",
    localDateInputValue(on(2026, 10, 1, 0, 30)), "2026-10-01");

  // Round trip: what the dialog writes into the input is what saveExpense()
  // parses back out, or an untouched edit moves the date.
  const roundTrip = localDateInputValue(on(2026, 9, 30, 23, 30)).split("-").map(Number);
  check("the value re-parses to the same local day",
    new Date(roundTrip[0], roundTrip[1] - 1, roundTrip[2], 12, 0, 0).getDate(), 30);
  check("...and the same local month",
    new Date(roundTrip[0], roundTrip[1] - 1, roundTrip[2], 12, 0, 0).getMonth(), 8);
}

// ---------------------------------------------------------------------------
// Source-level checks. These are claims about wiring and gating that no pure
// function can carry: a correct summariseExpenses is worth nothing if nobody
// calls it, and correct arithmetic shown to a cashier is a privacy failure
// rather than a maths one.
const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

// Slices one function body: from its declaration to whichever top-level
// declaration comes next. renderExpenses is not async, so an "\nasync function"
// anchor alone would run past it into subscribeToServices.
function body(header) {
  const start = noComments.indexOf(header);
  if (start === -1) throw new Error(`${header} not found in app.js`);
  const rest = noComments.slice(start + header.length);
  const ends = [rest.indexOf("\nfunction "), rest.indexOf("\nasync function "), rest.indexOf("\nconst ")]
    .filter((i) => i !== -1);
  return rest.slice(0, ends.length ? Math.min(...ends) : rest.length);
}

console.log("\n=== a cashier neither subscribes to nor renders expenses ===");
{
  // 10: recording an expense is owner and manager only, and firestore.rules
  // refuses the collection to a cashier. Subscribing anyway would not leak the
  // data -- the rules hold -- but it would print permission-denied in every
  // cashier's console on every sign-in, which teaches a shop to ignore the one
  // channel that reports real breakage.
  const subscribe = body("async function subscribeToExpenses(");
  check("subscribeToExpenses refuses a non-manager",
    /if \(!isManagerOrOwnerRole\(\)\)\s*\{\s*state\.expenses = \[\];\s*return;\s*\}/.test(subscribe), true);
  check("...before it reaches onSnapshot, not after",
    subscribe.indexOf("isManagerOrOwnerRole()") < subscribe.indexOf("onSnapshot("), true);
  check("...and empties the list rather than leaving a previous role's data",
    /state\.expenses = \[\];\s*return;/.test(subscribe), true);

  // The second half of the same decision. state.expenses is empty for a cashier
  // anyway, but renderExpenses is reached from renderAll on every repaint and
  // the totals tiles must not be built for a role that may not see them.
  const render = body("function renderExpenses(");
  check("renderExpenses refuses a non-manager",
    /if \(!isManagerOrOwnerRole\(\)\) \{[\s\S]{0,200}return;\s*\}/.test(render), true);
  // Emptied, not merely skipped. A demoted manager's rows would otherwise sit in
  // a section hidden by CSS with every wages figure still in the DOM.
  check("...and empties the table rather than leaving stale rows",
    /table\.innerHTML = "";/.test(render), true);
  check("...before it writes any figure into the totals tiles",
    render.indexOf("isManagerOrOwnerRole()") < render.indexOf("totals.innerHTML"), true);
  check("...and before it writes any row into the table",
    render.indexOf("isManagerOrOwnerRole()") < render.indexOf("table.innerHTML"), true);

  // The nav-level gate. canOpenView() is the choke point the command palette
  // and stale click handlers also pass through, so an entry here would open the
  // screen for a cashier regardless of what the render function decides.
  check("the cashier allowlist is still just the till",
    /const CASHIER_ALLOWED_VIEWS = \["pos"\];/.test(noComments), true);
  check("expenses is not in the cashier allowlist",
    /CASHIER_ALLOWED_VIEWS = \[[^\]]*expenses/.test(noComments), false);
}

console.log("\n=== corrections are the owner's ===");
{
  // A manager records, only the owner corrects -- an expense is a book entry,
  // and letting whoever wrote it rewrite the amount removes the control the
  // collection exists to provide. firestore.rules enforces it; these two gates
  // stop a manager filling in a dialog and then being refused on save.
  const del = body("async function deleteExpense(");
  check("deleteExpense is owner-only", /if \(!isOwnerRole\(\)\) return;/.test(del), true);
  // The delete is batched with its audit entry now, so the write it must not
  // reach is batch.delete rather than a bare deleteDoc.
  check("...and refuses before it prepares any write",
    del.indexOf("isOwnerRole()") < del.indexOf("batch.delete("), true);
  // Immediately follows, with only whitespace between. The looser form matched
  // the text even with `if (false)` wrapped round the audit write, which is a
  // presence test dressed as a behaviour test.
  check("the deletion is batched with an audit entry",
    /batch\.delete\([^;]+\);\s*batch\.set\([\s\S]{0,200}moneyAuditEntry\("EXPENSE_DELETED"/.test(del), true);

  const open = body("function openExpenseDialog(");
  check("editing an existing expense is owner-only",
    /if \(existing && !isOwnerRole\(\)\) return;/.test(open), true);
  check("...but recording a new one is not blocked by that gate",
    open.indexOf("existing && !isOwnerRole()") > open.indexOf("state.expenses.find"), true);
  check("...and it refuses before the dialog is shown",
    open.indexOf("isOwnerRole()") < open.indexOf("dialog.showModal()"), true);

  // The row buttons are only drawn for an owner. Not a security boundary -- the
  // rules and the two gates above are -- but a manager clicking Delete and
  // getting nothing at all is the worse failure.
  const render = body("function renderExpenses(");
  check("the edit and delete buttons are drawn only for an owner",
    /const canEdit = isOwnerRole\(\);/.test(render), true);
  check("...and the row markup honours that", /canEdit \? `/.test(render), true);
}

console.log("\n=== saving an expense works offline ===");
{
  const save = body("async function saveExpense(");

  // "all stores" cannot own a document: storeId is a required field and the
  // rules pin it. The same refusal saveProduct() and saveService() make.
  check("a new expense is refused while viewing all stores",
    /if \(!existing && state\.currentStoreId === "all"\)/.test(save), true);
  check("...with a toast that says to pick one",
    /showToast\(t\("toast\.selectStoreBeforeAdd"\)\);/.test(save), true);
  check("...and the refusal comes before any write is prepared",
    save.indexOf('state.currentStoreId === "all"') < save.indexOf("batch.set("), true);

  // The offline claim in 8.1, made real. An expense is a create with no read,
  // so it queues and replays like any other offline write -- but only if nobody
  // awaits it. Firestore does not resolve a write promise until the server
  // acknowledges, so awaiting this would hang the dialog open with no spinner
  // and no error, in exactly the no-signal case this collection is for.
  check("the write is not awaited", /await setDoc\(/.test(save), false);
  // Batched with the audit entry, so the record and the evidence land together
  // or not at all -- and still not awaited, because offline the promise does not
  // settle until reconnect.
  check("the write is fire and forget with a catch",
    /batch\.commit\(\)\s*\.catch\(/.test(save), true);
  check("the expense is batched with its audit entry",
    /batch\.set\([\s\S]{0,400}moneyAuditEntry\(existing \? "EXPENSE_UPDATED" : "EXPENSE_RECORDED"/.test(save), true);
  check("...and the catch reports rather than swallowing",
    /\.catch\(\(error\) => \{\s*console\.warn\(error\);\s*showToast\(t\("toast\.expenseFailed"\)\);\s*\}\);/.test(save), true);
  check("the dialog closes after the write is issued, not inside the catch",
    /\}\);\s*qs\("#expenseDialog"\)\.close\(\);/.test(save), true);
  check("...and the shop is told it saved",
    /showToast\(t\(existing \? "toast\.expenseUpdated" : "toast\.expenseSaved"\)\);/.test(save), true);

  // The date input is parsed as local noon, not through new Date("2026-09-01"),
  // which is UTC midnight and therefore the previous day -- and the previous
  // month, on the 1st -- for anyone west of Greenwich.
  check("the date input is parsed into local parts, not through Date(string)",
    /const \[y, m, d\] = spentAtRaw\.split\("-"\)\.map\(Number\);/.test(save), true);
  check("...and built at local midday, clear of both midnights",
    /new Date\(y, \(m \|\| 1\) - 1, d \|\| 1, 12, 0, 0\)/.test(save), true);

  // The closed category set from 8.2 is enforced client-side too, so a stale
  // form or a tampered submit lands in "other" rather than being refused by the
  // rules after the dialog has already closed.
  check("an unknown category falls back to other rather than being sent",
    /EXPENSE_CATEGORIES\.includes\(input\.category\) \? input\.category : "other"/.test(save), true);
  check("paidFrom is narrowed to the two values the rules allow",
    /input\.paidFrom === "till" \? "till" : "other"/.test(save), true);
}

console.log("\n=== the table listener is delegated, not per row ===");
{
  // renderExpenses rewrites table.innerHTML on every snapshot, and a snapshot
  // arrives for every expense anyone in the business records. Binding a handler
  // per row would attach a fresh set on each repaint against elements the
  // previous set was bound to, which is a leak that grows with the day.
  check("the click handler is bound once on the table",
    /qs\("#expensesTable"\)\?\.addEventListener\("click", \(event\) => \{/.test(noComments), true);
  check("...and finds the row button by delegation",
    /event\.target\.closest\("\[data-edit-expense\]"\)/.test(noComments), true);
  check("...for delete as well as edit",
    /event\.target\.closest\("\[data-delete-expense\]"\)/.test(noComments), true);

  const render = body("function renderExpenses(");
  check("renderExpenses binds no listeners of its own",
    /addEventListener/.test(render), false);
  check("...and the row buttons carry data attributes rather than inline handlers",
    /onclick=/.test(render), false);
}

console.log("\n=== money figures do not outlive the session ===");
{
  // The next sign-in on this handset may be a different business. An expense
  // list left in state would be rendered for whoever signs in next, before any
  // snapshot arrives to correct it -- and the listener left running would keep
  // writing the previous business's spending into it.
  const teardownStart = noComments.indexOf("stopIdleWatcher();");
  const teardown = noComments.slice(teardownStart, noComments.indexOf("state.cart = [];", teardownStart));
  check("the sign-out teardown block was located",
    teardown.length > 500 && teardown.length < 4000, true);
  check("the expenses listener is detached on sign-out",
    /if \(state\.unsubscribeExpenses\) state\.unsubscribeExpenses\(\);/.test(teardown), true);
  check("...and the handle is dropped",
    /state\.unsubscribeExpenses = null;/.test(teardown), true);
  check("...and the spending itself is cleared",
    /state\.expenses = \[\];/.test(teardown), true);

  // Order matters: clearing the array while the listener is still attached
  // leaves the next snapshot free to refill it.
  check("the listener is detached before the list is cleared",
    teardown.indexOf("state.unsubscribeExpenses()") < teardown.indexOf("state.expenses = []"), true);
}

console.log("\n=== the wiring is where it is claimed to be ===");
{
  // Correct arithmetic that nothing calls is a screen that never updates.
  const renderAll = body("function renderAll(");
  check("renderAll repaints the expenses screen", /renderExpenses\(\);/.test(renderAll), true);

  const signInStart = noComments.indexOf("await loadUserSettings(user);");
  const signIn = noComments.slice(signInStart, noComments.indexOf("stopIdleWatcher();", signInStart));
  check("the sign-in block was located", signIn.length > 200 && signIn.length < 2000, true);
  check("signing in subscribes to expenses", /subscribeToExpenses\(\);/.test(signIn), true);
  check("...alongside the other collections, not before the profile is loaded",
    signIn.indexOf("subscribeToExpenses()") > signIn.indexOf("subscribeToProducts()"), true);

  // Changing the month must repaint, or the owner picks August and keeps
  // reading September's figures.
  check("changing the month re-renders",
    /state\.expenseMonthSelection = event\.currentTarget\.value[\s\S]{0,80}renderExpenses\(\);/.test(noComments), true);

  // The rows and the tiles must be filtered by the same rule, or the total says
  // one thing and the rows visible underneath it add up to another.
  const render = body("function renderExpenses(");
  check("the tiles are built from summariseExpenses",
    /const summary = summariseExpenses\(scoped, monthKey\);/.test(render), true);
  // Asserted as the property, not as one spelling of it. This originally pinned
  // the inline `${at.getFullYear()}-${String(at.getMonth() + 1)...}` expression
  // and went red when that arithmetic was pulled into localMonthKey() -- a test
  // failing on a fix rather than on a defect. What matters is that the rows and
  // the tiles bucket by the SAME rule; which function holds it is not the point.
  check("the rows are filtered by the same local month key",
    /localMonthKey\(at\) === monthKey/.test(render), true);
  // Scoped to the two expense readers on purpose. Other parts of app.js build a
  // month key inline for their own reasons and predate this work; the property
  // here is that the expenses screen has exactly one month rule, not that the
  // whole file does.
  check("...and neither expense reader re-implements it inline",
    /getFullYear\(\)\}-\$\{String\(/.test(render + body("function summariseExpenses(")), false);
  check("both read the same branch-scoped list",
    /const scoped = storeExpenses\(\);/.test(render), true);

  // storeExpenses() is the branch filter. Without it a multi-branch owner
  // viewing one shop would see every shop's spending in that shop's total.
  const scope = body("function storeExpenses(");
  check("a chosen branch filters the list", /expense\.storeId === state\.currentStoreId/.test(scope), true);
  check("...and all stores shows everything", /state\.currentStoreId === "all"\) return state\.expenses;/.test(scope), true);
  check("...and no store yet shows nothing rather than everything",
    /if \(!state\.currentStoreId\) return \[\];/.test(scope), true);
}

console.log("\n=== every label exists in both languages ===");
{
  // t() falls back to DICTIONARY.en and then to the key itself, so a key missing
  // only from sw does not throw -- it silently prints English to a Swahili shop,
  // and a key missing from both prints "expenses.thAmount" into a table header.
  // Neither shows up in any other test.
  const dictStart = src.indexOf("const DICTIONARY = {");
  const enStart = src.indexOf("\n  en: {", dictStart);
  const swStart = src.indexOf("\n  sw: {", dictStart);
  const dictEnd = src.indexOf("\n};", swStart);
  const enDict = src.slice(enStart, swStart);
  const swDict = src.slice(swStart, dictEnd);
  check("the English dictionary was located", enDict.length > 10000, true);
  check("the Swahili dictionary was located", swDict.length > 10000, true);

  // Keys as they are actually referenced -- app.js outside the dictionary, plus
  // the data-i18n attributes in app.html, which is where most of the expenses
  // screen's static labels live.
  const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
  const referenced = new Set();
  for (const text of [src.slice(0, dictStart), src.slice(dictEnd), html]) {
    for (const m of text.matchAll(/"((?:expenses|cat)\.[A-Za-z]+)"/g)) referenced.add(m[1]);
    for (const m of text.matchAll(/data-i18n(?:-placeholder)?="((?:expenses|cat)\.[A-Za-z]+)"/g)) referenced.add(m[1]);
  }
  check("expense keys were found to check", referenced.size > 20, true);

  for (const key of [...referenced].sort()) {
    const quoted = `"${key}":`;
    check(`${key} exists in English`, enDict.includes(quoted), true);
    check(`${key} exists in Swahili`, swDict.includes(quoted), true);
    // The house idiom, kept as a second reading: a key defined in both
    // dictionaries appears at least twice in the file.
    check(`${key} appears in both dictionaries`,
      (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length >= 2, true);
  }

  // The closed category set from 8.2. A category with no label renders as the
  // raw string in a table cell -- expenseCategoryLabel() deliberately does that
  // rather than print "cat.rent" -- so a missing label is invisible in English
  // and near-invisible in Swahili, where "rent" merely looks untranslated.
  const categories = /const EXPENSE_CATEGORIES = \[([\s\S]*?)\];/.exec(noComments)?.[1] || "";
  const names = [...categories.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  check("all nine categories were found", names.length, 9);
  check("the set matches the design", names.join(","),
    "rent,utilities,wages,transport,supplies,repairs,licences,marketing,other");
  for (const name of names) {
    check(`cat.${name} has an English label`, enDict.includes(`"cat.${name}":`), true);
    check(`cat.${name} has a Swahili label`, swDict.includes(`"cat.${name}":`), true);
  }

  // 8.2 is explicit that there is no entertainment category, because input VAT
  // on it is not deductible and there is no treatment for that yet. It belongs
  // in "other" with a note until there is one.
  check("there is still no entertainment category", names.includes("entertainment"), false);

  // The toasts the save and delete paths reach for. A missing one prints the
  // key into a toast, which is the most visible failure of the lot.
  for (const key of ["toast.expenseSaved", "toast.expenseUpdated",
                     "toast.expenseDeleted", "toast.expenseFailed"]) {
    check(`${key} exists in English`, enDict.includes(`"${key}":`), true);
    check(`${key} exists in Swahili`, swDict.includes(`"${key}":`), true);
  }

  // Placeholder parity: monthCount is called with {count}, so a translation
  // that dropped the placeholder would print a sentence with no number in it.
  check("expenses.monthCount carries its placeholder in both languages",
    (src.match(/"expenses\.monthCount": "[^"]*\{count\}[^"]*"/g) || []).length, 2);
}

console.log("\n=== the month rule has one definition ===");
{
  check("localMonthKey pads a single-digit month",
    localMonthKey(new Date(2026, 8, 15, 12, 0, 0)), "2026-09");
  check("localMonthKey uses local parts, not UTC",
    // 00:30 local on 1 September in EAT is 21:30 on 31 August in UTC. An ISO
    // slice reports August; the shop is in September.
    localMonthKey(new Date(2026, 8, 1, 0, 30, 0)), "2026-09");
  check("localMonthKey handles December without rolling the year",
    localMonthKey(new Date(2026, 11, 31, 23, 30, 0)), "2026-12");

  const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  // The defect the design named, found in the state default after the first
  // implementation landed: everything READ the local month while the value they
  // were all compared against was a UTC slice. Between midnight and 03:00 EAT on
  // the 1st that is the previous month, so the screen opened on last month's
  // total and an expense recorded that morning was invisible.
  check("the default month selection is built from local parts",
    /expenseMonthSelection:\s*localMonthKey\(new Date\(\)\)/.test(noComments), true);
  check("...and not from an ISO slice",
    /expenseMonthSelection:\s*new Date\(\)\.toISOString\(\)/.test(noComments), false);

  // Three readers, one rule. Two copies of a date rule is how they drift.
  const uses = (noComments.match(/localMonthKey\(/g) || []).length;
  check("every month reader goes through the one helper", uses >= 4, true);
  check("no reader still inlines the month arithmetic",
    /getMonth\(\) \+ 1\)\.toString\(\)\.padStart|\$\{at\.getFullYear\(\)\}-\$\{String\(at\.getMonth/.test(noComments), false);
}

console.log("\n=== one collection, one offline behaviour ===");
{
  const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const del = noComments.slice(noComments.indexOf("async function deleteExpense"));
  const delBody = del.slice(0, del.indexOf("\nfunction "));
  check("deleteExpense was located", delBody.length > 100, true);
  // saveExpense deliberately does not await, because offline the promise does
  // not settle until reconnect. deleteExpense awaited, so the same collection
  // behaved two different ways depending on which button was pressed: the row
  // vanished from the local cache and neither toast ever fired.
  check("the delete is not awaited either",
    /await batch\.commit\(\)/.test(delBody), false);
  check("...and reports its own failure",
    /batch\.commit\(\)[\s\S]{0,120}\.catch\(/.test(delBody), true);
}

console.log("\n=== the recorder is shown, because the rules pin it ===");
{
  const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // recordedByUid == request.auth.uid is enforced in firestore.rules precisely
  // so an owner reviewing a manager's spending can trust the name. A key defined
  // in both dictionaries and rendered nowhere is a dropped column.
  check("expenses.recordedBy is actually rendered",
    /t\("expenses\.recordedBy", \{ name:/.test(noComments), true);
  check("a raw uid is never shown in place of a name",
    /recorderName\(expense\) \?/.test(noComments), true);
  const rec = noComments.slice(noComments.indexOf("function recorderName"));
  const recBody = rec.slice(0, rec.indexOf("\nfunction "));
  check("the owner's own entries are not attributed back to them",
    /uid === state\.businessOwnerUid/.test(recBody), true);
  check("the note cell is still escaped alongside it",
    /esc\(expense\.note \|\| ""\)/.test(noComments), true);
}

console.log("\n=== the audit entry omits, it never nulls ===");
{
  // The rule this encodes is the one that took every credit sale to a new
  // customer down: auditStringsBounded() reads `!('x' in d) || d.x is string`,
  // so an ABSENT key passes and a PRESENT-BUT-NULL key refuses the whole write.
  // These entries are batched with the expense or the deletion, so a null in one
  // optional field would take the record with it.
  globalThis.state = { user: { uid: "u1" }, firebaseApi: { firestore: { serverTimestamp: () => "ts" } } };

  const entry = moneyAuditEntry("EXPENSE_DELETED", {
    expenseId: "e1", storeId: null, amount: 4000, category: undefined
  });
  check("a null field is omitted, not written", "storeId" in entry, false);
  check("an undefined field is omitted", "category" in entry, false);
  check("an empty string is omitted too", "note" in moneyAuditEntry("X", { note: "" }), false);
  check("real values survive", entry.expenseId, "e1");
  check("...including numbers", entry.amount, 4000);
  check("zero is a real value and is kept", moneyAuditEntry("X", { amount: 0 }).amount, 0);
  check("the action is set", entry.action, "EXPENSE_DELETED");
  check("the caller is stamped", entry.uid, "u1");
  check("createdAt comes from the server, not the device", entry.createdAt, "ts");
  delete globalThis.state;
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
