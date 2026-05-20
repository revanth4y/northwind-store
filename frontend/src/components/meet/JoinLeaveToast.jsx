/**
 * JoinLeaveToast
 * ──────────────
 * Stacked animated toast notifications for participant join/leave events.
 * Rendered as a fixed overlay above the control bar.
 */

import { AnimatePresence, motion } from "framer-motion";
import { UserCheckIcon, UserMinusIcon } from "lucide-react";

/**
 * @param {{
 *   notifications: Array<{ id: number, type: 'join'|'leave', username: string }>,
 * }} props
 */
export function JoinLeaveToast({ notifications }) {
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence mode="popLayout">
        {notifications.map((n) => (
          <motion.div
            key={n.id}
            initial={{ opacity: 0, y: 16, scale: 0.88 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.92 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className={`flex items-center gap-2.5 rounded-2xl px-4 py-2.5 text-sm font-medium shadow-xl backdrop-blur-md
              ${n.type === "join"
                ? "bg-success/20 text-success ring-1 ring-success/30"
                : "bg-neutral-700/80 text-neutral-300 ring-1 ring-white/10"
              }`}
          >
            {n.type === "join" ? (
              <UserCheckIcon className="size-4 shrink-0" />
            ) : (
              <UserMinusIcon className="size-4 shrink-0" />
            )}
            <span>
              <strong>{n.username}</strong>{" "}
              {n.type === "join" ? "joined the meeting" : "left the meeting"}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
