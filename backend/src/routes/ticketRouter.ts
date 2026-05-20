/**
 * ticketRouter — support ticket CRUD + lifecycle management
 *
 * Customers:  see/close/reopen their own tickets, post replies.
 * Staff:      see all tickets, change status/priority/assignment, post internal notes.
 *
 * Every lifecycle change is logged as an immutable ticketEvents row so the
 * frontend can render a full audit trail / timeline.
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";

import { db } from "../db/index.js";
import { tickets, ticketMessages, ticketEvents } from "../db/schema.js";
import type { UserRole, TicketEventType } from "../db/schema.js";
import { getLocalUser } from "../lib/users.js";
import { isStaff } from "../lib/roles.js";
import { getTicketNsp } from "../lib/ticketSocketManager.js";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Write one audit-trail event — fire-and-forget, never throws. */
async function logEvent(opts: {
  ticketId:     string;
  actorClerkId: string | null;
  actorName:    string;
  actorRole:    UserRole;
  eventType:    TicketEventType;
  fromValue?:   string | null;
  toValue?:     string | null;
  note?:        string | null;
}) {
  const [event] = await db.insert(ticketEvents).values({
    ticketId:     opts.ticketId,
    actorClerkId: opts.actorClerkId,
    actorName:    opts.actorName,
    actorRole:    opts.actorRole,
    eventType:    opts.eventType,
    fromValue:    opts.fromValue ?? null,
    toValue:      opts.toValue   ?? null,
    note:         opts.note      ?? null,
  }).returning();
  return event;
}

/** Emit both ticket:updated and ticket:event over the /tickets socket namespace. */
function emitTicketUpdate(
  ticketId:         string,
  customerClerkId:  string | null | undefined,
  updatedTicket:    unknown,
  event?:           unknown,
) {
  const nsp = getTicketNsp();
  if (!nsp) return;

  const ticketPayload = { ticket: updatedTicket };
  nsp.to(`ticket:${ticketId}`).emit("ticket:updated", ticketPayload);
  if (customerClerkId) {
    nsp.to(`user:${customerClerkId}`).emit("ticket:updated", ticketPayload);
  }
  nsp.to("admin:tickets").emit("ticket:updated", ticketPayload);

  if (event) {
    const eventPayload = { ticketId, event };
    nsp.to(`ticket:${ticketId}`).emit("ticket:event", eventPayload);
    if (customerClerkId) {
      nsp.to(`user:${customerClerkId}`).emit("ticket:event", eventPayload);
    }
  }
}

// ── List tickets ───────────────────────────────────────────────────────────────

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const localUser = await getLocalUser(userId);
    if (!localUser) { res.status(503).json({ error: "Account not synced yet" }); return; }

    const { status, priority, category, q } = req.query as Record<string, string>;

    const conditions = [];

    if (!isStaff(localUser.role)) {
      conditions.push(eq(tickets.customerClerkId, userId));
    }

    if (status  && status  !== "all") conditions.push(eq(tickets.status,   status  as any));
    if (priority && priority !== "all") conditions.push(eq(tickets.priority, priority as any));
    if (category && category !== "all") conditions.push(eq(tickets.category, category as any));
    if (q?.trim()) {
      conditions.push(
        or(
          ilike(tickets.title,         `%${q.trim()}%`),
          ilike(tickets.customerName,  `%${q.trim()}%`),
          ilike(tickets.customerEmail, `%${q.trim()}%`),
        )!,
      );
    }

    const rows = await db
      .select()
      .from(tickets)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(tickets.updatedAt));

    res.json({ tickets: rows });
  } catch (e) { next(e); }
});

