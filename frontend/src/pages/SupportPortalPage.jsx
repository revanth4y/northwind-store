import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { motion } from "framer-motion";
import {
  PlusIcon,
  TicketIcon,
  ClockIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ChevronRightIcon,
  InboxIcon,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useTicketSocket } from "../hooks/useTicketSocket";

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

const PRIORITY_DOT = {
  urgent: "bg-error",
  high:   "bg-warning",
  medium: "bg-info",
  low:    "bg-base-content/30",
};

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="card bg-base-100 shadow-sm"
    >
      <div className="card-body p-5">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${color}`}>
          <Icon className="size-5 text-white" />
        </div>
        <p className="mt-3 text-3xl font-bold tabular-nums">{value}</p>
        <p className="text-sm text-base-content/60">{label}</p>
      </div>
    </motion.div>
  );
}

function TicketRow({ ticket, basePath }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className="group flex items-center gap-3 rounded-xl border border-base-200 bg-base-100 px-4 py-3 shadow-xs transition-shadow hover:shadow-md"
    >
      <div className={`mt-1 size-2 shrink-0 rounded-full ${PRIORITY_DOT[ticket.priority] ?? "bg-base-content/30"}`} title={ticket.priority} />
      <div className="min-w-0 flex-1">
        <Link
          to={`${basePath}/${ticket.id}`}
          className="block truncate font-medium transition-colors group-hover:text-primary"
        >
          #{ticket.ticketNumber} — {ticket.title}
        </Link>
        <p className="mt-0.5 text-xs text-base-content/50">
          {new Date(ticket.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          {ticket.assignedToName ? ` · Assigned to ${ticket.assignedToName}` : ""}
        </p>
      </div>
      <span className={`badge badge-sm shrink-0 ${STATUS_BADGE[ticket.status]}`}>
        {STATUS_LABEL[ticket.status]}
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-base-content/30 transition-colors group-hover:text-primary" />
    </motion.div>
  );
}

export default function SupportPortalPage() {
  const { getToken, isSignedIn } = useAuth();
  const navigate = useNavigate();

  // ── Real-time socket — keeps the ticket list live ──────────────────────────
  // The hook patches ["tickets"] in the React Query cache on ticket:updated and
  // invalidates it on ticket:message so status/updatedAt always reflect reality.
  useTicketSocket();

  const { data, isLoading, error } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => apiFetch("/api/tickets", { getToken }),
    enabled: isSignedIn,
  });

  const tickets = data?.tickets ?? [];
  const open        = tickets.filter(t => t.status === "open");
  const inProgress  = tickets.filter(t => t.status === "in_progress");
  const pending     = tickets.filter(t => t.status === "pending");
  const resolved    = tickets.filter(t => t.status === "resolved" || t.status === "closed");
  const active      = tickets.filter(t => !["resolved", "closed"].includes(t.status));

  if (!isSignedIn) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <TicketIcon className="size-12 text-base-content/30" />
        <h2 className="text-xl font-semibold">Sign in to view your support tickets</h2>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Support Portal</h1>
          <p className="mt-1 text-sm text-base-content/60">Track and manage your support requests</p>
        </div>
        <Link to="/support/tickets/new" className="btn btn-primary gap-2">
          <PlusIcon className="size-4" />
          New Ticket
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={AlertCircleIcon} label="Open"        value={open.length}       color="bg-error" />
        <StatCard icon={ClockIcon}       label="In Progress" value={inProgress.length}  color="bg-warning" />
        <StatCard icon={InboxIcon}       label="Pending"     value={pending.length}     color="bg-info" />
        <StatCard icon={CheckCircleIcon} label="Resolved"    value={resolved.length}    color="bg-success" />
      </div>

      {/* Active tickets */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Active Tickets</h2>
        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="skeleton h-16 w-full rounded-xl" />
            ))}
          </div>
        )}
        {error && (
          <div className="alert alert-error">
            <AlertCircleIcon className="size-4" />
            Failed to load tickets.
          </div>
        )}
        {!isLoading && !error && active.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-base-300 py-12 text-center">
            <TicketIcon className="size-10 text-base-content/25" />
            <p className="text-base-content/50">No active tickets</p>
            <Link to="/support/tickets/new" className="btn btn-primary btn-sm gap-1.5">
              <PlusIcon className="size-3.5" />
              Open a ticket
            </Link>
          </div>
        )}
        <div className="space-y-2">
          {active.map(t => (
            <TicketRow key={t.id} ticket={t} basePath="/support/tickets" />
          ))}
        </div>
      </section>

      {/* Resolved / Closed tickets */}
      {resolved.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-base-content/60">Resolved &amp; Closed</h2>
          <div className="space-y-2 opacity-70">
            {resolved.map(t => (
              <TicketRow key={t.id} ticket={t} basePath="/support/tickets" />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
