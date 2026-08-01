const { beforeUserSignedIn, beforeUserCreated } = require("firebase-functions/v2/identity");
const { HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

async function checkAndRecordAttempt(email) {
  const key = String(email || "").toLowerCase().trim();
  if (!key) return;
  const ref = db.collection("authFailures").doc(key);
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const attempts = (snap.exists ? snap.data().attempts || [] : []).filter((ts) => now - ts < WINDOW_MS);
    if (attempts.length >= MAX_ATTEMPTS) {
      throw new Error("too-many-attempts");
    }
    tx.set(ref, { attempts: [...attempts, now], updatedAt: FieldValue.serverTimestamp() });
  });
}

exports.beforeSignIn = beforeUserSignedIn(async (event) => {
  try {
    await checkAndRecordAttempt(event.data.email);
  } catch (error) {
    if (error.message === "too-many-attempts") {
      throw new HttpsError("resource-exhausted", "Too many attempts. Please wait 15 minutes and try again.");
    }
    console.error("beforeSignIn attempt check failed:", error);
    throw new HttpsError("internal", "Sign-in could not be processed. Please try again.");
  }
});

exports.beforeCreate = beforeUserCreated(async (event) => {
  try {
    await checkAndRecordAttempt(event.data.email);
  } catch (error) {
    if (error.message === "too-many-attempts") {
      throw new HttpsError("resource-exhausted", "Too many attempts. Please wait 15 minutes and try again.");
    }
    console.error("beforeCreate attempt check failed:", error);
    throw new HttpsError("internal", "Account creation could not be processed. Please try again.");
  }
});