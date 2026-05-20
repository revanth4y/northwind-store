/**
 * useAdminSupport  — admin/support-agent side hook
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/react";
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
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

const log = (...args) => console.log("[admin-support]", ...args);
const warn = (...args) => console.warn("[admin-support]", ...args);

export function useAdminSupport({ localStream, enabled, callerName = "Agent" }) {
  const { getToken } = useAuth();

  // ── Public state ──────────────────────────────────────────────────────────
  const [phase, setPhase] = useState("idle");
  const [queue, setQueue] = useState([]);
  const [activeCall, setActiveCall] = useState(null);
  const [peerStream, setPeerStream] = useState(null);
  const [peerIceState, setPeerIceState] = useState("new");
  const [socketConnected, setSocketConnected] = useState(false);
  const [incomingNotifications, setIncomingNotifications] = useState([]);
  const notifCounter = useRef(0);

  // ── Chat / reactions / screen-share state ─────────────────────────────────
  const [messages, setMessages] = useState([]);
  const [remoteScreenShare, setRemoteScreenShare] = useState(false);
  const [latestRemoteReaction, setLatestRemoteReaction] = useState(null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const socketRef = useRef(null);
  const mySocketId = useRef("");
  const pcRef = useRef(null);
  const iceQueueRef = useRef([]);
  const localStreamRef = useRef(localStream);
  const customerSocketIdRef = useRef(null);
  const activeSessionIdRef = useRef(null);
  const makingOfferRef = useRef(false);
  const initialNegotiationDoneRef = useRef(false);
  const callerNameRef = useRef(callerName);

  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { callerNameRef.current = callerName; }, [callerName]);

  // ── Notification helpers ──────────────────────────────────────────────────

  function addIncomingNotification(entry) {
    const id = ++notifCounter.current;
    setIncomingNotifications((prev) => [...prev, { id, ...entry }]);
    setTimeout(() => {
      setIncomingNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 12_000);
  }

  function dismissNotification(sessionId) {
    setIncomingNotifications((prev) => prev.filter((n) => n.sessionId !== sessionId));
  }

  // ── WebRTC helpers ────────────────────────────────────────────────────────

  function closePc() {
    pcRef.current?.close();
    pcRef.current = null;
    iceQueueRef.current = [];
    makingOfferRef.current = false;
    initialNegotiationDoneRef.current = false;
    setPeerStream(null);
    setPeerIceState("new");
    setRemoteScreenShare(false);
  }

  function createPc(customerSocketId) {
    closePc();

    const pc = new RTCPeerConnection(ICE_CONFIG);
    pcRef.current = pc;

    const stream = localStreamRef.current;
    if (stream) {
      const tracks = stream.getTracks();
      log("createPc: adding", tracks.length, "track(s)");
      tracks.forEach((t) => pc.addTrack(t, stream));
    } else {
      warn("createPc: localStream is null");
    }

    pc.onnegotiationneeded = async () => {
      if (!initialNegotiationDoneRef.current) {
        log("onnegotiationneeded: suppressed — awaiting initial offer");
        return;
      }
      if (makingOfferRef.current || pc.signalingState !== "stable") return;
      log("onnegotiationneeded: renegotiating");
      makingOfferRef.current = true;
      try {
        const offer = await pc.createOffer();
        if (pc.signalingState !== "stable") return;
        await pc.setLocalDescription(offer);
        socketRef.current?.emit("signal", customerSocketId, JSON.stringify({ sdp: pc.localDescription }));
      } catch (err) {
        warn("onnegotiationneeded error:", err);
      } finally {
        makingOfferRef.current = false;
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current?.emit("signal", customerSocketId, JSON.stringify({ ice: e.candidate }));
      }
    };

    pc.onconnectionstatechange = () => {
      log("connectionState →", pc.connectionState);
      setPeerIceState(pc.connectionState);
      if (pc.connectionState === "connected") setPhase("in-call");
    };

    pc.ontrack = (e) => {
      log("ontrack: received", e.track.kind);
      setPeerStream(e.streams[0] ?? new MediaStream([e.track]));
    };

    return pc;
  }

  // ── Signal handler ────────────────────────────────────────────────────────

  const handleSignal = useCallback(async (fromId, raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const pc = pcRef.current;
    if (!pc) return;

    if (msg.sdp) {
      try {
        const sdpType = msg.sdp.type;
        log("handleSignal: SDP type=%s", sdpType);

        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        for (const c of iceQueueRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
        iceQueueRef.current = [];

        if (sdpType === "offer") {
          makingOfferRef.current = true;
          try {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socketRef.current?.emit("signal", fromId, JSON.stringify({ sdp: pc.localDescription }));
            log("handleSignal: answer sent");
            initialNegotiationDoneRef.current = true;
          } finally {
            makingOfferRef.current = false;
          }
        }
      } catch (err) {
        warn("SDP error:", err);
      }
    }

    if (msg.ice) {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(msg.ice)).catch(() => {});
      } else {
        iceQueueRef.current = [...iceQueueRef.current, msg.ice];
      }
    }
  }, []);

  // ── Socket lifecycle ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled) return;

    let socket;

    (async () => {
      const token = await getToken().catch(() => null);
      if (!token) { warn("No Clerk token"); return; }

      socket = io(`${SOCKET_URL}/support`, {
        auth: { token },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1500,
      });

      socketRef.current = socket;

      socket.on("connect", () => {
        mySocketId.current = socket.id;
        setSocketConnected(true);
      });
      socket.on("disconnect", () => setSocketConnected(false));

      socket.on("support:queue-snapshot", (entries) => setQueue(entries ?? []));
      socket.on("support:queue-update", (entries) => setQueue(entries ?? []));

      socket.on("support:new-request", (entry) => {
        setQueue((prev) => {
          if (prev.find((e) => e.sessionId === entry.sessionId)) return prev;
          return [...prev, entry];
        });
        addIncomingNotification(entry);
      });

      socket.on("support:request-taken", ({ sessionId }) => {
        setQueue((prev) => prev.filter((e) => e.sessionId !== sessionId));
        dismissNotification(sessionId);
      });

      socket.on("support:accepted", ({ sessionId, customerName, customerEmail, customerAvatar, customerSocketId }) => {
        log("support:accepted — customerSocketId=%s", customerSocketId);
        setActiveCall({ sessionId, customerName, customerEmail, customerAvatar, customerSocketId });
        customerSocketIdRef.current = customerSocketId;
        activeSessionIdRef.current = sessionId;
        setPhase("accepting");
        dismissNotification(sessionId);
        createPc(customerSocketId);
      });

      socket.on("support:ended", () => {
        closePc();
        setPhase("ended");
        setMessages([]);
        setTimeout(() => {
          setPhase("idle");
          setActiveCall(null);
          customerSocketIdRef.current = null;
          activeSessionIdRef.current = null;
        }, 3000);
      });

      socket.on("support:customer-disconnected", () => {
        closePc();
        setPhase("ended");
        setMessages([]);
        setTimeout(() => {
          setPhase("idle");
          setActiveCall(null);
          customerSocketIdRef.current = null;
          activeSessionIdRef.current = null;
        }, 3000);
      });

      socket.on("signal", handleSignal);
      socket.on("support:error", ({ code }) => warn("server error:", code));

      // ── Chat ──────────────────────────────────────────────────────────────
      socket.on("support:chat", (msg) => {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + Math.random(),
            sender: msg.senderName,
            socketId: msg.senderSocketId,
            data: msg.text,
            ts: msg.ts,
            self: false,
          },
        ]);
      });

      // ── Screen-share state ────────────────────────────────────────────────
      socket.on("support:screen-share", ({ active }) => {
        setRemoteScreenShare(!!active);
      });

      // ── Reactions ─────────────────────────────────────────────────────────
      socket.on("support:react", ({ emoji }) => {
        setLatestRemoteReaction({ id: Date.now() + Math.random(), emoji });
      });
    })();

    return () => {
      socket?.disconnect();
      closePc();
      setPhase("idle");
      setQueue([]);
      setActiveCall(null);
      setIncomingNotifications([]);
      setSocketConnected(false);
      customerSocketIdRef.current = null;
      activeSessionIdRef.current = null;
      setMessages([]);
      setRemoteScreenShare(false);
      setLatestRemoteReaction(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ── Public API ────────────────────────────────────────────────────────────

  const acceptCall = useCallback((sessionId) => {
    dismissNotification(sessionId);
    socketRef.current?.emit("support:accept", sessionId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rejectCall = useCallback((sessionId) => {
    dismissNotification(sessionId);
    socketRef.current?.emit("support:reject", sessionId);
    setQueue((prev) => prev.filter((e) => e.sessionId !== sessionId));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const endCall = useCallback(() => {
    const sid = activeSessionIdRef.current;
    if (sid) socketRef.current?.emit("support:end", sid);
    closePc();
    setPhase("idle");
    setActiveCall(null);
    customerSocketIdRef.current = null;
    activeSessionIdRef.current = null;
    setMessages([]);
  }, []);

  const updateLocalStream = useCallback((stream) => {
    localStreamRef.current = stream;
    const pc = pcRef.current;
    if (!pc || !stream) return;
    stream.getTracks().forEach((newTrack) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === newTrack.kind);
      if (sender) {
        sender.replaceTrack(newTrack).catch((e) => warn("replaceTrack error:", e));
      } else {
        pc.addTrack(newTrack, stream);
      }
    });
  }, []);

  const sendChat = useCallback((text) => {
    const trimmed = String(text ?? "").trim().slice(0, 500);
    if (!trimmed || !socketRef.current?.connected) return;
    const msg = {
      id: Date.now() + Math.random(),
      sender: callerNameRef.current,
      socketId: mySocketId.current,
      data: trimmed,
      ts: Date.now(),
      self: true,
    };
    setMessages((prev) => [...prev, msg]);
    socketRef.current.emit("support:chat", { text: trimmed });
  }, []);

  const emitScreenShare = useCallback((active) => {
    socketRef.current?.emit("support:screen-share", { active });
  }, []);

  const sendReact = useCallback((emoji) => {
    socketRef.current?.emit("support:react", { emoji });
  }, []);

  return {
    phase,
    queue,
    activeCall,
    peerStream,
    peerIceState,
    socketConnected,
    incomingNotifications,
    acceptCall,
    rejectCall,
    endCall,
    updateLocalStream,
    messages,
    sendChat,
    remoteScreenShare,
    emitScreenShare,
    sendReact,
    latestRemoteReaction,
  };
}
