/**
 * Polar webhook handler
 * ─────────────────────
 * Polar signs events using HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{body}`.
 * The key is the full POLAR_WEBHOOK_SECRET value (including the "polar_whs_" prefix)
 * treated as a UTF-8 string — NOT base64-decoded.
 *
 * Supported events
 *   order.paid → fulfil the pending checkout session → create order + order_items rows
 */

import type { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "../lib/env.js";
import { checkoutSessions, orderItems, orders, products, shipmentEvents } from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  isShiprocketConfigured,
  createShiprocketOrder,
  generateAWB,
  buildShiprocketPayload,
} from "../lib/shiprocket.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function headerString(headers: Request["headers"], name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function checkoutSessionIdFromMetadata(order: Record<string, unknown>) {
  const metadata = order.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const sessionId = (metadata as Record<string, unknown>).checkout_session_id;
  return typeof sessionId === "string" ? sessionId : undefined;
}

/**
 * Verify the standardwebhooks HMAC-SHA256 signature.
 *
 * Polar's signing key is the full secret string (UTF-8), NOT base64-decoded.
 * The signed content is: `{id}.{timestamp}.{rawBody}`
 * Each incoming sig token has the form `v1,<base64-hmac>`.
 */
function verifyPolarSignature(
  secret: string,
  id: string,
  ts: string,
  rawBody: Buffer,
  sigHeader: string,
): boolean {
  const keyBuf = Buffer.from(secret, "utf8");
  const signedContent = Buffer.concat([Buffer.from(`${id}.${ts}.`), rawBody]);
  const expected = createHmac("sha256", keyBuf).update(signedContent).digest("base64");
  const expectedBuf = Buffer.from(`v1,${expected}`);

  for (const token of sigHeader.split(" ")) {
    const tok = token.trim();
    if (!tok) continue;
    try {
      const tokBuf = Buffer.from(tok);
      if (tokBuf.length === expectedBuf.length && timingSafeEqual(tokBuf, expectedBuf)) {
        return true;
      }
    } catch {
      // buffer length mismatch — not a match
    }
  }
  return false;
}

async function alreadyPaid(polarOrderId?: string, checkoutId?: string) {
  if (polarOrderId) {
    const [row] = await db
      .select()
      .from(orders)
      .where(eq(orders.polarOrderId, polarOrderId))
      .limit(1);
    if (row?.status === "paid") return true;
  }
  if (checkoutId) {
    const [row] = await db
      .select()
      .from(orders)
      .where(eq(orders.polarCheckoutId, checkoutId))
      .limit(1);
    if (row?.status === "paid") return true;
  }
  return false;
}

async function fulfillCheckoutSession(
  sessionId: string,
  polarOrderId: string | undefined,
  checkoutId: string | undefined,
): Promise<{ success: boolean; orderId?: string }> {
  const result = await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, sessionId))
      .for("update");

    if (!session) {
      console.warn("[polar-webhook] checkout session not found:", sessionId);
      return { success: false };
    }

    const [order] = await tx
      .insert(orders)
      .values({
        userId: session.userId,
        status: "paid",
        totalCents: session.totalCents,
        polarCheckoutId: checkoutId ?? session.polarCheckoutId ?? null,
        shippingAddress: session.shippingAddress ?? null,
        shipmentStatus: "pending",
        ...(polarOrderId ? { polarOrderId } : {}),
      })
      .returning();

    if (session.lines.length) {
      await tx.insert(orderItems).values(
        session.lines.map((line) => ({
          orderId: order.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
        })),
      );
    }

    // Seed the shipment event log
    await tx.insert(shipmentEvents).values({
      orderId: order.id,
      status: "pending",
      description: "Order placed and payment confirmed",
      source: "system",
    });

    await tx.delete(checkoutSessions).where(eq(checkoutSessions.id, sessionId));

    console.log(
      `[polar-webhook] ✅ order created — orderId=${order.id} userId=${session.userId} totalCents=${session.totalCents}`,
    );

    return { success: true, orderId: order.id, session };
  }) as { success: boolean; orderId?: string; session?: typeof checkoutSessions.$inferSelect };

  // ── Async Shiprocket fulfillment (non-blocking) ─────────────────────────────
  if (result.success && result.orderId && isShiprocketConfigured()) {
    const orderId   = result.orderId;
    const session   = result.session!;

    setImmediate(async () => {
      try {
        // Load product names for line items
        const productIds = session.lines.map(l => l.productId);
        const productRows = await db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(inArray(products.id, productIds));
        const nameMap = new Map(productRows.map(p => [p.id, p.name]));

        const shipping = session.shippingAddress;
        if (!shipping) {
          console.warn(`[shiprocket] orderId=${orderId} — no shipping address, skipping`);
          return;
        }

        const payload = buildShiprocketPayload({
          orderId,
          orderDate: new Date(),
          items: session.lines.map(l => ({
            name:          nameMap.get(l.productId) ?? "Product",
            sku:           l.productId.slice(0, 8),
            quantity:      l.quantity,
            unitPriceCents: l.unitPriceCents,
          })),
          shipping,
          totalCents: session.totalCents,
        });

        const created = await createShiprocketOrder(payload);
        if (!created) return;

        console.log(`[shiprocket] order created — shiprocketOrderId=${created.order_id} shipmentId=${created.shipment_id}`);

        await db.update(orders).set({
          shiprocketOrderId:   String(created.order_id),
          shiprocketShipmentId: String(created.shipment_id),
          shipmentStatus:      "processing",
          updatedAt:           new Date(),
        }).where(eq(orders.id, orderId));

        await db.insert(shipmentEvents).values({
          orderId,
          status: "processing",
          description: "Shipment created in courier system",
          source: "shiprocket",
        });

        // Auto-assign AWB
        const awbRes = await generateAWB(created.shipment_id);
        if (awbRes?.awb_assign_status === 1) {
          const d = awbRes.response.data;
          await db.update(orders).set({
            awbCode:         d.awb_code,
            courierName:     d.courier_name,
            courierPartnerId: String(d.courier_company_id),
            trackingUrl:     `https://shiprocket.co/tracking/${d.awb_code}`,
            shipmentStatus:  "shipped",
            shipmentCreatedAt: new Date(),
            updatedAt:       new Date(),
          }).where(eq(orders.id, orderId));

          await db.insert(shipmentEvents).values({
            orderId,
            status: "shipped",
            description: `AWB ${d.awb_code} assigned · ${d.courier_name}`,
            source: "shiprocket",
          });

          console.log(`[shiprocket] ✅ AWB assigned — ${d.awb_code} via ${d.courier_name}`);
        }
      } catch (err) {
        console.error("[shiprocket] async fulfillment error:", err);
      }
    });
  }

  return { success: result.success, orderId: result.orderId };
}