// ── Create ticket ─────────────────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const localUser = await getLocalUser(userId);
    if (!localUser) { res.status(503).json({ error: "Account not synced yet" }); return; }

    const { title, description, category, priority, productId, productName, orderReference } = req.body as Record<string, string>;

    if (!title?.trim())       { res.status(400).json({ error: "title is required" });       return; }
    if (!description?.trim()) { res.status(400).json({ error: "description is required" }); return; }
    if (!category)            { res.status(400).json({ error: "category is required" });    return; }

    const [ticket] = await db
      .insert(tickets)
      .values({
        userId:          localUser.id,
        customerClerkId: userId,
        customerName:    localUser.displayName ?? localUser.email,
        customerEmail:   localUser.email,
        title:           title.trim().slice(0, 200),
        description:     description.trim().slice(0, 5000),
        category:        category as any,
        priority:        (priority ?? "medium") as any,
        status:          "open",
        productId:       productId ?? null,
        productName:     productName?.trim().slice(0, 200) ?? null,
        orderReference:  orderReference?.trim().slice(0, 100) ?? null,
      })
      .returning();

    // First message = the description itself
    await db.insert(ticketMessages).values({
      ticketId:      ticket.id,
      authorClerkId: userId,
      authorName:    localUser.displayName ?? localUser.email,
      authorRole:    localUser.role,
      content:       description.trim().slice(0, 5000),
      isInternal:    false,
    });

    // Audit trail: created event
    await logEvent({
      ticketId:     ticket.id,
      actorClerkId: userId,
      actorName:    localUser.displayName ?? localUser.email,
      actorRole:    localUser.role,
      eventType:    "created",
      toValue:      "open",
    });

    // Real-time: notify all staff of the new ticket
    getTicketNsp()?.to("admin:tickets").emit("ticket:new", ticket);

    res.status(201).json({ ticket });
  } catch (e) { next(e); }
});

// ── Get ticket + messages + events ────────────────────────────────────────────

router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const localUser = await getLocalUser(userId);
    if (!localUser) { res.status(503).json({ error: "Account not synced yet" }); return; }

    const [ticket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, String(req.params.id)))
      .limit(1);

    if (!ticket) { res.status(404).json({ error: "Not found" }); return; }

    if (!isStaff(localUser.role) && ticket.customerClerkId !== userId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const msgWhere = isStaff(localUser.role)
      ? eq(ticketMessages.ticketId, ticket.id)
      : and(eq(ticketMessages.ticketId, ticket.id), eq(ticketMessages.isInternal, false));

    const [messages, events] = await Promise.all([
      db.select().from(ticketMessages).where(msgWhere).orderBy(asc(ticketMessages.createdAt)),
      db.select().from(ticketEvents).where(eq(ticketEvents.ticketId, ticket.id)).orderBy(asc(ticketEvents.createdAt)),
    ]);

    res.json({ ticket, messages, events });
  } catch (e) { next(e); }
});

// ── Add message ───────────────────────────────────────────────────────────────

router.post("/:id/messages", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const localUser = await getLocalUser(userId);
    if (!localUser) { res.status(503).json({ error: "Account not synced yet" }); return; }

    const [ticket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, String(req.params.id)))
      .limit(1);

    if (!ticket) { res.status(404).json({ error: "Not found" }); return; }

    if (!isStaff(localUser.role) && ticket.customerClerkId !== userId) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    // Customers cannot reply on closed tickets
    if (!isStaff(localUser.role) && ticket.status === "closed") {
      res.status(403).json({ error: "Ticket is closed. Please reopen it first." }); return;
    }

    const { content, isInternal } = req.body as { content?: string; isInternal?: boolean };

    if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }

    const internal = isStaff(localUser.role) ? Boolean(isInternal) : false;

    const [message] = await db
      .insert(ticketMessages)
      .values({
        ticketId:      ticket.id,
        authorClerkId: userId,
        authorName:    localUser.displayName ?? localUser.email,
        authorRole:    localUser.role,
        content:       content.trim().slice(0, 5000),
        isInternal:    internal,
      })
      .returning();

    // Auto-transitions
    const now = new Date();
    let newStatus: string | null = null;

    if (isStaff(localUser.role) && !internal) {
      const updates: Record<string, unknown> = { updatedAt: now };
      if (ticket.status === "open") { updates.status = "in_progress"; newStatus = "in_progress"; }
      if (!ticket.assignedToId) {
        updates.assignedToId   = localUser.id;
        updates.assignedToName = localUser.displayName ?? localUser.email;
      }
      await db.update(tickets).set(updates).where(eq(tickets.id, ticket.id));
    } else if (!isStaff(localUser.role) && ticket.status === "pending") {
      await db.update(tickets).set({ status: "in_progress", updatedAt: now })
        .where(eq(tickets.id, ticket.id));
      newStatus = "in_progress";
    } else {
      await db.update(tickets).set({ updatedAt: now }).where(eq(tickets.id, ticket.id));
    }

    // Log status change event if transition occurred
    let statusEvent = null;
    if (newStatus) {
      statusEvent = await logEvent({
        ticketId:     ticket.id,
        actorClerkId: userId,
        actorName:    localUser.displayName ?? localUser.email,
        actorRole:    localUser.role,
        eventType:    "status_changed",
        fromValue:    ticket.status,
        toValue:      newStatus,
      });
    }

    // Fetch final ticket state
    const [updatedTicket] = await db.select().from(tickets).where(eq(tickets.id, ticket.id)).limit(1);

    // Real-time
    const nsp = getTicketNsp();
    if (nsp) {
      const msgPayload = { ticketId: ticket.id, message };
      nsp.to(`ticket:${ticket.id}`).emit("ticket:message", msgPayload);
      if (!internal && ticket.customerClerkId) {
        nsp.to(`user:${ticket.customerClerkId}`).emit("ticket:message", msgPayload);
      }
      if (updatedTicket) {
        emitTicketUpdate(ticket.id, ticket.customerClerkId, updatedTicket, statusEvent);
      }
    }

    res.status(201).json({ message });
  } catch (e) { next(e); }
});

