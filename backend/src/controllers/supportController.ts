/**
 * supportController
 * -----------------
 * REST handlers for the admin support history dashboard.
 * All routes are mounted under /api/admin/support (protected by requireAdmin).
 *
 * GET /api/admin/support/stats    -> analytics summary
 * GET /api/admin/support/sessions -> paginated session list with filters
 */

import type { Request, Response, NextFunction } from "express";
import { and, avg, count, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { supportSessions } from "../db/schema.js";
import type { SupportSessionStatus } from "../db/schema.js";

// ---------------------------------------------------------------------------
// GET /api/admin/support/stats
// ---------------------------------------------------------------------------

export async function getSupportStats(_req: Request, res: Response, next: NextFunction) {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 6); // last 7 days

    const [
      [totalRow],
      [todayRow],
      [weekRow],
      [activeRow],
      [endedRow],
      [rejectedRow],
      [abandonedRow],
      [avgRow],
      [totalDurRow],
    ] = await Promise.all([
      db.select({ v: count() }).from(supportSessions),
      db.select({ v: count() }).from(supportSessions)
        .where(gte(supportSessions.queuedAt, todayStart)),
      db.select({ v: count() }).from(supportSessions)
        .where(gte(supportSessions.queuedAt, weekStart)),
      db.select({ v: count() }).from(supportSessions)
        .where(eq(supportSessions.status, "active")),
      db.select({ v: count() }).from(supportSessions)
        .where(eq(supportSessions.status, "ended")),
      db.select({ v: count() }).from(supportSessions)
        .where(eq(supportSessions.status, "rejected")),
      db.select({ v: count() }).from(supportSessions)
        .where(eq(supportSessions.status, "abandoned")),
      // avg duration only over ended calls that have a recorded duration
      db.select({ v: avg(supportSessions.durationSeconds) }).from(supportSessions)
        .where(and(
          eq(supportSessions.status, "ended"),
          sql`${supportSessions.durationSeconds} is not null`,
        )),
      db.select({ v: sql<number>`coalesce(sum(${supportSessions.durationSeconds}),0)` })
        .from(supportSessions)
        .where(eq(supportSessions.status, "ended")),
    ]);

    const total         = Number(totalRow?.v ?? 0);
    const ended         = Number(endedRow?.v ?? 0);
    const successRate   = total > 0 ? Math.round((ended / total) * 100) : 0;
    const avgDuration   = avgRow?.v ? Math.round(Number(avgRow.v)) : null;
    const totalDuration = Number(totalDurRow?.v ?? 0);

    res.json({
      total,
      today:        Number(todayRow?.v ?? 0),
      week:         Number(weekRow?.v ?? 0),
      active:       Number(activeRow?.v ?? 0),
      ended,
      rejected:     Number(rejectedRow?.v ?? 0),
      abandoned:    Number(abandonedRow?.v ?? 0),
      avgDurationSeconds:   avgDuration,
      totalDurationSeconds: totalDuration,
      successRate,
    });
  } catch (e) {
    next(e);
  }
}

// ---------------------------------------------------------------------------
// GET /api/admin/support/sessions
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set<SupportSessionStatus>([
  "queued", "active", "ended", "rejected", "abandoned",
]);

export async function listSupportSessions(req: Request, res: Response, next: NextFunction) {
  try {
    // Query params
    const page     = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const offset   = (page - 1) * pageSize;

    const search = typeof req.query.search === "string" ? req.query.search.trim() : null;
    const statusParam = req.query.status as string | undefined;
    const status: SupportSessionStatus | null =
      statusParam && VALID_STATUSES.has(statusParam as SupportSessionStatus)
        ? (statusParam as SupportSessionStatus)
        : null;
    const from = req.query.from ? new Date(req.query.from as string) : null;
    const to   = req.query.to   ? new Date(req.query.to   as string) : null;

    // Build WHERE conditions
    const conditions = [];

    if (search) {
      conditions.push(
        or(
          ilike(supportSessions.customerName,  `%${search}%`),
          ilike(supportSessions.customerEmail, `%${search}%`),
          ilike(supportSessions.adminName,     `%${search}%`),
        ),
      );
    }
    if (status) {
      conditions.push(eq(supportSessions.status, status));
    }
    if (from && !isNaN(from.getTime())) {
      conditions.push(gte(supportSessions.queuedAt, from));
    }
    if (to && !isNaN(to.getTime())) {
      // end of day for 'to'
      const toEnd = new Date(to);
      toEnd.setHours(23, 59, 59, 999);
      conditions.push(lte(supportSessions.queuedAt, toEnd));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Run data + count in parallel
    const [rows, [countRow]] = await Promise.all([
      db
        .select()
        .from(supportSessions)
        .where(where)
        .orderBy(desc(supportSessions.queuedAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ v: count() }).from(supportSessions).where(where),
    ]);

    const total     = Number(countRow?.v ?? 0);
    const pageCount = Math.ceil(total / pageSize);

    // Compute wait time for each row
    const sessions = rows.map((r) => ({
      ...r,
      waitSeconds:
        r.acceptedAt && r.queuedAt
          ? Math.max(0, Math.floor((r.acceptedAt.getTime() - r.queuedAt.getTime()) / 1000))
          : null,
    }));

    res.json({ sessions, total, page, pageSize, pageCount });
  } catch (e) {
    next(e);
  }
}
