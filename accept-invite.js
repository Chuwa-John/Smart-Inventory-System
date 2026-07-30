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

// Asks the proxy who issued this invite and for what role. Returns the payload
// on success, {ok:false,...} for a link the server positively rejects (used,
// expired, unknown), or null when the service simply cannot be reached.
//
// Null is deliberately distinct from ok:false: the Render free tier sleeps, and
// a spun-down instance must not be allowed to present a valid invitation as a
// dead one. On null the page falls back to generic wording and still lets the
// invitee proceed -- accept-invite re-validates everything server-side anyway.
async function loadInvitePreview() {
  let response;
  try {
    response = await fetch(new URL("/api/staff/invite-preview", aiConfig.proxyUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkToken }),
      signal: AbortSignal.timeout(8000)
    });
  } catch (error) {
    console.warn("Invite preview unreachable; continuing without it.", error);
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (response.ok && payload.ok) return payload;

  // ONLY a recognised verdict is allowed to close the door. Everything else --
  // a 5xx, an HTML error page, or the 404 served by a proxy older than this
  // page -- means "preview unavailable", not "bad invite". Hosting and Render
  // deploy independently, so a frontend that shipped first would otherwise tell
  // every invitee their valid link was dead. Failing open costs nothing:
  // accept-invite re-validates the token server-side regardless.
  if (PREVIEW_VERDICTS.has(payload.code)) {
    return { ok: false, code: payload.code, error: payload.error || "" };
  }
  console.warn(`Invite preview returned ${response.status} with no verdict; continuing without it.`);
  return null;
}

function renderInviteContext(preview) {
  const roleLabel = ROLE_LABELS[preview?.role] || "staff member";
  const businessName = preview?.businessName || "";

  if (!preview) {
    showIntro("Set a password below to accept this staff invitation and join your employer's business.");
    return;
  }

  const box = qs("#inviteContextBox");
  qs("#inviteContextHeading").textContent = businessName
    ? `${businessName} invited you to join as a ${roleLabel}`
    : `You have been invited to join as a ${roleLabel}`;

  const details = [
    businessName
      ? `You are joining ${businessName}'s existing business on DukaSmart — you are not creating a business of your own.`
      : "You are joining an existing business on DukaSmart — you are not creating a business of your own.",
    preview.emailHint ? `This invitation was issued to ${preview.emailHint}, so sign up with that address.` : "",
    "Your employer controls what you can see and do."
  ].filter(Boolean);

  qs("#inviteContextText").textContent = details.join(" ");
  box.hidden = false;

  showIntro(`Set a password below to accept and create your ${roleLabel.toLowerCase()} sign-in.`);
}

let auth = null;
let firebaseApi = null;
let mode = "create"; // "create" | "signin" -- flips if the email already has an account
let linkToken = "";
const ROLE_LABELS = { cashier: "Cashier", manager: "Manager" };
// The only server answers that mean "this link is genuinely dead".
const PREVIEW_VERDICTS = new Set(["invalid", "used", "expired"]);
// Held across the email-verification step so Continue can reload the same user
// rather than asking for the password again.
let pendingUser = null;

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

  // Resolve who is inviting whom BEFORE showing the form, so this never reads
  // as "create your own account". A dead link (used/expired/unknown) ends here
  // with a plain explanation instead of a password form that cannot succeed.
  const preview = await loadInvitePreview();
  if (preview && preview.ok === false) {
    showIntro(preview.error || "This invite link is no longer valid. Please ask your employer to resend it.");
    return;
  }
  renderInviteContext(preview);
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

