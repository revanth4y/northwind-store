import { useState, useRef, useEffect } from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { motion } from "framer-motion";
import {
  ArrowLeftIcon,
  SendIcon,
  AlertCircleIcon,
  ShieldIcon,
  LockIcon,
  CheckCircleIcon,
  UserCheckIcon,
  XCircleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useTicketSocket } from "../hooks/useTicketSocket";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { TicketTimeline } from "../components/ticket/TicketTimeline";

const STATUS_OPTIONS = [
  { value: "open",        label: "Open",        cls: "badge-error" },
  { value: "in_progress", label: "In Progress",  cls: "badge-warning" },
  { value: "pending",     label: "Pending",      cls: "badge-info" },
  { value: "resolved",    label: "Resolved",     cls: "badge-success" },
  { value: "closed",      label: "Closed",       cls: "badge-neutral" },
];

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent", cls: "badge-error" },
  { value: "high",   label: "High",   cls: "badge-warning" },
  { value: "medium", label: "Medium", cls: "badge-info" },
  { value: "low",    label: "Low",    cls: "badge-ghost" },
];

const CATEGORY_LABEL = {
  product_issue: "Product Issue",
  order_issue:   "Order Issue",
  refund:        "Refund",
  payment:       "Payment",
  technical:     "Technical",
  delivery:      "Delivery",
  general:       "General",
};

// Statuses that warrant a resolution note prompt
const RESOLUTION_STATUSES = new Set(["resolved", "closed"]);

