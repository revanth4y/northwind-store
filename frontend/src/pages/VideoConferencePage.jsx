/**
 * VideoConferencePage  (/meet)
 * ────────────────────────────
 * Role-aware router: customer → SupportLobby → WaitingRoom → 1:1 call
 *                    admin/support → AdminSupportPanel + active call view
 */

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { useAuth, useUser } from "@clerk/react";

import { AdminSupportPanel }      from "../components/meet/AdminSupportPanel";
import { ChatPanel }              from "../components/meet/ChatPanel";
import { ControlBar }             from "../components/meet/ControlBar";
import { FloatingSelfView }       from "../components/meet/FloatingSelfView";
import { HostControlsPanel }      from "../components/meet/HostControlsPanel";
import { ParticipantsList }       from "../components/meet/ParticipantsList";
import { SupportLobby }          from "../components/meet/SupportLobby";
import { TileFullscreenOverlay }  from "../components/meet/TileFullscreenOverlay";
import { VideoGrid }              from "../components/meet/VideoGrid";
import { WaitingRoom }            from "../components/meet/WaitingRoom";

import { useAdminSupport }  from "../hooks/useAdminSupport";
import { useSupportCall }   from "../hooks/useSupportCall";
import { useFullscreen }    from "../hooks/useFullscreen";

const SOCKET_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

// ── Helpers ───────────────────────────────────────────────────────────────────

function LoadingScreen({ text = "Loading…" }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 text-white gap-4">
      <span className="loading loading-spinner loading-lg text-primary" />
      <p className="text-sm text-neutral-400">{text}</p>
    </div>
  );
}

function EndedScreen({ reason, onReset }) {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 px-4 text-white">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-xs text-center"
      >
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-800">
            <span className="text-3xl">👋</span>
          </div>
        </div>
        <h2 className="mb-2 text-xl font-bold">Call Ended</h2>
        <p className="mb-8 text-sm text-neutral-400">{reason ?? "The call has ended."}</p>
        <div className="flex flex-col gap-2">
          <button onClick={onReset} className="btn btn-primary w-full">Start a New Call</button>
          <button onClick={() => navigate("/")} className="btn btn-ghost w-full text-neutral-400">Back to Home</button>
        </div>
      </motion.div>
    </div>
  );
}