// ── handler ───────────────────────────────────────────────────────────────────

export async function polarWebhookHandler(req: Request, res: Response) {
  const env = getEnv();

  if (!env.POLAR_WEBHOOK_SECRET) {
    console.warn("[polar-webhook] POLAR_WEBHOOK_SECRET is not set — rejecting request");
    res.status(503).json({ error: "Polar webhooks not configured" });
    return;
  }

  try {
    const raw = req.body instanceof Buffer ? req.body : Buffer.from(String(req.body));

    const id = headerString(req.headers, "webhook-id");
    const ts = headerString(req.headers, "webhook-timestamp");
    const sig = headerString(req.headers, "webhook-signature");

    if (!id || !ts || !sig) {
      console.warn("[polar-webhook] missing signature headers", { id: !!id, ts: !!ts, sig: !!sig });
      res.status(400).json({ error: "Missing webhook headers" });
      return;
    }

    // ── Signature verification ────────────────────────────────────────────────
    if (!verifyPolarSignature(env.POLAR_WEBHOOK_SECRET, id, ts, raw, sig)) {
      console.error("[polar-webhook] ❌ signature verification failed");
      res.status(400).json({ error: "Invalid webhook signature" });
      return;
    }

    // ── Parse event ───────────────────────────────────────────────────────────
    const event = JSON.parse(raw.toString("utf8")) as {
      type: string;
      data?: Record<string, unknown>;
    };

    console.log(`[polar-webhook] received event type="${event.type}" webhook-id="${id}"`);

    // ── Handle order.paid ─────────────────────────────────────────────────────
    if (event.type === "order.paid" && event.data) {
      const data = event.data;
      const polarOrderId = typeof data.id === "string" ? data.id : undefined;
      const checkoutId = typeof data.checkout_id === "string" ? data.checkout_id : undefined;
      const sessionId = checkoutSessionIdFromMetadata(data);

      console.log(
        `[polar-webhook] order.paid — polarOrderId=${polarOrderId ?? "n/a"} checkoutId=${checkoutId ?? "n/a"} sessionId=${sessionId ?? "n/a"}`,
      );

      if (await alreadyPaid(polarOrderId, checkoutId)) {
        console.log("[polar-webhook] duplicate order.paid — already fulfilled, ignoring");
        res.json({ ok: true, duplicate: true });
        return;
      }

      if (!sessionId) {
        console.error("[polar-webhook] order.paid missing checkout_session_id in metadata", data);
        res.status(400).json({ error: "Missing checkout_session_id in metadata" });
        return;
      }

      const result = await fulfillCheckoutSession(sessionId, polarOrderId, checkoutId);

      if (result.success) {
        res.json({ ok: true, orderId: result.orderId });
        return;
      }

      if (await alreadyPaid(polarOrderId, checkoutId)) {
        console.log("[polar-webhook] race-condition duplicate — already fulfilled");
        res.json({ ok: true, duplicate: true });
        return;
      }

      console.error("[polar-webhook] ❌ fulfillCheckoutSession returned false", {
        sessionId,
        polarOrderId,
        checkoutId,
      });
      res.status(500).json({ error: "Checkout fulfillment failed" });
      return;
    }

    console.log(`[polar-webhook] unhandled event type="${event.type}" — acknowledged`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[polar-webhook] unexpected error:", err);
    res.status(400).json({ error: "Webhook processing error" });
  }
}
