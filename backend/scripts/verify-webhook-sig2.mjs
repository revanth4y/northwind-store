/**
 * Extended brute-force signature verifier.
 * Tries every plausible combination of key encoding × content format.
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));

const debug = JSON.parse(readFileSync(join(__dir, "..", "webhook-debug.json"), "utf8"));
const { id, ts, sig, body } = debug;

const envRaw = readFileSync(join(__dir, "..", ".env"), "utf8");
const secretMatch = envRaw.match(/^POLAR_WEBHOOK_SECRET\s*=\s*(.+)$/m);
const fullSecret = secretMatch[1].trim();
const strippedSecret = fullSecret.startsWith("polar_whs_")
  ? fullSecret.slice("polar_whs_".length)
  : fullSecret;

const incomingSig = sig.replace(/^v1,/, "");
const incomingBytes = Buffer.from(incomingSig, "base64");
console.log("Target sig (hex):", incomingBytes.toString("hex"));
console.log();

// Different ways to interpret the secret key
const keys = {
  "stripped, base64-decoded":   Buffer.from(strippedSecret, "base64"),
  "full, base64-decoded":       Buffer.from(fullSecret, "base64"),
  "stripped, utf8":             Buffer.from(strippedSecret, "utf8"),
  "full, utf8":                 Buffer.from(fullSecret, "utf8"),
  "stripped, hex-decoded":      Buffer.from(strippedSecret, "hex").length > 0
                                  ? Buffer.from(strippedSecret, "hex")
                                  : null,
};

// Different ways to build signed content
const bodyBuf = Buffer.from(body, "utf8");
const contents = {
  "id.ts.body (string concat)":  Buffer.from(`${id}.${ts}.${body}`),
  "id.ts.body (buffer concat)":  Buffer.concat([Buffer.from(`${id}.${ts}.`), bodyBuf]),
  "id.ts. + body bytes":         Buffer.concat([Buffer.from(id + "." + ts + "."), bodyBuf]),
};

let found = false;
for (const [keyLabel, keyBuf] of Object.entries(keys)) {
  if (!keyBuf || keyBuf.length === 0) continue;
  for (const [contentLabel, contentBuf] of Object.entries(contents)) {
    const computed = createHmac("sha256", keyBuf).update(contentBuf).digest("base64");
    const match = computed === incomingSig;
    if (match) {
      console.log(`✅ MATCH! key="${keyLabel}" content="${contentLabel}"`);
      console.log("   computed:", computed);
      found = true;
    }
  }
}

if (!found) {
  console.log("❌ No combination matched. Full table:");
  for (const [keyLabel, keyBuf] of Object.entries(keys)) {
    if (!keyBuf || keyBuf.length === 0) { console.log(`  [skip] ${keyLabel} — empty`); continue; }
    for (const [contentLabel, contentBuf] of Object.entries(contents)) {
      const computed = createHmac("sha256", keyBuf).update(contentBuf).digest("base64");
      console.log(`  key="${keyLabel}" content="${contentLabel}"`);
      console.log(`    computed: v1,${computed}`);
    }
  }

  // Print what key bytes look like
  console.log();
  console.log("Key byte snapshots:");
  for (const [label, buf] of Object.entries(keys)) {
    if (!buf) continue;
    console.log(`  ${label}: len=${buf.length} [0..3]=[${[...buf.slice(0,4)]}]`);
  }
}