function RejectedScreen({ reason, onReset }) {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 px-4 text-white">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-xs text-center"
      >
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-error/20">
            <span className="text-3xl">🚫</span>
          </div>
        </div>
        <h2 className="mb-2 text-xl font-bold">Not Available</h2>
        <p className="mb-8 text-sm text-neutral-400">{reason}</p>
        <div className="flex flex-col gap-2">
          <button onClick={onReset} className="btn btn-primary w-full">Try Again</button>
          <button onClick={() => navigate("/")} className="btn btn-ghost w-full text-neutral-400">Back to Home</button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Floating reaction bubble ───────────────────────────────────────────────────

function ReactionBubble({ emoji, id }) {
  return (
    <motion.div
      key={id}
      initial={{ opacity: 1, y: 0, scale: 0.6 }}
      animate={{ opacity: 0, y: -140, scale: 1.3 }}
      transition={{ duration: 2.8, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none absolute bottom-20 left-1/2 z-50 -translate-x-1/2 select-none text-5xl drop-shadow-lg"
    >
      {emoji}
    </motion.div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function VideoConferencePage() {
  const navigate   = useNavigate();
  const { getToken } = useAuth();
  const { user }   = useUser();

  // ── Role detection ──────────────────────────────────────────────────────────
  const [userRole,  setUserRole]  = useState(null);
  const [roleError, setRoleError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) { setUserRole("customer"); return; }
        const res = await fetch(`${SOCKET_URL}/api/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error();
        const { user: localUser } = await res.json();
        setUserRole(localUser?.role ?? "customer");
      } catch {
        setRoleError(true);
        setUserRole("customer");
      }
    })();
  }, [getToken]);

  const isStaff = userRole === "admin" || userRole === "support";

  const callerName   = user?.fullName ?? user?.firstName ?? user?.primaryEmailAddress?.emailAddress?.split("@")[0] ?? "Guest";
  const callerEmail  = user?.primaryEmailAddress?.emailAddress ?? "";
  const callerAvatar = user?.imageUrl ?? null;

  // ── Local media refs & state ────────────────────────────────────────────────
  const localStreamRef  = useRef(null);
  const cameraStreamRef = useRef(null);
  const screenTrackRef  = useRef(null);
  const localVideoRef   = useRef(null);

  const [localStream, setLocalStreamState] = useState(null);
  const [cameraStream, setCameraStream]    = useState(null);

  const [micOn,    setMicOn]    = useState(true);
  const [camOn,    setCamOn]    = useState(true);
  const [screenOn, setScreenOn] = useState(false);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [showChat,         setShowChat]         = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showHostControls, setShowHostControls] = useState(false);
  const [chatInput,        setChatInput]        = useState("");
  const [unread,           setUnread]           = useState(0);

  const [fullscreenedTileId, setFullscreenedTileId] = useState(null);
  const [reactions, setReactions] = useState([]);

  const meetingAreaRef = useRef(null);
  const videoAreaRef   = useRef(null);

  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(meetingAreaRef);

  // ── Customer hook ───────────────────────────────────────────────────────────
  const {
    phase: customerPhase,
    sessionId: customerSessionId,
    queuePosition,
    adminCount,
    adminInfo,
    peerStream: customerPeerStream,
    peerIceState: customerIceState,
    socketConnected: customerSocketConnected,
    endReason: customerEndReason,
    requestSupport,
    cancelRequest,
    endCall: customerEndCall,
    reset: customerReset,
    updateLocalStream: customerUpdateStream,
    messages: customerMessages,
    sendChat: customerSendChat,
    remoteScreenShare: customerRemoteScreenShare,
    emitScreenShare: customerEmitScreenShare,
    sendReact: customerSendReact,
    latestRemoteReaction: customerLatestReaction,
  } = useSupportCall({
    callerName,
    callerEmail,
    callerAvatar,
    localStream: localStreamRef.current,
    enabled: !isStaff && userRole !== null,
  });

  // ── Admin hook ──────────────────────────────────────────────────────────────
  const {
    phase: adminPhase,
    queue,
    activeCall,
    peerStream: adminPeerStream,
    peerIceState: adminIceState,
    socketConnected: adminSocketConnected,
    incomingNotifications,
    acceptCall,
    rejectCall,
    endCall: adminEndCall,
    updateLocalStream: adminUpdateStream,
    messages: adminMessages,
    sendChat: adminSendChat,
    remoteScreenShare: adminRemoteScreenShare,
    emitScreenShare: adminEmitScreenShare,
    sendReact: adminSendReact,
    latestRemoteReaction: adminLatestReaction,
  } = useAdminSupport({
    localStream: localStreamRef.current,
    enabled: isStaff,
    callerName,
  });

  // ── Derived: pick the active hook's values ──────────────────────────────────
  const messages          = isStaff ? adminMessages          : customerMessages;
  const sendChat          = isStaff ? adminSendChat          : customerSendChat;
  const remoteScreenShare = isStaff ? adminRemoteScreenShare : customerRemoteScreenShare;
  const emitScreenShare   = isStaff ? adminEmitScreenShare   : customerEmitScreenShare;
  const sendReact         = isStaff ? adminSendReact         : customerSendReact;
  const latestRemoteReaction = isStaff ? adminLatestReaction : customerLatestReaction;

  // ── Queue entry timestamp ───────────────────────────────────────────────────
  const [queuedAt, setQueuedAt] = useState(null);
  useEffect(() => {
    if (customerPhase === "waiting") setQueuedAt(Date.now());
  }, [customerPhase]);

  // ── Admin camera pre-acquisition ─────────────────────────────────────────────
  useEffect(() => {
    if (!isStaff || localStreamRef.current) return;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        stream.getVideoTracks().forEach(t => (t.enabled = camOn));
        stream.getAudioTracks().forEach(t => (t.enabled = micOn));
        setLocalStream(stream);
      })
      .catch(err => console.warn("[video-page] admin: camera error:", err.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaff]);

  // ── Stream management ────────────────────────────────────────────────────────

  const setLocalStream = useCallback((stream) => {
    localStreamRef.current = stream;
    setLocalStreamState(stream);
    if (localVideoRef.current && stream) localVideoRef.current.srcObject = stream;
    if (isStaff) adminUpdateStream(stream);
    else customerUpdateStream(stream);
  }, [isStaff, adminUpdateStream, customerUpdateStream]);

  const handleLobbyStart = useCallback((stream, mic, cam) => {
    setMicOn(mic);
    setCamOn(cam);
    localStreamRef.current = stream;
    setLocalStreamState(stream);
    if (localVideoRef.current && stream) localVideoRef.current.srcObject = stream;
    customerUpdateStream(stream);
    requestSupport();
  }, [customerUpdateStream, requestSupport]);

  // ── Controls ─────────────────────────────────────────────────────────────────

  const toggleMic = useCallback(() => {
    const next = !micOn;
    localStreamRef.current?.getAudioTracks().forEach(t => (t.enabled = next));
    setMicOn(next);
  }, [micOn]);

  const toggleCam = useCallback(() => {
    const next = !camOn;
    localStreamRef.current?.getVideoTracks().forEach(t => (t.enabled = next));
    setCamOn(next);
  }, [camOn]);

  const toggleScreen = useCallback(async () => {
    if (screenOn) {
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      const restored = cameraStreamRef.current;
      cameraStreamRef.current = null;
      setCameraStream(null);
      if (restored) {
        setLocalStream(restored);
      } else {
        try {
          const cam = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          const [videoTrack] = cam.getVideoTracks();
          videoTrack.enabled = camOn;
          setLocalStream(new MediaStream([
            videoTrack,
            ...(localStreamRef.current?.getAudioTracks() ?? []),
          ]));
        } catch { /* ignored */ }
      }
      setScreenOn(false);
    } else {
      try {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const [screenTrack] = display.getVideoTracks();
        screenTrackRef.current = screenTrack;

        const saved = localStreamRef.current;
        cameraStreamRef.current = saved;
        setCameraStream(saved);

        const screenStream = new MediaStream([
          screenTrack,
          ...(localStreamRef.current?.getAudioTracks() ?? []),
        ]);
        setLocalStream(screenStream);
        setScreenOn(true);

        screenTrack.onended = () => {
          const restored = cameraStreamRef.current;
          cameraStreamRef.current = null;
          screenTrackRef.current  = null;
          setCameraStream(null);
          if (restored) setLocalStream(restored);
          setScreenOn(false);
        };
      } catch { /* user cancelled */ }
    }
  }, [screenOn, camOn, setLocalStream]);

  // ── Notify remote when screen share changes ───────────────────────────────────
  const inCallPhase = isStaff
    ? adminPhase === "in-call" || adminPhase === "accepting"
    : customerPhase === "in-call" || customerPhase === "connecting";

  useEffect(() => {
    if (!inCallPhase) return;
    emitScreenShare(screenOn);
  }, [screenOn, inCallPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLeave = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current  = null;
    cameraStreamRef.current = null;
    screenTrackRef.current  = null;
    setCameraStream(null);
    if (isStaff) adminEndCall();
    else customerEndCall();
    navigate("/");
  }, [isStaff, adminEndCall, customerEndCall, navigate]);

  // ── Derived values ───────────────────────────────────────────────────────────

  const peerName = isStaff
    ? (activeCall?.customerName ?? "Customer")
    : (adminInfo?.name ?? "Agent");

  const peerStream   = isStaff ? adminPeerStream   : customerPeerStream;
  const peerIceState = isStaff ? adminIceState     : customerIceState;
  const socketConnected = isStaff ? adminSocketConnected : customerSocketConnected;

  const callParticipants = useMemo(() => [
    {
      id: "remote",
      stream: peerStream,
      username: peerName,
      isLocal: false,
      isHost: isStaff,
      camOn: true,
      micOn: true,
      iceState: peerIceState,
      isScreenShare: remoteScreenShare,
    },
    {
      id: "local",
      stream: localStream,
      username: callerName,
      isLocal: true,
      isHost: isStaff,
      camOn,
      micOn,
      iceState: "connected",
      isScreenShare: screenOn,
    },
  ], [peerStream, peerName, isStaff, peerIceState, remoteScreenShare, localStream, callerName, camOn, micOn, screenOn]);

  const participantsForPanel = useMemo(() => [
    { socketId: "local", username: callerName, joinedAt: Date.now(), isHost: isStaff, isSelf: true },
    ...(isStaff
      ? (activeCall ? [{ socketId: activeCall.customerSocketId, username: activeCall.customerName, joinedAt: Date.now(), isHost: false, isSelf: false }] : [])
      : (adminInfo  ? [{ socketId: adminInfo.socketId,          username: adminInfo.name,          joinedAt: Date.now(), isHost: true,  isSelf: false }] : [])
    ),
  ], [callerName, isStaff, activeCall, adminInfo]);

  const fullscreenedParticipant = useMemo(
    () => fullscreenedTileId ? callParticipants.find(p => p.id === fullscreenedTileId) ?? null : null,
    [fullscreenedTileId, callParticipants],
  );

  // ── Unread chat counter ───────────────────────────────────────────────────────
  const readCountRef = useRef(0);
  useEffect(() => {
    if (showChat) {
      readCountRef.current = messages.length;
      setUnread(0);
    } else {
      setUnread(Math.max(0, messages.length - readCountRef.current));
    }
  }, [messages.length, showChat]);

  // ── Call duration timer ───────────────────────────────────────────────────────
  const callStartRef = useRef(null);
  const [callDuration, setCallDuration] = useState("00:00");

  useEffect(() => {
    if (inCallPhase) {
      if (!callStartRef.current) callStartRef.current = Date.now();
    } else {
      callStartRef.current = null;
      setCallDuration("00:00");
    }
  }, [inCallPhase]);

  useEffect(() => {
    if (!inCallPhase) return;
    const id = setInterval(() => {
      const start = callStartRef.current ?? Date.now();
      const s = Math.floor((Date.now() - start) / 1000);
      setCallDuration(
        `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`,
      );
    }, 1000);
    return () => clearInterval(id);
  }, [inCallPhase]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!inCallPhase) return;
    const handler = (e) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target.isContentEditable
      ) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "m" || e.key === "M") { e.preventDefault(); toggleMic(); }
      if (e.key === "v" || e.key === "V") { e.preventDefault(); toggleCam(); }
      if (e.key === "s" || e.key === "S") { e.preventDefault(); toggleScreen(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [inCallPhase, toggleMic, toggleCam, toggleScreen]);

  // ── Side-panel toggles ────────────────────────────────────────────────────────
  const openChat = useCallback(() => {
    setShowChat(v => !v);
    setShowParticipants(false);
    setShowHostControls(false);
  }, []);

  const openParticipants = useCallback(() => {
    setShowParticipants(v => !v);
    setShowChat(false);
    setShowHostControls(false);
  }, []);

  const openHostControls = useCallback(() => {
    setShowHostControls(v => !v);
    setShowChat(false);
    setShowParticipants(false);
  }, []);

  const handleTileFullscreen = useCallback((id) => {
    setFullscreenedTileId(prev => prev === id ? null : id);
  }, []);

  // ── Reactions ─────────────────────────────────────────────────────────────────

  const showReactionBubble = useCallback((emoji) => {
    const id = Date.now() + Math.random();
    setReactions(prev => [...prev, { id, emoji }]);
    setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 3200);
  }, []);

  // Show remote participant's reaction as a bubble on this side
  useEffect(() => {
    if (!latestRemoteReaction?.emoji) return;
    showReactionBubble(latestRemoteReaction.emoji);
  }, [latestRemoteReaction]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReact = useCallback((emoji) => {
    showReactionBubble(emoji);
    sendReact?.(emoji);
  }, [sendReact, showReactionBubble]);

  // ── Chat send ─────────────────────────────────────────────────────────────────
  const handleSendChat = useCallback(() => {
    if (!chatInput.trim()) return;
    sendChat?.(chatInput);
    setChatInput("");
  }, [chatInput, sendChat]);

  // ── Shared active call view ───────────────────────────────────────────────────
  const activeCallView = (
    <div ref={meetingAreaRef} className="relative flex h-full flex-col bg-neutral-950">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div ref={videoAreaRef} className="relative flex min-h-0 flex-1 p-2 sm:p-3">
          <VideoGrid
            participants={callParticipants}
            screenOn={screenOn}
            isAdmin={isStaff}
            onTileFullscreen={handleTileFullscreen}
          />

          {screenOn && inCallPhase && (
            <FloatingSelfView
              stream={cameraStream}
              username={callerName}
              camOn={camOn}
              containerRef={videoAreaRef}
            />
          )}

          {/* Floating emoji reactions */}
          <AnimatePresence>
            {reactions.map(r => (
              <ReactionBubble key={r.id} id={r.id} emoji={r.emoji} />
            ))}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {showParticipants && (
            <ParticipantsList
              key="participants"
              participants={participantsForPanel}
              onClose={() => setShowParticipants(false)}
            />
          )}
          {showChat && (
            <ChatPanel
              key="chat"
              messages={messages}
              input={chatInput}
              onInput={setChatInput}
              onSend={handleSendChat}
              onClose={() => setShowChat(false)}
            />
          )}
          {showHostControls && isStaff && (
            <HostControlsPanel
              key="host"
              participants={participantsForPanel}
              sessionId={isStaff ? activeCall?.sessionId : customerSessionId}
              callDuration={callDuration}
              onClose={() => setShowHostControls(false)}
            />
          )}
        </AnimatePresence>
      </div>

      <ControlBar
        micOn={micOn}
        camOn={camOn}
        screenOn={screenOn}
        chatOpen={showChat}
        participantsOpen={showParticipants}
        hostControlsOpen={showHostControls}
        participantCount={participantsForPanel.length}
        unread={unread}
        isHost={isStaff}
        fullscreen={isFullscreen}
        onMic={toggleMic}
        onCam={toggleCam}
        onScreen={toggleScreen}
        onChat={openChat}
        onParticipants={openParticipants}
        onHostControls={openHostControls}
        onFullscreen={toggleFullscreen}
        onReact={handleReact}
        onLeave={handleLeave}
      />

      <TileFullscreenOverlay
        participant={fullscreenedParticipant}
        onClose={() => setFullscreenedTileId(null)}
      />
    </div>
  );

  // ── Render tree ───────────────────────────────────────────────────────────────

  if (userRole === null) return <LoadingScreen text="Loading your profile…" />;

  if (isStaff) {
    return (
      <AdminSupportPanel
        phase={adminPhase}
        queue={queue}
        activeCall={activeCall}
        socketConnected={adminSocketConnected}
        incomingNotifications={incomingNotifications}
        onAccept={acceptCall}
        onReject={rejectCall}
        onEndCall={adminEndCall}
      >
        {adminPhase === "in-call" && activeCallView}
      </AdminSupportPanel>
    );
  }

  if (customerPhase === "idle") {
    return (
      <SupportLobby
        callerName={callerName}
        callerEmail={callerEmail}
        callerAvatar={callerAvatar}
        onStart={handleLobbyStart}
      />
    );
  }

  if (customerPhase === "requesting" || customerPhase === "waiting") {
    return (
      <WaitingRoom
        queuePosition={queuePosition}
        adminCount={adminCount}
        queuedAt={queuedAt}
        socketConnected={customerSocketConnected}
        onCancel={() => {
          cancelRequest();
          localStreamRef.current?.getTracks().forEach(t => t.stop());
          localStreamRef.current = null;
        }}
      />
    );
  }

  if (customerPhase === "ended") {
    return (
      <EndedScreen
        reason={customerEndReason}
        onReset={() => {
          localStreamRef.current?.getTracks().forEach(t => t.stop());
          localStreamRef.current = null;
          customerReset();
        }}
      />
    );
  }

  if (customerPhase === "rejected") {
    return (
      <RejectedScreen
        reason={customerEndReason}
        onReset={() => {
          localStreamRef.current?.getTracks().forEach(t => t.stop());
          localStreamRef.current = null;
          customerReset();
        }}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-white">
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
        className="flex shrink-0 items-center justify-between border-b border-white/8 bg-neutral-900/90 px-4 py-2.5 backdrop-blur-md"
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-neutral-400 transition-colors hover:bg-white/8 hover:text-white"
            title="Back to store"
          >
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <span className="hidden sm:inline">Home</span>
          </button>
          <span className="text-sm font-semibold text-neutral-200">Support Call</span>
          {adminInfo?.name && (
            <span className="text-xs text-neutral-500">with {adminInfo.name}</span>
          )}
        </div>
        <div
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium
            ${socketConnected ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
        >
          <span className={`size-1.5 rounded-full ${socketConnected ? "animate-pulse bg-success" : "bg-warning"}`} />
          {customerPhase === "connecting" ? "Connecting…" : "Live"}
        </div>
      </motion.header>

      {customerPhase === "connecting" && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <span className="loading loading-spinner loading-lg text-primary" />
            <p className="mt-4 text-sm text-neutral-400">
              {adminInfo?.name ? `Connecting you to ${adminInfo.name}…` : "Setting up your call…"}
            </p>
          </div>
        </div>
      )}

      {customerPhase === "in-call" && (
        <div className="flex flex-1 min-h-0 overflow-hidden flex-col">
          {activeCallView}
        </div>
      )}
    </div>
  );
}
