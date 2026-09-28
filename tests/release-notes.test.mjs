// What changed, for a shop with no app store to read it in.
//
// The failure this guards is silent and the worst kind: a deploy bumps the
// stamp, forgets the notes, and every shop is shown the PREVIOUS release's
// changes under a new version number. That is worse than showing nothing,
// because it is confidently wrong. The top entry must name the stamp being
// shipped, or the build fails here.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const hosting = JSON.parse(readFileSync(new URL("../firebase.json", import.meta.url), "utf8"));
const notes = JSON.parse(readFileSync(new URL("../release-notes.json", import.meta.url), "utf8"));

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass && detail) console.log(`      ${detail}`);
}

console.log("=== the notes describe the build actually being shipped ===");
{
  const stamp = html.match(/app\.js\?v=([0-9a-z]+)/)?.[1] || "";
  check("app.html carries a stamp", Boolean(stamp), `got "${stamp}"`);
  check("the newest entry names that stamp",
    notes.releases[0]?.version === stamp,
    `notes say ${notes.releases[0]?.version}, app.html says ${stamp}`);
  check("entries run newest first",
    notes.releases.every((r, i) => i === 0 || notes.releases[i - 1].version >= r.version),
    notes.releases.map((r) => r.version).join(" > "));
  check("no version appears twice",
    new Set(notes.releases.map((r) => r.version)).size === notes.releases.length);
}

console.log("=== every entry says something, in both languages ===");
{
  for (const release of notes.releases) {
    check(`${release.version} has English lines`,
      Array.isArray(release.en) && release.en.length > 0 && release.en.every((l) => l.trim()));
    check(`${release.version} has Swahili lines`,
      Array.isArray(release.sw) && release.sw.length > 0 && release.sw.every((l) => l.trim()));
    // Not a translation check -- nothing here can do that -- but a missing
    // line is a shop reading one language and getting a shorter story.
    check(`${release.version} says the same number of things in each`,
      release.en.length === release.sw.length,
      `en ${release.en?.length} vs sw ${release.sw?.length}`);
    check(`${release.version} has a date`, /^\d{4}-\d{2}-\d{2}$/.test(release.date || ""));
  }
}

console.log("=== a shopkeeper can read it ===");
{
  // The audience is a shop, not the person who wrote the code. A function
  // name in here means the note was written for the wrong reader.
  const jargon = /\(\)|\bundefined\b|\bnull\b|firestore|serviceWorker|localStorage|app\.js|console\./i;
  for (const release of notes.releases) {
    const offenders = [...release.en, ...release.sw].filter((line) => jargon.test(line));
    check(`${release.version} carries no code in its notes`,
      offenders.length === 0, offenders.join(" | "));
  }
}

