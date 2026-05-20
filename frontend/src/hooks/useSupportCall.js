/**
 * useSupportCall  — customer-side support call hook
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

const log = (...args) => console.log("[support-call]", ...args);
const warn = (...args) => console.warn("[support-call]", ...args);

export function useSupportCall({ callerName, callerEmail, callerAvatar, localStream, enabled }) {
  const { getToken } = useAuth();

  // ── Public state ──────────────────────────────────────────────────────────
  const [phase, setPhase] = useState("idle");
  const [sessionId, setSessionId] = useState(null);
  const [queuePosition, setQueuePosition] = useState(null);
  const [adminCount, setAdminCount] = useState(0);
  const [adminInfo, setAdminInfo] = useState(null);
  const [peerStream, setPeerStream] = useState(null);
  const [peerIceState, setPeerIceState] = useState("new");
  const [socketConnected, setSocketConnected] = useState(false);
  const [endReason, setEndReason] = useState(null);

  // ── Chat / reactions / screen-share state ─────────────────────────────────
  const [messages, setMessages] = useState([]);
  const [remoteScreenShare, setRemoteScreenShare] = useState(false);
  const [latestRemoteReaction, setLatestRemoteReaction] = useState(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const socketRef = useRef(null);
  const mySocketId = useRef("");
  const pcRef = useRef(null);
  const iceQueueRef = useRef([]);
  const localStreamRef = useRef(localStream);
  const adminSocketIdRef = useRef(null);
  const sessionIdRef = useRef(null);
  const makingOfferRef = useRef(false);
  const callerNameRef = useRef(callerName);

  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { callerNameRef.current = callerName; }, [callerName]);

  // ── WebRTC helpers ────────────────────────────────────────────────────────

  function closePc() {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    iceQueueRef.current = [];
    makingOfferRef.current = false;
    setPeerStream(null);
    setPeerIceState("new");
    setRemoteScreenShare(false);
  }

  const createPc = useCallback((adminSocketId) => {
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
      if (makingOfferRef.current || pc.signalingState !== "stable") return;
      log("onnegotiationneeded: renegotiating");
      makingOfferRef.current = true;
      try {
        const offer = await pc.createOffer();
        if (pc.signalingState !== "stable") return;
        await pc.setLocalDescription(offer);
        socketRef.current?.emit("signal", adminSocketId, JSON.stringify({ sdp: pc.localDescription }));
      } catch (err) {
        warn("onnegotiationneeded error:", err);
      } finally {
        makingOfferRef.current = false;
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current?.emit("signal", adminSocketId, JSON.stringify({ ice: e.candidate }));
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

        if (sdpType === "answer") {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          for (const c of iceQueueRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          }
          iceQueueRef.current = [];
        } else if (sdpType === "offer") {
          log("handleSignal: renegotiation offer — answering");
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          for (const c of iceQueueRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          }
          iceQueueRef.current = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socketRef.current?.emit("signal", adminSocketIdRef.current, JSON.stringify({ sdp: pc.localDescription }));
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

      socket = io(`${SOCKET_URL}/support`, {
        auth: { token, guestName: callerName },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 8,
        reconnectionDelay: 2000,
      });

      socketRef.current = socket;

      socket.on("connect", () => {
        mySocketId.current = socket.id;
        setSocketConnected(true);
      });

      socket.on("disconnect", () => setSocketConnected(false));

      socket.on("support:queued", ({ sessionId: sid, position, adminCount: ac }) => {
        setSessionId(sid);
        sessionIdRef.current = sid;
        setQueuePosition(position);
        setAdminCount(ac ?? 0);
        setPhase("waiting");
      });

      socket.on("support:accepted", async ({ sessionId: sid, adminName, adminSocketId }) => {
        log("support:accepted — adminSocketId=%s", adminSocketId);
        setPhase("connecting");
        setAdminInfo({ name: adminName, socketId: adminSocketId });
        adminSocketIdRef.current = adminSocketId;

        const pc = createPc(adminSocketId);
        makingOfferRef.current = true;
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("signal", adminSocketId, JSON.stringify({ sdp: pc.localDescription }));
        } catch (err) {
          warn("offer error:", err);
          setPhase("error");
        } finally {
          makingOfferRef.current = false;
        }
      });

      socket.on("support:rejected", ({ message }) => {
        setEndReason(message ?? "No agents available.");
        setPhase("rejected");
      });

      socket.on("support:ended", ({ endedBy }) => {
        closePc();
        setEndReason(endedBy === "admin" ? "Agent ended the call." : "You ended the call.");
        setPhase("ended");
      });

      socket.on("support:admin-disconnected", () => {
        closePc();
        setEndReason("The agent disconnected. Please try again.");
        setPhase("ended");
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
      setSessionId(null);
      sessionIdRef.current = null;
      setAdminInfo(null);
      adminSocketIdRef.current = null;
      setPeerStream(null);
      setSocketConnected(false);
      setMessages([]);
      setRemoteScreenShare(false);
      setLatestRemoteReaction(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ── Public API ────────────────────────────────────────────────────────────

  const requestSupport = useCallback(() => {
    if (!socketRef.current?.connected) return;
    setPhase("requesting");
    socketRef.current.emit("support:request", { callerName, callerEmail, callerAvatar });
  }, [callerName, callerEmail, callerAvatar]);

  const cancelRequest = useCallback(() => {
    socketRef.current?.emit("support:cancel");
    setPhase("idle");
    setSessionId(null);
    sessionIdRef.current = null;
    setQueuePosition(null);
  }, []);

  const endCall = useCallback(() => {
    const sid = sessionIdRef.current;
    if (sid) socketRef.current?.emit("support:end", sid);
    closePc();
    setPhase("ended");
    setEndReason("You ended the call.");
  }, []);

  const reset = useCallback(() => {
    closePc();
    setPhase("idle");
    setSessionId(null);
    sessionIdRef.current = null;
    setQueuePosition(null);
    setAdminInfo(null);
    adminSocketIdRef.current = null;
    setPeerStream(null);
    setEndReason(null);
    setMessages([]);
    setRemoteScreenShare(false);
    setLatestRemoteReaction(null);
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
    sessionId,
    queuePosition,
    adminCount,
    adminInfo,
    peerStream,
    peerIceState,
    socketConnected,
    endReason,
    requestSupport,
    cancelRequest,
    endCall,
    reset,
    updateLocalStream,
    messages,
    sendChat,
    remoteScreenShare,
    emitScreenShare,
    sendReact,
    latestRemoteReaction,
  };
}
