/**
 * Admin shipment management routes
 * GET  /api/admin/shipments          – list all orders with shipment info
 * GET  /api/admin/shipments/:id      – single order shipment detail
 * PATCH /api/admin/shipments/:id/status – manually override shipment status
 * POST /api/admin/shipments/:id/sync  – pull fresh tracking from Shiprocket
 * POST /api/admin/shipments/:id/cancel – cancel a shipment
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "../db/index.js";
import { orders, orderItems, products, shipmentEvents } from "../db/schema.js";
import { asc, desc, eq, inArray } from "drizzle-orm";
import {
  trackShipmentByAWB,
  cancelShipmentByAWBs,
  isShiprocketConfigured,
} from "../lib/shiprocket.js";
import z from "zod";

const router = Router();

// ── List all orders with shipment data ─────────────────────────────────────────
router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db
      .select()
      .from(orders)
      .orderBy(desc(orders.createdAt));

    const orderIds = rows.map(r => r.id);
    const previewMap = new Map<string, { name: string; quantity: number }[]>();

    if (orderIds.length > 0) {
      const items = await db
        .select({
          orderId: orderItems.orderId,
          quantity: orderItems.quantity,
          name: products.name,
        })
        .from(orderItems)
        .innerJoin(products, eq(orderItems.productId, products.id))
        .where(inArray(orderItems.orderId, orderIds));

      for (const item of items) {
        const list = previewMap.get(item.orderId) ?? [];
        list.push({ name: item.name, quantity: item.quantity });
        previewMap.set(item.orderId, list);
      }
    }

    res.json({
      shipments: rows.map(o => ({
        ...o,
        previewItems: previewMap.get(o.id) ?? [],
      })),
    });
  } catch (e) {
    next(e);
  }
});

// ── Single order shipment detail ───────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, req.params.id as string))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const items = await db
      .select({
        id: orderItems.id,
        quantity: orderItems.quantity,
        unitPriceCents: orderItems.unitPriceCents,
        product: products,
      })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, order.id));

    const events = await db
      .select()
      .from(shipmentEvents)
      .where(eq(shipmentEvents.orderId, order.id))
      .orderBy(asc(shipmentEvents.timestamp));

    res.json({ order, items, events });
  } catch (e) {
    next(e);
  }
});

// ── Manually override shipment status ─────────────────────────────────────────
const statusPatchSchema = z.object({
  shipmentStatus: z.enum([
    "pending", "processing", "packed", "shipped",
    "out_for_delivery", "delivered", "delayed", "returned", "cancelled",
  ]),
  note: z.string().max(500).optional(),
  location: z.string().optional(),
});

router.patch("/:id/status", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = statusPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, req.params.id as string))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const now = new Date();
    const updates: Partial<typeof order> = {
      shipmentStatus: parsed.data.shipmentStatus,
      updatedAt: now,
    };

    if (parsed.data.shipmentStatus === "delivered") {
      updates.deliveryDate = now;
    }

    const [updated] = await db
      .update(orders)
      .set(updates)
      .where(eq(orders.id, order.id))
      .returning();

    await db.insert(shipmentEvents).values({
      orderId: order.id,
      status: parsed.data.shipmentStatus,
      description: parsed.data.note ?? `Status manually set to ${parsed.data.shipmentStatus}`,
      location: parsed.data.location,
      source: "manual",
      timestamp: now,
    });

    res.json({ order: updated });
  } catch (e) {
    next(e);
  }
});

// ── Sync tracking data from Shiprocket ────────────────────────────────────────
router.post("/:id/sync", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, req.params.id as string))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (!order.awbCode) {
      res.status(400).json({ error: "No AWB code on this order" });
      return;
    }

    if (!isShiprocketConfigured()) {
      res.status(503).json({ error: "Shiprocket not configured" });
      return;
    }

    const tracking = await trackShipmentByAWB(order.awbCode);
    if (!tracking) {
      res.status(502).json({ error: "No tracking data returned" });
      return;
    }

    const td     = tracking.tracking_data;
    const track  = td.shipment_track?.[0];
    const acts   = td.shipment_track_activities ?? [];

    // Map Shiprocket status codes to our ShipmentStatus
    const srStatus = track?.current_status?.toLowerCase() ?? "";
    let mappedStatus: string | null = null;
    if (srStatus.includes("delivered")) mappedStatus = "delivered";
    else if (srStatus.includes("out for delivery")) mappedStatus = "out_for_delivery";
    else if (srStatus.includes("picked up") || srStatus.includes("in transit")) mappedStatus = "shipped";
    else if (srStatus.includes("delayed")) mappedStatus = "delayed";
    else if (srStatus.includes("returned") || srStatus.includes("rto")) mappedStatus = "returned";
    else if (srStatus.includes("cancelled")) mappedStatus = "cancelled";

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (mappedStatus) updates.shipmentStatus = mappedStatus;
    if (td.etd) updates.estimatedDelivery = new Date(td.etd);
    if (track?.delivered_date) updates.deliveryDate = new Date(track.delivered_date);
    if (td.track_url) updates.trackingUrl = td.track_url;

    const [updated] = await db
      .update(orders)
      .set(updates)
      .where(eq(orders.id, order.id))
      .returning();

    // Insert new activity rows (dedup by orderId+timestamp+description at app level)
    const existingEvents = await db
      .select({ ts: shipmentEvents.timestamp, desc: shipmentEvents.description })
      .from(shipmentEvents)
      .where(eq(shipmentEvents.orderId, order.id));
    const existingSet = new Set(
      existingEvents.map(e => `${new Date(e.ts).getTime()}::${e.desc}`)
    );

    for (const act of acts.slice(-10)) { // last 10 activities
      const ts  = act.date ? new Date(act.date) : now;
      const key = `${ts.getTime()}::${act.activity}`;
      if (existingSet.has(key)) continue;
      await db.insert(shipmentEvents).values({
        orderId: order.id,
        status:  mappedStatus ?? "shipped",
        description: act.activity,
        location: act.location,
        source: "shiprocket",
        timestamp: ts,
      });
    }

    res.json({ order: updated, tracking });
  } catch (e) {
    next(e);
  }
});

// ── Cancel a shipment ─────────────────────────────────────────────────────────
router.post("/:id/cancel", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, req.params.id as string))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const nonCancellable = ["delivered", "returned", "cancelled"];
    if (order.shipmentStatus && nonCancellable.includes(order.shipmentStatus)) {
      res.status(400).json({ error: "Cannot cancel a shipment in this state" });
      return;
    }

    if (order.awbCode && isShiprocketConfigured()) {
      await cancelShipmentByAWBs([order.awbCode]);
    }

    const [updated] = await db
      .update(orders)
      .set({ shipmentStatus: "cancelled", updatedAt: new Date() })
      .where(eq(orders.id, order.id))
      .returning();

    await db.insert(shipmentEvents).values({
      orderId: order.id,
      status: "cancelled",
      description: "Shipment cancelled by admin",
      source: "manual",
    });

    res.json({ order: updated });
  } catch (e) {
    next(e);
  }
});

export default router;
