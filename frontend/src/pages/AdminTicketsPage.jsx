import { useState, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  SearchIcon,
  TicketIcon,
  ChevronRightIcon,
  AlertCircleIcon,
  BellIcon,
  XIcon,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useTicketSocket } from "../hooks/useTicketSocket";

const STATUS_BADGE = {
  open:        "badge-error",
  in_progress: "badge-warning",
  pending:     "badge-info",
  resolved:    "badge-success",
  closed:      "badge-ghost",
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
  low:    "bg-base-content/20",
};

const PRIORITY_LABEL = {
  urgent: "Urgent",
  high:   "High",
  medium: "Medium",
  low:    "Low",
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

export default function AdminTicketsPage() {
  const { getToken, isSignedIn } = useAuth();

  const [filters, setFilters] = useState({
    status:   "all",
    priority: "all",
    category: "all",
    q:        "",
  });

  const [debouncedQ, setDebouncedQ] = useState("");
  const [qTimer, setQTimer] = useState(null);

  // Live new-ticket notification state
  const [newTicketAlert, setNewTicketAlert] = useState(null); // { title, ticketNumber }

  const handleQ = (value) => {
    setFilters(f => ({ ...f, q: value }));
    clearTimeout(qTimer);
    setQTimer(setTimeout(() => setDebouncedQ(value), 300));
  };

  const setFilter = (field) => (e) => setFilters(f => ({ ...f, [field]: e.target.value }));

  const params = new URLSearchParams();
  if (filters.status   !== "all") params.set("status",   filters.status);
  if (filters.priority !== "all") params.set("priority", filters.priority);
  if (filters.category !== "all") params.set("category", filters.category);
  if (debouncedQ.trim())          params.set("q",        debouncedQ.trim());
  const queryString = params.toString();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-tickets", queryString],
    queryFn: () => apiFetch(`/api/tickets${queryString ? `?${queryString}` : ""}`, { getToken }),
    enabled: isSignedIn,
  });

  // ── Real-time socket ────────────────────────────────────────────────────────
  // The hook invalidates ["admin-tickets"] on every new ticket/update so the
  // list auto-refreshes in the background without a manual button.
  const handleNewTicket = useCallback((ticket) => {
    setNewTicketAlert({ title: ticket.title, ticketNumber: ticket.ticketNumber });
    // Auto-dismiss after 6 seconds
    setTimeout(() => setNewTicketAlert(null), 6000);
  }, []);

  useTicketSocket({ onNewTicket: handleNewTicket });

  const tickets = data?.tickets ?? [];

  return (
    <div className="space-y-6">
      {/* Live new-ticket banner */}
      <AnimatePresence>
        {newTicketAlert && (
          <motion.div
            key="new-ticket-alert"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary"
          >
            <BellIcon className="size-4 shrink-0" />
            <span className="flex-1">
              <span className="font-semibold">New ticket:</span>{" "}
              {newTicketAlert.ticketNumber
                ? `#${newTicketAlert.ticketNumber} — `
                : ""}
              {newTicketAlert.title}
            </span>
            <button
              onClick={() => setNewTicketAlert(null)}
              className="rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Dismiss"
            >
              <XIcon className="size-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Support Tickets</h1>
          <p className="mt-0.5 text-sm text-base-content/60">
            {isLoading ? "Loading…" : `${tickets.length} ticket${tickets.length !== 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Search */}
        <label className="input input-bordered flex flex-1 items-center gap-2 sm:max-w-xs">
          <SearchIcon className="size-4 shrink-0 opacity-50" />
          <input
            type="text"
            placeholder="Search tickets…"
            value={filters.q}
            onChange={e => handleQ(e.target.value)}
            className="min-w-0 flex-1"
          />
        </label>

        <select className="select select-bordered" value={filters.status} onChange={setFilter("status")}>
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="pending">Pending</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>

        <select className="select select-bordered" value={filters.priority} onChange={setFilter("priority")}>
          <option value="all">All priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <select className="select select-bordered" value={filters.category} onChange={setFilter("category")}>
          <option value="all">All categories</option>
          <option value="product_issue">Product Issue</option>
          <option value="order_issue">Order Issue</option>
          <option value="refund">Refund</option>
          <option value="payment">Payment</option>
          <option value="technical">Technical</option>
          <option value="delivery">Delivery</option>
          <option value="general">General</option>
        </select>
      </div>

      {/* List */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="skeleton h-20 w-full rounded-xl" />
          ))}
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <AlertCircleIcon className="size-4" />
          Failed to load tickets: {error.message}
        </div>
      )}

      {!isLoading && !error && tickets.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-base-300 py-16 text-center">
          <TicketIcon className="size-10 text-base-content/25" />
          <p className="text-base-content/50">No tickets match your filters</p>
        </div>
      )}

      <div className="space-y-2">
        {tickets.map((ticket, i) => (
          <motion.div
            key={ticket.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
          >
            <Link
              to={`/admin/tickets/${ticket.id}`}
              className="group flex items-center gap-3 rounded-xl border border-base-200 bg-base-100 px-4 py-3.5 shadow-xs transition-all hover:border-primary/30 hover:shadow-md"
            >
              {/* Priority dot */}
              <div
                className={`mt-0.5 size-2.5 shrink-0 rounded-full ${PRIORITY_DOT[ticket.priority] ?? "bg-base-content/20"}`}
                title={PRIORITY_LABEL[ticket.priority]}
              />

              {/* Main info */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-xs text-base-content/40">#{ticket.ticketNumber}</span>
                  <span className="truncate font-medium transition-colors group-hover:text-primary">
                    {ticket.title}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-base-content/50">
                  <span>{ticket.customerName}</span>
                  <span>·</span>
                  <span>{CATEGORY_LABEL[ticket.category] ?? ticket.category}</span>
                  {ticket.productName && <><span>·</span><span className="text-base-content/40">📦 {ticket.productName}</span></>}
                  <span>·</span>
                  <span>
                    {new Date(ticket.updatedAt).toLocaleDateString(undefined, {
                      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                  {ticket.assignedToName && (
                    <>
                      <span>·</span>
                      <span className="text-primary">→ {ticket.assignedToName}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Status badge */}
              <span className={`badge badge-sm shrink-0 ${STATUS_BADGE[ticket.status]}`}>
                {STATUS_LABEL[ticket.status]}
              </span>

              <ChevronRightIcon className="size-4 shrink-0 text-base-content/25 transition-colors group-hover:text-primary" />
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
