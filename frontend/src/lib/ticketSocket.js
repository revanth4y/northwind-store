/**
 * ticketSocket — singleton Socket.IO connection to the /tickets namespace.
 *
 * One socket is shared across all React components so we don't open multiple
 * connections when several pages mount simultaneously.
 */

import { io } from "socket.io-client";

const SOCKET_URL =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL
    ? import.meta.env.VITE_API_URL
    : "http://localhost:3001";

/** The singleton socket instance — null until first call to getTicketSocket(). */
let socket = null;

/**
 * Returns the shared /tickets socket, creating and connecting it on first call.
 * Subsequent calls return the same instance (reconnects automatically if needed).
 *
 * @param {() => Promise<string|null>} getToken  Clerk getToken function
 */
export function getTicketSocket(getToken) {
  if (socket) {
    // If disconnected, socket.io will reconnect automatically. Just return it.
    return socket;
  }

  socket = io(`${SOCKET_URL}/tickets`, {
    // Auth callback is invoked on every connection attempt (including reconnects)
    // so the Clerk token is always fresh.
    auth: (cb) => {
      if (!getToken) return cb({ token: null });
      getToken()
        .then((token) => cb({ token: token ?? null }))
        .catch(() => cb({ token: null }));
    },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  });

  return socket;
}

/**
 * Disconnect and destroy the singleton (e.g. on sign-out).
 * After calling this, the next getTicketSocket() creates a fresh connection.
 */
export function disconnectTicketSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