// ── Close ticket (customer OR staff) ─────────────────────────────────────────

router.post("/:id/close", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const localUser = await getLocalUser(userId);
    if (!localUser) { res.status(503).json({ error: "Account not synced yet" }); return; }

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, String(req.params.id))).limit(1);
    if (!ticket) { res.status(404).json({ error: "Not found" }); return; }

    // Customer can only close their own ticket
    if (!isStaff(localUser.role) && ticket.customerClerkId !== userId) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    if (ticket.status === "closed") {
      res.status(409).json({ error: "Ticket is already closed" }); return;
    }

    const { note } = req.body as { note?: string };
    const now = new Date();
    const actorName = localUser.displayName ?? localUser.email;

    // Update ticket
    const [updated] = await db
      .update(tickets)
      .set({
        status:       "closed",
        closedAt:     now,
        closedByName: actorName,
        resolvedAt:   ticket.resolvedAt ?? now,
        updatedAt:    now,
      })
      .where(eq(tickets.id, ticket.id))
      .returning();

    // Audit event
    const event = await logEvent({
      ticketId:     ticket.id,
      actorClerkId: userId,
      actorName,
      actorRole:    localUser.role,
      eventType:    "status_changed",
      fromValue:    ticket.status,
      toValue:      "closed",
      note:         note?.trim().slice(0, 1000) || null,
    });

    // Optional resolution note as a visible message
    let message = null;
    if (note?.trim()) {
      const isInternal = isStaff(localUser.role); // staff notes are internal by default
      [message] = await db.insert(ticketMessages).values({
        ticketId:      ticket.id,
        authorClerkId: userId,
        authorName:    actorName,
        authorRole:    localUser.role,
        content:       note.trim().slice(0, 5000),
        isInternal,
      }).returning();

      // Real-time: push the note message
      const nsp = getTicketNsp();
      if (nsp && message) {
        const msgPayload = { ticketId: ticket.id, message };
        nsp.to(`ticket:${ticket.id}`).emit("ticket:message", msgPayload);
        if (!isInternal && ticket.customerClerkId) {
          nsp.to(`user:${ticket.customerClerkId}`).emit("ticket:message", msgPayload);
        }
      }
    }

    emitTicketUpdate(ticket.id, ticket.customerClerkId, updated, event);

    res.json({ ticket: updated, event, message });
  } catch (e) { next(e); }
});

// ── Reopen ticket (customer OR staff) ────────────────────────────────────────

router.post("/:id/reopen", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const localUser = await getLocalUser(userId);
    if (!localUser) { res.status(503).json({ error: "Account not synced yet" }); return; }

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, String(req.params.id))).limit(1);
    if (!ticket) { res.status(404).json({ error: "Not found" }); return; }

    if (!isStaff(localUser.role) && ticket.customerClerkId !== userId) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    if (ticket.status === "open" || ticket.status === "in_progress") {
      res.status(409).json({ error: "Ticket is already open" }); return;
    }

    const { note } = req.body as { note?: string };
    const now = new Date();
    const actorName = localUser.displayName ?? localUser.email;
    const prevStatus = ticket.status;

    const [updated] = await db
      .update(tickets)
      .set({
        status:       "open",
        closedAt:     null,
        closedByName: null,
        updatedAt:    now,
      })
      .where(eq(tickets.id, ticket.id))
      .returning();

    const event = await logEvent({
      ticketId:     ticket.id,
      actorClerkId: userId,
      actorName,
      actorRole:    localUser.role,
      eventType:    "status_changed",
      fromValue:    prevStatus,
      toValue:      "open",
      note:         note?.trim().slice(0, 1000) || null,
    });

    // Optional note as a message
    let message = null;
    if (note?.trim()) {
      [message] = await db.insert(ticketMessages).values({
        ticketId:      ticket.id,
        authorClerkId: userId,
        authorName:    actorName,
        authorRole:    localUser.role,
        content:       note.trim().slice(0, 5000),
        isInternal:    false,
      }).returning();

      const nsp = getTicketNsp();
      if (nsp && message) {
        const msgPayload = { ticketId: ticket.id, message };
        nsp.to(`ticket:${ticket.id}`).emit("ticket:message", msgPayload);
        if (ticket.customerClerkId) {
          nsp.to(`user:${ticket.customerClerkId}`).emit("ticket:message", msgPayload);
        }
      }
    }

    emitTicketUpdate(ticket.id, ticket.customerClerkId, updated, event);

    res.json({ ticket: updated, event, message });
  } catch (e) { next(e); }
});

