/**
 * TileFullscreenOverlay
 * ─────────────────────
 * Portal-based full-screen tile viewer.
 *
 * Renders the selected participant's video in a near-fullscreen modal
 * over the rest of the UI. Dismisses on Escape or clicking outside the tile.
 *
 * Uses ReactDOM.createPortal → document.body so the overlay is never
 * clipped by any parent overflow:hidden or z-index stacking context.
 */

import { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { XIcon } from "lucide-react";
import { ParticipantTile } from "./ParticipantTile";

/**
 * @param {{
 *   participant: {
 *     id: string,
 *     stream: MediaStream | null,
 *     username: string,
 *     isLocal?: boolean,
 *     isHost?: boolean,
 *     camOn?: boolean,
 *     iceState?: string,
 *     isScreenShare?: boolean,
 *   } | null,
 *   onClose: () => void,
 * }} props
 */
export function TileFullscreenOverlay({ participant, onClose }) {
  // Dismiss on Escape
  useEffect(() => {
    if (!participant) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [participant, onClose]);

  return createPortal(
    <AnimatePresence>
      {participant && (
        <motion.div
          key="tile-fullscreen-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/92 backdrop-blur-sm"
          onClick={onClose}
        >
          {/* Tile container — 16:9 capped at 90 vw / 85 vh */}
          <motion.div
            key="tile-fullscreen-content"
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1,    opacity: 1 }}
            exit={{ scale: 0.94,    opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative aspect-video w-[90vw] max-h-[85vh] overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10"
            style={{ maxWidth: "calc(85vh * 16/9)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <ParticipantTile
              stream={participant.stream}
              username={participant.username}
              isLocal={participant.isLocal}
              isHost={participant.isHost}
              camOn={participant.camOn}
              iceState={participant.iceState}
              isFocused
              isScreenShare={participant.isScreenShare}
            />

            {/* Close button */}
            <button
              onClick={onClose}
              aria-label="Close fullscreen"
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md transition-colors hover:bg-black/80"
            >
              <XIcon className="size-4" />
            </button>

            {/* Username banner at top */}
            <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {participant.username ?? "Participant"}
              {participant.isLocal && <span className="text-primary/80">(You)</span>}
            </div>
          </motion.div>

          {/* Dismiss hint */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="absolute bottom-6 text-[11px] text-neutral-500"
          >
            Press Esc or click outside to close
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
