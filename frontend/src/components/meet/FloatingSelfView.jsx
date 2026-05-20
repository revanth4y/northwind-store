/**
 * FloatingSelfView
 * ────────────────
 * Draggable, snap-to-corner floating self-video tile.
 * Shown during presentation mode so the presenter can see themselves
 * while the screen-share occupies the main stage.
 *
 * Behavior:
 *  • Drag freely within the meeting container
 *  • On drag-end: snaps to the nearest corner of the container
 *  • Corner preference persisted in localStorage
 *  • Minimize toggles between full PiP and a small avatar chip
 *  • Camera-off shows gradient background with initials
 *
 * Implementation notes:
 *  • Uses Framer Motion `useMotionValue` + `animate` for smooth snapping
 *  • `dragConstraints` keep the tile inside its container
 *  • Position is stored as pixel offsets from top-left of container
 *  • useEffect initializes position from localStorage corner preference
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue } from "framer-motion";
import { ChevronDownIcon, ChevronUpIcon, VideoOffIcon } from "lucide-react";

const TILE_W = 160;   // px
const TILE_H = 90;    // px — 16:9
const MARGIN = 14;    // px from container edge
const BAR_H  = 72;    // rough control-bar height to stay above

const SPRING = { type: "spring", stiffness: 400, damping: 38 };

const CORNER_KEYS = { TL: 0, TR: 1, BR: 2, BL: 3 };
const LS_KEY = "meet-self-corner";

function getCorner(saved) {
  return Object.keys(CORNER_KEYS).includes(saved) ? saved : "BR";
}

function cornerToPos(corner, cW, cH) {
  const maxX = cW - TILE_W - MARGIN;
  const maxY = cH - TILE_H - MARGIN - BAR_H;
  return {
    TL: { x: MARGIN,       y: MARGIN       },
    TR: { x: maxX,         y: MARGIN       },
    BL: { x: MARGIN,       y: maxY         },
    BR: { x: maxX,         y: maxY         },
  }[corner] ?? { x: maxX, y: maxY };
}

function nearestCorner(px, py, cW, cH) {
  const midX = cW / 2;
  const midY = cH / 2;
  return `${py < midY ? "T" : "B"}${px < midX ? "L" : "R"}`;
}

/**
 * @param {{
 *   stream: MediaStream | null,
 *   username: string,
 *   camOn: boolean,
 *   containerRef: React.RefObject<HTMLElement>,
 * }} props
 */
export function FloatingSelfView({ stream, username, camOn, containerRef }) {
  const videoRef  = useRef(null);
  const tileRef   = useRef(null);
  const [minimized, setMinimized] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Initials for camera-off fallback
  const initials = (username ?? "?")
    .split(" ").filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();

  // Assign stream to <video>
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream ?? null;
  }, [stream]);

  // Initialize position from saved corner preference
  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;

    const saved  = getCorner(localStorage.getItem(LS_KEY));
    const { x: px, y: py } = cornerToPos(saved, container.offsetWidth, container.offsetHeight);
    x.set(px);
    y.set(py);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-snap when minimized state changes
  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;
    const saved = getCorner(localStorage.getItem(LS_KEY));
    const { x: px, y: py } = cornerToPos(saved, container.offsetWidth, container.offsetHeight);
    animate(x, px, SPRING);
    animate(y, py, SPRING);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minimized]);

  const handleDragEnd = useCallback(() => {
    const container = containerRef?.current;
    const tile      = tileRef.current;
    if (!container || !tile) return;

    const cW = container.offsetWidth;
    const cH = container.offsetHeight;
    const corner = nearestCorner(x.get(), y.get(), cW, cH);
    const { x: snapX, y: snapY } = cornerToPos(corner, cW, cH);

    animate(x, snapX, SPRING);
    animate(y, snapY, SPRING);

    localStorage.setItem(LS_KEY, corner);
  }, [containerRef, x, y]);

  const tileH = minimized ? 36 : TILE_H;

  return (
    <motion.div
      ref={tileRef}
      drag
      dragMomentum={false}
      dragElastic={0.05}
      dragConstraints={containerRef}
      onDragEnd={handleDragEnd}
      style={{ x, y, width: TILE_W }}
      animate={{ height: tileH }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="absolute top-0 left-0 z-40 cursor-grab overflow-hidden rounded-xl shadow-2xl shadow-black/60 ring-1 ring-white/15 active:cursor-grabbing"
    >
      {/* Video */}
      {!minimized && (
        <div className="relative h-full w-full bg-neutral-800">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-cover transition-opacity duration-200 ${camOn && stream ? "opacity-100" : "opacity-0"}`}
          />

          {/* Camera-off fallback */}
          {(!camOn || !stream) && (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/20 to-neutral-900">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/30 text-sm font-bold text-primary ring-1 ring-primary/40">
                {initials || <VideoOffIcon className="size-4" />}
              </div>
            </div>
          )}

          {/* Name tag */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4">
            <span className="text-[10px] font-medium text-white drop-shadow">{username ?? "You"}</span>
          </div>

          {/* "You" dot */}
          <div className="absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary shadow shadow-primary/60" />
        </div>
      )}

      {/* Minimized chip */}
      {minimized && (
        <div className="flex h-full w-full items-center gap-2 bg-neutral-800/90 px-2.5 backdrop-blur-sm">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/30 text-[9px] font-bold text-primary">
            {initials}
          </div>
          <span className="flex-1 truncate text-[10px] font-medium text-white">{username ?? "You"}</span>
        </div>
      )}

      {/* Minimize / restore button */}
      <button
        onClick={(e) => { e.stopPropagation(); setMinimized(v => !v); }}
        className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/80"
        title={minimized ? "Expand self view" : "Minimize self view"}
      >
        {minimized
          ? <ChevronUpIcon className="size-3" />
          : <ChevronDownIcon className="size-3" />
        }
      </button>
    </motion.div>
  );
}
