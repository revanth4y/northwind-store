/**
 * supportDb
 * ---------
 * Thin async DB layer for support_sessions CRUD.
 * All functions are fire-and-forget safe (never throw to callers).
 *
 * Called exclusively from supportSocketManager on state transitions:
 *   queued    -> createSession()
 *   cancelled -> setAbandoned()
 *   accepted  -> setAccepted()
 *   rejected  -> setRejected()
 *   ended     -> setEnded()
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { supportSessions } from "../db/schema.js";
import type { SupportEndReason, SupportSessionStatus } from "../db/schema.js";

// Re-export types so supportSocketManager can use them without a direct schema import
export type { SupportEndReason, SupportSessionStatus };

// ---------------------------------------------------------------------------

/** Called when a customer joins the queue. Creates the persistent record. */
export async function createSession(params: {
  id: string;
  customerClerkId: string | null;
  customerName: string;
  customerEmail: string;
  customerAvatar: string | null;
}): Promise<void> {
  await db.insert(supportSessions).values({
    id: params.id,
    customerClerkId: params.customerClerkId,
    customerName: params.customerName.slice(0, 120),
    customerEmail: params.customerEmail.slice(0, 200),
    customerAvatar: params.customerAvatar?.slice(0, 600) ?? null,
    status: "queued" as SupportSessionStatus,
    queuedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/** Customer cancelled before an agent accepted. */
export async function setAbandoned(sessionId: string): Promise<void> {
  await db
    .update(supportSessions)
    .set({
      status: "abandoned" as SupportSessionStatus,
      endReason: "cancelled" as SupportEndReason,
      endedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(supportSessions.id, sessionId));
}

/** Admin accepted the call. */
export async function setAccepted(params: {
  sessionId: string;
  adminClerkId: string | null;
  adminName: string;
}): Promise<void> {
  await db
    .update(supportSessions)
    .set({
      status: "active" as SupportSessionStatus,
      adminClerkId: params.adminClerkId,
      adminName: params.adminName.slice(0, 120),
      acceptedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(supportSessions.id, params.sessionId));
}

/** Admin explicitly declined the queued request. */
export async function setRejected(sessionId: string): Promise<void> {
  await db
    .update(supportSessions)
    .set({
      status: "rejected" as SupportSessionStatus,
      endReason: "rejected" as SupportEndReason,
      endedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(supportSessions.id, sessionId));
}

/** Call finished (either party ended it or disconnected). */
export async function setEnded(params: {
  sessionId: string;
  startedAt: number; // ms timestamp when call was accepted (from in-memory ActiveCall)
  endReason: SupportEndReason;
}): Promise<void> {
  const now = new Date();
  const durationSeconds = Math.max(
    0,
    Math.floor((now.getTime() - params.startedAt) / 1000),
  );

  await db
    .update(supportSessions)
    .set({
      status: "ended" as SupportSessionStatus,
      endReason: params.endReason,
      endedAt: now,
      durationSeconds,
      updatedAt: now,
    })
    .where(eq(supportSessions.id, params.sessionId));
}
