/**
 * ControlBar
 * ──────────
 * Google Meet–style floating control bar.
 *
 * Visual:
 *   Centered glassmorphism pill with backdrop-blur, dark background,
 *   shadow, and a gradient fade above it into the video area.
 *
 * Layout (desktop):
 *   [Mic] [Cam]  ·  [Screen]  ·  [People] [Chat] [Host?]  ·  [⛶ Full] [Leave]
 *
 * Layout (mobile):
 *   Same but labels hidden, buttons slightly smaller.
 *
 * Keyboard shortcuts shown in button tooltips:
 *   Mic     → M
 *   Camera  → V
 *   Screen  → S
 *   Leave   → End call button
 *
 * Reactions:
 *   Clicking the React button opens an emoji picker above the bar.
 *   Selecting an emoji fires onReact(emoji) and closes the picker.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
  MonitorIcon,
  MonitorOffIcon,
  MessageSquareIcon,
  UsersIcon,
  PhoneOffIcon,
  MaximizeIcon,
  Minimize2Icon,
  ShieldIcon,
  SmileIcon,
} from "lucide-react";

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "👏", "🎉"];

// ── Single control button ─────────────────────────────────────────────────────

function CtrlBtn({ onClick, active, muted, disabled, label, shortcut, badge, children }) {
  return (
    <motion.button
      whileHover={disabled ? {} : { scale: 1.07 }}
      whileTap={disabled ? {} : { scale: 0.92 }}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`
        group relative flex flex-col items-center gap-1 rounded-xl
        px-2.5 py-2 text-[11px] font-medium
        transition-colors duration-150
        disabled:pointer-events-none disabled:opacity-30
        sm:px-3.5 sm:py-2.5
        ${muted
          ? "bg-error/15 text-error hover:bg-error/25"
          : active
            ? "bg-white/15 text-white hover:bg-white/20"
            : "bg-transparent text-neutral-400 hover:bg-white/10 hover:text-neutral-200"
        }
      `}
    >
      <span className="relative">
        {children}
        {badge > 0 && (
          <motion.span
            key={badge}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold text-white"
          >
            {badge > 9 ? "9+" : badge}
          </motion.span>
        )}
      </span>
      <span className="hidden leading-none sm:block">{label}</span>
    </motion.button>
  );
}

function Sep() {
  return <div className="mx-0.5 h-8 w-px shrink-0 bg-white/12 sm:mx-1" />;
}

// ── ControlBar ────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   micOn: boolean,
 *   camOn: boolean,
 *   screenOn: boolean,
 *   chatOpen: boolean,
 *   participantsOpen: boolean,
 *   hostControlsOpen?: boolean,
 *   participantCount: number,
 *   unread: number,
 *   isHost?: boolean,
 *   fullscreen?: boolean,
 *   onMic: () => void,
 *   onCam: () => void,
 *   onScreen: () => void,
 *   onChat: () => void,
 *   onParticipants: () => void,
 *   onHostControls?: () => void,
 *   onFullscreen?: () => void,
 *   onReact?: (emoji: string) => void,
 *   onLeave: () => void,
 * }} props
 */
