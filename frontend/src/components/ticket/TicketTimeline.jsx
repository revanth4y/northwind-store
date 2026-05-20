/**
 * TicketTimeline
 * ───────────────
 * Renders a merged, chronological timeline of ticket messages and lifecycle
 * events (status changes, priority changes, assignments).
 *
 * Messages are shown as chat bubbles; events are shown as slim activity rows.
 */

import { motion, AnimatePresence } from "framer-motion";
import {
  UserIcon,
  ShieldIcon,
  LockIcon,
  CheckCircleIcon,
  XCircleIcon,
  RefreshCwIcon,
  TagIcon,
  UserCheckIcon,
  TicketIcon,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function Avatar({ name, isStaff }) {
  const initials = name
    ? name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";
  return (
    <div className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white
      ${isStaff ? "bg-primary" : "bg-secondary"}`}>
      {initials}
    </div>
  );
}

// ── Status display helpers ─────────────────────────────────────────────────────

const STATUS_LABEL = {
  open:        "Open",
  in_progress: "In Progress",
  pending:     "Pending",
  resolved:    "Resolved",
  closed:      "Closed",
};

const STATUS_CLS = {
  open:        "text-error",
  in_progress: "text-warning",
  pending:     "text-info",
  resolved:    "text-success",
  closed:      "text-base-content/60",
};

const PRIORITY_LABEL = {
  urgent: "Urgent",
  high:   "High",
  medium: "Medium",
  low:    "Low",
};

// ── Event row ─────────────────────────────────────────────────────────────────

function EventIcon({ eventType, toValue }) {
  if (eventType === "created")  return <TicketIcon    className="size-3.5" />;
  if (eventType === "assigned") return <UserCheckIcon className="size-3.5" />;
  if (eventType === "priority_changed") return <TagIcon className="size-3.5" />;
  if (eventType === "status_changed") {
    if (toValue === "closed")   return <XCircleIcon    className="size-3.5" />;
    if (toValue === "resolved") return <CheckCircleIcon className="size-3.5" />;
    if (toValue === "open")     return <RefreshCwIcon  className="size-3.5" />;
    return <RefreshCwIcon className="size-3.5" />;
  }
  return <RefreshCwIcon className="size-3.5" />;
}

function EventDescription({ event }) {
  const name = <span className="font-medium text-base-content/80">{event.actorName}</span>;

  if (event.eventType === "created") {
    return <>{name} opened this ticket</>;
  }

  if (event.eventType === "status_changed") {
    const from = STATUS_LABEL[event.fromValue] ?? event.fromValue;
    const to   = STATUS_LABEL[event.toValue]   ?? event.toValue;
    const toCls = STATUS_CLS[event.toValue] ?? "";
    return <>
      {name} changed status from{" "}
      <span className="font-medium">{from}</span>
      {" "}→{" "}
      <span className={`font-semibold ${toCls}`}>{to}</span>
    </>;
  }

  if (event.eventType === "priority_changed") {
    const from = PRIORITY_LABEL[event.fromValue] ?? event.fromValue;
    const to   = PRIORITY_LABEL[event.toValue]   ?? event.toValue;
    return <>{name} changed priority from <span className="font-medium">{from}</span> → <span className="font-medium">{to}</span></>;
  }

  if (event.eventType === "assigned") {
    return <>{name} assigned to <span className="font-medium">{event.toValue || "unassigned"}</span></>;
  }

  return <>{name} updated the ticket</>;
}

function EventRow({ event }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-2.5 py-1 text-xs text-base-content/55"
    >
      {/* Connector line + icon */}
      <div className="mt-0.5 flex w-8 shrink-0 flex-col items-center">
        <div className="flex size-5 items-center justify-center rounded-full bg-base-200 text-base-content/50">
          <EventIcon eventType={event.eventType} toValue={event.toValue} />
        </div>
      </div>

      <div className="min-w-0 flex-1 pt-0.5">
        <EventDescription event={event} />
        {event.note && (
          <p className="mt-1 italic text-base-content/50">&ldquo;{event.note}&rdquo;</p>
        )}
        <span className="mt-0.5 block text-[10px] text-base-content/35">{formatTime(event.createdAt)}</span>
      </div>
    </motion.div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }) {
  const isStaffMsg = msg.authorRole !== "customer";
  const isInternal = msg.isInternal;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isStaffMsg ? "flex-row-reverse" : ""}`}
    >
      <Avatar name={msg.authorName} isStaff={isStaffMsg} />
      <div className={`max-w-[80%] space-y-1 flex flex-col ${isStaffMsg ? "items-end" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          {isInternal && (
            <span className="flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-semibold text-warning">
              <LockIcon className="size-2.5" />
              Internal
            </span>
          )}
          <span className={`flex items-center gap-1 text-xs text-base-content/50 ${isStaffMsg ? "flex-row-reverse" : ""}`}>
            {isStaffMsg ? <ShieldIcon className="size-3 text-primary" /> : <UserIcon className="size-3" />}
            {msg.authorName}
          </span>
          <span className="text-xs text-base-content/35">{formatTime(msg.createdAt)}</span>
        </div>
        <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed
          ${isInternal
            ? "border border-warning/30 bg-warning/10 text-base-content"
            : isStaffMsg
              ? "bg-primary text-primary-content"
              : "bg-base-200 text-base-content"
          } ${isStaffMsg ? "rounded-tr-sm" : "rounded-tl-sm"}`}
        >
          {msg.content}
        </div>
      </div>
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * @param {{
 *   messages: object[],
 *   events: object[],
 *   typingUsers: Array<{ name: string, socketId: string }>,
 *   bottomRef: React.Ref,
 * }} props
 */
export function TicketTimeline({ messages, events, typingUsers, bottomRef }) {
  // Merge and sort by createdAt
  const items = [
    ...messages.map(m => ({ ...m, _type: "message" })),
    ...events.map(e => ({ ...e, _type: "event" })),
  ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  return (
    <div className="flex flex-col gap-4">
      <AnimatePresence initial={false}>
        {items.map(item =>
          item._type === "message"
            ? <MessageBubble key={`msg-${item.id}`} msg={item} />
            : <EventRow      key={`evt-${item.id}`} event={item} />
        )}
      </AnimatePresence>

      {/* Typing indicator */}
      <AnimatePresence>
        {typingUsers?.length > 0 && (
          <motion.div
            key="typing"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="flex items-center gap-2 pl-1 text-xs text-base-content/50"
          >
            <span className="loading loading-dots loading-xs" />
            <span>
              {typingUsers.map(u => u.name).join(", ")}
              {" "}{typingUsers.length === 1 ? "is" : "are"} typing…
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={bottomRef} />
    </div>
  );
}
