/**
 * useVideoConference
 * ──────────────────
 * Manages the full WebRTC + Socket.IO lifecycle for a video call room.
 *
 * Key design decisions vs the old code:
 *  • All mutable signaling state lives in refs — no stale closures in socket handlers
 *  • ICE candidates are queued until remoteDescription is set (fixes silent drop bug)
 *  • Peer usernames are tracked through the signaling channel
 *  • RTCPeerConnection state changes surface in UI via `iceState` per peer
 *  • TURN servers added for users behind symmetric NAT
 *  • Socket.IO reconnection enabled with sensible defaults
 *  • `updateLocalStream` replaces tracks in all active PCs (screen share / camera swap)
 *  • Participant list (all members incl. self) with host identification
 *  • Join/leave toast notifications with auto-dismiss
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    // Free public TURN servers — helps peers behind symmetric NAT
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

/**
 * @param {{ room: string|null, username: string }} opts
 * @returns {{
 *   peers: Array<{ socketId: string, username: string, stream: MediaStream|null, iceState: string }>,
 *   participants: Array<{ socketId: string, username: string, joinedAt: number, isHost: boolean, isSelf: boolean }>,
 *   messages: Array<{ sender: string, data: string, socketId: string, ts: number, self: boolean }>,
 *   notifications: Array<{ id: number, type: 'join'|'leave', username: string }>,
 *   socketConnected: boolean,
 *   isHost: boolean,
 *   updateLocalStream: (stream: MediaStream) => void,
 *   sendMessage: (text: string) => void,
 *   leave: () => void,
 * }}
 */
