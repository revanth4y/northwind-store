/**
 * Quick sanity check: does the new verifyPolarSignature logic pass the captured event?
 */
import { readFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const debug = JSON.parse(readFileSync(join(__dir, "..", "webhook-debug.json"), "utf8"));
const { id, ts, sig, body } = debug;

const envRaw = readFileSync(join(__dir, "..", ".env"), "utf8");
const secret = envRaw.match(/^POLAR_WEBHOOK_SECRET\s*=\s*(.+)$/m)[1].trim();

const keyBuf = Buffer.from(secret, "utf8");
const rawBody = Buffer.from(body, "utf8");
const signedContent = Buffer.concat([Buffer.from(`${id}.${ts}.`), rawBody]);
const expected = createHmac("sha256", keyBuf).update(signedContent).digest("base64");
const expectedToken = `v1,${expected}`;

let matched = false;
for (const token of sig.split(" ")) {
  const tok = token.trim();
  if (!tok) continue;
  const a = Buffer.from(expectedToken);
  const b = Buffer.from(tok);
  if (a.length === b.length && timingSafeEqual(a, b)) { matched = true; break; }
}

console.log("Secret (first 20):", secret.slice(0, 20) + "...");
console.log("Expected token   :", expectedToken);
console.log("Incoming sig     :", sig);
console.log(matched ? "✅ SIGNATURE VALID" : "❌ SIGNATURE INVALID");
