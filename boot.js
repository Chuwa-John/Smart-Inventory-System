// Clears the .js-pending flag that index.html ships with, revealing the app and
// hiding the "this browser cannot run Savia" notice.
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
document.documentElement.classList.remove("js-pending");
