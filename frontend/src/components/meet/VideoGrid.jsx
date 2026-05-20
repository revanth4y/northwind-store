/**
 * VideoGrid — Google Meet–style adaptive layout engine
 * ─────────────────────────────────────────────────────
 *
 * Gallery mode:   ResizeObserver tracks the container. computeOptimalLayout()
 *                 picks the column count that maximises tile area while keeping
 *                 every tile at exactly 16:9 and every tile on screen.
 *                 Tiles are centred; surplus space is black background — exactly
 *                 like Google Meet.
 *
 * Presentation:   One dominant stage (flex-1) + compact 180 px right rail.
 *                 Active when screenOn=true (screen share) or a tile is pinned.
 *
 * Pin / unpin
 *   Click any gallery tile → pins it → switches to presentation.
 *   Click stage tile or the "Unpin" chip → back to gallery.
 *   Screen-share forces stage to local; pin is silently preserved for after.
 *
 * All layout changes animate with Framer Motion (FLIP + crossfade).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MonitorIcon, PinOffIcon } from "lucide-react";
import { ParticipantTile } from "./ParticipantTile";

// ── Constants ─────────────────────────────────────────────────────────────────

const ASPECT = 16 / 9;
const GAP    = 10;   // px gap between tiles

const SPRING = { type: "spring", stiffness: 260, damping: 28, mass: 0.8 };
const FADE   = { duration: 0.22, ease: [0.4, 0, 0.2, 1] };

// ── Layout calculator ─────────────────────────────────────────────────────────
/**
 * Given N tiles in a container of W × H pixels, find the column count that
 * maximises tile area while every tile fits on screen at exactly 16:9.
 *
 * Returns { cols, tileW, tileH } (pixel dimensions, already floored).
 */
function computeOptimalLayout(count, W, H) {
  if (!W || !H || count === 0) {
    const w = W || 640;
    return { cols: 1, tileW: w, tileH: Math.round(w / ASPECT) };
  }

  let bestCols = 1, bestArea = 0, bestW = 0, bestH = 0;

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);

    // Width-constrained: fill horizontally, check it fits vertically
    const wByW = (W - GAP * (cols - 1)) / cols;
    const hByW = wByW / ASPECT;
    if (wByW > 0 && hByW > 0 && hByW * rows + GAP * (rows - 1) <= H) {
      const area = wByW * hByW;
      if (area > bestArea) {
        bestArea = area; bestCols = cols;
        bestW = Math.floor(wByW); bestH = Math.floor(hByW);
      }
    }

    // Height-constrained: fill vertically, check it fits horizontally
    const hByH = (H - GAP * (rows - 1)) / rows;
    const wByH = hByH * ASPECT;
    if (wByH > 0 && hByH > 0 && wByH * cols + GAP * (cols - 1) <= W) {
      const area = wByH * hByH;
      if (area > bestArea) {
        bestArea = area; bestCols = cols;
        bestW = Math.floor(wByH); bestH = Math.floor(hByH);
      }
    }
  }

  // Fallback: spread everything into one row
  if (bestArea === 0) {
    const w = Math.max(1, Math.floor((W - GAP * (count - 1)) / count));
    return { cols: count, tileW: w, tileH: Math.floor(w / ASPECT) };
  }

  return { cols: bestCols, tileW: bestW, tileH: bestH };
}

// ── VideoGrid ─────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   participants: Array<{
 *     id: string,
 *     stream: MediaStream | null,
 *     username: string,
 *     isLocal?: boolean,
 *     isHost?: boolean,
 *     camOn?: boolean,
 *     micOn?: boolean,
 *     iceState?: string,
 *     isScreenShare?: boolean,
 *   }>,
 *   screenOn?: boolean,
 *   isAdmin?: boolean,
 *   onTileFullscreen?: (id: string) => void,
 * }} props
 */
