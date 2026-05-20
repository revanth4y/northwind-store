import { getAuth } from "@clerk/express";
import type { NextFunction, Response, Request } from "express";
import { getLocalUser } from "../lib/users";
import { isStaff } from "../lib/roles";
import { db } from "../db";
import { orderItems, orders, products, shipmentEvents } from "../db/schema";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { trackShipmentByAWB, cancelShipmentByAWBs, isShiprocketConfigured } from "../lib/shiprocket";

// ── List orders ───────────────────────────────────────────────────────────────
export async function listOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res.status(503).json({ error: "Account not synced yet" });
      return;
    }

    const rows = isStaff(localUser.role)
      ? await db.select().from(orders).orderBy(desc(orders.createdAt))
      : await db
          .select()
          .from(orders)
          .where(eq(orders.userId, localUser.id))
          .orderBy(desc(orders.createdAt));

    const orderIds = rows.map((r) => r.id);
    const previewByOrder = new Map<string, object[]>();

    if (orderIds.length > 0) {
      const itemRows = await db
        .select({
          orderId: orderItems.orderId,
          quantity: orderItems.quantity,
          name: products.name,
          slug: products.slug,
          imageUrl: products.imageUrl,
        })
        .from(orderItems)
        .innerJoin(products, eq(orderItems.productId, products.id))
        .where(inArray(orderItems.orderId, orderIds))
        .orderBy(asc(orderItems.id));

      for (const row of itemRows) {
        const list = previewByOrder.get(row.orderId) ?? [];
        list.push({
          name: row.name,
          slug: row.slug,
          imageUrl: row.imageUrl,
          quantity: row.quantity,
        });
        previewByOrder.set(row.orderId, list);
      }
    }

    const ordersPayload = rows.map((o) => ({
      ...o,
      previewItems: previewByOrder.get(o.id) ?? [],
    }));

    res.json({ orders: ordersPayload });
  } catch (e) {
    next(e);
  }
}

// ── Get single order ──────────────────────────────────────────────────────────
export async function getOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res.status(503).json({ error: "Account not synced yet" });
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

    const canAccess = order.userId === localUser.id || isStaff(localUser.role);
    if (!canAccess) {
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

    res.json({ order, items });
  } catch (e) {
    next(e);
  }
}

// ── Get shipment tracking ─────────────────────────────────────────────────────
export async function getOrderTracking(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res.status(503).json({ error: "Account not synced yet" });
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

    const canAccess = order.userId === localUser.id || isStaff(localUser.role);
    if (!canAccess) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Load stored shipment events from DB
    const events = await db
      .select()
      .from(shipmentEvents)
      .where(eq(shipmentEvents.orderId, order.id))
      .orderBy(asc(shipmentEvents.timestamp));

    // If AWB exists and Shiprocket is configured, fetch live tracking data
    let liveTracking = null;
    if (order.awbCode && isShiprocketConfigured()) {
      try {
        liveTracking = await trackShipmentByAWB(order.awbCode);
      } catch (err) {
        console.error("[tracking] failed to fetch live data:", err);
      }
    }

    res.json({ order, events, liveTracking });
  } catch (e) {
    next(e);
  }
}

// ── Cancel shipment (customer) ────────────────────────────────────────────────
export async function cancelOrderShipment(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res.status(503).json({ error: "Account not synced yet" });
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

    const canAccess = order.userId === localUser.id || isStaff(localUser.role);
    if (!canAccess) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Only allow cancellation before shipment is shipped
    const nonCancellable = ["shipped", "out_for_delivery", "delivered", "returned", "cancelled"];
    if (order.shipmentStatus && nonCancellable.includes(order.shipmentStatus)) {
      res.status(400).json({ error: "Shipment cannot be cancelled at this stage" });
      return;
    }

    if (order.awbCode && isShiprocketConfigured()) {
      await cancelShipmentByAWBs([order.awbCode]);
    }

    await db.update(orders).set({
      shipmentStatus: "cancelled",
      updatedAt: new Date(),
    }).where(eq(orders.id, order.id));

    await db.insert(shipmentEvents).values({
      orderId: order.id,
      status: "cancelled",
      description: `Shipment cancelled by ${localUser.displayName ?? localUser.email}`,
      source: isStaff(localUser.role) ? "manual" : "system",
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}
