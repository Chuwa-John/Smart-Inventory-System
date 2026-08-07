// Phase 27: long-term stability — what a till that is never reloaded accumulates.
//
//   node long-session.test.mjs
//
// Every other suite opens the app, asserts something, and throws the page away.
// A shop does the opposite: one tab, opened when the shutters go up, still open
// when they come down. Nothing that leaks per sale, per render or per question
// is visible to a test that runs once, and all of it is visible to a cashier by
// four in the afternoon on a phone with 2GB of RAM.
//
// The defect this exists for: state.chatHistory was appended to and never
// trimmed. MAX_CHAT_HISTORY capped what was SENT to the model and was mistaken
// for capping what was KEPT, so the array grew for the life of the session --
// and renderChatLog() rebuilds the panel from the whole array with innerHTML on
// every turn, making the cost of the nth question proportional to n. The only
// things that ever emptied it were the Clear button and a reload.
//
// The rest of these are invariants that were already true when this was written.
// They are pinned here because each one is a single edit away from not being
// true, and none of them fails loudly -- a second bindEvents() call does not
// throw, it just makes every button fire twice.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

function extractFn(name) {
  const start = app.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let i = app.indexOf("(", start), parens = 0;
  for (; i < app.length; i++) {
    if (app[i] === "(") parens++;
    else if (app[i] === ")") { parens--; if (parens === 0) { i++; break; } }
  }
  let depth = 0;
  i = app.indexOf("{", i);
  for (; i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}") { depth--; if (depth === 0) break; }
  }
  return app.slice(start, i + 1);
}

