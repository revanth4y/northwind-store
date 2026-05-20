/**
 * tunnel.js — stable LocalTunnel wrapper for Northwind backend
 * ─────────────────────────────────────────────────────────────
 * Runs LocalTunnel programmatically so we can:
 *  • Detect the real URL that was assigned (not just hope the subdomain stuck)
 *  • Warn loudly when the subdomain was NOT granted
 *  • Write the live URL to .tunnel-url so other scripts can read it
 *  • Auto-reconnect when the tunnel drops, without needing a loop script
 *
 * Usage:  node scripts/tunnel.js
 */

"use strict";

const localtunnel = require("localtunnel");
const fs = require("node:fs");
const path = require("node:path");

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = 3001;

// Change this to any name you like. The longer + more unique, the more likely
// LocalTunnel will actually give it to you. Avoid short or common words.
const PREFERRED_SUBDOMAIN = "nw-revanth-northwind-2025";

const TUNNEL_URL_FILE = path.join(__dirname, "..", ".tunnel-url");
const RETRY_DELAY_MS = 3000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function printUrls(url) {
  const line = "─".repeat(60);
  console.log("\n" + line);
  console.log("  🚇 Tunnel active");
  console.log(line);
  console.log(`  Public base:       ${url}`);
  console.log(`  Clerk webhook:     ${url}/webhooks/clerk`);
  console.log(`  Polar webhook:     ${url}/webhooks/polar`);
  console.log(line);
  console.log("  Paste these URLs into:");
  console.log("    • Clerk  → dashboard.clerk.com → Webhooks → endpoint URL");
  console.log("    • Polar  → sandbox.polar.sh    → Webhooks → endpoint URL");
  console.log(line + "\n");
}

function saveUrl(url) {
  fs.writeFileSync(TUNNEL_URL_FILE, url + "\n", "utf8");
}

function clearUrl() {
  try {
    fs.unlinkSync(TUNNEL_URL_FILE);
  } catch {
    // file may not exist — that's fine
  }
}

// ── Tunnel lifecycle ──────────────────────────────────────────────────────────

let activeTunnel = null;
let reconnecting = false;

async function connect() {
  console.log(`[tunnel] Connecting → requesting subdomain "${PREFERRED_SUBDOMAIN}"…`);

  let tunnel;
  try {
    tunnel = await localtunnel({ port: PORT, subdomain: PREFERRED_SUBDOMAIN });
  } catch (err) {
    console.error("[tunnel] ❌ Failed to connect:", err.message);
    scheduleReconnect();
    return;
  }

  activeTunnel = tunnel;
  reconnecting = false;

  const grantedUrl = tunnel.url;
  const expectedUrl = `https://${PREFERRED_SUBDOMAIN}.loca.lt`;
  const gotWanted = grantedUrl === expectedUrl;

  if (gotWanted) {
    console.log(`[tunnel] ✅ Subdomain granted: ${grantedUrl}`);
  } else {
    console.warn(`[tunnel] ⚠️  Subdomain "${PREFERRED_SUBDOMAIN}" was taken or unavailable.`);
    console.warn(`[tunnel]    Requested: ${expectedUrl}`);
    console.warn(`[tunnel]    Assigned:  ${grantedUrl}`);
    console.warn(`[tunnel]    Update your Clerk and Polar webhook URLs to the assigned URL above.`);
  }

  saveUrl(grantedUrl);
  printUrls(grantedUrl);

  tunnel.on("error", (err) => {
    console.error("[tunnel] Error:", err.message);
  });

  tunnel.on("close", () => {
    console.log("[tunnel] 🔌 Tunnel closed. Reconnecting…");
    clearUrl();
    activeTunnel = null;
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnecting) return;
  reconnecting = true;
  setTimeout(() => {
    reconnecting = false;
    connect();
  }, RETRY_DELAY_MS);
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown() {
  console.log("\n[tunnel] Shutting down…");
  clearUrl();
  if (activeTunnel) {
    try {
      activeTunnel.close();
    } catch {
      // ignore
    }
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── Start ─────────────────────────────────────────────────────────────────────

connect();
