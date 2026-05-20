/**
 * WaitingRoom
 * ───────────
 * Shown to the customer after they've requested support and are in the queue.
 * Displays wait status, queue position, and a cancel button.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router";
import { HeadphonesIcon, XCircleIcon, UsersIcon, WifiIcon, ArrowLeftIcon } from "lucide-react";

function ElapsedTimer({ since }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - since) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [since]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return <span>{mm}:{ss}</span>;
}

/**
 * @param {{
 *   queuePosition: number | null,
 *   adminCount: number,
 *   queuedAt: number | null,
 *   socketConnected: boolean,
 *   onCancel: () => void,
 * }} props
 */
export function WaitingRoom({ queuePosition, adminCount, queuedAt, socketConnected, onCancel }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 px-4 py-10 text-white">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.38, ease: "easeOut" }}
        className="w-full max-w-sm"
      >
        {/* Animated headphone icon */}
        <div className="mb-8 flex justify-center">
          <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/30">
            <HeadphonesIcon className="size-10 text-primary" />
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-primary/30"
              animate={{ scale: [1, 1.4, 1.4], opacity: [0.6, 0, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
            />
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-primary/20"
              animate={{ scale: [1, 1.7, 1.7], opacity: [0.4, 0, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 0.5 }}
            />
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-neutral-900 p-8 text-center shadow-2xl">
          <h2 className="mb-1 text-xl font-bold text-white">Waiting for an Agent</h2>
          <p className="mb-6 text-sm text-neutral-400">
            A support agent will join your call shortly.
            <br />
            Please keep this window open.
          </p>

          {/* Stats */}
          <div className="mb-6 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/5 px-3 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                Queue position
              </p>
              <p className="mt-0.5 text-2xl font-bold text-primary">
                {queuePosition ?? "—"}
              </p>
            </div>
            <div className="rounded-xl bg-white/5 px-3 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                Wait time
              </p>
              <p className="mt-0.5 font-mono text-2xl font-bold text-neutral-200">
                {queuedAt ? <ElapsedTimer since={queuedAt} /> : "—"}
              </p>
            </div>
          </div>

          {/* Agent availability pill */}
          <div
            className={`mb-6 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium
              ${adminCount > 0
                ? "bg-success/10 text-success"
                : "bg-warning/10 text-warning"
              }`}
          >
            <UsersIcon className="size-4 shrink-0" />
            {adminCount > 0
              ? `${adminCount} agent${adminCount !== 1 ? "s" : ""} online`
              : "No agents online yet — you'll be helped when one connects"}
          </div>

          {/* Connection status */}
          <div
            className={`mb-5 flex items-center justify-center gap-1.5 text-xs
              ${socketConnected ? "text-neutral-500" : "text-warning"}`}
          >
            <WifiIcon className="size-3.5" />
            {socketConnected ? "Connected to support server" : "Reconnecting…"}
          </div>

          {/* Dots */}
          <div className="mb-6 flex justify-center">
            <span className="loading loading-dots loading-md text-primary" />
          </div>

          {/* Cancel */}
          <button
            onClick={onCancel}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-neutral-400 transition-colors hover:border-error/40 hover:bg-error/10 hover:text-error"
          >
            <XCircleIcon className="size-4" />
            Cancel Request
          </button>

          <Link
            to="/"
            onClick={onCancel}
            className="mt-2 flex w-full items-center justify-center gap-1.5 text-xs text-neutral-600 transition-colors hover:text-neutral-400"
          >
            <ArrowLeftIcon className="size-3" />
            Back to store
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
