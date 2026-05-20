/**
 * supportSocketManager
 * ────────────────────
 * Customer ↔ Admin support call signaling — Socket.IO `/support` namespace.
 *
 * Architecture:
 *   • Customers request a support call → added to an in-memory queue
 *   • Online admin/support staff see the queue in real time
 *   • Admin accepts → both parties join a private room, WebRTC offer/answer flows
 *   • Signal relay is the same ICE/SDP relay used by the P2P conferencing system
 *
 * Protocol (client → server):
 *   support:request({ callerName, callerEmail, callerAvatar })
 *   support:cancel()
 *   support:accept(sessionId)          [admin only]
 *   support:reject(sessionId)          [admin only]
 *   support:end(sessionId)
 *   signal(toSocketId, jsonPayload)    — SDP + ICE relay
 *
 * Protocol (server → client):
 *   support:queued({ sessionId, position, adminCount, queuedAt })
 *   support:queue-snapshot(QueueEntry[])         [to new admin on connect]
 *   support:queue-update(QueueEntry[])           [to all admins on any change]
 *   support:new-request(QueueEntry)              [to admins on new customer]
 *   support:request-taken({ sessionId })         [to other admins when one accepts]
 *   support:accepted({ sessionId, roomId, ... }) [to both parties]
 *   support:rejected({ sessionId, message })     [to customer]
 *   support:ended({ sessionId, endedBy })        [to the other party when one ends]
 *   support:admin-disconnected({ sessionId })    [to customer]
 *   support:customer-disconnected({ sessionId }) [to admin]
 *   support:error({ code, message })
 *   signal(fromSocketId, jsonPayload)            [WebRTC relay]
 */

import type { Server } from "socket.io";
import type { Namespace, Socket } from "socket.io";
import { verifyToken } from "@clerk/backend";
import { randomUUID } from "node:crypto";
import { getEnv } from "./env.js";
import { getLocalUser } from "./users.js";
import { isStaff } from "./roles.js";
import type { UserRole } from "../db/schema.js";
import {
  createSession,
  setAbandoned,
  setAccepted,
  setRejected,
  setEnded,
} from "./supportDb.js";

