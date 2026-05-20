/**
 * ParticipantTile
 * ───────────────
 * Single participant tile for any VideoGrid layout mode.
 *
 * Design contract:
 *  • Always fills its container (h-full w-full). The container controls size.
 *  • The <video> element is NEVER unmounted between layout changes.
 *    srcObject is assigned by a useEffect; stable stream refs mean no flash.
 *  • Screen-share streams use object-contain (never crop the shared content).
 *  • Camera-off state shows a deterministic gradient with large initials,
 *    matching the Google Meet visual style.
 *
 * Features:
 *  • Active-speaker glow via Web Audio API analyser (rAF pace, no thrash)
 *  • Hover-reveal controls: pin, fullscreen (⊞), context menu (⋮)
 *  • Double-click to fullscreen
 *  • Host crown badge
 *  • Mute / camera-off indicators
 *  • Connection state badge (connecting, failed, etc.)
 *  • Thumbnail / focused / gallery variants
 *
 * Performance: wrapped in React.memo — only re-renders when a prop changes.
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  VideoOffIcon,
  WifiOffIcon,
  LoaderIcon,
  PinIcon,
  MonitorIcon,
  MicOffIcon,
  VideoIcon,
  MaximizeIcon,
  MoreVerticalIcon,
  CrownIcon,
} from "lucide-react";
import { TileContextMenu } from "./TileContextMenu";

// ── Deterministic tile background gradient ────────────────────────────────────

const GRADIENTS = [
  "from-rose-900  to-red-950",
  "from-teal-900  to-emerald-950",
  "from-blue-900  to-indigo-950",
  "from-purple-900 to-violet-950",
  "from-amber-900 to-orange-950",
  "from-cyan-900  to-sky-950",
];

function getGradient(username) {
  let hash = 0;
  for (const c of username ?? "") hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

// ── Active-speaker detector ───────────────────────────────────────────────────

function useIsSpeaking(stream) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!stream) { setSpeaking(false); return; }
    if (!stream.getAudioTracks().length) { setSpeaking(false); return; }

    let cancelled = false, rafId, ctx;
    try { ctx = new AudioContext(); } catch { return; }

    const source   = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (cancelled) return;
      rafId = requestAnimationFrame(tick);
      analyser.getByteFrequencyData(data);
      setSpeaking(data.reduce((a, b) => a + b, 0) / data.length > 8);
    };
    rafId = requestAnimationFrame(tick);

    return () => { cancelled = true; cancelAnimationFrame(rafId); ctx.close().catch(() => {}); };
  }, [stream]);

  return speaking;
}

// ── Connection badge ──────────────────────────────────────────────────────────

function ConnectionBadge({ state }) {
  if (!state || state === "connected") return null;
  const cfg = {
    new:          { label: "Connecting…",   cls: "bg-warning/80 text-black",  Icon: LoaderIcon,  spin: true  },
    connecting:   { label: "Connecting…",   cls: "bg-warning/80 text-black",  Icon: LoaderIcon,  spin: true  },
    disconnected: { label: "Reconnecting",  cls: "bg-warning/80 text-black",  Icon: LoaderIcon,  spin: true  },
    failed:       { label: "Failed",        cls: "bg-error/80 text-white",    Icon: WifiOffIcon, spin: false },
    closed:       { label: "Left",          cls: "bg-neutral/80 text-white",  Icon: WifiOffIcon, spin: false },
  }[state];
  if (!cfg) return null;

  return (
    <div className={`absolute right-2 top-2 z-20 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm ${cfg.cls}`}>
      <cfg.Icon className={`size-3 ${cfg.spin ? "animate-spin" : ""}`} />
      {cfg.label}
    </div>
  );
}

// ── ParticipantTile ───────────────────────────────────────────────────────────

/**
 * @param {{
 *   stream?: MediaStream | null,
 *   username?: string,
 *   isLocal?: boolean,
 *   isHost?: boolean,
 *   isAdmin?: boolean,
 *   camOn?: boolean,
 *   iceState?: string,
 *   isFocused?: boolean,
 *   isPinned?: boolean,
 *   isThumbnail?: boolean,
 *   isScreenShare?: boolean,
 *   onPin?: () => void,
 *   onFullscreen?: () => void,
 * }} props
 */
