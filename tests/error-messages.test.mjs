// Guards QA-009 and QA-010: what a shop floor is told when something fails.
//
//   node error-messages.test.mjs
//
// Preferring error.message put raw SDK English — "Missing or insufficient
// permissions", "Failed to get document because the client is offline" — in
// front of a cashier who may not read English and can act on neither. The
// discriminator is that SDK errors carry a `code` and the app's own thrown
// errors, already built with t(), do not.
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

const mapBlock = src.slice(
  src.indexOf("const SDK_ERROR_MESSAGE_KEYS"),
  src.indexOf("};", src.indexOf("const SDK_ERROR_MESSAGE_KEYS")) + 2
);

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

// Harness: t() returns the key so assertions read as intent, and navigator is
// swapped per case.
const navigator = { onLine: true };
const { describeOperationError } = new Function("navigator", "t",
  `${mapBlock}\n${extract("describeOperationError")}\nreturn { describeOperationError };`
)(navigator, (key) => key);

const sdkError = (code) => Object.assign(new Error("Some raw English SDK text."), { code });
const appError = (translated) => new Error(translated);

console.log("=== SDK failures are translated, never echoed ===");
{
  navigator.onLine = true;
  const cases = [
    ["permission-denied", "error.permissionDenied"],
    ["unavailable", "error.offline"],
    ["deadline-exceeded", "error.timeout"],
    ["resource-exhausted", "error.busy"],
    ["aborted", "error.contention"],
    ["not-found", "error.notFound"],
    ["failed-precondition", "error.failedPrecondition"]
  ];
  for (const [code, expected] of cases) {
    const out = describeOperationError(sdkError(code), "toast.saleFailedGeneric");
    check(`"${code}" maps to a translated message`, out === expected, `got ${out}`);
  }
  const unknown = describeOperationError(sdkError("some-future-code"), "toast.saleFailedGeneric");
  check("an unmapped SDK code falls back to the translated toast",
    unknown === "toast.saleFailedGeneric", `got ${unknown}`);
  check("raw SDK English never reaches the user",
    !cases.some(([code]) => describeOperationError(sdkError(code), "x").includes("raw English")));
}

console.log("\n=== the app's own errors keep their translated text ===");
{
  navigator.onLine = true;
  // These are thrown as new Error(t("txerror.itemGone", {...})) — already
  // translated, and carrying no `code`.
  const out = describeOperationError(appError("Sukari haipo tena kwenye hisa."), "toast.saleFailedGeneric");
  check("a translated app error is shown as-is", out === "Sukari haipo tena kwenye hisa.", `got ${out}`);
  check("it is not replaced by the generic fallback", out !== "toast.saleFailedGeneric");
}

console.log("\n=== offline outranks whatever code the SDK attached ===");
{
  navigator.onLine = false;
  check("a permission error while offline reports the connection",
    describeOperationError(sdkError("permission-denied"), "toast.saleFailedGeneric") === "error.offline");
  check("an app error while offline also reports the connection",
    describeOperationError(appError("Something specific"), "toast.saleFailedGeneric") === "error.offline");
  check("no error object at all still reports the connection",
    describeOperationError(null, "toast.saleFailedGeneric") === "error.offline");
}

console.log("\n=== degenerate input never throws ===");
{
  navigator.onLine = true;
  check("null error falls back", describeOperationError(null, "toast.saleFailedGeneric") === "toast.saleFailedGeneric");
  check("undefined error falls back", describeOperationError(undefined, "toast.saleFailedGeneric") === "toast.saleFailedGeneric");
  check("an error with no message falls back",
    describeOperationError(new Error(""), "toast.saleFailedGeneric") === "toast.saleFailedGeneric");
  check("a non-string code is ignored rather than indexed",
    describeOperationError({ code: 42, message: "x" }, "toast.saleFailedGeneric") === "x");
}

console.log("\n=== no raw SDK message is toasted anywhere ===");
{
  const rawToasts = (src.match(/showToast\(error\.message/g) || []).length;
  check("every error toast goes through the translator", rawToasts === 0,
    `${rawToasts} site(s) still toast error.message directly`);
  check("describeOperationError is actually used",
    (src.match(/describeOperationError\(error, "/g) || []).length >= 5);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
