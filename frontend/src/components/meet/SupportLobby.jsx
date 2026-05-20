/**
 * SupportLobby
 * ────────────
 * Customer-facing pre-call screen.
 * Shows a camera preview + "Connect with Support" button.
 * Caller info (name, email, avatar) is pre-filled from Clerk.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router";
import {
  ArrowLeftIcon,
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
} from "lucide-react";

/**
 * @param {{
 *   callerName: string,
 *   callerEmail: string,
 *   callerAvatar: string | null,
 *   onStart: (stream: MediaStream|null, micOn: boolean, camOn: boolean) => void,
 * }} props
 */
export function SupportLobby({ callerName, callerEmail, callerAvatar, onStart }) {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  // Set to true when the user clicks Connect so the cleanup knows NOT to stop
  // tracks — ownership has been transferred to the parent / peer connection.
  const handedOffRef = useRef(false);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [joining, setJoining] = useState(false);
  const [mediaError, setMediaError] = useState(null);

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
      // Only stop tracks if the user did NOT hand them off to the peer
      // connection. If they clicked Connect, the parent owns the stream and
      // will stop it on hang-up. Stopping here would kill the sender tracks
      // before the WebRTC offer is even created.
      if (!handedOffRef.current) {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      }
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = micOn));
  }, [micOn]);

  useEffect(() => {
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = camOn));
  }, [camOn]);

  async function handleStart() {
    if (joining) return;
    setJoining(true);

    let stream = streamRef.current;
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

    // Mark as handed off BEFORE calling onStart so the useEffect cleanup
    // (which runs when this component unmounts due to phase change) does not
    // stop the tracks that are now owned by the RTCPeerConnection.
    handedOffRef.current = true;
    onStart(stream, micOn, camOn);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38, ease: "easeOut" }}
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
            <HeadphonesIcon className="size-5 text-primary" />
            <span className="font-mono text-lg font-bold text-white">Customer Support</span>
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

            {!camOn && (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-800">
                {callerAvatar ? (
                  <img
                    src={callerAvatar}
                    alt={callerName}
                    className="h-20 w-20 rounded-full object-cover ring-2 ring-neutral-600"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-neutral-700 text-3xl font-bold uppercase text-neutral-400 ring-2 ring-neutral-600">
                    {callerName?.[0] ?? "?"}
                  </div>
                )}
              </div>
            )}

            {mediaError && (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/90 p-4">
                <p className="text-center text-sm text-neutral-400">{mediaError}</p>
              </div>
            )}

            {/* Mic/cam toggles */}
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-3">
              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={() => setMicOn((v) => !v)}
                className={`flex size-10 items-center justify-center rounded-full shadow-lg transition-colors
                  ${micOn ? "bg-white/20 text-white hover:bg-white/30" : "bg-error text-white"}`}
              >
                {micOn ? <MicIcon className="size-5" /> : <MicOffIcon className="size-5" />}
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={() => setCamOn((v) => !v)}
                className={`flex size-10 items-center justify-center rounded-full shadow-lg transition-colors
                  ${camOn ? "bg-white/20 text-white hover:bg-white/30" : "bg-error text-white"}`}
              >
                {camOn ? <VideoIcon className="size-5" /> : <VideoOffIcon className="size-5" />}
              </motion.button>
            </div>
          </div>

          {/* Form */}
          <div className="space-y-4 p-6">
            {/* Caller info card */}
            <div className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3">
              {callerAvatar ? (
                <img
                  src={callerAvatar}
                  alt={callerName}
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/30 text-base font-bold uppercase text-primary">
                  {callerName?.[0] ?? "?"}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{callerName || "Guest"}</p>
                <p className="truncate text-xs text-neutral-400">{callerEmail || "Not signed in"}</p>
              </div>
            </div>

            <p className="text-center text-sm text-neutral-400">
              A support agent will join your call shortly.
              <br />
              Please check your mic and camera before connecting.
            </p>

            {/* Connect button */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleStart}
              disabled={joining}
              className="btn btn-primary w-full gap-2 text-base font-semibold shadow-lg disabled:opacity-40"
            >
              {joining ? (
                <>
                  <span className="loading loading-spinner loading-sm" />
                  Connecting…
                </>
              ) : (
                <>
                  <HeadphonesIcon className="size-5" />
                  Connect with Support
                </>
              )}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
