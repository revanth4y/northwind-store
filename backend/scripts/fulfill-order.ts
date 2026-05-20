/**
 * One-time script to manually fulfill a Polar order when the webhook failed.
 * Usage: npx tsx scripts/fulfill-order.ts
 */
import "dotenv/config";
import { db } from "../src/db/index.js";
import { checkoutSessions, orderItems, orders } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

const SESSION_ID   = "0afc0af4-ec08-44c6-86f5-2f01637f2734";
const POLAR_ORDER  = "b0de2c62-e433-4422-b28d-48890f6baa99";
const CHECKOUT_ID  = "a217300a-f920-42f9-a6a2-2e37d12bfa63";

async function main() {
  console.log("Looking up checkout session:", SESSION_ID);

  const [session] = await db
    .select()
    .from(checkoutSessions)
    .where(eq(checkoutSessions.id, SESSION_ID));

  if (!session) {
    console.error("❌ Checkout session not found — may have already been fulfilled.");
    process.exit(1);
  }

  console.log("✅ Session found:", {
    userId: session.userId,
    totalCents: session.totalCents,
    lines: session.lines.length,
  });

  const result = await db.transaction(async (tx) => {
    const [order] = await tx
      .insert(orders)
      .values({
        userId: session.userId,
        status: "paid",
        totalCents: session.totalCents,
        polarCheckoutId: CHECKOUT_ID,
        polarOrderId: POLAR_ORDER,
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

    await tx.delete(checkoutSessions).where(eq(checkoutSessions.id, SESSION_ID));

    return order;
  });

  console.log("🎉 Order fulfilled successfully!");
  console.log("   orderId   :", result.id);
  console.log("   userId    :", result.userId);
  console.log("   total     :", result.totalCents, "cents ($" + (result.totalCents / 100).toFixed(2) + ")");
  console.log("   status    :", result.status);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Script failed:", err);
  process.exit(1);
});
