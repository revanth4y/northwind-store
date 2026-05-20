/**
 * ParticipantsList
 * ────────────────
 * Google Meet–style slide-in "People" panel.
 *
 * Features:
 *  • Live participant cards with avatar, role badge, status
 *  • Host crown badge (amber)
 *  • Grouped "You" + "Others" sections
 *  • Online indicator dot
 *  • Joined-at time
 *  • Smooth list entry animations
 *  • Search box (client-side filter)
 */

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { XIcon, CrownIcon, SearchIcon, UserIcon, MicOffIcon } from "lucide-react";

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Deterministic avatar gradient (matches ParticipantTile) ──────────────────
const AVATAR_COLORS = [
  "bg-rose-700",
  "bg-teal-700",
  "bg-blue-700",
  "bg-purple-700",
  "bg-amber-700",
  "bg-cyan-700",
];
function avatarColor(name) {
  let h = 0;
  for (const c of name ?? "") h = (h * 31 + c.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ── Single participant row ────────────────────────────────────────────────────

function ParticipantRow({ p }) {
  const initials = (p.username ?? "?")
    .split(" ").filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const color = avatarColor(p.username);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.18 }}
      className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-white/5"
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white ${color} ring-1 ring-white/10`}>
          {initials || <UserIcon className="size-4" />}
        </div>
        {/* Online indicator */}
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-neutral-900 bg-success" />
      </div>

      {/* Name + meta */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium text-neutral-100">
            {p.username ?? "Participant"}
          </p>
          {p.isSelf && (
            <span className="shrink-0 rounded-full bg-primary/20 px-1.5 py-px text-[9px] font-semibold text-primary">
              You
            </span>
          )}
        </div>
        <p className="text-[10px] text-neutral-500">
          {p.isHost ? "Host · " : ""}
          Joined {formatTime(p.joinedAt)}
        </p>
      </div>

      {/* Status icons */}
      <div className="flex shrink-0 items-center gap-1">
        {/* Host crown */}
        {p.isHost && (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/20" title="Host">
            <CrownIcon className="size-3 text-amber-400" />
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── ParticipantsList ──────────────────────────────────────────────────────────

/**
 * @param {{
 *   participants: Array<{
 *     socketId: string,
 *     username: string,
 *     joinedAt: number,
 *     isHost: boolean,
 *     isSelf: boolean,
 *   }>,
 *   onClose: () => void,
 * }} props
 */
export function ParticipantsList({ participants, onClose }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? participants.filter(p => (p.username ?? "").toLowerCase().includes(q))
      : participants;
  }, [participants, query]);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => {
      if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      return (a.username ?? "").localeCompare(b.username ?? "");
    }),
    [filtered],
  );

  const you   = sorted.filter(p => p.isSelf);
  const others = sorted.filter(p => !p.isSelf);

  return (
    <motion.aside
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0,      opacity: 1 }}
      exit  ={{ x: "100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 360, damping: 36 }}
      className="flex w-72 shrink-0 flex-col border-l border-white/8 bg-neutral-900 xl:w-80"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <h3 className="text-sm font-semibold text-neutral-100">
          People
          <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs font-normal text-neutral-400">
            {participants.length}
          </span>
        </h3>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      {/* Grouped avatar row */}
      {participants.length > 1 && (
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
          <div className="flex -space-x-2">
            {participants.slice(0, 5).map((p) => (
              <div
                key={p.socketId}
                title={p.username}
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-neutral-900 ${avatarColor(p.username)}`}
              >
                {(p.username ?? "?")[0]?.toUpperCase()}
              </div>
            ))}
          </div>
          <span className="text-xs text-neutral-400">
            {participants.length} in this call
          </span>
        </div>
      )}

      {/* Search */}
      <div className="px-3 pt-2.5 pb-1">
        <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-2">
          <SearchIcon className="size-3.5 shrink-0 text-neutral-500" />
          <input
            type="text"
            placeholder="Search participants"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-xs text-neutral-200 placeholder-neutral-600 outline-none"
          />
        </div>
      </div>

      {/* Participant list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {/* You section */}
        {you.length > 0 && (
          <>
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
              You
            </p>
            <AnimatePresence>
              {you.map(p => <ParticipantRow key={p.socketId} p={p} />)}
            </AnimatePresence>
          </>
        )}

        {/* Others section */}
        {others.length > 0 && (
          <>
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
              In this call
            </p>
            <AnimatePresence>
              {others.map(p => <ParticipantRow key={p.socketId} p={p} />)}
            </AnimatePresence>
          </>
        )}

        {sorted.length === 0 && (
          <p className="mt-10 text-center text-xs text-neutral-600">
            {query ? "No participants match your search." : "No participants yet."}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-white/8 px-4 py-3">
        <p className="text-center text-[11px] text-neutral-600">
          {participants.length === 1 ? "Just you in this call" : `${participants.length} people in this call`}
        </p>
      </div>
    </motion.aside>
  );
}