// Fire-and-forget DB write — never blocks the socket event loop
function dbWrite(p: Promise<void>, label: string) {
  p.catch((err) => console.error(`[support-db] ${label}:`, err));
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface SocketData {
  userId: string | null;
  role: UserRole;
  displayName: string;
  email: string;
}

export interface QueueEntry {
  sessionId: string;
  customerSocketId: string;
  callerName: string;
  callerEmail: string;
  callerAvatar: string | null;
  queuedAt: number;
}

interface ActiveCall {
  sessionId: string;
  customerSocketId: string;
  adminSocketId: string;
  roomId: string;
  startedAt: number;
}

// ── In-memory state ────────────────────────────────────────────────────────────
// (resets on server restart — acceptable for a single-instance dev/small-prod setup)

/** sessionId → queue entry */
const supportQueue = new Map<string, QueueEntry>();
/** sessionId → active call */
const activeCalls = new Map<string, ActiveCall>();
/** socket IDs of currently-connected admin/support staff */
const adminSockets = new Set<string>();
/** customer socketId → sessionId (for queue/active-call lookups on disconnect) */
const customerSessionMap = new Map<string, string>();
/** admin socketId → sessionId (if they're in an active call) */
const adminCallMap = new Map<string, string>();
/** customer socketId → sessionId (if they're in an active call) */
const customerCallMap = new Map<string, string>();

// ── Helpers ────────────────────────────────────────────────────────────────────

function queueSnapshot(): QueueEntry[] {
  return [...supportQueue.values()];
}

/** Find the active call session ID for either an admin or customer socket. */
function getCallRoomSessionId(socket: Socket): string | null {
  return adminCallMap.get(socket.id) ?? customerCallMap.get(socket.id) ?? null;
}

function broadcastToAdmins(nsp: Namespace, event: string, data: unknown) {
  for (const adminId of adminSockets) {
    nsp.to(adminId).emit(event, data);
  }
}

function queuePosition(sessionId: string): number {
  let pos = 1;
  for (const id of supportQueue.keys()) {
    if (id === sessionId) return pos;
    pos++;
  }
  return pos;
}

// ── Mount on the /support namespace ───────────────────────────────────────────

export function connectSupportSocket(io: Server): void {
  const env = getEnv();

  const nsp: Namespace = io.of("/support");

  // ── Auth middleware ────────────────────────────────────────────────────────
  // Verifies the Clerk session token passed in socket.handshake.auth.token.
  // Falls back to guest customer if the token is absent or invalid.
  nsp.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;

    if (!token) {
      socket.data = {
        userId: null,
        role: "customer" as UserRole,
        displayName: (socket.handshake.auth?.guestName as string | undefined) ?? "Customer",
        email: "",
      } satisfies SocketData;
      return next();
    }

    try {
      const payload = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
      const localUser = await getLocalUser(payload.sub);

      socket.data = {
        userId: payload.sub,
        role: (localUser?.role ?? "customer") as UserRole,
        displayName: localUser?.displayName ?? "Customer",
        email: localUser?.email ?? "",
      } satisfies SocketData;
    } catch {
      // Bad token — treat as guest customer (still allowed to request support)
      socket.data = {
        userId: null,
        role: "customer" as UserRole,
        displayName: (socket.handshake.auth?.guestName as string | undefined) ?? "Customer",
        email: "",
      } satisfies SocketData;
    }

    next();
  });

  // ── Connection ─────────────────────────────────────────────────────────────
  nsp.on("connection", (socket: Socket) => {
    const data = socket.data as SocketData;
    const staffMember = isStaff(data.role);

    if (staffMember) {
      adminSockets.add(socket.id);
      // Give new admin the current queue so their dashboard is immediately populated
      socket.emit("support:queue-snapshot", queueSnapshot());
    }

    // ── Customer: request support call ──────────────────────────────────────
    socket.on(
      "support:request",
      (payload: {
        callerName?: string;
        callerEmail?: string;
        callerAvatar?: string | null;
      }) => {
        const d = socket.data as SocketData;

        // Admins cannot queue for support
        if (isStaff(d.role)) {
          socket.emit("support:error", { code: "STAFF_CANNOT_QUEUE" });
          return;
        }

        // Already in queue — re-send position
        const existingSessionId = customerSessionMap.get(socket.id);
        if (existingSessionId && supportQueue.has(existingSessionId)) {
          socket.emit("support:queued", {
            sessionId: existingSessionId,
            position: queuePosition(existingSessionId),
            adminCount: adminSockets.size,
            queuedAt: supportQueue.get(existingSessionId)!.queuedAt,
          });
          return;
        }

        const sessionId = randomUUID();
        const entry: QueueEntry = {
          sessionId,
          customerSocketId: socket.id,
          callerName: String(payload?.callerName ?? d.displayName ?? "Customer").slice(0, 80),
          callerEmail: String(payload?.callerEmail ?? d.email ?? "").slice(0, 120),
          callerAvatar: payload?.callerAvatar ? String(payload.callerAvatar).slice(0, 600) : null,
          queuedAt: Date.now(),
        };

        supportQueue.set(sessionId, entry);
        customerSessionMap.set(socket.id, sessionId);

        // Persist to DB (fire-and-forget)
        dbWrite(
          createSession({
            id: sessionId,
            customerClerkId: d.userId,
            customerName: entry.callerName,
            customerEmail: entry.callerEmail,
            customerAvatar: entry.callerAvatar,
          }),
          "createSession",
        );

        // Acknowledge to the customer
        socket.emit("support:queued", {
          sessionId,
          position: supportQueue.size,
          adminCount: adminSockets.size,
          queuedAt: entry.queuedAt,
        });

        // Notify all online admins
        broadcastToAdmins(nsp, "support:new-request", entry);
      },
    );

    // ── Customer: cancel waiting ─────────────────────────────────────────────
    socket.on("support:cancel", () => {
      const sessionId = customerSessionMap.get(socket.id);
      if (!sessionId) return;
      if (supportQueue.has(sessionId)) {
        supportQueue.delete(sessionId);
        customerSessionMap.delete(socket.id);
        dbWrite(setAbandoned(sessionId), "setAbandoned(cancel)");
        broadcastToAdmins(nsp, "support:queue-update", queueSnapshot());
      }
    });

    // ── Admin: accept call ───────────────────────────────────────────────────
    socket.on("support:accept", (sessionId: string) => {
      const d = socket.data as SocketData;
      if (!isStaff(d.role)) {
        socket.emit("support:error", { code: "FORBIDDEN" });
        return;
      }

      const entry = supportQueue.get(sessionId);
      if (!entry) {
        socket.emit("support:error", { code: "SESSION_NOT_FOUND", sessionId });
        return;
      }

      // Check admin is not already in a call
      if (adminCallMap.has(socket.id)) {
        socket.emit("support:error", { code: "ALREADY_IN_CALL" });
        return;
      }

      // Remove from queue before any async ops
      supportQueue.delete(sessionId);
      customerSessionMap.delete(entry.customerSocketId);

      const roomId = `support:${sessionId}`;
      const call: ActiveCall = {
        sessionId,
        customerSocketId: entry.customerSocketId,
        adminSocketId: socket.id,
        roomId,
        startedAt: Date.now(),
      };
      activeCalls.set(sessionId, call);
      adminCallMap.set(socket.id, sessionId);
      customerCallMap.set(entry.customerSocketId, sessionId);

      // Persist accepted state to DB
      dbWrite(
        setAccepted({
          sessionId,
          adminClerkId: d.userId,
          adminName: d.displayName,
        }),
        "setAccepted",
      );

      // Join the private room
      void socket.join(roomId);
      const customerSocket = nsp.sockets.get(entry.customerSocketId);
      if (customerSocket) {
        void customerSocket.join(roomId);
      }

      // Tell customer the agent has accepted — customer will initiate the WebRTC offer
      nsp.to(entry.customerSocketId).emit("support:accepted", {
        sessionId,
        roomId,
        adminName: d.displayName,
        adminSocketId: socket.id,
      });

      // Tell admin which customer they're connecting to
      socket.emit("support:accepted", {
        sessionId,
        roomId,
        customerName: entry.callerName,
        customerEmail: entry.callerEmail,
        customerAvatar: entry.callerAvatar,
        customerSocketId: entry.customerSocketId,
      });

      // Tell other admins that this request was taken (remove from their queue)
      for (const adminId of adminSockets) {
        if (adminId !== socket.id) {
          nsp.to(adminId).emit("support:request-taken", { sessionId });
        }
      }

      // Full queue update to all admins
      broadcastToAdmins(nsp, "support:queue-update", queueSnapshot());
    });

    // ── Admin: reject call ───────────────────────────────────────────────────
    socket.on("support:reject", (sessionId: string) => {
      const d = socket.data as SocketData;
      if (!isStaff(d.role)) return;

      const entry = supportQueue.get(sessionId);
      if (!entry) return;

      supportQueue.delete(sessionId);
      customerSessionMap.delete(entry.customerSocketId);

      dbWrite(setRejected(sessionId), "setRejected");

      nsp.to(entry.customerSocketId).emit("support:rejected", {
        sessionId,
        message: "No agents are available at this time. Please try again shortly.",
      });

      broadcastToAdmins(nsp, "support:queue-update", queueSnapshot());
    });

    // ── WebRTC signal relay ──────────────────────────────────────────────────
    // Relays SDP offers/answers and ICE candidates between the two call parties.
    socket.on("signal", (toId: string, payload: string) => {
      nsp.to(toId).emit("signal", socket.id, payload);
    });

    // ── Chat relay ────────────────────────────────────────────────────────────
    // Relay chat messages to the other party in the active call room.
    // Only the recipient receives the message (sender adds it locally optimistically).
    socket.on("support:chat", (payload: { text?: string; ts?: number }) => {
      const sessionId = getCallRoomSessionId(socket);
      if (!sessionId) return;
      const call = activeCalls.get(sessionId);
      if (!call) return;
      const d = socket.data as SocketData;
      const otherSocketId =
        socket.id === call.adminSocketId ? call.customerSocketId : call.adminSocketId;
      nsp.to(otherSocketId).emit("support:chat", {
        senderName: d.displayName,
        senderSocketId: socket.id,
        text: String(payload?.text ?? "").slice(0, 500),
        ts: Date.now(),
      });
    });

    // ── Screen-share state relay ──────────────────────────────────────────────
    // Notifies the other party that this socket started/stopped screen sharing.
    socket.on("support:screen-share", (payload: { active: boolean }) => {
      const sessionId = getCallRoomSessionId(socket);
      if (!sessionId) return;
      const call = activeCalls.get(sessionId);
      if (!call) return;
      const otherSocketId =
        socket.id === call.adminSocketId ? call.customerSocketId : call.adminSocketId;
      nsp.to(otherSocketId).emit("support:screen-share", { active: !!payload?.active });
    });

    // ── Emoji reaction relay ──────────────────────────────────────────────────
    socket.on("support:react", (payload: { emoji?: string }) => {
      const sessionId = getCallRoomSessionId(socket);
      if (!sessionId) return;
      const call = activeCalls.get(sessionId);
      if (!call) return;
      const otherSocketId =
        socket.id === call.adminSocketId ? call.customerSocketId : call.adminSocketId;
      const emoji = String(payload?.emoji ?? "").slice(0, 8);
      if (!emoji) return;
      nsp.to(otherSocketId).emit("support:react", { emoji });
    });

    // ── End call ────────────────────────────────────────────────────────────
    socket.on("support:end", (sessionId: string) => {
      endCall(nsp, sessionId, socket.id);
    });

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      const d = socket.data as SocketData;

      if (isStaff(d.role)) {
        adminSockets.delete(socket.id);

        // Admin was in an active call — notify customer and persist
        const sessionId = adminCallMap.get(socket.id);
        if (sessionId) {
          const call = activeCalls.get(sessionId);
          if (call) {
            dbWrite(
              setEnded({ sessionId, startedAt: call.startedAt, endReason: "admin_disconnected" }),
              "setEnded(admin-disconnect)",
            );
            nsp.to(call.customerSocketId).emit("support:admin-disconnected", { sessionId });
            customerCallMap.delete(call.customerSocketId);
            activeCalls.delete(sessionId);
          }
          adminCallMap.delete(socket.id);
        }
      } else {
        // Customer disconnected
        const sessionId = customerSessionMap.get(socket.id);
        if (!sessionId) return;

        // Was waiting in queue
        if (supportQueue.has(sessionId)) {
          supportQueue.delete(sessionId);
          dbWrite(setAbandoned(sessionId), "setAbandoned(disconnect)");
          broadcastToAdmins(nsp, "support:queue-update", queueSnapshot());
        }

        // Was in an active call
        const call = activeCalls.get(sessionId);
        if (call) {
          dbWrite(
            setEnded({ sessionId, startedAt: call.startedAt, endReason: "customer_disconnected" }),
            "setEnded(customer-disconnect)",
          );
          nsp.to(call.adminSocketId).emit("support:customer-disconnected", { sessionId });
          activeCalls.delete(sessionId);
          adminCallMap.delete(call.adminSocketId);
          customerCallMap.delete(socket.id);
        }

        customerSessionMap.delete(socket.id);
      }
    });
  });
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function endCall(nsp: Namespace, sessionId: string, initiatorSocketId: string) {
  const call = activeCalls.get(sessionId);
  if (!call) return;

  activeCalls.delete(sessionId);
  adminCallMap.delete(call.adminSocketId);
  customerCallMap.delete(call.customerSocketId);

  const isAdmin = initiatorSocketId === call.adminSocketId;
  const otherSocketId = isAdmin ? call.customerSocketId : call.adminSocketId;
  const endedBy = isAdmin ? "admin" : "customer";
  const endReason = isAdmin ? "admin_ended" : "customer_ended";

  // Persist ended state
  dbWrite(
    setEnded({ sessionId, startedAt: call.startedAt, endReason }),
    "setEnded",
  );

  nsp.to(otherSocketId).emit("support:ended", { sessionId, endedBy });

  // Leave the private room
  nsp.sockets.get(initiatorSocketId)?.leave(call.roomId);
  nsp.sockets.get(otherSocketId)?.leave(call.roomId);
}