// ── Update ticket (staff only) ────────────────────────────────────────────────

router.patch("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const localUser = await getLocalUser(userId);
    if (!localUser) { res.status(503).json({ error: "Account not synced yet" }); return; }
    if (!isStaff(localUser.role)) { res.status(403).json({ error: "Forbidden" }); return; }

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, String(req.params.id))).limit(1);
    if (!ticket) { res.status(404).json({ error: "Not found" }); return; }

    const { status, priority, assignedToName, resolutionNote } = req.body as Record<string, string>;
    const now = new Date();
    const actorName = localUser.displayName ?? localUser.email;
    const updates: Record<string, unknown> = { updatedAt: now };

    const loggedEvents: unknown[] = [];

    // Status change
    if (status && status !== ticket.status) {
      updates.status = status;
      if (status === "resolved" && !ticket.resolvedAt) updates.resolvedAt = now;
      if ((status === "open" || status === "in_progress") && ticket.resolvedAt) updates.resolvedAt = null;
      if (status === "closed") {
        updates.closedAt     = now;
        updates.closedByName = actorName;
        if (!ticket.resolvedAt) updates.resolvedAt = now;
      }
      if (status !== "closed" && ticket.status === "closed") {
        updates.closedAt     = null;
        updates.closedByName = null;
      }
      loggedEvents.push({ type: "status_changed", from: ticket.status, to: status });
    }

    // Priority change
    if (priority && priority !== ticket.priority) {
      updates.priority = priority;
      loggedEvents.push({ type: "priority_changed", from: ticket.priority, to: priority });
    }

    // Assignment change
    if (assignedToName !== undefined) {
      updates.assignedToName = assignedToName;
      updates.assignedToId   = localUser.id;
      loggedEvents.push({ type: "assigned", from: ticket.assignedToName, to: assignedToName });
    }

    const [updated] = await db.update(tickets).set(updates).where(eq(tickets.id, ticket.id)).returning();

    // Log all events
    let lastEvent = null;
    for (const e of loggedEvents as Array<{ type: string; from: string | null; to: string }>) {
      lastEvent = await logEvent({
        ticketId:     ticket.id,
        actorClerkId: userId,
        actorName,
        actorRole:    localUser.role,
        eventType:    e.type as TicketEventType,
        fromValue:    e.from,
        toValue:      e.to,
      });
    }

    // Optional resolution note — creates a visible internal message
    let message = null;
    if (resolutionNote?.trim()) {
      const isPublic = Boolean((req.body as any).resolutionNotePublic);
      [message] = await db.insert(ticketMessages).values({
        ticketId:      ticket.id,
        authorClerkId: userId,
        authorName:    actorName,
        authorRole:    localUser.role,
        content:       resolutionNote.trim().slice(0, 5000),
        isInternal:    !isPublic,
      }).returning();

      const nsp = getTicketNsp();
      if (nsp && message) {
        const msgPayload = { ticketId: ticket.id, message };
        nsp.to(`ticket:${ticket.id}`).emit("ticket:message", msgPayload);
        if (isPublic && ticket.customerClerkId) {
          nsp.to(`user:${ticket.customerClerkId}`).emit("ticket:message", msgPayload);
        }
      }
    }

    emitTicketUpdate(ticket.id, ticket.customerClerkId, updated, lastEvent);

    res.json({ ticket: updated, message });
  } catch (e) { next(e); }
});

export default router;