export default function AdminTicketDetailPage() {
  const { id } = useParams();
  const { getToken, isSignedIn } = useAuth();
  const qc = useQueryClient();
  const bottomRef = useRef(null);

  const [reply, setReply] = useState("");
  const [isInternal, setIsInternal] = useState(false);

  // Resolution note modal (shown when admin closes/resolves)
  const [resolutionModal, setResolutionModal] = useState(null); // { targetStatus }
  const [resolutionNote, setResolutionNote] = useState("");
  const [isPublicNote, setIsPublicNote] = useState(true);

  // Reopen confirmation
  const [reopenModal, setReopenModal] = useState(false);

  // ── Real-time socket ───────────────────────────────────────────────────────
  const { typingUsers, emitTyping } = useTicketSocket({ ticketId: id });

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-ticket", id],
    queryFn: () => apiFetch(`/api/tickets/${id}`, { getToken }),
    enabled: isSignedIn && !!id,
  });

  const ticket   = data?.ticket;
  const messages = data?.messages ?? [];
  const events   = data?.events   ?? [];

  const itemCount = messages.length + events.length;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [itemCount]);

  // ── Reply mutation ─────────────────────────────────────────────────────────
  const { mutate: sendReply, isPending: sendingReply } = useMutation({
    mutationFn: () =>
      apiFetch(`/api/tickets/${id}/messages`, {
        getToken, method: "POST", body: { content: reply, isInternal },
      }),
    onSuccess: (data) => {
      setReply("");
      const msg = data?.message;
      if (msg) {
        qc.setQueryData(["admin-ticket", id], (old) => {
          if (!old) return old;
          const msgs = old.messages ?? [];
          if (msgs.some(m => m.id === msg.id)) return old;
          return { ...old, messages: [...msgs, msg] };
        });
      }
      qc.invalidateQueries({ queryKey: ["admin-ticket", id] });
      qc.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
  });

  // ── Status/priority/assignment mutation ────────────────────────────────────
  const { mutate: updateTicket, isPending: updating } = useMutation({
    mutationFn: (patch) =>
      apiFetch(`/api/tickets/${id}`, { getToken, method: "PATCH", body: patch }),
    onSuccess: (data) => {
      const updated = data?.ticket;
      if (updated) {
        qc.setQueryData(["admin-ticket", id], (old) =>
          old ? { ...old, ticket: updated } : old,
        );
      }
      // Append any note message that was created
      const msg = data?.message;
      if (msg) {
        qc.setQueryData(["admin-ticket", id], (old) => {
          if (!old) return old;
          const msgs = old.messages ?? [];
          if (msgs.some(m => m.id === msg.id)) return old;
          return { ...old, messages: [...msgs, msg] };
        });
      }
      qc.invalidateQueries({ queryKey: ["admin-ticket", id] });
      qc.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
  });

  // ── Close mutation ─────────────────────────────────────────────────────────
  const { mutate: closeTicket, isPending: closing } = useMutation({
    mutationFn: () =>
      apiFetch(`/api/tickets/${id}/close`, {
        getToken, method: "POST",
        body: { note: resolutionNote.trim() || undefined },
      }),
    onSuccess: (data) => {
      setResolutionModal(null);
      setResolutionNote("");
      if (data?.ticket) {
        qc.setQueryData(["admin-ticket", id], (old) => old ? { ...old, ticket: data.ticket } : old);
      }
      qc.invalidateQueries({ queryKey: ["admin-ticket", id] });
      qc.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
  });

  // ── Reopen mutation ────────────────────────────────────────────────────────
  const { mutate: reopenTicket, isPending: reopening } = useMutation({
    mutationFn: () =>
      apiFetch(`/api/tickets/${id}/reopen`, { getToken, method: "POST" }),
    onSuccess: (data) => {
      setReopenModal(false);
      if (data?.ticket) {
        qc.setQueryData(["admin-ticket", id], (old) => old ? { ...old, ticket: data.ticket } : old);
      }
      qc.invalidateQueries({ queryKey: ["admin-ticket", id] });
      qc.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
  });

  const handleSend = (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    sendReply();
  };

  // Status button click — prompt for note on resolve/close, else change directly
  const handleStatusClick = (targetStatus) => {
    if (!ticket || ticket.status === targetStatus) return;
    if (RESOLUTION_STATUSES.has(targetStatus)) {
      setResolutionNote("");
      setIsPublicNote(true);
      setResolutionModal({ targetStatus });
    } else {
      updateTicket({ status: targetStatus });
    }
  };

  const handleResolutionConfirm = () => {
    if (resolutionModal?.targetStatus === "closed") {
      closeTicket();
    } else {
      // resolved via PATCH
      updateTicket({
        status: resolutionModal.targetStatus,
        resolutionNote: resolutionNote.trim() || undefined,
        resolutionNotePublic: isPublicNote,
      });
      setResolutionModal(null);
      setResolutionNote("");
    }
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
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="skeleton h-8 w-48" />
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="skeleton h-[600px] rounded-2xl" />
          <div className="skeleton h-[300px] rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="alert alert-error">
          <AlertCircleIcon className="size-4" />
          {error?.message ?? "Ticket not found."}
        </div>
      </div>
    );
  }

  const currentStatus   = STATUS_OPTIONS.find(s => s.value === ticket.status);
  const currentPriority = PRIORITY_OPTIONS.find(p => p.value === ticket.priority);
  const isClosed  = ticket.status === "closed";
  const isFinished = isClosed || ticket.status === "resolved";

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Back */}
      <Link to="/admin/tickets" className="btn btn-ghost btn-sm gap-1.5 pl-0">
        <ArrowLeftIcon className="size-4" />
        All tickets
      </Link>

      <div className="grid gap-5 lg:grid-cols-[1fr_272px]">
        {/* ── Left: Conversation ── */}
        <div className="flex flex-col gap-4">
          {/* Ticket title card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="card bg-base-100 shadow-sm"
          >
            <div className="card-body p-5">
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex-1">
                  <p className="text-xs text-base-content/40">Ticket #{ticket.ticketNumber}</p>
                  <h1 className="mt-1 text-xl font-bold">{ticket.title}</h1>
                </div>
                <span className={`badge ${currentStatus?.cls ?? "badge-ghost"}`}>
                  {currentStatus?.label ?? ticket.status}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-base-content/50">
                <span className={`badge badge-sm ${currentPriority?.cls ?? "badge-ghost"}`}>
                  {currentPriority?.label ?? ticket.priority}
                </span>
                <span className="badge badge-sm badge-ghost">
                  {CATEGORY_LABEL[ticket.category] ?? ticket.category}
                </span>
                <span>From: {ticket.customerName} ({ticket.customerEmail})</span>
                {ticket.assignedToName && <span>· Assigned: {ticket.assignedToName}</span>}
              </div>

              {/* Closed / resolved banner */}
              {isClosed && (
                <div className="mt-3 flex items-center gap-2 rounded-xl bg-base-200 px-4 py-2.5 text-sm text-base-content/60">
                  <XCircleIcon className="size-4 shrink-0" />
                  <span>
                    Closed{ticket.closedByName ? ` by ${ticket.closedByName}` : ""}
                    {ticket.closedAt ? ` · ${new Date(ticket.closedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
                  </span>
                </div>
              )}
              {ticket.status === "resolved" && (
                <div className="mt-3 flex items-center gap-2 rounded-xl bg-success/10 px-4 py-2.5 text-sm text-success">
                  <CheckCircleIcon className="size-4 shrink-0" />
                  <span>
                    Resolved
                    {ticket.resolvedAt ? ` · ${new Date(ticket.resolvedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
                  </span>
                </div>
              )}
            </div>
          </motion.div>

          {/* Timeline + reply */}
          <div className="card flex-1 bg-base-100 shadow-sm">
            <div className="card-body gap-0 p-0">
              <div className="flex max-h-[500px] min-h-[180px] flex-col overflow-y-auto px-5 py-5 sm:px-6">
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
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 rounded-xl bg-base-200 px-4 py-2.5 text-sm text-base-content/60">
                      <XCircleIcon className="size-4 shrink-0" />
                      Ticket is closed.
                    </div>
                    <button
                      onClick={() => setReopenModal(true)}
                      className="btn btn-sm btn-outline gap-1.5"
                    >
                      <RefreshCwIcon className="size-3.5" />
                      Reopen
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSend} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => setIsInternal(false)}
                        className={`btn btn-xs gap-1 ${!isInternal ? "btn-primary" : "btn-ghost"}`}>
                        <ShieldIcon className="size-3" /> Public reply
                      </button>
                      <button type="button" onClick={() => setIsInternal(true)}
                        className={`btn btn-xs gap-1 ${isInternal ? "btn-warning" : "btn-ghost"}`}>
                        <LockIcon className="size-3" /> Internal note
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <textarea
                        className={`textarea textarea-bordered min-h-[90px] flex-1 resize-none text-sm
                          ${isInternal ? "border-warning/50 bg-warning/5" : ""}`}
                        placeholder={isInternal ? "Internal note (only visible to staff)…" : "Reply to customer…"}
                        value={reply}
                        onChange={e => { setReply(e.target.value); emitTyping(); }}
                        onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend(e); }}
                        maxLength={5000}
                      />
                      <button type="submit" disabled={!reply.trim() || sendingReply}
                        className={`btn self-end gap-1.5 ${isInternal ? "btn-warning" : "btn-primary"}`}>
                        {sendingReply ? <span className="loading loading-spinner loading-sm" /> : <SendIcon className="size-4" />}
                        {isInternal ? "Add Note" : "Reply"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: Controls ── */}
        <div className="space-y-4">
          {/* Status */}
          <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
            className="card bg-base-100 shadow-sm">
            <div className="card-body p-4 gap-3">
              <h3 className="font-semibold text-sm">Status</h3>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map(s => (
                  <button
                    key={s.value}
                    disabled={updating || closing}
                    onClick={() => handleStatusClick(s.value)}
                    className={`badge cursor-pointer border px-3 py-3 text-xs font-semibold transition-all ${s.cls}
                      ${ticket.status === s.value ? "ring-2 ring-offset-1 ring-primary" : "opacity-50 hover:opacity-100"}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Quick reopen if closed */}
              {isFinished && (
                <button
                  onClick={() => setReopenModal(true)}
                  disabled={updating || reopening}
                  className="btn btn-ghost btn-xs gap-1.5 mt-1"
                >
                  <RefreshCwIcon className="size-3" />
                  Reopen ticket
                </button>
              )}
            </div>
          </motion.div>

          {/* Priority */}
          <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.05 }} className="card bg-base-100 shadow-sm">
            <div className="card-body p-4 gap-3">
              <h3 className="font-semibold text-sm">Priority</h3>
              <div className="flex flex-wrap gap-1.5">
                {PRIORITY_OPTIONS.map(p => (
                  <button
                    key={p.value}
                    disabled={updating}
                    onClick={() => ticket.priority !== p.value && updateTicket({ priority: p.value })}
                    className={`badge cursor-pointer border px-3 py-3 text-xs font-semibold transition-all ${p.cls}
                      ${ticket.priority === p.value ? "ring-2 ring-offset-1 ring-primary" : "opacity-50 hover:opacity-100"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Assignment */}
          <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }} className="card bg-base-100 shadow-sm">
            <div className="card-body p-4 gap-3">
              <h3 className="font-semibold text-sm">Assignment</h3>
              {ticket.assignedToName
                ? <p className="text-sm text-base-content/70">Assigned to <span className="font-medium text-primary">{ticket.assignedToName}</span></p>
                : <p className="text-sm text-base-content/50">Unassigned</p>
              }
              <button disabled={updating}
                onClick={() => updateTicket({ assignedToName: "me" })}
                className="btn btn-ghost btn-sm gap-1.5">
                <UserCheckIcon className="size-4" />
                {ticket.assignedToName ? "Reassign to me" : "Assign to me"}
              </button>
            </div>
          </motion.div>

          {/* Details */}
          <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 }} className="card bg-base-100 shadow-sm">
            <div className="card-body p-4 gap-2">
              <h3 className="mb-1 font-semibold text-sm">Details</h3>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-base-content/50">Customer</dt>
                  <dd className="truncate font-medium">{ticket.customerName}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-base-content/50">Email</dt>
                  <dd className="truncate font-medium">{ticket.customerEmail}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-base-content/50">Category</dt>
                  <dd className="font-medium">{CATEGORY_LABEL[ticket.category] ?? ticket.category}</dd>
                </div>
                {ticket.productName && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-base-content/50">Product</dt>
                    <dd className="truncate font-medium">{ticket.productName}</dd>
                  </div>
                )}
                {ticket.orderReference && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-base-content/50">Order Ref</dt>
                    <dd className="font-medium">{ticket.orderReference}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt className="text-base-content/50">Created</dt>
                  <dd className="font-medium">{new Date(ticket.createdAt).toLocaleDateString()}</dd>
                </div>
                {ticket.resolvedAt && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-base-content/50">Resolved</dt>
                    <dd className="font-medium">{new Date(ticket.resolvedAt).toLocaleDateString()}</dd>
                  </div>
                )}
                {ticket.closedAt && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-base-content/50">Closed</dt>
                    <dd className="font-medium">
                      {new Date(ticket.closedAt).toLocaleDateString()}
                      {ticket.closedByName && <span className="block text-base-content/40">by {ticket.closedByName}</span>}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── Resolution note modal (resolved / closed) ── */}
      <ConfirmModal
        isOpen={!!resolutionModal}
        title={resolutionModal?.targetStatus === "closed" ? "Close ticket?" : "Mark as Resolved?"}
        description={
          resolutionModal?.targetStatus === "closed"
            ? "This will lock the conversation. Add an optional note for the customer."
            : "Mark this ticket as resolved. You can add a note for the customer."
        }
        confirmLabel={resolutionModal?.targetStatus === "closed" ? "Close Ticket" : "Mark Resolved"}
        confirmClass={resolutionModal?.targetStatus === "closed" ? "btn-error" : "btn-success"}
        loading={updating || closing}
        onConfirm={handleResolutionConfirm}
        onCancel={() => { setResolutionModal(null); setResolutionNote(""); }}
      >
        <div className="space-y-3">
          <label className="form-control">
            <div className="label pb-1">
              <span className="label-text text-xs">Resolution note (optional)</span>
            </div>
            <textarea
              className="textarea textarea-bordered resize-none text-sm"
              placeholder="Describe what was done to resolve this issue…"
              value={resolutionNote}
              onChange={e => setResolutionNote(e.target.value)}
              rows={3}
              maxLength={1000}
            />
          </label>
          {resolutionModal?.targetStatus !== "closed" && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={isPublicNote}
                onChange={e => setIsPublicNote(e.target.checked)}
              />
              Send note to customer
            </label>
          )}
        </div>
      </ConfirmModal>

      {/* ── Reopen confirmation ── */}
      <ConfirmModal
        isOpen={reopenModal}
        title="Reopen this ticket?"
        description="Status will be reset to Open and the customer can reply again."
        confirmLabel="Reopen Ticket"
        confirmClass="btn-primary"
        loading={reopening}
        onConfirm={() => reopenTicket()}
        onCancel={() => setReopenModal(false)}
      />
    </div>
  );
}
