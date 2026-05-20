/**
 * TileContextMenu
 * ───────────────
 * Animated dropdown triggered by the ⋮ button on a participant tile.
 * Appears on hover; dismisses on outside click or Escape.
 *
 * Actions:
 *   Pin / Unpin          — focus participant into main stage
 *   Fullscreen           — expand this tile to fullscreen
 *   Spotlight            — alias for pin (admin language)
 *   Mute / Remove        — admin-only (TODO: socket events)
 */

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  PinIcon,
  PinOffIcon,
  MaximizeIcon,
  SparklesIcon,
  MicOffIcon,
  UserMinusIcon,
} from "lucide-react";

const MENU_VARIANTS = {
  hidden : { opacity: 0, scale: 0.9, y: -4 },
  visible: { opacity: 1, scale: 1,   y: 0  },
  exit   : { opacity: 0, scale: 0.9, y: -4 },
};

/**
 * @param {{
 *   open: boolean,
 *   isPinned: boolean,
 *   isLocal: boolean,
 *   isAdmin?: boolean,
 *   onClose: () => void,
 *   onPin: () => void,
 *   onFullscreen?: () => void,
 *   onMute?: () => void,
 *   onRemove?: () => void,
 * }} props
 */
export function TileContextMenu({
  open,
  isPinned,
  isLocal,
  isAdmin = false,
  onClose,
  onPin,
  onFullscreen,
  onMute,
  onRemove,
}) {
  const menuRef = useRef(null);

  // Dismiss on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (!menuRef.current?.contains(e.target)) onClose();
    }
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  function Item({ Icon, label, onClick, danger = false, disabled = false }) {
    return (
      <motion.button
        whileHover={{ backgroundColor: danger ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.08)" }}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
          onClose();
        }}
        disabled={disabled}
        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors disabled:opacity-40
          ${danger ? "text-error" : "text-neutral-200"}`}
      >
        <Icon className="size-3.5 shrink-0" />
        {label}
      </motion.button>
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={menuRef}
          key="context-menu"
          variants={MENU_VARIANTS}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={{ duration: 0.14, ease: "easeOut" }}
          className="absolute right-2 top-9 z-50 min-w-[152px] overflow-hidden rounded-xl border border-white/10 bg-neutral-800/95 py-1 shadow-2xl shadow-black/50 backdrop-blur-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Pin / Unpin — not for local */}
          {!isLocal && (
            <Item
              Icon={isPinned ? PinOffIcon : PinIcon}
              label={isPinned ? "Unpin" : "Pin"}
              onClick={onPin}
            />
          )}

          {/* Spotlight (same as pin for now) */}
          {!isLocal && !isPinned && (
            <Item
              Icon={SparklesIcon}
              label="Spotlight"
              onClick={onPin}
            />
          )}

          {/* Fullscreen */}
          {onFullscreen && (
            <Item
              Icon={MaximizeIcon}
              label="Full screen"
              onClick={onFullscreen}
            />
          )}

          {/* Admin-only actions */}
          {isAdmin && !isLocal && (
            <>
              <div className="my-1 border-t border-white/8" />
              <Item
                Icon={MicOffIcon}
                label="Mute"
                onClick={onMute}
                disabled={!onMute}
              />
              <Item
                Icon={UserMinusIcon}
                label="Remove"
                onClick={onRemove}
                danger
                disabled={!onRemove}
              />
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
