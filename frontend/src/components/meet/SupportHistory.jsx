/**
 * SupportHistory
 * ──────────────
 * Searchable, filterable, paginated table of past support sessions.
 * Fetches from GET /api/admin/support/sessions and GET /api/admin/support/stats.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@clerk/react";
import {
  SearchIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  FilterIcon,
  UserIcon,
  ClockIcon,
  CalendarIcon,
} from "lucide-react";
import { SupportStats } from "./SupportStats.jsx";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }) {
  const cfg = {
    queued:    { cls: "bg-warning/15 text-warning",         label: "Queued" },
    active:    { cls: "bg-success/15 text-success",         label: "Active" },
    ended:     { cls: "bg-neutral-700 text-neutral-300",    label: "Ended" },
    rejected:  { cls: "bg-error/15 text-error",             label: "Rejected" },
    abandoned: { cls: "bg-neutral-800 text-neutral-500",    label: "Abandoned" },
  }[status] ?? { cls: "bg-white/10 text-neutral-400", label: status };

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.cls}`}>
      {status === "active" && (
        <span className="mr-1 size-1.5 animate-pulse rounded-full bg-success" />
      )}
      {cfg.label}
    </span>
  );
}

function EndReasonBadge({ reason }) {
  if (!reason) return null;
  const labels = {
    customer_ended:       "Customer ended",
    admin_ended:          "Agent ended",
    customer_disconnected: "Customer dropped",
    admin_disconnected:   "Agent dropped",
    rejected:             "Declined",
    cancelled:            "Cancelled",
  };
  return (
    <span className="text-[11px] text-neutral-500">{labels[reason] ?? reason}</span>
  );
}

function CallerAvatar({ name, avatar }) {
  const initial = (name ?? "?")[0]?.toUpperCase() ?? "?";
  if (avatar) {
    return (
      <img
        src={avatar}
        alt={name}
        className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/15"
        onError={(e) => { e.target.style.display = "none"; }}
      />
    );
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
      {initial}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "active",    label: "Active" },
  { value: "ended",     label: "Ended" },
  { value: "queued",    label: "Queued" },
  { value: "rejected",  label: "Rejected" },
  { value: "abandoned", label: "Abandoned" },
];

export function SupportHistory() {
  const { getToken } = useAuth();

  // Filter state
  const [search, setSearch]     = useState("");
  const [status, setStatus]     = useState("");
  const [from, setFrom]         = useState("");
  const [to, setTo]             = useState("");
  const [page, setPage]         = useState(1);
  const PAGE_SIZE = 20;

  // Data state
  const [sessions, setSessions] = useState([]);
  const [total, setTotal]       = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  // Stats
  const [stats, setStats]       = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Debounce search
  const searchTimer = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [status, from, to]);

  // Fetch helper
  const authFetch = useCallback(async (url) => {
    const token = await getToken();
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, [getToken]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await authFetch(`${API}/api/admin/support/stats`);
      setStats(data);
    } catch {
      // non-fatal
    } finally {
      setStatsLoading(false);
    }
  }, [authFetch]);

  // Fetch session list
  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (status) params.set("status", status);
      if (from) params.set("from", from);
      if (to)   params.set("to", to);

      const data = await authFetch(`${API}/api/admin/support/sessions?${params}`);
      setSessions(data.sessions ?? []);
      setTotal(data.total ?? 0);
      setPageCount(data.pageCount ?? 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [authFetch, page, debouncedSearch, status, from, to]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  function handleRefresh() {
    fetchStats();
    fetchSessions();
  }

  return (
    <div className="flex flex-col gap-6 p-5">

      {/* Stats */}
      <SupportStats stats={stats} loading={statsLoading} />

      {/* History section */}
      <div className="rounded-2xl border border-white/8 bg-neutral-900 overflow-hidden">

        {/* Header + filters */}
        <div className="border-b border-white/8 px-5 py-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-200">
              Session History
              {total > 0 && (
                <span className="ml-2 text-xs font-normal text-neutral-500">
                  {total.toLocaleString()} total
                </span>
              )}
            </h2>
            <button
              onClick={handleRefresh}
              title="Refresh"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              <RefreshCwIcon className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {/* Filter row */}
          <div className="flex flex-wrap gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-48">
              <SearchIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-neutral-500" />
              <input
                type="text"
                placeholder="Search by name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-neutral-800 py-2 pl-8 pr-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
            </div>

            {/* Status filter */}
            <div className="relative">
              <FilterIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-neutral-500 pointer-events-none" />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="appearance-none rounded-xl border border-white/10 bg-neutral-800 py-2 pl-8 pr-8 text-sm text-white outline-none focus:border-primary cursor-pointer"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Date range */}
            <div className="relative">
              <CalendarIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-neutral-500 pointer-events-none" />
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-xl border border-white/10 bg-neutral-800 py-2 pl-8 pr-3 text-sm text-white outline-none focus:border-primary"
                title="From date"
              />
            </div>
            <div className="relative">
              <CalendarIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-neutral-500 pointer-events-none" />
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-xl border border-white/10 bg-neutral-800 py-2 pl-8 pr-3 text-sm text-white outline-none focus:border-primary"
                title="To date"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {error ? (
            <div className="p-8 text-center text-sm text-error">{error}</div>
          ) : loading && sessions.length === 0 ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-white/5" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <UserIcon className="mb-3 size-10 text-neutral-700" />
              <p className="text-sm font-medium text-neutral-500">No sessions found</p>
              <p className="mt-1 text-xs text-neutral-600">
                {debouncedSearch || status || from || to
                  ? "Try adjusting your filters."
                  : "Support sessions will appear here once customers start calling."}
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/8 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  <th className="px-5 py-3 text-left">Customer</th>
                  <th className="px-5 py-3 text-left">Agent</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-left">
                    <div className="flex items-center gap-1"><CalendarIcon className="size-3" /> Date</div>
                  </th>
                  <th className="px-5 py-3 text-left">
                    <div className="flex items-center gap-1"><ClockIcon className="size-3" /> Wait</div>
                  </th>
                  <th className="px-5 py-3 text-left">
                    <div className="flex items-center gap-1"><ClockIcon className="size-3" /> Duration</div>
                  </th>
                  <th className="px-5 py-3 text-left">End Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                <AnimatePresence mode="popLayout">
                  {sessions.map((s, i) => (
                    <motion.tr
                      key={s.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.02 }}
                      className="transition-colors hover:bg-white/3"
                    >
                      {/* Customer */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <CallerAvatar name={s.customerName} avatar={s.customerAvatar} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-white max-w-[140px]">
                              {s.customerName || "Guest"}
                            </p>
                            <p className="truncate text-[11px] text-neutral-500 max-w-[140px]">
                              {s.customerEmail || "—"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Agent */}
                      <td className="px-5 py-3.5">
                        <p className="text-sm text-neutral-300">{s.adminName || "—"}</p>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3.5">
                        <StatusBadge status={s.status} />
                      </td>

                      {/* Date */}
                      <td className="px-5 py-3.5">
                        <p className="text-xs text-neutral-400">{formatDate(s.queuedAt)}</p>
                      </td>

                      {/* Wait time */}
                      <td className="px-5 py-3.5">
                        <p className="text-xs text-neutral-400">{formatDuration(s.waitSeconds)}</p>
                      </td>

                      {/* Duration */}
                      <td className="px-5 py-3.5">
                        <p className="text-xs text-neutral-400">{formatDuration(s.durationSeconds)}</p>
                      </td>

                      {/* End reason */}
                      <td className="px-5 py-3.5">
                        <EndReasonBadge reason={s.endReason} />
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {pageCount > 1 && (
          <div className="flex items-center justify-between border-t border-white/8 px-5 py-3">
            <p className="text-xs text-neutral-500">
              Page {page} of {pageCount} &middot; {total.toLocaleString()} total
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-neutral-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-30"
              >
                <ChevronLeftIcon className="size-3.5" />
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={page === pageCount}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-neutral-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-30"
              >
                Next
                <ChevronRightIcon className="size-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
