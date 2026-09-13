// Clears the .js-pending flag that app.html ships with, revealing the app and
// hiding the "this browser cannot run SaviaSmart" notice.
//
// This is a separate file rather than an inline <script> for one reason: the
// production Content-Security-Policy is `script-src 'self' ...` with no
// 'unsafe-inline' and no nonce, so an inline script is silently blocked. When it
// was inline the flag was never cleared, the notice showed on every browser, and
// the app was unreachable. tests/compatibility.headless.mjs now serves the real
// CSP so that cannot happen again.
//
// It stays a MODULE so a browser too old for ES modules ignores it and keeps the
// notice -- which is the entire point of the mechanism. And it is separate from
// app.js so the decision does not wait on a 360 KB download over a slow link.
// The saved theme, applied here rather than in app.js: this file is in the
// <head> and app.js is a 400 KB module below it, so restoring the choice there
// would show the wrong theme first and repaint -- a white flash on a dark till,
// in a dark shop. It is a module for the CSP reason above, not an inline
// script.
//
// Light is the markup default (see the data-theme on <html>), so only an
// explicit "dark" has anything to undo. Anything else stored is ignored rather
// than trusted: localStorage is writable by anything on this origin.
try {
  const savedTheme = localStorage.getItem("savia.theme");
  if (savedTheme === "dark") document.documentElement.removeAttribute("data-theme");
  else if (savedTheme === "light") document.documentElement.dataset.theme = "light";
} catch (error) {
  // A browser with storage blocked keeps the default. Not worth a message.
}

document.documentElement.classList.remove("js-pending");