// Fails open on infrastructure failure, for the same reason as the copy in
// app.js: the Render free tier sleeps, and answering a spun-down instance with
// a thrown error made the throttle able to block invite acceptance entirely.
// A real 429 is still honoured.
async function checkAuthAttemptLimit(email) {
  let response;
  try {
    response = await fetch(new URL("/api/auth/check-limit", aiConfig.proxyUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(8000)
    });
  } catch (error) {
    console.warn("Auth throttle unreachable; continuing without it.", error);
    return;
  }
  if (response.status === 429) {
    const error = new Error("Too many attempts. Please wait 15 minutes and try again.");
    error.code = "auth/too-many-requests";
    throw error;
  }
  if (!response.ok) {
    console.warn(`Auth throttle returned ${response.status}; continuing without it.`);
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
    // Surface the server's verification requirement as a resumable step rather
    // than a terminal error. The client checks emailVerified before calling, so
    // this only fires if the token was stale -- but a dead-end 403 on the
    // onboarding path is not something to leave to chance.
    const error = new Error(payload.error || "Could not accept this invite.");
    if (payload.code === "email-not-verified") error.code = "email-not-verified";
    throw error;
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

async function finishAcceptance(user) {
  showIntro("Accepting invite…");
  // The proxy's accept-invite endpoint independently verifies invite.email
  // matches this authenticated account's email -- so even if someone
  // reaches this page and creates/signs into the WRONG email, the server
  // rejects it rather than trusting whatever the client asserts.
  const idToken = await user.getIdToken(/* forceRefresh */ true);
  const result = await callAcceptInvite(idToken);

  showIntro(`Invite accepted as ${result.role}. Redirecting you to the app…`);
  qs("#acceptInviteFormFields").hidden = true;
  qs("#inviteVerifySection").hidden = true;
  window.setTimeout(() => {
    window.location.href = "./index.html";
  }, 1500);
}

// Swaps the form for the "check your inbox" step. Kept on the same page with a
// Continue button rather than redirecting: Firebase's verification link opens
// its own page and does not come back here, so the smoothest route is to leave
// this tab open and let the user return to it.
async function startEmailVerification(user) {
  pendingUser = user;
  qs("#acceptInviteFormFields").hidden = true;
  qs("#inviteVerifySection").hidden = false;
  setFieldError("inviteVerifyError", "");
  showIntro("Almost done — just confirm your email address.");
  qs("#inviteVerifyText").textContent =
    `We sent a verification link to ${user.email}. Open it, tap the link, then come back here and press Continue. Check your spam folder if it has not arrived.`;
  await sendVerification(user);
}

async function sendVerification(user) {
  try {
    const { sendEmailVerification } = firebaseApi.auth;
    await sendEmailVerification(user);
  } catch (error) {
    console.warn(error);
    // Firebase rate-limits verification sends. The link from the first email is
    // still valid, so say that rather than implying the process is broken.
    setFieldError(
      "inviteVerifyError",
      error.code === "auth/too-many-requests"
        ? "Too many emails requested. Please use the link in the message already sent, or wait a few minutes."
        : "Could not send the verification email. Press Resend to try again."
    );
  }
}

async function handleVerifyContinue() {
  if (!pendingUser) return;
  const button = qs("#inviteVerifyContinueButton");
  button.disabled = true;
  setFieldError("inviteVerifyError", "");
  try {
    // reload() refreshes the account record; the ID token still carries the old
    // email_verified claim until it is force-refreshed, which finishAcceptance
    // does. Without both steps the server keeps seeing an unverified token.
    await pendingUser.reload();
    if (!pendingUser.emailVerified) {
      setFieldError(
        "inviteVerifyError",
        "This email still shows as unverified. Open the link in the email, then press Continue again."
      );
      return;
    }
    await finishAcceptance(pendingUser);
  } catch (error) {
    console.warn(error);
    setFieldError("inviteVerifyError", error.message || "Could not accept the invite. Please try again.");
  } finally {
    button.disabled = false;
  }
}

async function handleResendVerification() {
  if (!pendingUser) return;
  const button = qs("#inviteResendVerificationButton");
  button.disabled = true;
  setFieldError("inviteVerifyError", "");
  await sendVerification(pendingUser);
  if (!qs("#inviteVerifyError").textContent) {
    setFieldError("inviteVerifyError", "Verification email sent again. Please check your inbox and spam folder.");
  }
  button.disabled = false;
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

    // The server requires a verified email before granting a role in someone
    // else's business. A newly created account is NEVER verified at this
    // point, so gate here and walk the user through it rather than firing a
    // request that is guaranteed to come back 403.
    if (!credential.user.emailVerified) {
      await startEmailVerification(credential.user);
      return;
    }

    await finishAcceptance(credential.user);
  } catch (error) {
    console.warn(error);
    if (error.code === "email-not-verified") {
      // Stale token: the account is real but its verified state had not
      // propagated. Route into the same resumable step instead of dead-ending.
      await startEmailVerification(auth.currentUser);
    } else if (error.code === "auth/too-many-requests") {
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
qs("#inviteVerifyContinueButton").addEventListener("click", handleVerifyContinue);
qs("#inviteResendVerificationButton").addEventListener("click", handleResendVerification);

// Deliberately no onAuthStateChanged auto-resume here. It looked like a
// convenience -- pick the verification step back up for an already-signed-in
// visitor -- but createUserWithEmailAndPassword fires that listener too, so it
// would race handleSubmit and send two verification emails, tripping Firebase's
// own send limit. It would also hijack the wrong identity: someone already
// signed in as one account who opens an invite for another would be shown
// "verify <the wrong email>". Closing the tab mid-flow is recoverable without
// it -- reopening the link and entering the password signs in, and by then the
// email is usually verified, so acceptance completes on the spot.
init();