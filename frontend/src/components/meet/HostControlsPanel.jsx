/**
 * HostControlsPanel
 * ─────────────────
 * Slide-in panel for admin/support-staff meeting moderation.
 * Only rendered when isStaff = true.
 *
 * Current state: UI controls only.
 * Full socket integration (mute all, remove participant, toggle permissions)
 * is marked TODO and requires backend socket events.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  XIcon,
  ShieldIcon,
  MicOffIcon,
  MonitorOffIcon,
  MessageSquareOffIcon,
  UserMinusIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  InfoIcon,
} from "lucide-react";

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ value, onChange, label, description }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 hover:bg-white/4">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-neutral-200">{label}</p>
        {description && (
          <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">{description}</p>
        )}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`mt-0.5 shrink-0 transition-colors ${value ? "text-primary" : "text-neutral-600"}`}
        title={value ? "Disable" : "Enable"}
      >
        {value
          ? <ToggleRightIcon className="size-6" />
          : <ToggleLeftIcon  className="size-6" />
        }
      </button>
    </div>
  );
}

// ── Section ────────────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div>
      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-600">
        {title}
      </p>
      {children}
    </div>
  );
}

// ── HostControlsPanel ─────────────────────────────────────────────────────────

/**
 * @param {{
 *   participants: Array<{ socketId: string, username: string, isHost: boolean, isSelf: boolean }>,
 *   sessionId: string | null,
 *   callDuration: string,
 *   onClose: () => void,
 *   onMuteAll?: () => void,
 *   onRemoveParticipant?: (socketId: string) => void,
 * }} props
 */
export function HostControlsPanel({
  participants,
  sessionId,
  callDuration,
  onClose,
  onMuteAll,
  onRemoveParticipant,
}) {
  // Permission toggles — UI state only (TODO: emit to socket)
  const [allowScreenShare, setAllowScreenShare] = useState(true);
  const [allowChat,        setAllowChat]        = useState(true);
  const [allowMic,         setAllowMic]         = useState(true);
  const [allowCamera,      setAllowCamera]      = useState(true);

  return (
    <motion.aside
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0,      opacity: 1 }}
      exit  ={{ x: "100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 360, damping: 36 }}
      className="flex w-72 shrink-0 flex-col border-l border-white/8 bg-neutral-900 xl:w-80"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
        <ShieldIcon className="size-4 text-primary" />
        <h3 className="flex-1 text-sm font-semibold text-neutral-100">Host Controls</h3>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Call info */}
        <Section title="Call Info">
          <div className="mx-3 mb-2 rounded-xl bg-white/5 px-3 py-2.5 text-xs text-neutral-400 space-y-1">
            <div className="flex justify-between">
              <span>Duration</span>
              <span className="font-mono text-neutral-200">{callDuration}</span>
            </div>
            {sessionId && (
              <div className="flex justify-between">
                <span>Session</span>
                <span className="max-w-[100px] truncate font-mono text-[10px] text-neutral-400">
                  {sessionId}
                </span>
              </div>
            )}
          </div>
        </Section>

        {/* Participants with individual controls */}
        <Section title={`Participants (${participants.length})`}>
          {participants.map((p) => (
            <div
              key={p.socketId}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 hover:bg-white/4"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-700 text-[11px] font-bold text-neutral-300 ring-1 ring-white/10">
                {(p.username ?? "?")[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-neutral-200">
                  {p.username ?? "Participant"}
                  {p.isSelf && <span className="ml-1 text-[10px] text-primary">(You)</span>}
                </p>
                {p.isHost && (
                  <p className="text-[10px] text-amber-400">Host</p>
                )}
              </div>
              {/* Per-participant actions — not self */}
              {!p.isSelf && (
                <div className="flex gap-1">
                  <button
                    title="Mute (TODO)"
                    onClick={() => {/* TODO: socket emit */}}
                    className="flex h-6 w-6 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-white/10 hover:text-error"
                  >
                    <MicOffIcon className="size-3.5" />
                  </button>
                  <button
                    title="Remove (TODO)"
                    onClick={() => onRemoveParticipant?.(p.socketId)}
                    className="flex h-6 w-6 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-error/15 hover:text-error"
                  >
                    <UserMinusIcon className="size-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* Mute all */}
          <button
            onClick={onMuteAll}
            className="mx-3 mt-1 mb-2 flex w-[calc(100%-24px)] items-center justify-center gap-2 rounded-xl border border-white/10 py-2 text-xs font-medium text-neutral-400 transition-colors hover:border-error/30 hover:bg-error/10 hover:text-error"
          >
            <MicOffIcon className="size-3.5" />
            Mute everyone
          </button>
        </Section>

        {/* Meeting moderation */}
        <Section title="Meeting Moderation">
          <div className="space-y-0.5">
            <Toggle
              value={allowScreenShare}
              onChange={setAllowScreenShare}
              label="Share their screen"
            />
            <Toggle
              value={allowChat}
              onChange={setAllowChat}
              label="Send messages"
            />
            <Toggle
              value={allowMic}
              onChange={setAllowMic}
              label="Turn on microphone"
              description="Affects new participants"
            />
            <Toggle
              value={allowCamera}
              onChange={setAllowCamera}
              label="Turn on camera"
              description="Affects new participants"
            />
          </div>
        </Section>

        {/* Note */}
        <div className="mx-3 mb-4 mt-2 flex gap-2 rounded-xl bg-primary/8 px-3 py-2.5">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-primary/70" />
          <p className="text-[10px] leading-relaxed text-neutral-500">
            Mute and permission controls affect the UI only. Full socket-based enforcement coming soon.
          </p>
        </div>
      </div>
    </motion.aside>
  );
}
