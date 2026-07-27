// DEPRECATED — this file is no longer used for price-override authorization and is
// excluded from Firebase Hosting deploys (see firebase.json "ignore").
//
// Price overrides are now verified server-side only, by the Render proxy's
// /api/ai/override-verify endpoint (proxy/server.js), which checks the submitted
// code against PRICE_OVERRIDE_PASSWORD_HASH — a bcrypt hash stored exclusively in
// Render's environment variables, never in any file shipped to the browser.
//
// Do not reintroduce a client-side password/hash check here or anywhere in app.js.
// Any secret value placed in a deployed JS file is trivially readable via DevTools
// and can be brute-forced offline in seconds if it's an unsalted hash of a short
// password or PIN. This file is kept only as a historical marker so a future
// session doesn't mistake its absence for an unfinished migration.
export const priceConfig = {};
