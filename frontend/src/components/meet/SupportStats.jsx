/**
 * SupportStats
 * ────────────
 * Analytics summary cards for the admin support dashboard.
 * Fetches from GET /api/admin/support/stats.
 */

import { motion } from "framer-motion";
import {
  PhoneCallIcon,
  CalendarDaysIcon,
  ClockIcon,
  UsersIcon,
  TrendingUpIcon,
  XCircleIcon,
  CheckCircleIcon,
  ActivityIcon,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatTotalDuration(seconds) {
  if (!seconds) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      className="flex items-start gap-4 rounded-2xl border border-white/8 bg-neutral-900 p-5 shadow-sm"
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
        <p className="mt-0.5 text-2xl font-bold text-white">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-neutral-500">{sub}</p>}
      </div>
    </motion.div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   stats: {
 *     total: number,
 *     today: number,
 *     week: number,
 *     active: number,
 *     ended: number,
 *     rejected: number,
 *     abandoned: number,
 *     avgDurationSeconds: number | null,
 *     totalDurationSeconds: number,
 *     successRate: number,
 *   } | null,
 *   loading: boolean,
 * }} props
 */
export function SupportStats({ stats, loading }) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl border border-white/8 bg-neutral-900"
          />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const cards = [
    {
      icon: PhoneCallIcon,
      label: "Total Sessions",
      value: stats.total.toLocaleString(),
      sub: `${stats.week} this week`,
      color: "bg-primary/20 text-primary",
      delay: 0,
    },
    {
      icon: CalendarDaysIcon,
      label: "Today",
      value: stats.today.toLocaleString(),
      sub: "sessions started today",
      color: "bg-sky-500/20 text-sky-400",
      delay: 0.05,
    },
    {
      icon: ActivityIcon,
      label: "Active Now",
      value: stats.active.toLocaleString(),
      sub: stats.active === 1 ? "call in progress" : "calls in progress",
      color: stats.active > 0 ? "bg-success/20 text-success" : "bg-neutral-700 text-neutral-400",
      delay: 0.1,
    },
    {
      icon: CheckCircleIcon,
      label: "Completed",
      value: stats.ended.toLocaleString(),
      sub: `${stats.successRate}% success rate`,
      color: "bg-emerald-500/20 text-emerald-400",
      delay: 0.15,
    },
    {
      icon: ClockIcon,
      label: "Avg Duration",
      value: formatDuration(stats.avgDurationSeconds),
      sub: "per completed call",
      color: "bg-violet-500/20 text-violet-400",
      delay: 0.2,
    },
    {
      icon: TrendingUpIcon,
      label: "Total Talk Time",
      value: formatTotalDuration(stats.totalDurationSeconds),
      sub: "across all completed calls",
      color: "bg-amber-500/20 text-amber-400",
      delay: 0.25,
    },
    {
      icon: XCircleIcon,
      label: "Rejected",
      value: stats.rejected.toLocaleString(),
      sub: "declined by agent",
      color: "bg-error/15 text-error",
      delay: 0.3,
    },
    {
      icon: UsersIcon,
      label: "Abandoned",
      value: stats.abandoned.toLocaleString(),
      sub: "customer left queue",
      color: "bg-neutral-700 text-neutral-400",
      delay: 0.35,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <StatCard key={c.label} {...c} />
      ))}
    </div>
  );
}
