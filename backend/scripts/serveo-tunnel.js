/**
 * serveo-tunnel.js — auto-reconnecting SSH tunnel to serveo.net
 * Spawns SSH as a child process and restarts it whenever the connection drops.
 */

"use strict";

const { spawn } = require("child_process");

const SUBDOMAIN   = "nw-revanth-northwind-2025";
const LOCAL_PORT  = 3001;
const RETRY_MS    = 3000;

let proc = null;
let stopping = false;

function connect() {
  if (stopping) return;

  console.log(`[tunnel] Connecting → https://${SUBDOMAIN}.serveousercontent.com`);

  proc = spawn(
    "ssh",
    [
      "-o", "StrictHostKeyChecking=no",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3",
      "-R", `${SUBDOMAIN}:80:localhost:${LOCAL_PORT}`,
      "serveo.net",
    ],
    { stdio: "inherit" },
  );

  proc.on("error", (err) => {
    console.error("[tunnel] spawn error:", err.message);
    scheduleReconnect();
  });

  proc.on("close", (code) => {
    if (stopping) return;
    console.log(`[tunnel] SSH exited (code ${code ?? "?"}). Reconnecting in ${RETRY_MS / 1000}s…`);
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (stopping) return;
  setTimeout(connect, RETRY_MS);
}

function shutdown() {
  stopping = true;
  console.log("\n[tunnel] Shutting down…");
  proc?.kill();
  process.exit(0);
}

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);

connect();
