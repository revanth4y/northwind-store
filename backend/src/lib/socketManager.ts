/**
 * WebRTC signaling server — Socket.IO
 * ────────────────────────────────────
 * Protocol:
 *   client → server  join-call(room, username)
 *   server → joiner  existing-peers([{ socketId, username }], hostSocketId)
 *   server → others  peer-joined({ socketId, username })
 *   client → server  signal(toId, jsonPayload)   — SDP + ICE relay
 *   server → target  signal(fromId, jsonPayload)
 *   client → server  chat-message(text)
 *   server → room    chat-message({ sender, data, socketId, ts })
 *   server → room    peer-left(socketId)          — on disconnect
 *   server → room    host-changed(newHostSocketId) — when host leaves
 *
 * All media flows P2P via WebRTC; this server only relays signals.
 */

import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";

interface UserMeta {
  username: string;
  room: string;
  joinedAt: number;
}

interface ChatMessage {
  sender: string;
  data: string;
  socketId: string;
  ts: number;
}

const MAX_CHAT_HISTORY = 200;

// Keyed by socket.id
const userMeta: Record<string, UserMeta> = {};
// Keyed by room name → host socketId
const roomHost: Record<string, string> = {};
// Keyed by room name
const chatHistory: Record<string, ChatMessage[]> = {};

export function connectToSocket(server: HttpServer): Server {
  const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60_000,
    pingInterval: 25_000,
  });

  io.on("connection", (socket) => {
    // ── Join ──────────────────────────────────────────────────────────────────
    socket.on("join-call", (room: string, username: string) => {
      // Collect existing participants BEFORE joining the room
      const roomMembers = io.sockets.adapter.rooms.get(room);
      const existingIds = roomMembers ? [...roomMembers].filter((id) => id !== socket.id) : [];
      const existingPeers = existingIds.map((id) => ({
        socketId: id,
        username: userMeta[id]?.username ?? "Participant",
        joinedAt: userMeta[id]?.joinedAt ?? Date.now(),
      }));

      // First joiner becomes the host; existing host preserved if still present
      const isFirstInRoom = existingIds.length === 0;
      if (isFirstInRoom || !roomHost[room] || !existingIds.includes(roomHost[room])) {
        roomHost[room] = socket.id;
      }

      socket.join(room);
      userMeta[socket.id] = { username, room, joinedAt: Date.now() };

      // New joiner gets the list of who's already there + current host
      socket.emit("existing-peers", existingPeers, roomHost[room]);

      // Existing members learn about the new joiner
      socket.to(room).emit("peer-joined", { socketId: socket.id, username });

      // Replay chat history to the new joiner
      const history = chatHistory[room] ?? [];
      if (history.length) socket.emit("chat-history", history);
    });

    // ── WebRTC signal relay ───────────────────────────────────────────────────
    socket.on("signal", (toId: string, payload: string) => {
      io.to(toId).emit("signal", socket.id, payload);
    });

    // ── In-room chat ──────────────────────────────────────────────────────────
    socket.on("chat-message", (data: string) => {
      const meta = userMeta[socket.id];
      if (!meta) return;

      const msg: ChatMessage = {
        sender: meta.username,
        data: String(data).slice(0, 1000),
        socketId: socket.id,
        ts: Date.now(),
      };

      if (!chatHistory[meta.room]) chatHistory[meta.room] = [];
      chatHistory[meta.room].push(msg);
      if (chatHistory[meta.room].length > MAX_CHAT_HISTORY) {
        chatHistory[meta.room].shift();
      }

      io.to(meta.room).emit("chat-message", msg);
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on("disconnect", () => {

      const meta = userMeta[socket.id];
      if (!meta) return;

      socket.to(meta.room).emit("peer-left", socket.id);
      delete userMeta[socket.id];

      // Host migration: reassign host to the next available member
      if (roomHost[meta.room] === socket.id) {
        // Note: on disconnect, socket may still briefly appear in adapter; filter it out
        const roomMembers = io.sockets.adapter.rooms.get(meta.room);
        const remaining = roomMembers
          ? [...roomMembers].filter((id) => id !== socket.id)
          : [];
        if (remaining.length > 0) {
          const newHostId = remaining[0];
          roomHost[meta.room] = newHostId;
          io.to(meta.room).emit("host-changed", newHostId);
        } else {
          delete roomHost[meta.room];
        }
      }

      // Clean up chat history and host when the room empties
      const roomMembers = io.sockets.adapter.rooms.get(meta.room);
      const remaining = roomMembers
        ? [...roomMembers].filter((id) => id !== socket.id)
        : [];
      if (remaining.length === 0) {
        delete chatHistory[meta.room];
        delete roomHost[meta.room];
      }
    });
  });

  return io;
}