export const ParticipantTile = memo(function ParticipantTile({
  stream,
  username,
  isLocal       = false,
  isHost        = false,
  isAdmin       = false,
  camOn         = true,
  micOn         = true,
  iceState,
  isFocused     = false,
  isPinned      = false,
  isThumbnail   = false,
  isScreenShare = false,
  onPin,
  onFullscreen,
}) {
  const videoRef      = useRef(null);
  const isSpeaking    = useIsSpeaking(stream);
  const [hovered,     setHovered]     = useState(false);
  const [menuOpen,    setMenuOpen]    = useState(false);

  const gradient = getGradient(username);

  // Assign stream to <video> — never recreate the element
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream ?? null;
  }, [stream]);

  // Double-click fullscreen
  const handleDoubleClick = useCallback(() => {
    onFullscreen?.();
  }, [onFullscreen]);

  // ── Visibility logic ───────────────────────────────────────────────────────
  const showFallback = isLocal
    ? !camOn
    : !stream || iceState === "failed" || iceState === "closed";

  const initials = (username ?? "?")
    .split(" ").filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();

  // ── Border ring priority ───────────────────────────────────────────────────
  const ringClass = isSpeaking
    ? "ring-[3px] ring-success shadow-[0_0_28px_6px_rgba(34,197,94,0.38)]"
    : isFocused
      ? "ring-2 ring-primary/50"
      : isPinned
        ? "ring-2 ring-primary/40"
        : isLocal
          ? "ring-1 ring-primary/25"
          : "ring-1 ring-white/8";

  // Screen share: don't crop the content
  const objectFitClass = isScreenShare ? "object-contain bg-black" : "object-cover";

  return (
    <div
      className={`group relative flex h-full w-full cursor-pointer select-none overflow-hidden rounded-[inherit] bg-neutral-900 ${ringClass}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setMenuOpen(false); }}
      onClick={!menuOpen ? onPin : undefined}
      onDoubleClick={handleDoubleClick}
    >
      {/* ── Video ───────────────────────────────────────────────────────────── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={`h-full w-full transition-opacity duration-300 ${objectFitClass} ${showFallback ? "absolute inset-0 opacity-0" : "opacity-100"}`}
      />

      {/* ── Camera-off / disconnected fallback — Google Meet gradient style ── */}
      {showFallback && (
        <div className={`absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br ${gradient}`}>
          <div className={`flex items-center justify-center rounded-full bg-white/10 ring-2 ring-white/20 ${isThumbnail ? "h-9 w-9" : "h-16 w-16"}`}>
            {iceState === "failed" || iceState === "closed" ? (
              <WifiOffIcon className={`text-white/60 ${isThumbnail ? "size-4" : "size-7"}`} />
            ) : initials ? (
              <span className={`font-bold text-white ${isThumbnail ? "text-sm" : "text-2xl"}`}>{initials}</span>
            ) : (
              <VideoOffIcon className={`text-white/60 ${isThumbnail ? "size-4" : "size-7"}`} />
            )}
          </div>
          {!isThumbnail && (
            <span className="text-xs text-white/50">
              {isLocal ? "Your camera is off" : `${username ?? "Participant"}'s camera is off`}
            </span>
          )}
        </div>
      )}

      {/* ── Active-speaker glow ring ────────────────────────────────────────── */}
      <AnimatePresence>
        {isSpeaking && (
          <motion.div
            key="speaker-glow"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.4, 1, 0.4] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            className="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-inset ring-success/60"
          />
        )}
      </AnimatePresence>

      {/* ── Hover controls row (top-right) ─────────────────────────────────── */}
      <AnimatePresence>
        {hovered && !isThumbnail && (
          <motion.div
            key="hover-controls"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute right-2 top-2 z-20 flex gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Pin / Unpin button */}
            {!isLocal && (
              <button
                onClick={(e) => { e.stopPropagation(); onPin?.(); }}
                title={isPinned ? "Unpin" : "Pin"}
                className={`flex h-7 w-7 items-center justify-center rounded-lg backdrop-blur-md transition-colors ${isPinned ? "bg-primary text-white" : "bg-black/60 text-white hover:bg-black/80"}`}
              >
                <PinIcon className="size-3.5" />
              </button>
            )}

            {/* Fullscreen button */}
            {onFullscreen && (
              <button
                onClick={(e) => { e.stopPropagation(); onFullscreen(); }}
                title="Full screen (or double-click)"
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-white backdrop-blur-md transition-colors hover:bg-black/80"
              >
                <MaximizeIcon className="size-3.5" />
              </button>
            )}

            {/* Context menu trigger */}
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
                title="More options"
                className={`flex h-7 w-7 items-center justify-center rounded-lg backdrop-blur-md transition-colors ${menuOpen ? "bg-white/20 text-white" : "bg-black/60 text-white hover:bg-black/80"}`}
              >
                <MoreVerticalIcon className="size-3.5" />
              </button>

              <TileContextMenu
                open={menuOpen}
                isPinned={isPinned}
                isLocal={isLocal}
                isAdmin={isAdmin}
                onClose={() => setMenuOpen(false)}
                onPin={() => { onPin?.(); }}
                onFullscreen={onFullscreen}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Pinned badge (non-hovered, non-thumbnail) ──────────────────────── */}
      {isPinned && !hovered && !isThumbnail && (
        <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-full bg-primary/80 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
          <PinIcon className="size-2.5" />
          Pinned
        </div>
      )}

      {/* ── Screen-share badge (thumbnails + unfocused tiles) ──────────────── */}
      {isScreenShare && !isFocused && (
        <div className="absolute left-2 top-2 z-20 flex items-center gap-1.5 rounded-full bg-primary/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          <MonitorIcon className="size-3" />
          {!isThumbnail && "Screen"}
        </div>
      )}

      {/* ── Host crown ─────────────────────────────────────────────────────── */}
      {isHost && !isThumbnail && (
        <div className="absolute left-2 top-2 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 shadow">
          <CrownIcon className="size-3 text-amber-900" />
        </div>
      )}

      {/* ── Bottom name bar ─────────────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2.5 pb-2 pt-8">
        {/* Mic muted indicator */}
        {!micOn && (
          <span className={`shrink-0 rounded-full bg-error/80 p-0.5 backdrop-blur-sm ${isThumbnail ? "" : ""}`} title="Muted">
            <MicOffIcon className={`text-white ${isThumbnail ? "size-2.5" : "size-3"}`} />
          </span>
        )}
        {/* Camera off indicator */}
        {!camOn && (
          <span className={`shrink-0 rounded-full bg-neutral-700/80 p-0.5 backdrop-blur-sm`} title="Camera off">
            <VideoIcon className={`text-neutral-300 ${isThumbnail ? "size-2.5" : "size-3"}`} />
          </span>
        )}
        <span
          className={`min-w-0 flex-1 truncate font-medium text-white drop-shadow-sm ${isThumbnail ? "text-[10px]" : "text-xs"}`}
        >
          {username ?? "Participant"}
          {isLocal && !isThumbnail && (
            <span className="ml-1 text-primary/80">(You)</span>
          )}
        </span>
        {isLocal && isThumbnail && (
          <span className="ml-auto shrink-0 rounded-full bg-primary/80 px-1.5 py-px text-[9px] font-bold text-white">
            You
          </span>
        )}
      </div>

      {/* ── Connection badge (remote, non-thumbnail) ────────────────────────── */}
      {!isLocal && !isThumbnail && <ConnectionBadge state={iceState} />}

      {/* ── Local indicator dot (gallery/stage tiles only) ──────────────────── */}
      {isLocal && !isThumbnail && (
        <div className="absolute left-2.5 top-2.5 h-2 w-2 rounded-full bg-primary shadow-lg shadow-primary/60" />
      )}
    </div>
  );
});
