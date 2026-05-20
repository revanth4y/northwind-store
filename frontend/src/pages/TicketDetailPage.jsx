import { useState, useRef, useEffect } from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { motion } from "framer-motion";
import {
  ArrowLeftIcon,
  SendIcon,
  AlertCircleIcon,
  XCircleIcon,
  RefreshCwIcon,
  CheckCircleIcon,
  WifiOffIcon,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useTicketSocket } from "../hooks/useTicketSocket";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { TicketTimeline } from "../components/ticket/TicketTimeline";

const STATUS_BADGE = {
  open:        "badge-error",
  in_progress: "badge-warning",
  pending:     "badge-info",
  resolved:    "badge-success",
  closed:      "badge-neutral",
};

const STATUS_LABEL = {
  open:        "Open",
  in_progress: "In Progress",
  pending:     "Pending",
  resolved:    "Resolved",
  closed:      "Closed",
};

const PRIORITY_LABEL = {
  urgent: { label: "Urgent", cls: "badge-error" },
  high:   { label: "High",   cls: "badge-warning" },
  medium: { label: "Medium", cls: "badge-info" },
  low:    { label: "Low",    cls: "badge-ghost" },
};

const CATEGORY_LABEL = {
  product_issue: "Product Issue",
  order_issue:   "Order Issue",
  refund:        "Refund",
  payment:       "Payment",
  technical:     "Technical",
  delivery:      "Delivery",
  general:       "General",
};