export function VideoGrid({ participants, screenOn = false, isAdmin = false, onTileFullscreen }) {
  const [pinnedId, setPinnedId] = useState(null);
  const [size, setSize]         = useState({ w: 0, h: 0 });
  const containerRef            = useRef(null);

  // ── Container size tracking ───────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Seed immediately so we don't wait for the first ResizeObserver callback
    setSize({ w: Math.floor(el.offsetWidth), h: Math.floor(el.offsetHeight) });

    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────
  const localId  = useMemo(() => participants.find(p => p.isLocal)?.id ?? "local",   [participants]);
  const remoteP  = useMemo(() => participants.find(p => !p.isLocal),                  [participants]);
  const remoteIsSharing = remoteP?.isScreenShare ?? false;

  // Priority: local screen share → remote screen share → manual pin → gallery
  const stageId = screenOn
    ? localId
    : remoteIsSharing
      ? (remoteP?.id ?? null)
      : pinnedId;

  const isPresentation = !!stageId && participants.length > 1;
  const stageP         = useMemo(() => participants.find(p => p.id === stageId), [participants, stageId]);
  const filmstrip      = useMemo(
    () => isPresentation ? participants.filter(p => p.id !== stageId) : [],
    [isPresentation, participants, stageId],
  );

  // Auto-clear a stale pin when that participant leaves
  useEffect(() => {
    if (pinnedId && !participants.find(p => p.id === pinnedId)) setPinnedId(null);
  }, [participants, pinnedId]);

  const handlePin = useCallback((id) => {
    if (screenOn || remoteIsSharing) return; // screen share controls the stage
    setPinnedId(prev => prev === id ? null : id);
  }, [screenOn, remoteIsSharing]);

  // ── Gallery layout computation ────────────────────────────────────────────
  const layout = useMemo(
    () => computeOptimalLayout(participants.length, size.w, size.h),
    [participants.length, size.w, size.h],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-neutral-950">
      <AnimatePresence mode="wait" initial={false}>

        {!isPresentation ? (
          /* ── Gallery ────────────────────────────────────────────────────── */
          <motion.div
            key="gallery"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FADE}
            className="flex h-full w-full items-center justify-center"
          >
            {size.w > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${layout.cols}, ${layout.tileW}px)`,
                  gap: GAP,
                }}
              >
                <AnimatePresence>
                  {participants.map((p) => (
                    <motion.div
                      key={p.id}
                      layout
                      initial={{ opacity: 0, scale: 0.92 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.88 }}
                      transition={SPRING}
                      style={{ width: layout.tileW, height: layout.tileH }}
                      className="overflow-hidden rounded-2xl"
                    >
                      <ParticipantTile
                        stream={p.stream}
                        username={p.username}
                        isLocal={p.isLocal}
                        isHost={p.isHost}
                        camOn={p.camOn}
                        micOn={p.micOn}
                        iceState={p.iceState}
                        isPinned={pinnedId === p.id}
                        isScreenShare={p.isScreenShare}
                        isAdmin={isAdmin}
                        onPin={() => handlePin(p.id)}
                        onFullscreen={() => onTileFullscreen?.(p.id)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </motion.div>

        ) : (
          /* ── Presentation / pinned ──────────────────────────────────────── */
          <motion.div
            key="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FADE}
            className="flex h-full w-full gap-2.5"
          >
            {/* ── Main stage ─────────────────────────────────────────────── */}
            <motion.div
              key="stage"
              layout
              transition={SPRING}
              className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl bg-black"
            >
              {stageP && (
                <ParticipantTile
                  stream={stageP.stream}
                  username={stageP.username}
                  isLocal={stageP.isLocal}
                  isHost={stageP.isHost}
                  camOn={stageP.camOn}
                  micOn={stageP.micOn}
                  iceState={stageP.iceState}
                  isFocused
                  isPinned={pinnedId === stageP.id}
                  isScreenShare={stageP.isScreenShare}
                  isAdmin={isAdmin}
                  onPin={() => !screenOn && handlePin(stageP.id)}
                  onFullscreen={() => onTileFullscreen?.(stageP.id)}
                />
              )}

              {/* Presenting chip — local or remote */}
              <AnimatePresence>
                {stageP?.isScreenShare && stageP?.isLocal && (
                  <motion.div
                    key="local-presenting-label"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="absolute left-3 top-3 z-30 flex items-center gap-2 rounded-full bg-primary/90 px-3 py-1 text-xs font-semibold text-white shadow-lg backdrop-blur-sm"
                  >
                    <MonitorIcon className="size-3.5" />
                    You are presenting
                  </motion.div>
                )}
                {stageP?.isScreenShare && !stageP?.isLocal && (
                  <motion.div
                    key="remote-presenting-label"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="absolute left-3 top-3 z-30 flex items-center gap-2 rounded-full bg-neutral-700/90 px-3 py-1 text-xs font-semibold text-white shadow-lg backdrop-blur-sm"
                  >
                    <MonitorIcon className="size-3.5" />
                    {stageP?.username ?? "Participant"} is presenting
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Unpin chip */}
              <AnimatePresence>
                {pinnedId === stageP?.id && !stageP?.isScreenShare && (
                  <motion.button
                    key="unpin-btn"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    onClick={() => setPinnedId(null)}
                    className="absolute right-3 top-3 z-30 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md transition-colors hover:bg-primary"
                  >
                    <PinOffIcon className="size-3" />
                    Unpin
                  </motion.button>
                )}
              </AnimatePresence>
            </motion.div>

            {/* ── Participant rail ────────────────────────────────────────── */}
            <div
              className="
                flex w-[180px] shrink-0 flex-col gap-2.5 overflow-y-auto overflow-x-hidden py-0.5
                [&::-webkit-scrollbar]:w-1
                [&::-webkit-scrollbar-track]:bg-transparent
                [&::-webkit-scrollbar-thumb]:rounded-full
                [&::-webkit-scrollbar-thumb]:bg-white/20
                [&::-webkit-scrollbar-thumb:hover]:bg-white/35
              "
            >
              <AnimatePresence>
                {filmstrip.map((p) => (
                  <RailTile
                    key={p.id}
                    participant={p}
                    isPinned={pinnedId === p.id}
                    canPin={!screenOn}
                    isAdmin={isAdmin}
                    onPin={() => handlePin(p.id)}
                    onFullscreen={() => onTileFullscreen?.(p.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Rail tile ─────────────────────────────────────────────────────────────────

const RailTile = memo(function RailTile({ participant: p, isPinned, canPin, isAdmin, onPin, onFullscreen }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.88 }}
      transition={SPRING}
      onClick={canPin ? onPin : undefined}
      className={`
        group relative aspect-video w-full shrink-0 overflow-hidden rounded-xl
        ring-1 transition-shadow duration-150
        ${isPinned
          ? "ring-primary shadow-lg shadow-primary/20"
          : "ring-white/10 hover:ring-white/30"}
        ${canPin ? "cursor-pointer" : "cursor-default"}
      `}
    >
      <ParticipantTile
        stream={p.stream}
        username={p.username}
        isLocal={p.isLocal}
        isHost={p.isHost}
        camOn={p.camOn}
        micOn={p.micOn}
        iceState={p.iceState}
        isThumbnail
        isPinned={isPinned}
        isScreenShare={p.isScreenShare}
        isAdmin={isAdmin}
        onPin={onPin}
        onFullscreen={onFullscreen}
      />

      {/* "Pin" hover cue */}
      {canPin && !isPinned && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <span className="rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
            Pin
          </span>
        </div>
      )}

      {/* Pinned badge */}
      {isPinned && (
        <div className="absolute right-1.5 top-1.5 z-10 rounded-full bg-primary/85 px-1.5 py-px text-[9px] font-bold text-white">
          Pinned
        </div>
      )}
    </motion.div>
  );
});
