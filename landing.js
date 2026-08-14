// Landing page: language switch, and the trades marquee.
//
// A FILE rather than an inline <script> because the production CSP is
// script-src 'self' with no unsafe-inline (see firebase.json). An inline
// version is blocked outright, which would ship the page stuck in English
// behind a dead button.
//
// No framework, no build step, no dependency. The whole point of this page is
// that it loads fast on an ordinary Android over an ordinary connection, and
// a translation layer is not worth a payload.

(function () {
  "use strict";

  var STORAGE_KEY = "savia:landing-lang";
  var EN = "en";
  var SW = "sw";

  // The English text lives in the document itself and the Kiswahili in a
  // data-sw attribute beside it, so a string and its translation are edited in
  // one place and can never drift apart in a separate dictionary file.
  //
  // The English is captured on first run rather than duplicated into a second
  // attribute: the DOM already holds it, and writing it twice is one more
  // thing to keep in step.
  var nodes = [].slice.call(document.querySelectorAll("[data-sw]"));

  function capture(el) {
    if (el.getAttribute("data-en") === null) {
      el.setAttribute("data-en", el.textContent);
    }
  }

  function apply(lang) {
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      capture(el);
      var next = lang === SW ? el.getAttribute("data-sw") : el.getAttribute("data-en");
      if (next !== null) el.textContent = next;
    }

    document.documentElement.lang = lang;

    // Names the language you would switch TO. The alternative -- labelling the
    // current language -- is unreadable to the person most likely to need the
    // button, because they cannot read the language it is written in.
    var label = document.getElementById("langLabel");
    if (label) label.textContent = lang === SW ? "English" : "Kiswahili";

    document.title = lang === SW
      ? "SaviaSmart: fahamu duka lako"
      : "SaviaSmart: know your shop";

    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (error) {
      // Private browsing, or storage disabled. The switch still works for this
      // visit; it just will not be remembered, which is a smaller failure than
      // the button doing nothing.
    }
  }

  function preferred() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === SW || saved === EN) return saved;
    } catch (error) {
      // Fall through to the browser's own setting.
    }
    // A Tanzanian phone set to Kiswahili should land on Kiswahili without
    // hunting for a button. Anything else keeps English, which is what the
    // document already holds.
    var langs = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < langs.length; i++) {
      if (/^sw\b/i.test(langs[i] || "")) return SW;
    }
    return EN;
  }

  // The marquee needs the list twice so translateY(-50%) lands exactly on the
  // start of the copy. Duplicating in script rather than in markup means each
  // trade name and its translation are written once.
  //
  // Cloned BEFORE the first apply() so the copies are picked up by the same
  // query and translate with everything else.
  var track = document.getElementById("tradesTrack");
  if (track) {
    var rows = [].slice.call(track.children);
    for (var r = 0; r < rows.length; r++) {
      var copy = rows[r].cloneNode(true);
      copy.setAttribute("aria-hidden", "true");
      track.appendChild(copy);
    }
    // Re-read: the clones carry data-sw and must be translated too.
    nodes = [].slice.call(document.querySelectorAll("[data-sw]"));
  }

  apply(preferred());

  var toggle = document.getElementById("langToggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      apply(document.documentElement.lang === SW ? EN : SW);
    });
  }
})();
