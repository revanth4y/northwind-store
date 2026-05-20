/**
 * ticketSocketManager
 * ────────────────────
 * Real-time updates for the support ticket system — Socket.IO `/tickets` namespace.
 *
 * Rooms:
 *   admin:tickets          — all connected staff (auto-joined on connect)
 *   ticket:<ticketId>      — users viewing that ticket's detail page
 *   user:<clerkId>         — personal room for each authenticated user
 *
 * Server → Client events:
 *   ticket:new(ticket)             → new ticket created; emitted to admin:tickets
 *   ticket:message({ ticketId, message })
 *                                  → new message; emitted to ticket:<id> + user:<clerkId>
 *   ticket:updated({ ticket })     → ticket metadata changed; same rooms
 *   ticket:typing({ socketId, name, ticketId })
 *                                  → typing indicator; emitted to ticket:<id> (excl. sender)
 *
 * Client → Server events:
 *   ticket:join(ticketId)   → join ticket:<ticketId> room
 *   ticket:leave(ticketId)  → leave ticket:<ticketId> room
 *   ticket:typing(ticketId) → relay typing indicator to others in ticket:<ticketId>
 */

import type { Server, Namespace } from "socket.io";
import { verifyToken } from "@clerk/backend";
import { getEnv } from "./env.js";
import { getLocalUser } from "./users.js";
import { isStaff } from "./roles.js";
import type { UserRole } from "../db/schema.js";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SocketData {
  userId: string | null;
  role: UserRole;
  displayName: string;
}

// ── Singleton namespace reference ──────────────────────────────────────────────

let ticketNsp: Namespace | null = null;

/** Called by routes to emit events after DB mutations */
export function getTicketNsp(): Namespace | null {
  return ticketNsp;
}

// ── Mount on the /tickets namespace ───────────────────────────────────────────

export function connectTicketSocket(io: Server): void {
  const env = getEnv();
  const nsp: Namespace = io.of("/tickets");
  ticketNsp = nsp;

  // ── Auth middleware ────────────────────────────────────────────────────────
  // Accepts any connection; staff get extra rooms. Unauthenticated = guest.
  nsp.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;

    if (!token) {
      socket.data = {
        userId: null,
        role: "customer" as UserRole,
        displayName: "Guest",
      } satisfies SocketData;
      return next();
    }

    try {
      const payload = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
      const localUser = await getLocalUser(payload.sub);

      socket.data = {
        userId: payload.sub,
        role: (localUser?.role ?? "customer") as UserRole,
        displayName: localUser?.displayName ?? "User",
      } satisfies SocketData;
    } catch {
      socket.data = {
        userId: null,
        role: "customer" as UserRole,
        displayName: "Guest",
      } satisfies SocketData;
    }

    next();
  });

  // ── Connection ─────────────────────────────────────────────────────────────
  nsp.on("connection", (socket) => {
    const data = socket.data as SocketData;

    // Auto-join broadcast rooms
    if (isStaff(data.role)) {
      void socket.join("admin:tickets");
    }
    if (data.userId) {
      void socket.join(`user:${data.userId}`);
    }

    // ── Per-ticket room management ─────────────────────────────────────────
    socket.on("ticket:join", (ticketId: unknown) => {
      if (typeof ticketId === "string" && ticketId.length > 0 && ticketId.length < 100) {
        void socket.join(`ticket:${ticketId}`);
      }
    });

    socket.on("ticket:leave", (ticketId: unknown) => {
      if (typeof ticketId === "string" && ticketId.length > 0 && ticketId.length < 100) {
        void socket.leave(`ticket:${ticketId}`);
      }
    });

    // ── Typing indicator relay ─────────────────────────────────────────────
    // Relay to the ticket room, excluding the sender.
    socket.on("ticket:typing", (ticketId: unknown) => {
      if (typeof ticketId !== "string" || ticketId.length === 0 || ticketId.length >= 100) return;
      const d = socket.data as SocketData;
      socket.to(`ticket:${ticketId}`).emit("ticket:typing", {
        socketId: socket.id,
        name: d.displayName,
        ticketId,
      });
    });
  });
}