console.log("=== the file can actually reach a device ===");
{
  // Unversioned on purpose: the page that reads it is running the OLD build
  // and cannot know the new stamp, so the URL has to be stable.
  check("the notes are fetched by a stable, unversioned url",
    /fetch\("\.\/release-notes\.json"/.test(src) && !/release-notes\.json\?v=/.test(src));
  check("the service worker pre-caches them, so they work offline",
    /"\.\/release-notes\.json"/.test(sw));
  check("...unversioned there too, or the old build would ask for the wrong key",
    !/release-notes\.json\?v=/.test(sw));
  // Same trap firebase-config.js hit in QA-106: an unversioned file served
  // with a long cache pins whatever a device fetched once.
  const rule = (hosting.hosting.headers || []).find((h) => h.source === "/release-notes.json");
  check("hosting serves them no-cache, so a device is not pinned to its first copy",
    Boolean(rule) && rule.headers.some((h) => h.key === "Cache-Control" && /no-cache/.test(h.value)));
  check("they are not swept up by the ignore list",
    !(hosting.hosting.ignore || []).includes("release-notes.json"));
  check("the spa rewrite does not swallow the request",
    /json/.test(hosting.hosting.rewrites?.[0]?.source || ""));
}

console.log("=== the way in, and the way out ===");
{
  check("the update banner offers it", /id="updateWhatsNewButton"/.test(html));
  check("...and it is a real button, not a click handler on text",
    /<button[^>]*id="updateWhatsNewButton"[^>]*type="button"/.test(html));
  check("settings offers it too, for whoever missed the banner",
    /id="settingsWhatsNewButton"/.test(html));
  check("both are wired", /#updateWhatsNewButton"\)\?\.addEventListener/.test(src)
    && /#settingsWhatsNewButton"\)\?\.addEventListener/.test(src));
  check("the banner asks for the INCOMING notes",
    /#updateWhatsNewButton[\s\S]{0,120}openWhatsNew\(\{ incoming: true \}\)/.test(src));
  check("settings asks for incoming only when an update really is waiting",
    /#settingsWhatsNewButton[\s\S]{0,140}openWhatsNew\(\{ incoming: state\.updateReady \}\)/.test(src));
  check("the dialog can be closed", /id="whatsNewDialogClose"/.test(html) && /id="whatsNewDialogDismiss"/.test(html));
  // The dialog offers a reload too -- somebody who has just read "coming when
  // you reload" should not have to hunt for the banner behind it. It must
  // SHARE the one call site, or deployment-validation.test.mjs stops being
  // able to prove the app never refreshes a till on its own.
  check("the dialog offers a reload", /id="whatsNewReloadButton"/.test(html));
  check("...through the one shared call site, not a second one",
    /const reloadForUpdate = \(\) => location\.reload\(\);/.test(src)
      && /#whatsNewReloadButton"\)\?\.addEventListener\("click", reloadForUpdate\)/.test(src));
  check("...and it is hidden unless an update really is waiting",
    /id="whatsNewReloadButton"[^>]*hidden/.test(html)
      && /reload\.hidden = !incoming/.test(src));
  check("the running version is shown, so a phone call can name the build",
    /id="settingsVersion"/.test(html) && /settingsVersion\.textContent = APP_VERSION/.test(src));
}

console.log("=== it fails honestly ===");
{
  check("a failed fetch says so rather than showing an empty panel",
    /update\.whatsNewUnavailable/.test(src));
  check("...and reassures the shop that reloading is still safe",
    /reloading is still safe/.test(src));
  check("a slow fetch shows a loading line, so the button is not dead",
    /update\.whatsNewLoading/.test(src));
  check("a missing language falls back rather than rendering nothing",
    /release\?\.\[state\.\w+\] \|\| release\?\.en/.test(src));
  // The fallback makes a wrong property name INVISIBLE: no error, just English
  // served to every Swahili shop forever. It shipped that way once. So assert
  // the name is the one state actually declares, not merely that some lookup
  // is there.
  const langProp = src.match(/const lines = release\?\.\[state\.(\w+)\]/)?.[1];
  check("...and the language property is the real one",
    Boolean(langProp) && src.includes(`${langProp}: localStorage`),
    `release notes read state.${langProp}, which state does not declare`);
  check("malformed notes are rejected rather than half-rendered",
    /Array\.isArray\(data\?\.releases\)/.test(src));
  check("note text is escaped", /esc\(line\)/.test(src));
}

console.log("=== every key is in both languages ===");
{
  const keys = [
    "update.whatsNewLink", "update.whatsNewTitle", "update.whatsNewClose",
    "update.whatsNewLoading", "update.whatsNewUnavailable", "update.whatsNewNone",
    "update.whatsNewIncoming", "update.whatsNewCurrent", "update.whatsNewEarlier",
    "settings.aboutEyebrow", "settings.versionLabel", "settings.whatsNewButton",
    "settings.whatsNewIntro"
  ];
  for (const key of keys) {
    check(`${key} exists in both languages`,
      (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}":`, "g")) || []).length === 2);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(failed.map((f) => `  FAILED: ${f.name}`).join("\n"));
  process.exit(1);
}
