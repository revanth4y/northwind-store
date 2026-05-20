/**
 * Offline Polar webhook signature verifier.
 * Run after webhook-debug.json has been written by the backend:
 *
 *   node scripts/verify-webhook-sig.mjs
 *
 * It computes the expected HMAC-SHA256 signature using the same algorithm
 * that standardwebhooks v1.0.0 uses, then compares every sig in the
 * webhook-signature header to find a match (or explain why there is none).
 */

import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── 1. Load debug payload ─────────────────────────────────────────────────────
const debugPath = join(__dir, "..", "webhook-debug.json");
let debug;
try {
  debug = JSON.parse(readFileSync(debugPath, "utf8"));
} catch {
  console.error("❌ webhook-debug.json not found. Redeliver a webhook first.");
  process.exit(1);
}

const { id, ts, sig, body } = debug;
console.log("webhook-id       :", id);
console.log("webhook-timestamp:", ts);
console.log("webhook-signature:", sig);
console.log("body length      :", body.length);
console.log("body first/last  :", body.charCodeAt(0), "/", body.charCodeAt(body.length - 1));
console.log();

// ── 2. Load secret from .env ──────────────────────────────────────────────────
const envPath = join(__dir, "..", ".env");
const envRaw = readFileSync(envPath, "utf8");
const secretMatch = envRaw.match(/^POLAR_WEBHOOK_SECRET\s*=\s*(.+)$/m);
if (!secretMatch) {
  console.error("❌ POLAR_WEBHOOK_SECRET not found in .env");
  process.exit(1);
}
const fullSecret = secretMatch[1].trim();
const strippedSecret = fullSecret.startsWith("polar_whs_")
  ? fullSecret.slice("polar_whs_".length)
  : fullSecret;

console.log("full secret      :", fullSecret.slice(0, 20) + "...");
console.log("stripped secret  :", strippedSecret.slice(0, 20) + "...");
console.log();

// ── 3. Decode secret (standardwebhooks uses base64) ───────────────────────────
const secretBytes = Buffer.from(strippedSecret, "base64");
console.log("secret bytes [0..3]:", [...secretBytes.slice(0, 4)]);
console.log();

// ── 4. Build the signed content exactly as standardwebhooks does ──────────────
//   signedContent = `${msgId}.${msgTimestamp}.${body}`
const signedContent = `${id}.${ts}.${body}`;
console.log("signed content (first 80):", signedContent.slice(0, 80));
console.log();

// ── 5. Compute HMAC-SHA256 ────────────────────────────────────────────────────
const mac = createHmac("sha256", secretBytes).update(signedContent).digest("base64");
const computedSig = `v1,${mac}`;
console.log("computed sig     :", computedSig);
console.log();

// ── 6. Compare against every sig in the header ───────────────────────────────
//   header format: "v1,<b64> v1,<b64> ..."  (space-separated)
const incomingSigs = (sig ?? "").split(" ").map((s) => s.trim()).filter(Boolean);
console.log("incoming sigs    :", incomingSigs);
console.log();

let matched = false;
for (const incoming of incomingSigs) {
  if (incoming === computedSig) {
    console.log("✅ MATCH:", incoming);
    matched = true;
  } else {
    console.log("❌ no match:", incoming);
    // Show where they differ
    const a = computedSig.replace("v1,", "");
    const b = incoming.replace(/^v\d,/, "");
    const aBuf = Buffer.from(a, "base64");
    const bBuf = Buffer.from(b, "base64");
    console.log("   computed bytes [0..3] :", [...aBuf.slice(0, 4)]);
    console.log("   incoming bytes [0..3] :", [...bBuf.slice(0, 4)]);
  }
}

if (!matched) {
  console.log();
  console.log("── Trying with raw body as Buffer (in case encoding differs) ──");
  const bodyBuf = Buffer.from(body, "utf8");
  const signedContent2 = Buffer.concat([
    Buffer.from(`${id}.${ts}.`),
    bodyBuf,
  ]);
  const mac2 = createHmac("sha256", secretBytes).update(signedContent2).digest("base64");
  const computedSig2 = `v1,${mac2}`;
  console.log("computed sig2    :", computedSig2);
  console.log("matches?         :", incomingSigs.includes(computedSig2));

  console.log();
  console.log("── Trying WITHOUT stripping polar_whs_ prefix ──");
  const secretBytesRaw = Buffer.from(fullSecret, "base64");
  const mac3 = createHmac("sha256", secretBytesRaw).update(signedContent).digest("base64");
  const computedSig3 = `v1,${mac3}`;
  console.log("computed sig3    :", computedSig3);
  console.log("matches?         :", incomingSigs.includes(computedSig3));
}