export function ControlBar({
  micOn, camOn, screenOn,
  chatOpen, participantsOpen, hostControlsOpen = false,
  participantCount, unread,
  isHost = false,
  fullscreen = false,
  onMic, onCam, onScreen,
  onChat, onParticipants, onHostControls,
  onFullscreen,
  onReact,
  onLeave,
}) {
  const [showReactions, setShowReactions] = useState(false);
  const reactionsRef = useRef(null);

  // Close reactions picker when clicking outside it
  useEffect(() => {
    if (!showReactions) return;
    function handler(e) {
      if (!reactionsRef.current?.contains(e.target)) setShowReactions(false);
    }
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [showReactions]);

  return (
    <div className="relative z-30 flex shrink-0 justify-center px-3 py-3 sm:px-4 sm:py-4">
      {/* Soft gradient fade merging video into the control bar */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-12 h-12 bg-gradient-to-t from-neutral-950/90 to-transparent"
      />

      {/* Emoji reactions picker — floats above the pill */}
      <AnimatePresence>
        {showReactions && (
          <motion.div
            ref={reactionsRef}
            key="reactions-picker"
            initial={{ opacity: 0, y: 8, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.92 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full z-50 mb-2 flex items-center gap-1 rounded-2xl bg-neutral-800/95 px-2 py-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
          >
            {REACTION_EMOJIS.map((emoji) => (
              <motion.button
                key={emoji}
                whileHover={{ scale: 1.3, y: -3 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => {
                  onReact?.(emoji);
                  setShowReactions(false);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-xl transition-colors hover:bg-white/10"
                title={emoji}
              >
                {emoji}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The pill */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.3, ease: "easeOut" }}
        className="
          inline-flex items-center gap-0.5
          rounded-2xl
          bg-neutral-800/92 px-2 py-1.5
          shadow-2xl shadow-black/60
          ring-1 ring-white/8
          backdrop-blur-xl
          sm:gap-1 sm:px-3 sm:py-2
        "
      >
        {/* ── Left: Mic + Camera ── */}
        <CtrlBtn
          onClick={onMic}
          active={micOn}
          muted={!micOn}
          label={micOn ? "Mute" : "Unmute"}
          shortcut="M"
        >
          {micOn ? <MicIcon className="size-5" /> : <MicOffIcon className="size-5" />}
        </CtrlBtn>

        <CtrlBtn
          onClick={onCam}
          active={camOn}
          muted={!camOn}
          label={camOn ? "Stop video" : "Start video"}
          shortcut="V"
        >
          {camOn ? <VideoIcon className="size-5" /> : <VideoOffIcon className="size-5" />}
        </CtrlBtn>

        <Sep />

        {/* ── Screen share ── */}
        <CtrlBtn
          onClick={onScreen}
          active={screenOn}
          label={screenOn ? "Stop sharing" : "Share screen"}
          shortcut="S"
        >
          {screenOn
            ? <MonitorOffIcon className="size-5 text-primary" />
            : <MonitorIcon className="size-5" />}
        </CtrlBtn>

        {/* ── Reactions ── */}
        <CtrlBtn
          onClick={() => setShowReactions(v => !v)}
          active={showReactions}
          label="React"
        >
          <SmileIcon className="size-5" />
        </CtrlBtn>

        <Sep />

        {/* ── People ── */}
        <CtrlBtn onClick={onParticipants} active={participantsOpen} label="People">
          <span className="relative">
            <UsersIcon className="size-5" />
            {participantCount > 0 && (
              <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-white/20 px-0.5 text-[9px] font-bold text-white">
                {participantCount > 9 ? "9+" : participantCount}
              </span>
            )}
          </span>
        </CtrlBtn>

        {/* ── Chat ── */}
        <CtrlBtn
          onClick={onChat}
          active={chatOpen}
          badge={chatOpen ? 0 : unread}
          label="Chat"
        >
          <MessageSquareIcon className="size-5" />
        </CtrlBtn>

        {/* ── Host controls (admin only) ── */}
        {isHost && (
          <CtrlBtn
            onClick={onHostControls}
            active={hostControlsOpen}
            label="Host"
          >
            <ShieldIcon className="size-5" />
          </CtrlBtn>
        )}

        <Sep />

        {/* ── Fullscreen ── */}
        {onFullscreen && (
          <CtrlBtn onClick={onFullscreen} active={fullscreen} label={fullscreen ? "Exit full" : "Full screen"}>
            {fullscreen
              ? <Minimize2Icon className="size-5" />
              : <MaximizeIcon className="size-5" />}
          </CtrlBtn>
        )}

        {/* ── Leave — red pill ── */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.93 }}
          onClick={onLeave}
          aria-label="Leave call"
          title="Leave call"
          className="
            flex items-center gap-2 rounded-xl
            bg-error px-3 py-2 text-[11px]
            font-semibold text-white shadow-lg shadow-error/30
            transition-colors hover:bg-error/85
            sm:px-4 sm:py-2.5
          "
        >
          <PhoneOffIcon className="size-4" />
          <span className="hidden sm:inline">Leave</span>
        </motion.button>
      </motion.div>
    </div>
  );
}
