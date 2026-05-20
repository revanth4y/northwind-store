/**
 * useTicketSocket
 * ───────────────
 * React hook that manages the /tickets Socket.IO connection and keeps the
 * React Query cache up-to-date in real time.
 *
 * Usage:
 *   // Global (e.g. in list pages — no specific ticket)
 *   const { connected } = useTicketSocket({ onNewTicket: (t) => showToast(t) });
 *
 *   // Per-ticket detail page
 *   const { typingUsers, emitTyping } = useTicketSocket({ ticketId: id });
 *
 * Cache strategy:
 *   ticket:message  → surgical setQueryData on ["ticket",id] and ["admin-ticket",id]
 *                     + invalidate list queries so updatedAt / status reflect changes
 *   ticket:updated  → patch ticket object in detail and list caches
 *   ticket:new      → invalidate ["admin-tickets"] + call onNewTicket callback
 *   ticket:typing   → local state only; filtered by ticketId
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { getTicketSocket } from "../lib/ticketSocket";

const TYPING_TTL_MS = 3000;

/**
 * @param {{
 *   ticketId?: string | null,
 *   onNewTicket?: (ticket: object) => void,
 * }} opts
 */
export function useTicketSocket({ ticketId = null, onNewTicket } = {}) {
  const { getToken, isSignedIn } = useAuth();
  const qc = useQueryClient();

  const socketRef   = useRef(null);
  const ticketIdRef = useRef(ticketId);
  const onNewRef    = useRef(onNewTicket);
  const typingTimers = useRef({});

  const [typingUsers, setTypingUsers] = useState([]);
  const [connected,   setConnected]   = useState(false);

  // Keep refs in sync with latest props/callbacks without re-running effects
  ticketIdRef.current = ticketId;
  onNewRef.current    = onNewTicket;

  // ── Main socket effect ───────────────────────────────────────────────────────
  // Re-runs when sign-in state changes. The socket itself is a singleton so it
  // isn't re-created on ticketId changes; rooms are managed by a separate effect.
  useEffect(() => {
    if (!isSignedIn) return;

    let active = true;

    // ── Event handlers — named so we can remove exactly these instances ──────
    const handleConnect = () => {
      if (!active) return;
      setConnected(true);
      // (Re)join the ticket room after every connection/reconnection
      if (ticketIdRef.current) {
        socketRef.current?.emit("ticket:join", ticketIdRef.current);
      }
    };

    const handleDisconnect = () => {
      if (active) setConnected(false);
    };

    // A new ticket was created — refresh the admin list
    const handleTicketNew = (ticket) => {
      qc.invalidateQueries({ queryKey: ["admin-tickets"] });
      onNewRef.current?.(ticket);
    };

    // A lifecycle event (status change, assignment, etc.) was logged
    const handleTicketEvent = ({ ticketId: tid, event }) => {
      if (!tid || !event) return;
      const patcher = (old) => {
        if (!old) return old;
        const events = old.events ?? [];
        if (events.some((e) => e.id === event.id)) return old;
        return { ...old, events: [...events, event] };
      };
      qc.setQueryData(["ticket",       tid], patcher);
      qc.setQueryData(["admin-ticket", tid], patcher);
    };

    // A new message arrived on a ticket
    const handleTicketMessage = ({ ticketId: tid, message }) => {
      if (!tid || !message) return;

      // Surgical append to detail caches (dedup by id)
      const patcher = (old) => {
        if (!old) return old;
        const msgs = old.messages ?? [];
        if (msgs.some((m) => m.id === message.id)) return old; // already present
        return { ...old, messages: [...msgs, message] };
      };
      qc.setQueryData(["ticket",       tid], patcher);
      qc.setQueryData(["admin-ticket", tid], patcher);

      // Invalidate list caches so updatedAt / status changes propagate
      qc.invalidateQueries({ queryKey: ["tickets"]       });
      qc.invalidateQueries({ queryKey: ["admin-tickets"] });
    };

    // Ticket metadata was updated (status, priority, assignment, etc.)
    const handleTicketUpdated = ({ ticket: updated }) => {
      if (!updated?.id) return;
      const tid = updated.id;

      // Patch detail caches
      qc.setQueryData(["ticket",       tid], (old) => old ? { ...old, ticket: updated } : old);
      qc.setQueryData(["admin-ticket", tid], (old) => old ? { ...old, ticket: updated } : old);

      // Patch customer portal list (exact key match)
      qc.setQueryData(["tickets"], (old) => {
        if (!old) return old;
        return {
          ...old,
          tickets: (old.tickets ?? []).map((t) =>
            t.id === tid ? { ...t, ...updated } : t,
          ),
        };
      });

      // Invalidate admin list (filter state unknown; let React Query refetch)
      qc.invalidateQueries({ queryKey: ["admin-tickets"] });
    };

    // Someone else is typing in this ticket's thread
    const handleTicketTyping = ({ socketId, name, ticketId: tid }) => {
      // Only surface typing indicators for the ticket this hook instance is watching
      if (!ticketIdRef.current || tid !== ticketIdRef.current) return;

      setTypingUsers((prev) => {
        if (prev.some((u) => u.socketId === socketId)) return prev;
        return [...prev, { socketId, name }];
      });

      // Auto-clear after TTL
      clearTimeout(typingTimers.current[socketId]);
      typingTimers.current[socketId] = setTimeout(() => {
        setTypingUsers((prev) => prev.filter((u) => u.socketId !== socketId));
      }, TYPING_TTL_MS);
    };

    // ── Connect ─────────────────────────────────────────────────────────────
    const sock = getTicketSocket(getToken);
    if (!active) return;

    socketRef.current = sock;

    sock.on("connect",        handleConnect);
    sock.on("disconnect",     handleDisconnect);
    sock.on("ticket:new",     handleTicketNew);
    sock.on("ticket:message", handleTicketMessage);
    sock.on("ticket:updated", handleTicketUpdated);
    sock.on("ticket:event",   handleTicketEvent);
    sock.on("ticket:typing",  handleTicketTyping);

    // Sync initial state
    if (sock.connected) {
      setConnected(true);
      if (ticketIdRef.current) {
        sock.emit("ticket:join", ticketIdRef.current);
      }
    }

    return () => {
      active = false;
      sock.off("connect",        handleConnect);
      sock.off("disconnect",     handleDisconnect);
      sock.off("ticket:new",     handleTicketNew);
      sock.off("ticket:message", handleTicketMessage);
      sock.off("ticket:updated", handleTicketUpdated);
      sock.off("ticket:event",   handleTicketEvent);
      sock.off("ticket:typing",  handleTicketTyping);
    };
  }, [isSignedIn, getToken, qc]); // intentionally excludes ticketId — managed below

  // ── Room join/leave when ticketId changes ────────────────────────────────────
  useEffect(() => {
    const sock = socketRef.current;
    if (!sock || !ticketId) return;

    // If already connected, join immediately; otherwise handleConnect will do it
    if (sock.connected) {
      sock.emit("ticket:join", ticketId);
    }

    return () => {
      sock.emit("ticket:leave", ticketId);
      // Clear typing state when leaving the ticket
      setTypingUsers([]);
      Object.values(typingTimers.current).forEach(clearTimeout);
      typingTimers.current = {};
    };
  }, [ticketId]);

  // ── Typing emit helper — rate-limited to once per 1.5 s ─────────────────────
  const lastTypingEmit = useRef(0);
  const emitTyping = useCallback(() => {
    const tid = ticketIdRef.current;
    if (!tid) return;
    const now = Date.now();
    if (now - lastTypingEmit.current < 1500) return;
    lastTypingEmit.current = now;
    socketRef.current?.emit("ticket:typing", tid);
  }, []);

  return { typingUsers, emitTyping, connected };
}