export function useVideoConference({ room, username }) {
  // ── Public state ────────────────────────────────────────────────────────
  /** WebRTC peers for the video grid */
  const [peers, setPeers] = useState([]);
  /** All room members including self — used by ParticipantsList */
  const [participants, setParticipants] = useState([]);
  /** Chat messages */
  const [messages, setMessages] = useState([]);
  /** Join/leave toast notifications (auto-dismiss) */
  const [notifications, setNotifications] = useState([]);
  const [socketConnected, setSocketConnected] = useState(false);

  // ── Internal refs (never stale in socket event handlers) ───────────────
  const socketRef = useRef(null);
  const mySocketId = useRef("");
  /** @type {React.MutableRefObject<Record<string, RTCPeerConnection>>} */
  const pcMap = useRef({});
  /** @type {React.MutableRefObject<Record<string, RTCIceCandidate[]>>} */
  const iceQueue = useRef({});
  /** @type {React.MutableRefObject<Record<string, string>>} */
  const nameMap = useRef({});
  /** @type {React.MutableRefObject<MediaStream|null>} */
  const localStreamRef = useRef(null);
  /** Mutable participant registry — avoids stale state in socket handlers */
  const participantsRef = useRef({});
  /** Current host socket ID */
  const hostSocketIdRef = useRef(null);
  /** Auto-incrementing notification ID */
  const notifCounter = useRef(0);

  // ── Notification helpers ────────────────────────────────────────────────

  const addNotification = useCallback((type, uname) => {
    const id = ++notifCounter.current;
    setNotifications((prev) => [...prev, { id, type, username: uname }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 4500);
  }, []);

  // ── Participant registry helpers ────────────────────────────────────────

  const flushParticipants = useCallback(() => {
    setParticipants(Object.values(participantsRef.current));
  }, []);

  const addParticipant = useCallback(
    (socketId, uname, joinedAt, isHost) => {
      participantsRef.current[socketId] = {
        socketId,
        username: uname,
        joinedAt,
        isHost: !!isHost,
        isSelf: socketId === mySocketId.current,
      };
      flushParticipants();
    },
    [flushParticipants],
  );

  const removeParticipant = useCallback(
    (socketId) => {
      delete participantsRef.current[socketId];
      flushParticipants();
    },
    [flushParticipants],
  );

  const applyHost = useCallback(
    (newHostId) => {
      hostSocketIdRef.current = newHostId;
      Object.values(participantsRef.current).forEach((p) => {
        p.isHost = p.socketId === newHostId;
      });
      flushParticipants();
    },
    [flushParticipants],
  );

  // ── Peer state helpers ───────────────────────────────────────────────────

  const updatePeer = useCallback((socketId, fields) => {
    setPeers((prev) =>
      prev.map((p) => (p.socketId === socketId ? { ...p, ...fields } : p)),
    );
  }, []);

  const removePeer = useCallback((socketId) => {
    pcMap.current[socketId]?.close();
    delete pcMap.current[socketId];
    delete iceQueue.current[socketId];
    delete nameMap.current[socketId];
    setPeers((prev) => prev.filter((p) => p.socketId !== socketId));
  }, []);

  // ── RTCPeerConnection factory ────────────────────────────────────────────

  const makePc = useCallback(
    (peerId) => {
      if (pcMap.current[peerId]) return pcMap.current[peerId];

      const pc = new RTCPeerConnection(ICE_CONFIG);
      pcMap.current[peerId] = pc;
      iceQueue.current[peerId] = [];

      // Add local tracks
      const stream = localStreamRef.current;
      if (stream) stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socketRef.current?.emit("signal", peerId, JSON.stringify({ ice: e.candidate }));
        }
      };

      pc.onconnectionstatechange = () => {
        updatePeer(peerId, { iceState: pc.connectionState });
      };

      pc.ontrack = (e) => {
        const remoteStream = e.streams[0] ?? new MediaStream([e.track]);
        updatePeer(peerId, { stream: remoteStream });
      };

      return pc;
    },
    [updatePeer],
  );

  // ── Signal handler ───────────────────────────────────────────────────────

  const handleSignal = useCallback(
    async (fromId, raw) => {
      if (fromId === mySocketId.current) return;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      const pc = makePc(fromId);

      if (msg.sdp) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));

          // Drain queued ICE candidates that arrived before the remote description
          const queued = iceQueue.current[fromId] ?? [];
          for (const c of queued) {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          }
          iceQueue.current[fromId] = [];

          if (msg.sdp.type === "offer") {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socketRef.current?.emit(
              "signal",
              fromId,
              JSON.stringify({ sdp: pc.localDescription }),
            );
          }
        } catch (err) {
          console.warn("[webrtc] SDP error:", err);
        }
      }

      if (msg.ice) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(msg.ice)).catch(() => {});
        } else {
          // Queue until remote description is set
          iceQueue.current[fromId] = [...(iceQueue.current[fromId] ?? []), msg.ice];
        }
      }
    },
    [makePc],
  );

  // ── Socket lifecycle ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!room || !username) return;

    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      mySocketId.current = socket.id;
      setSocketConnected(true);

      // Add self to participant registry (isHost determined after existing-peers reply)
      participantsRef.current = {};
      participantsRef.current[socket.id] = {
        socketId: socket.id,
        username,
        joinedAt: Date.now(),
        isHost: false,
        isSelf: true,
      };
      flushParticipants();

      socket.emit("join-call", room, username);
    });

    socket.on("disconnect", () => setSocketConnected(false));

    socket.on("reconnect", () => {
      setSocketConnected(true);
      // Re-join the room after reconnect
      socket.emit("join-call", room, username);
    });

    // Server sends the list of peers already in the room + current host
    socket.on("existing-peers", async (peerList, hostId) => {
      // Apply host — may be self if first joiner
      hostSocketIdRef.current = hostId;
      if (participantsRef.current[mySocketId.current]) {
        participantsRef.current[mySocketId.current].isHost =
          mySocketId.current === hostId;
      }

      for (const { socketId, username: name, joinedAt } of peerList) {
        nameMap.current[socketId] = name;

        // Add to participant registry
        participantsRef.current[socketId] = {
          socketId,
          username: name,
          joinedAt: joinedAt ?? Date.now(),
          isHost: socketId === hostId,
          isSelf: false,
        };

        // Add to video grid
        setPeers((prev) =>
          prev.find((p) => p.socketId === socketId)
            ? prev
            : [...prev, { socketId, username: name, stream: null, iceState: "new" }],
        );

        // We (the new joiner) send offers to all pre-existing peers
        const pc = makePc(socketId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("signal", socketId, JSON.stringify({ sdp: pc.localDescription }));
      }

      flushParticipants();
    });

    // A new peer joined after us — they will send us an offer
    socket.on("peer-joined", ({ socketId, username: name }) => {
      nameMap.current[socketId] = name;

      // Add to video grid
      setPeers((prev) =>
        prev.find((p) => p.socketId === socketId)
          ? prev
          : [...prev, { socketId, username: name, stream: null, iceState: "new" }],
      );

      // Add to participant registry
      addParticipant(socketId, name, Date.now(), socketId === hostSocketIdRef.current);

      // Show toast notification
      addNotification("join", name);
    });

    socket.on("signal", handleSignal);

    socket.on("peer-left", (leftId) => {
      const leavingName =
        participantsRef.current[leftId]?.username ??
        nameMap.current[leftId] ??
        "Participant";

      removeParticipant(leftId);
      removePeer(leftId);
      addNotification("leave", leavingName);
    });

    // Host has transferred to a new member
    socket.on("host-changed", (newHostId) => {
      applyHost(newHostId);
    });

    socket.on("chat-history", (history) => {
      setMessages(
        history.map((m) => ({ ...m, self: m.socketId === mySocketId.current })),
      );
    });

    socket.on("chat-message", (msg) => {
      setMessages((prev) => [
        ...prev,
        { ...msg, self: msg.socketId === mySocketId.current },
      ]);
    });

    return () => {
      socket.disconnect();
      Object.values(pcMap.current).forEach((pc) => pc.close());
      pcMap.current = {};
      iceQueue.current = {};
      nameMap.current = {};
      participantsRef.current = {};
      mySocketId.current = "";
      hostSocketIdRef.current = null;
      setPeers([]);
      setParticipants([]);
      setMessages([]);
      setNotifications([]);
      setSocketConnected(false);
    };
    // handleSignal and makePc use only refs — safe to exclude from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, username]);

  // ── Derived values ────────────────────────────────────────────────────────

  // isHost is true when the local socket is the current room host
  const isHost =
    !!mySocketId.current &&
    !!hostSocketIdRef.current &&
    mySocketId.current === hostSocketIdRef.current;

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Call with the new MediaStream whenever local media changes
   * (initial stream, screen share start/stop, camera swap).
   * Updates the ref and replaces the corresponding track in every active PC.
   */
  const updateLocalStream = useCallback((stream) => {
    localStreamRef.current = stream;
    if (!stream) return;
    Object.values(pcMap.current).forEach((pc) => {
      stream.getTracks().forEach((newTrack) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === newTrack.kind);
        if (sender) {
          sender.replaceTrack(newTrack).catch(() => {});
        } else {
          pc.addTrack(newTrack, stream);
        }
      });
    });
  }, []);

  const sendMessage = useCallback((text) => {
    socketRef.current?.emit("chat-message", text);
  }, []);

  const leave = useCallback(() => {
    socketRef.current?.disconnect();
    Object.values(pcMap.current).forEach((pc) => pc.close());
    pcMap.current = {};
  }, []);

  return {
    peers,
    participants,
    messages,
    notifications,
    socketConnected,
    isHost,
    updateLocalStream,
    sendMessage,
    leave,
  };
}
