import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";

import * as Sentry from "@sentry/node";

import { clerkMiddleware } from "@clerk/express";
import { clerkWebhookHandler } from "./webhooks/clerk";
import { getEnv } from "./lib/env";
import keepAliveCron from "./lib/cron";
import { connectToSocket } from "./lib/socketManager";
import { connectSupportSocket } from "./lib/supportSocketManager";
import { connectTicketSocket } from "./lib/ticketSocketManager";

import productRouter from "./routes/productRouter";
import meRouter from "./routes/meRouter";
import chekoutRouter from "./routes/chekoutRouter";
import adminRouter from "./routes/adminRouter";
import orderRouter from "./routes/orderRouter";
import ticketRouter from "./routes/ticketRouter";

import { polarWebhookHandler } from "./webhooks/polar";
import { sentryClerkUserMiddleware } from "./middleware/sentryClerkUser";

const env = getEnv();
const app = express();

// Create HTTP server so Socket.IO and Express share port 3001.
const server = createServer(app);

// P2P video conferencing (existing rooms) — default namespace "/"
const io = connectToSocket(server);

// Customer ↔ Admin support call system — "/support" namespace
connectSupportSocket(io);

// Real-time ticket updates — "/tickets" namespace
connectTicketSocket(io);

const rawJson = express.raw({ type: "application/json", limit: "1mb" });

// Webhook routes must receive raw (un-parsed) bodies.
app.post("/webhooks/clerk", rawJson, (req, res) => {
  void clerkWebhookHandler(req, res);
});
app.post("/webhooks/polar", rawJson, (req, res) => {
  void polarWebhookHandler(req, res);
});

app.use(express.json());
app.use(cors());
app.use(clerkMiddleware());

app.use(sentryClerkUserMiddleware);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/me", meRouter);
app.use("/api/products", productRouter);
app.use("/api/checkout", chekoutRouter);
app.use("/api/admin", adminRouter);
app.use("/api/orders", orderRouter);
app.use("/api/tickets", ticketRouter);

// Serve static frontend build in production.
const publicDir = path.join(process.cwd(), "public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));

  app.get("/{*any}", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") { next(); return; }
    if (req.path.startsWith("/api") || req.path.startsWith("/webhooks")) { next(); return; }
    res.sendFile(path.join(publicDir, "index.html"), (err) => next(err));
  });
}

// Sentry error handler must be registered after all routes.
Sentry.setupExpressErrorHandler(app);

app.use(
  (_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const sentryId = (res as express.Response & { sentry?: string }).sentry;
    res.status(500).json({
      error: "Internal server error",
      ...(sentryId !== undefined && { sentryId }),
    });
  },
);

server.listen(env.PORT, () => {
  console.log(`Server (HTTP + Socket.IO) listening on port ${env.PORT}`);
  if (env.NODE_ENV === "production") {
    keepAliveCron.start();
  }
});
