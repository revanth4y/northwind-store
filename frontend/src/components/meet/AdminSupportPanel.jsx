/**
 * AdminSupportPanel
 * ─────────────────
 * Full-page support queue dashboard for admin/support staff.
 *
 * Shows:
 *  • Live queue of waiting customers (with accept / decline per entry)
 *  • Incoming call toast notifications
 *  • Active call info banner when in a 1:1 session
 *  • Connection status indicator
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router";
import {
  HeadphonesIcon,
  PhoneCallIcon,
  PhoneOffIcon,
  UserCheckIcon,
  UserXIcon,
  UsersIcon,
  WifiIcon,
  ClockIcon,
  MailIcon,
  BellRingIcon,
  CheckCircleIcon,
  LayoutListIcon,
  HistoryIcon,
  HomeIcon,
} from "lucide-react";
import { SupportHistory } from "./SupportHistory.jsx";

// ── Helpers ───────────────────────────────────────────────────────────────────

function useElapsed(since) {
  const [elapsed, setElapsed] = useState(since ? Math.floor((Date.now() - since) / 1000) : 0);
  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - since) / 1000)), 1000);
    return () => clearInterval(id);
  }, [since]);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function CallerAvatar({ name, avatar, size = "md" }) {
  const sizeClass = size === "lg" ? "h-14 w-14 text-xl" : "h-10 w-10 text-sm";
  const initial = (name ?? "?")[0]?.toUpperCase() ?? "?";

  if (avatar) {
    return (
      <img
        src={avatar}
        alt={name}
        className={`${sizeClass} shrink-0 rounded-full object-cover ring-1 ring-white/15`}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-primary/25 font-bold text-primary ring-1 ring-primary/30`}
    >
      {initial}
    </div>
  );
}

function QueueTimer({ since }) {
  const elapsed = useElapsed(since);
  return <span className="font-mono">{elapsed}</span>;
}

// ── Incoming call toast ───────────────────────────────────────────────────────

function IncomingCallToast({ notification, onAccept, onDismiss }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 64, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 64, scale: 0.88 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="pointer-events-auto w-80 overflow-hidden rounded-2xl border border-primary/30 bg-neutral-900 shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center gap-2 bg-primary/15 px-4 py-2.5">
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
        >
          <BellRingIcon className="size-4 text-primary" />
        </motion.div>
        <span className="text-sm font-semibold text-primary">Incoming Support Request</span>
      </div>

      {/* Caller info */}
      <div className="flex items-center gap-3 px-4 py-3">
        <CallerAvatar name={notification.callerName} avatar={notification.callerAvatar} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{notification.callerName}</p>
          <p className="truncate text-xs text-neutral-400">{notification.callerEmail || "No email"}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] text-neutral-500">Waiting</p>
          <p className="font-mono text-xs font-medium text-neutral-300">
            <QueueTimer since={notification.queuedAt} />
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 border-t border-white/8 px-4 py-3">
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={() => onAccept(notification.sessionId)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-success py-2 text-sm font-semibold text-success-content shadow transition-opacity hover:opacity-90"
        >
          <PhoneCallIcon className="size-4" />
          Accept
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={() => onDismiss(notification.sessionId)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 py-2 text-sm font-medium text-neutral-400 transition-colors hover:bg-white/10"
        >
          <UserXIcon className="size-4" />
          Dismiss
        </motion.button>
      </div>
    </motion.div>
  );
}

// ── Queue entry row ───────────────────────────────────────────────────────────

function QueueRow({ entry, position, onAccept, onReject, disabled }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-4 rounded-2xl border border-white/8 bg-neutral-900 px-4 py-3.5 shadow-sm"
    >
      {/* Position badge */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 font-mono text-sm font-bold text-neutral-300">
        {position}
      </div>

      {/* Avatar */}
      <CallerAvatar name={entry.callerName} avatar={entry.callerAvatar} />

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white">{entry.callerName}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-400">
          <MailIcon className="size-3 shrink-0" />
          <span className="truncate">{entry.callerEmail || "No email"}</span>
        </div>
      </div>

      {/* Wait time */}
      <div className="shrink-0 text-right">
        <div className="flex items-center gap-1 text-xs text-neutral-500">
          <ClockIcon className="size-3" />
          <QueueTimer since={entry.queuedAt} />
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 gap-2">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => onAccept(entry.sessionId)}
          disabled={disabled}
          title="Accept call"
          className="flex items-center gap-1.5 rounded-xl bg-success/15 px-3 py-1.5 text-xs font-semibold text-success transition-colors hover:bg-success hover:text-success-content disabled:opacity-40"
        >
          <UserCheckIcon className="size-3.5" />
          Accept
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => onReject(entry.sessionId)}
          disabled={disabled}
          title="Reject call"
          className="flex items-center gap-1.5 rounded-xl bg-error/10 px-3 py-1.5 text-xs font-semibold text-error transition-colors hover:bg-error hover:text-white disabled:opacity-40"
        >
          <UserXIcon className="size-3.5" />
          Decline
        </motion.button>
      </div>
    </motion.div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   phase: 'idle'|'accepting'|'in-call'|'ended',
 *   queue: import("../../../backend/src/lib/supportSocketManager").QueueEntry[],
 *   activeCall: object | null,
 *   socketConnected: boolean,
 *   incomingNotifications: Array<object>,
 *   onAccept: (sessionId: string) => void,
 *   onReject: (sessionId: string) => void,
 *   onEndCall: () => void,
 *   children?: React.ReactNode,   // active call video view injected from parent
 * }} props
 */
