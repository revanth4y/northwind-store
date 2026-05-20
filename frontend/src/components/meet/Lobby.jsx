/**
 * Lobby
 * ─────
 * Pre-join screen: camera preview, display name, room ID input.
 * Starts local media immediately so the user can preview themselves
 * before entering the call. Mic/cam preferences are preserved into the meeting.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router";
import {
  ArrowLeftIcon,
  VideoIcon,
  MicIcon,
  MicOffIcon,
  VideoOffIcon,
  RefreshCwIcon,
} from "lucide-react";

function generateRoomId() {
  const seg = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${seg()}-${seg()}-${seg()}`;
}

/**
 * @param {{
 *   defaultUsername?: string,
 *   onJoin: (opts: { username: string, roomId: string, stream: MediaStream|null, micOn: boolean, camOn: boolean }) => void,
 * }} props
 */
export function Lobby({ defaultUsername, onJoin }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [username, setUsername] = useState(defaultUsername ?? "");
  // Pre-fill room ID from ?room= query param (invite link) or generate a fresh one
  const [roomId, setRoomId] = useState(() => {
    const fromUrl = searchParams.get("room");
    return fromUrl ? fromUrl.toUpperCase() : generateRoomId();
  });
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [joining, setJoining] = useState(false);
  const [mediaError, setMediaError] = useState(null);

  // Sync username when Clerk user loads asynchronously
  useEffect(() => {
    if (defaultUsername && !username) setUsername(defaultUsername);
  }, [defaultUsername]); // eslint-disable-line react-hooks/exhaustive-deps

  // Acquire camera/mic for preview
  useEffect(() => {
    let mounted = true;

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
        stream.getVideoTracks().forEach((t) => (t.enabled = camOn));
        setMediaError(null);
      })
      .catch(() => {
        if (mounted) setMediaError("Camera or microphone not available.");
      });

    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply toggle to preview stream
  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = micOn));
  }, [micOn]);

  useEffect(() => {
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = camOn));
  }, [camOn]);

  async function handleJoin() {
    if (!username.trim() || !roomId.trim() || joining) return;
    setJoining(true);

    let stream = streamRef.current;

    // If preview failed, try once more
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        stream = null;
      }
    }

    if (stream) {
      stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
      stream.getVideoTracks().forEach((t) => (t.enabled = camOn));
    }

    onJoin({ username: username.trim(), roomId: roomId.trim(), stream, micOn, camOn });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        {/* Nav */}
        <div className="mb-5 flex items-center">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <ArrowLeftIcon className="size-4" />
            <span className="hidden sm:inline">Back to store</span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <VideoIcon className="size-5 text-primary" />
            <span className="font-mono text-lg font-bold text-white">Video Meet</span>
          </div>
        </div>

        {/* Card */}
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-neutral-900 shadow-2xl">

          {/* Camera preview */}
          <div className="relative aspect-video w-full bg-black">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={`h-full w-full object-cover transition-opacity duration-300 ${camOn ? "opacity-100" : "opacity-0"}`}
            />

            {/* Avatar when cam off */}
            {!camOn && (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-800">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-neutral-700 text-3xl font-bold uppercase text-neutral-400 ring-2 ring-neutral-600">
                  {username?.[0] ?? "?"}
                </div>
              </div>
            )}

            {/* Media error */}
            {mediaError && (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/90 p-4">
                <p className="text-center text-sm text-neutral-400">{mediaError}</p>
              </div>
            )}

            {/* Mic + cam toggles over preview */}
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-3">
              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={() => setMicOn((v) => !v)}
                title={micOn ? "Mute mic" : "Unmute mic"}
                className={`flex size-10 items-center justify-center rounded-full shadow-lg transition-colors
                  ${micOn ? "bg-white/20 text-white hover:bg-white/30" : "bg-error text-white"}`}
              >
                {micOn ? <MicIcon className="size-5" /> : <MicOffIcon className="size-5" />}
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={() => setCamOn((v) => !v)}
                title={camOn ? "Stop camera" : "Start camera"}
                className={`flex size-10 items-center justify-center rounded-full shadow-lg transition-colors
                  ${camOn ? "bg-white/20 text-white hover:bg-white/30" : "bg-error text-white"}`}
              >
                {camOn ? <VideoIcon className="size-5" /> : <VideoOffIcon className="size-5" />}
              </motion.button>
            </div>
          </div>

          {/* Form */}
          <div className="space-y-4 p-6">
            {/* Display name */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Display name
              </label>
              <input
                type="text"
                className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2.5 text-sm text-white
                  placeholder-neutral-500 outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/40"
                placeholder="Your name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                maxLength={40}
              />
            </div>

            {/* Room ID */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Room ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 rounded-xl border border-white/10 bg-neutral-800 px-3 py-2.5 font-mono text-sm
                    text-white placeholder-neutral-500 outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/40"
                  placeholder="e.g. ABCD-EFGH-IJKL"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  maxLength={20}
                />
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setRoomId(generateRoomId())}
                  title="Generate new Room ID"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10
                    text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <RefreshCwIcon className="size-4" />
                </motion.button>
              </div>
              <p className="mt-1.5 text-xs text-neutral-500">
                {searchParams.get("room")
                  ? "Room ID pre-filled from your invite link."
                  : "Share this ID so others can join the same room."}
              </p>
            </div>

            {/* Join button */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleJoin}
              disabled={!username.trim() || !roomId.trim() || joining}
              className="btn btn-primary w-full gap-2 text-base font-semibold shadow-lg disabled:opacity-40"
            >
              {joining ? (
                <>
                  <span className="loading loading-spinner loading-sm" />
                  Joining…
                </>
              ) : (
                <>
                  <VideoIcon className="size-5" />
                  Join / Create Meeting
                </>
              )}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
