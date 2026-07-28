import { firebaseConfig } from "./firebase-config.js";
import { aiConfig } from "./ai-config.js";

const qs = (selector) => document.querySelector(selector);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getLinkTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("accept-invite") || "";
}

function setFieldError(id, message) {
  const el = qs(`#${id}`);
  if (el) el.textContent = message || "";
}

function showIntro(text) {
  qs("#acceptInviteIntro").textContent = text;
}

let auth = null;
let firebaseApi = null;
let mode = "create"; // "create" | "signin" -- flips if the email already has an account
let linkToken = "";

async function init() {
  linkToken = getLinkTokenFromUrl();
  if (!linkToken) {
    showIntro("This invite link is missing or invalid. Please ask your employer to resend it.");
    return;
  }

  const hasConfig = firebaseConfig && !String(firebaseConfig.apiKey || "").startsWith("YOUR_");
  if (!hasConfig) {
    showIntro("This app is not fully configured yet. Please contact your employer.");
    return;
  }

  showIntro("Enter your email and set a password to accept this invitation.");
  qs("#acceptInviteFormFields").hidden = false;

  const appApi = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js");
  const authApi = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js");
  firebaseApi = { auth: authApi };

  const app = appApi.initializeApp(firebaseConfig);

  // Same App Check setup as the main app -- protects the invite-acceptance
  // endpoint from being hammered by anything other than this real client.
  try {
    if (typeof window.process === "undefined") window.process = { env: {} };
    const { initializeAppCheck, ReCaptchaV3Provider } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-app-check.js");
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider("6LdtGFEtAAAAABK4HX_ufjUMskc7pix12Lz2NMGd"),
      isTokenAutoRefreshEnabled: true
    });
  } catch (appCheckError) {
    console.warn("App Check failed to initialize; continuing without it.", appCheckError);
  }

  auth = authApi.getAuth(app);
}

async function checkAuthAttemptLimit(email) {
  const response = await fetch(new URL("/api/auth/check-limit", aiConfig.proxyUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
  if (response.status === 429) {
    const error = new Error("Too many attempts. Please wait 15 minutes and try again.");
    error.code = "auth/too-many-requests";
    throw error;
  }
  if (!response.ok) {
    const error = new Error("Authentication protection is unavailable.");
    error.code = "auth/network-request-failed";
    throw error;
  }
}

async function callAcceptInvite(idToken) {
  const response = await fetch(new URL("/api/staff/accept-invite", aiConfig.proxyUrl), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ linkToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Could not accept this invite.");
  }
  return payload;
}

// Handles the realistic case where the invitee already has a Firebase Auth
// account under this email (e.g. previously revoked and re-invited, or an
// account from a different business). Locks the email and asks for that
// account's existing password instead of trying to create a duplicate one.
function switchToSignInMode(email) {
  mode = "signin";
  qs("#inviteEmail").value = email;
  qs("#inviteEmail").disabled = true;
  qs("#inviteConfirmPasswordRow").hidden = true;
  qs("#inviteConfirmPassword").required = false;
  qs("#acceptInviteSubmitButton").textContent = "Sign In & Accept Invite";
  setFieldError("acceptInviteError", "An account already exists for this email. Enter its password to sign in and accept the invite.");
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!auth) return;

  const email = qs("#inviteEmail").value.trim();
  const password = qs("#invitePassword").value;
  const confirmPassword = qs("#inviteConfirmPassword").value;

  setFieldError("inviteEmailError", "");
  setFieldError("invitePasswordError", "");
  setFieldError("inviteConfirmPasswordError", "");
  setFieldError("acceptInviteError", "");

  if (!EMAIL_PATTERN.test(email)) return setFieldError("inviteEmailError", "Enter a valid email address.");
  if (password.length < 6) return setFieldError("invitePasswordError", "Password must be at least 6 characters.");
  if (mode === "create" && password !== confirmPassword) {
    return setFieldError("inviteConfirmPasswordError", "Passwords do not match.");
  }

  const submitButton = qs("#acceptInviteSubmitButton");
  submitButton.disabled = true;

  try {
    await checkAuthAttemptLimit(email);
    const { createUserWithEmailAndPassword, signInWithEmailAndPassword } = firebaseApi.auth;

    let credential;
    if (mode === "create") {
      try {
        credential = await createUserWithEmailAndPassword(auth, email, password);
      } catch (createError) {
        if (createError.code === "auth/email-already-in-use") {
          switchToSignInMode(email);
          return;
        }
        throw createError;
      }
    } else {
      credential = await signInWithEmailAndPassword(auth, email, password);
    }

    showIntro("Accepting invite\u2026");
    // The proxy's accept-invite endpoint independently verifies invite.email
    // matches this authenticated account's email -- so even if someone
    // reaches this page and creates/signs into the WRONG email, the server
    // rejects it rather than trusting whatever the client asserts.
    const idToken = await credential.user.getIdToken();
    const result = await callAcceptInvite(idToken);

    showIntro(`Invite accepted as ${result.role}. Redirecting you to the app\u2026`);
    qs("#acceptInviteFormFields").hidden = true;
    window.setTimeout(() => {
      window.location.href = "./index.html";
    }, 1500);
  } catch (error) {
    console.warn(error);
    if (error.code === "auth/too-many-requests") {
      setFieldError("acceptInviteError", "Too many attempts. Please wait a while and try again.");
    } else if (error.code === "auth/weak-password") {
      setFieldError("invitePasswordError", "Use a password with at least 6 characters.");
    } else if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password") {
      setFieldError("acceptInviteError", "Incorrect password for this email.");
    } else {
      setFieldError("acceptInviteError", error.message || "Could not accept this invite. Please try again.");
    }
  } finally {
    submitButton.disabled = false;
  }
}

qs("#acceptInviteForm").addEventListener("submit", handleSubmit);
init();