export function AdminSupportPanel({
  phase,
  queue,
  activeCall,
  socketConnected,
  incomingNotifications,
  onAccept,
  onReject,
  onEndCall,
  children,
}) {
  const inCall = phase === "in-call" || phase === "accepting";

  // Tab state — force back to queue when a call starts
  const [activeTab, setActiveTab] = useState("queue");
  useEffect(() => { if (inCall) setActiveTab("queue"); }, [inCall]);

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-white">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/8 bg-neutral-900/90 px-5 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-neutral-400 transition-colors hover:bg-white/8 hover:text-white"
            title="Back to store"
          >
            <HomeIcon className="size-3.5" />
            <span className="hidden sm:inline">Home</span>
          </Link>
          <HeadphonesIcon className="size-5 text-primary" />
          <span className="text-base font-bold text-white">Support Dashboard</span>
          {inCall && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-success" />
              {phase === "accepting" ? "Connecting…" : "In Call"}
            </motion.div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Active call end button */}
          {inCall && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              whileTap={{ scale: 0.94 }}
              onClick={onEndCall}
              className="flex items-center gap-2 rounded-xl bg-error/15 px-3 py-1.5 text-sm font-semibold text-error transition-colors hover:bg-error hover:text-white"
            >
              <PhoneOffIcon className="size-4" />
              End Call
            </motion.button>
          )}

          {/* Queue count */}
          <div className="flex items-center gap-1.5 rounded-full bg-white/8 px-2.5 py-1 text-xs font-medium text-neutral-300">
            <UsersIcon className="size-3.5" />
            {queue.length} waiting
          </div>

          {/* Connection status */}
          <div
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium
              ${socketConnected ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
          >
            <span
              className={`size-1.5 rounded-full ${socketConnected ? "animate-pulse bg-success" : "bg-warning"}`}
            />
            {socketConnected ? "Online" : "Reconnecting…"}
          </div>
        </div>
      </header>

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-1 border-b border-white/8 bg-neutral-900/60 px-4 py-1.5">
        <button
          onClick={() => setActiveTab("queue")}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors
            ${activeTab === "queue"
              ? "bg-white/10 text-white"
              : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"}`}
        >
          <LayoutListIcon className="size-4" />
          Queue
          {queue.length > 0 && (
            <span className="rounded-full bg-primary/25 px-1.5 py-0.5 text-[10px] font-semibold text-primary leading-none">
              {queue.length}
            </span>
          )}
        </button>
        <button
          onClick={() => !inCall && setActiveTab("history")}
          disabled={inCall}
          title={inCall ? "End the active call to view history" : undefined}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40
            ${activeTab === "history"
              ? "bg-white/10 text-white"
              : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"}`}
        >
          <HistoryIcon className="size-4" />
          History
        </button>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 gap-0 overflow-hidden">

        {/* ── Queue tab ────────────────────────────────────────────────── */}
        {activeTab === "queue" && (
          <>
            {/* Active call view (left/main) */}
            {inCall && (
              <div className="flex min-h-0 flex-1 flex-col">
                {phase === "accepting" && (
                  <div className="flex flex-1 items-center justify-center">
                    <div className="text-center">
                      <span className="loading loading-spinner loading-lg text-primary" />
                      <p className="mt-4 text-sm text-neutral-400">Connecting to customer…</p>
                    </div>
                  </div>
                )}
                {phase === "in-call" && children}
              </div>
            )}

            {/* Queue sidebar (or full page when idle) */}
            <div
              className={`flex shrink-0 flex-col overflow-y-auto border-l border-white/8 bg-neutral-900/50
                ${inCall ? "w-96" : "flex-1"}`}
            >
              {/* Active call info banner */}
              {inCall && activeCall && (
                <div className="border-b border-white/8 bg-primary/10 px-4 py-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary/70">
                    Active Call
                  </p>
                  <div className="flex items-center gap-3">
                    <CallerAvatar
                      name={activeCall.customerName}
                      avatar={activeCall.customerAvatar}
                      size="lg"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-white">{activeCall.customerName}</p>
                      <p className="truncate text-xs text-neutral-400">{activeCall.customerEmail}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Queue header */}
              <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                <h2 className="text-sm font-semibold text-neutral-200">
                  Support Queue
                  {queue.length > 0 && (
                    <span className="ml-2 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-normal text-primary">
                      {queue.length}
                    </span>
                  )}
                </h2>
              </div>

              {/* Queue list */}
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                <AnimatePresence mode="popLayout">
                  {queue.length === 0 ? (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center justify-center py-16 text-center"
                    >
                      <CheckCircleIcon className="mb-3 size-10 text-neutral-700" />
                      <p className="text-sm font-medium text-neutral-500">Queue is empty</p>
                      <p className="mt-1 text-xs text-neutral-600">
                        New customer requests will appear here in real time.
                      </p>
                    </motion.div>
                  ) : (
                    queue.map((entry, i) => (
                      <QueueRow
                        key={entry.sessionId}
                        entry={entry}
                        position={i + 1}
                        onAccept={onAccept}
                        onReject={onReject}
                        disabled={inCall}
                      />
                    ))
                  )}
                </AnimatePresence>
              </div>
            </div>
          </>
        )}

        {/* ── History tab ──────────────────────────────────────────────── */}
        {activeTab === "history" && (
          <div className="flex-1 overflow-y-auto">
            <SupportHistory />
          </div>
        )}
      </div>

      {/* ── Incoming call toast stack (top-right overlay) ─────────────────── */}
      <div className="pointer-events-none fixed right-4 top-16 z-50 flex flex-col items-end gap-3">
        <AnimatePresence mode="popLayout">
          {incomingNotifications.map((n) => (
            <IncomingCallToast
              key={n.id}
              notification={n}
              onAccept={onAccept}
              onDismiss={onReject}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
