// Minimal static server for local testing. No dependencies, so it needs no
// download and cannot fail because a registry is slow.
//
// Two things it does that a naive static server does not, and both matter here:
//
//   no-store on everything -- this app ships a service worker and a versioned
//   asset stamp, and a cached local file is exactly how you end up testing the
//   build you had an hour ago while believing it is the current one.
//
//   correct module MIME -- app.js is loaded as <script type="module">, and a
//   browser refuses a module served as anything but a JavaScript type.
//
// Not part of the deployed site: firebase.json's hosting ignore list names this
// file explicitly. There is no *.mjs glob there -- gen-sri.mjs is listed by name
// too -- so a new dev-only .mjs at the root ships unless someone adds it.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(".");
// 5173, not an arbitrary port: proxy/server.js defaults CORS_ORIGINS to
// http://localhost:5173, so anything else is refused by the AI proxy with no
// Access-Control-Allow-Origin header and the auth throttle goes unreachable.
const PORT = Number(process.env.PORT || 5173);

// ---------------------------------------------------------------------------
// Emulator mode (SAVIA_EMULATOR=1)
//
// Why the rewrite lives HERE and not in app.js:
//
// Pointing the client at an emulator means editing the Firebase auth and
// Firestore init -- the single most dangerous block in the file, and the one
// serving eight live shops. A hostname guard would probably be fine (app.js
// already ships one for the App Check debug token) but "probably fine" in the
// auth path is not a trade worth making for a test harness.
//
// This server is excluded from hosting by name, so a patch applied here cannot
// reach production by any deploy path. app.js on disk is never modified; the
// bytes are transformed in flight and only when the env flag is set.
//
// Every patch must match EXACTLY ONCE or the request fails with a 500. A patch
// that silently stops matching would serve an unpatched app.js pointed at the
// production project while the console says "emulator" -- that is the false
// green that cost a whole emulator run earlier, and it fails loud instead.
const EMULATOR = process.env.SAVIA_EMULATOR === "1";
const FIRESTORE_PORT = Number(process.env.SAVIA_FIRESTORE_PORT || 8080);

const PATCHES = [
  {
    name: "connect Firestore emulator",
    // Firestore ONLY. Auth and App Check are left exactly as production runs
    // them, for two reasons:
    //
    //   The Auth emulator will not start without an `emulators` block in
    //   firebase.json, and that is a tracked file the live project deploys
    //   from. A test harness does not get to edit it.
    //
    //   App Check is ENFORCED on Firebase Auth here. Disabling it locally to
    //   quieten the console risks 401 auth/firebase-app-check-token-is-invalid
    //   on the next token refresh, which would look like a bug in the code
    //   under test rather than in the harness.
    //
    // The Firestore emulator decodes a real ID token and honours its uid
    // without verifying the signature, so request.auth.uid in firestore.rules
    // is the genuine signed-in user. That is the whole point: real client,
    // real identity, real rules, disposable data.
    //
    // Placed after the persistence try/catch so it runs whichever branch set
    // state.db, and before any read or write is issued.
    find: "      state.db = firestoreApi.getFirestore(app);\n    }\n",
    replace:
      "      state.db = firestoreApi.getFirestore(app);\n    }\n"
      + `    firestoreApi.connectFirestoreEmulator(state.db, "127.0.0.1", ${FIRESTORE_PORT});\n`
  }
];

function patchAppJs(src) {
  let out = src;
  for (const p of PATCHES) {
    const hits = out.split(p.find).length - 1;
    if (hits !== 1) {
      throw new Error(
        `emulator patch "${p.name}" matched ${hits} times, expected exactly 1. `
        + "app.js has moved; refusing to serve a half-patched build."
      );
    }
    out = out.replace(p.find, p.replace);
  }
  return out;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

const server = createServer(async (req, res) => {
  let path = "?";
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    // Strip the ?v= stamp: the file on disk is the file, and the stamp is a
    // cache key for the CDN rather than part of the name.
    path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    const full = join(ROOT, normalize(path));
    // Refuse anything that escapes the served directory.
    if (!full.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const info = await stat(full);
    if (!info.isFile()) throw new Error("not a file");
    let body = await readFile(full);

    if (EMULATOR && path === "/app.js") {
      body = Buffer.from(patchAppJs(body.toString("utf8")), "utf8");
      console.log(`200 ${path}  [emulator-patched]`);
    } else {
      console.log(`200 ${path}`);
    }

    res.writeHead(200, {
      "Content-Type": TYPES[extname(full).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store, must-revalidate",
      "Content-Length": body.length
    });
    res.end(body);
  } catch (err) {
    // A failed patch is a server error, not a missing file. Saying "404" here
    // would send someone looking for the wrong problem entirely.
    if (err && String(err.message).startsWith("emulator patch")) {
      console.error(`500 ${path} -- ${err.message}`);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end(err.message);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    console.log(`404 ${req.url}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`serving ${ROOT} on http://localhost:${PORT}`);
  if (EMULATOR) {
    console.log(`EMULATOR MODE: firestore :${FIRESTORE_PORT} patched in flight; auth + App Check unchanged (real)`);
  }
});