// The enclosing top-level function of a character offset, by actual brace span.
// Taking the nearest declaration ABOVE an offset is not the same thing: it
// misattributes top-level code sitting after the last function in the file,
// which is exactly where the service worker is registered.
const SPANS = (() => {
  const spans = [];
  const re = /\n(?:async )?function ([A-Za-z0-9_$]+)\s*\(/g;
  for (let m; (m = re.exec(app)); ) {
    let i = app.indexOf("(", m.index), parens = 0;
    for (; i < app.length; i++) {
      if (app[i] === "(") parens++;
      else if (app[i] === ")") { parens--; if (parens === 0) { i++; break; } }
    }
    let depth = 0;
    i = app.indexOf("{", i);
    const start = i;
    for (; i < app.length; i++) {
      if (app[i] === "{") depth++;
      else if (app[i] === "}") { depth--; if (depth === 0) break; }
    }
    spans.push({ name: m[1], start, end: i });
  }
  return spans;
})();

function enclosingFn(offset) {
  return SPANS.find((s) => offset > s.start && offset < s.end)?.name ?? null;
}

// Call sites, excluding the declaration itself.
function callCount(name) {
  return [...app.matchAll(new RegExp(`(?<!function )\\b${name}\\s*\\(`, "g"))].length;
}

console.log("=== the chat log is bounded, and the newest exchange survives ===");
{
  const capMatch = app.match(/const MAX_CHAT_LOG_MESSAGES = (\d+);/);
  check("a cap on the STORED log exists", Boolean(capMatch),
    "MAX_CHAT_HISTORY bounds what is sent to the model, not what is kept");
  const CAP = Number(capMatch?.[1] ?? 0);

  const state = { chatHistory: [] };
  const { pushChatMessage } = new Function("state", "MAX_CHAT_LOG_MESSAGES",
    `${extractFn("pushChatMessage")}\nreturn { pushChatMessage };`)(state, CAP);

  // A long but entirely ordinary day of asking the advisor questions.
  for (let i = 0; i < 500; i++) {
    pushChatMessage({ role: "user", content: `question ${i}` });
    pushChatMessage({ role: "assistant", content: `answer ${i}` });
  }

  check("1,000 messages do not accumulate", state.chatHistory.length <= CAP,
    `held ${state.chatHistory.length} of 1000, cap is ${CAP}`);
  check("the most recent answer is still there",
    state.chatHistory.at(-1)?.content === "answer 499",
    `last is ${JSON.stringify(state.chatHistory.at(-1))}`);
  check("the oldest question is gone",
    !state.chatHistory.some((m) => m.content === "question 0"));

  // Load-bearing: askAi() overwrites the last entry by index once the model
  // answers. Trimming from the END would make it write over the wrong message,
  // or over one that is no longer there.
  const beforeLength = state.chatHistory.length;
  state.chatHistory[state.chatHistory.length - 1] = { role: "assistant", content: "real answer" };
  check("replacing the last entry by index still lands on the placeholder",
    state.chatHistory.at(-1).content === "real answer" && state.chatHistory.length === beforeLength);

  // Trimming has to happen on the way in, not on the way out, or the peak is
  // still unbounded however tidy the array looks afterwards.
  const fresh = { chatHistory: [] };
  const { pushChatMessage: push2 } = new Function("state", "MAX_CHAT_LOG_MESSAGES",
    `${extractFn("pushChatMessage")}\nreturn { pushChatMessage };`)(fresh, CAP);
  let peak = 0;
  for (let i = 0; i < 300; i++) {
    push2({ role: "user", content: `q${i}` });
    peak = Math.max(peak, fresh.chatHistory.length);
  }
  check("the array never peaks above the cap mid-run", peak <= CAP, `peaked at ${peak}`);
}

console.log("\n=== nothing appends to the log behind the cap's back ===");
{
  // The helper's own push is the legitimate one; everything else is a bypass.
  const outside = app.replace(extractFn("pushChatMessage"), "");
  const direct = [...outside.matchAll(/state\.chatHistory\.push\(/g)].length;
  check("every append goes through pushChatMessage", direct === 0,
    `${direct} direct state.chatHistory.push() call(s) bypass the cap`);
  check("pushChatMessage is actually used", callCount("pushChatMessage") >= 3,
    `${callCount("pushChatMessage")} call sites`);
}

console.log("\n=== the undo stack is bounded too ===");
{
  // Deep-clones the whole cart per change. Uncapped, a busy till holds every
  // intermediate basket of the day.
  const idx = app.indexOf("state.cartHistory.push(");
  const near = app.slice(idx, idx + 220);
  check("cart undo history is capped", /state\.cartHistory\.length > \d+/.test(near),
    "a JSON deep-clone per cart change, kept forever");
}

console.log("\n=== every snapshot listener is released before it is replaced ===");
{
  // Firestore listeners are the expensive kind of leak: each one holds a query,
  // a callback and everything the callback closes over, and keeps receiving.
  const subs = [...app.matchAll(/state\.(unsubscribe[A-Za-z]+)\s*=\s*onSnapshot\(/g)];
  check("subscriptions were found to check", subs.length >= 8, `${subs.length} found`);
  const unreleased = [];
  for (const m of subs) {
    const handle = m[1];
    const fnName = enclosingFn(m.index);
    if (!fnName) { unreleased.push(`${handle} (no enclosing function)`); continue; }
    const body = extractFn(fnName);
    const releasePos = body.indexOf(`state.${handle}`);
    const released = new RegExp(`if \\(state\\.${handle}\\) state\\.${handle}\\(\\)`).test(body);
    // The release must also come before the reassignment inside that function.
    const assignPos = body.indexOf(`state.${handle} = onSnapshot(`);
    if (!released || releasePos > assignPos) unreleased.push(`${handle} in ${fnName}()`);
  }
  check("each resubscribe releases the previous listener first", unreleased.length === 0,
    unreleased.join("\n      "));
}

console.log("\n=== one-shot wiring runs exactly once ===");
{
  // None of these throw when run twice. bindEvents() twice means every button
  // fires its handler twice -- two sales from one click on Complete Sale.
  for (const fn of ["bindEvents", "initIdleActivityTracking", "installFaultReporting", "watchConnection"]) {
    check(`${fn}() is called once`, callCount(fn) === 1, `${callCount(fn)} call sites`);
  }
}

console.log("\n=== repeating timers and frames cannot stack ===");
{
  const idle = extractFn("startIdleWatcher");
  check("the idle interval refuses to start twice",
    /if \(state\.idleCheckIntervalId\) return;/.test(idle),
    "a second setInterval with no clear leaves the first running forever");

  const sched = extractFn("scheduleRenderAll");
  check("a queued render frame is not queued again",
    /if \(scheduledRenderFrame !== null\) return;/.test(sched));
  check("...and the slot is cleared when it runs",
    /scheduledRenderFrame = null;/.test(sched),
    "otherwise the guard latches and rendering stops entirely");

  // Counting clearInterval calls was the wrong test: an interval meant to live
  // as long as the page needs no clear, and one started twice is a leak however
  // many clears exist elsewhere. What matters is whether it can be started
  // twice at all.
  const started = [];
  for (const m of app.matchAll(/setInterval\(/g)) {
    const fn = enclosingFn(m.index);
    if (!fn) continue;                                  // module top level, runs once
    const guarded = /if \(state\.[A-Za-z]*IntervalId\) return;/.test(extractFn(fn));
    if (callCount(fn) !== 1 && !guarded) started.push(`${fn}() — ${callCount(fn)} call sites, no guard`);
  }
  check("no repeating timer can be started twice", started.length === 0, started.join("\n      "));
}

console.log("\n=== listeners on document and window are bound from one-shot code ===");
{
  // A listener on a node that gets replaced dies with it. A listener on
  // document or window outlives everything, so binding one from code that runs
  // more than once accumulates for the life of the session.
  const globals = [...app.matchAll(/(?:document|window)\.addEventListener\(/g)];
  check("global listeners were found to check", globals.length >= 5, `${globals.length} found`);
  const repeated = [];
  for (const m of globals) {
    const fnName = enclosingFn(m.index);
    if (!fnName) continue;                    // module top level, runs once
    if (callCount(fnName) !== 1) repeated.push(`${fnName}() — ${callCount(fnName)} call sites`);
  }
  check("none is bound from a function called more than once", repeated.length === 0,
    [...new Set(repeated)].join("\n      "));
}

console.log("\n=== a failed lazy load does not leave debris ===");
{
  // The load is deliberately retried, so the dead tag has to go or a shop
  // exporting repeatedly on a bad connection collects one per attempt.
  const fn = extractFn("loadScriptOnce");
  check("the script tag is removed when the load fails",
    /onerror = \(\) => \{[\s\S]*?script\.remove\(\)/.test(fn),
    "retries are expected here, so the tags would accumulate");
}

console.log("\n=== date boundaries are not frozen at load ===");
{
  // A till open past midnight must not keep reporting yesterday as today.
  for (const fn of ["getSalesRangeBounds", "renderManagerControl"]) {
    const body = extractFn(fn);
    check(`${fn}() reads the clock when it runs`, /new Date\(\)/.test(body),
      "a date captured at module scope makes an overnight session report the wrong day");
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
