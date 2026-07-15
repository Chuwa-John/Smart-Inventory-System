// Set your fixed-price override password's SHA-256 hash here (never store the plaintext password).
// Generate the hash by pasting this into your browser console with your chosen password:
//   crypto.subtle.digest("SHA-256", new TextEncoder().encode("your-password-here"))
//     .then(buf => console.log([...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("")));
export const priceConfig = {
  overridePasswordHash: "REPLACE_WITH_YOUR_SHA256_HASH"
};