export default function TicketDetailPage() {
  const { id } = useParams();
  const { getToken, isSignedIn } = useAuth();
  const qc = useQueryClient();
  const bottomRef = useRef(null);

  const [reply, setReply] = useState("");
  const [closeModal, setCloseModal] = useState(false);
  const [reopenModal, setReopenModal] = useState(false);
  const [closeNote, setCloseNote] = useState("");

  // ── Real-time socket ───────────────────────────────────────────────────────
  const { typingUsers, emitTyping } = useTicketSocket({ ticketId: id });

  const { data, isLoading, error } = useQuery({
    queryKey: ["ticket", id],
    queryFn: () => apiFetch(`/api/tickets/${id}`, { getToken }),
    enabled: isSignedIn && !!id,
  });

  const ticket   = data?.ticket;
  const messages = data?.messages ?? [];
  const events   = data?.events   ?? [];

  // Auto-scroll when new messages/events arrive
  const itemCount = messages.length + events.length;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [itemCount]);

  // ── Reply mutation ─────────────────────────────────────────────────────────
  const { mutate: sendReply, isPending: sendingReply } = useMutation({
    mutationFn: () =>
      apiFetch(`/api/tickets/${id}/messages`, {
        getToken, method: "POST", body: { content: reply },
      }),
    onSuccess: (data) => {
      setReply("");
      const msg = data?.message;
      if (msg) {
        qc.setQueryData(["ticket", id], (old) => {
          if (!old) return old;
          const msgs = old.messages ?? [];
          if (msgs.some(m => m.id === msg.id)) return old;
          return { ...old, messages: [...msgs, msg] };
        });
      }
      qc.invalidateQueries({ queryKey: ["ticket", id] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  // ── Close mutation ─────────────────────────────────────────────────────────
  const { mutate: closeTicket, isPending: closing } = useMutation({
    mutationFn: () =>
      apiFetch(`/api/tickets/${id}/close`, {
        getToken, method: "POST",
        body: { note: closeNote.trim() || undefined },
      }),
    onSuccess: (data) => {
      setCloseModal(false);
      setCloseNote("");
      if (data?.ticket) {
        qc.setQueryData(["ticket", id], (old) => old ? { ...old, ticket: data.ticket } : old);
      }
      qc.invalidateQueries({ queryKey: ["ticket", id] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  // ── Reopen mutation ────────────────────────────────────────────────────────
  const { mutate: reopenTicket, isPending: reopening } = useMutation({
    mutationFn: () =>
      apiFetch(`/api/tickets/${id}/reopen`, {
        getToken, method: "POST",
      }),
    onSuccess: (data) => {
      setReopenModal(false);
      if (data?.ticket) {
        qc.setQueryData(["ticket", id], (old) => old ? { ...old, ticket: data.ticket } : old);
      }
      qc.invalidateQueries({ queryKey: ["ticket", id] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  const handleSend = (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    sendReply();
  };

  if (!isSignedIn) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-base-content/60">Sign in to view this ticket.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="skeleton h-8 w-48" />
        <div className="skeleton h-40 w-full rounded-2xl" />
        <div className="skeleton h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="alert alert-error">
          <AlertCircleIcon className="size-4" />
          {error?.message ?? "Ticket not found."}
        </div>
      </div>
    );
  }

  const isClosed   = ticket.status === "closed";
  const isResolved = ticket.status === "resolved";
  const isFinished = isClosed || isResolved;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Back */}
      <Link to="/support" className="btn btn-ghost btn-sm gap-1.5 pl-0">
        <ArrowLeftIcon className="size-4" />
        Back to portal
      </Link>

      {/* Ticket header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="card bg-base-100 shadow-sm"
      >
        <div className="card-body p-5 sm:p-6">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1">
              <p className="text-xs text-base-content/40">Ticket #{ticket.ticketNumber}</p>
              <h1 className="mt-1 text-xl font-bold">{ticket.title}</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className={`badge badge-sm ${STATUS_BADGE[ticket.status] ?? "badge-ghost"}`}>
                {STATUS_LABEL[ticket.status] ?? ticket.status}
              </span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-base-content/50">
            <span className={`badge badge-sm ${PRIORITY_LABEL[ticket.priority]?.cls ?? "badge-ghost"}`}>
              {PRIORITY_LABEL[ticket.priority]?.label ?? ticket.priority}
            </span>
            <span className="badge badge-sm badge-ghost">
              {CATEGORY_LABEL[ticket.category] ?? ticket.category}
            </span>
            {ticket.productName && (
              <span className="badge badge-sm badge-outline">📦 {ticket.productName}</span>
            )}
            {ticket.orderReference && (
              <span className="badge badge-sm badge-outline">Order: {ticket.orderReference}</span>
            )}
            <span>Opened {new Date(ticket.createdAt).toLocaleDateString()}</span>
            {ticket.assignedToName && <span>· Assigned to {ticket.assignedToName}</span>}
          </div>

          {/* Closed / resolved banner */}
          {isClosed && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-base-200 px-4 py-2.5 text-sm text-base-content/60">
              <XCircleIcon className="size-4 shrink-0" />
              <span>
                Closed{ticket.closedByName ? ` by ${ticket.closedByName}` : ""}
                {ticket.closedAt ? ` on ${new Date(ticket.closedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : ""}
              </span>
            </div>
          )}
          {isResolved && !isClosed && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-success/10 px-4 py-2.5 text-sm text-success">
              <CheckCircleIcon className="size-4 shrink-0" />
              <span>
                Resolved
                {ticket.resolvedAt ? ` on ${new Date(ticket.resolvedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : ""}
              </span>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-4 flex flex-wrap gap-2">
            {!isFinished && (
              <button
                onClick={() => setCloseModal(true)}
                className="btn btn-sm btn-outline border-error/40 text-error hover:bg-error hover:text-white gap-1.5"
              >
                <XCircleIcon className="size-3.5" />
                Close Ticket
              </button>
            )}
            {isFinished && (
              <button
                onClick={() => setReopenModal(true)}
                className="btn btn-sm btn-outline gap-1.5"
              >
                <RefreshCwIcon className="size-3.5" />
                Reopen Ticket
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Timeline (messages + events) */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body gap-0 p-0">
          <div className="flex max-h-[560px] min-h-[200px] flex-col overflow-y-auto px-5 py-5 sm:px-6">
            <TicketTimeline
              messages={messages}
              events={events}
              typingUsers={typingUsers}
              bottomRef={bottomRef}
            />
          </div>

          {/* Reply area */}
          <div className="border-t border-base-200 px-5 pb-5 pt-4 sm:px-6">
            {isClosed ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-xl bg-base-200 px-4 py-3 text-sm text-base-content/60">
                  <WifiOffIcon className="size-4 shrink-0" />
                  This ticket is closed. Reopen it to send a new message.
                </div>
                <button
                  onClick={() => setReopenModal(true)}
                  className="btn btn-sm btn-outline gap-1.5"
                >
                  <RefreshCwIcon className="size-3.5" />
                  Reopen Ticket
                </button>
              </div>
            ) : (
              <form onSubmit={handleSend} className="flex gap-2">
                <textarea
                  className="textarea textarea-bordered min-h-[80px] flex-1 resize-none text-sm"
                  placeholder="Type your reply…"
                  value={reply}
                  onChange={e => { setReply(e.target.value); emitTyping(); }}
                  onKeyDown={e => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend(e);
                  }}
                  maxLength={5000}
                />
                <button
                  type="submit"
                  disabled={!reply.trim() || sendingReply}
                  className="btn btn-primary self-end gap-1.5"
                >
                  {sendingReply ? <span className="loading loading-spinner loading-sm" /> : <SendIcon className="size-4" />}
                  Send
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* ── Close confirmation modal ── */}
      <ConfirmModal
        isOpen={closeModal}
        title="Close this ticket?"
        description="The conversation will be locked. You can reopen it at any time if you need further help."
        confirmLabel="Close Ticket"
        confirmClass="btn-error"
        loading={closing}
        onConfirm={() => closeTicket()}
        onCancel={() => { setCloseModal(false); setCloseNote(""); }}
      >
        <label className="form-control">
          <div className="label pb-1">
            <span className="label-text text-xs">Resolution note (optional)</span>
          </div>
          <textarea
            className="textarea textarea-bordered resize-none text-sm"
            placeholder="Briefly describe how your issue was resolved…"
            value={closeNote}
            onChange={e => setCloseNote(e.target.value)}
            rows={3}
            maxLength={1000}
          />
        </label>
      </ConfirmModal>

      {/* ── Reopen confirmation modal ── */}
      <ConfirmModal
        isOpen={reopenModal}
        title="Reopen this ticket?"
        description="The ticket will be moved back to Open status and you'll be able to send messages again."
        confirmLabel="Reopen Ticket"
        confirmClass="btn-primary"
        loading={reopening}
        onConfirm={() => reopenTicket()}
        onCancel={() => setReopenModal(false)}
      />
    </div>
  );
}
