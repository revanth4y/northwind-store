import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { createClerkClient } from "@clerk/backend";
import { getEnv } from "./env.js";

export async function getLocalUser(clerkUserId: string) {
  const [row] = await db.select().from(users).where(eq(users.clerkUserId, clerkUserId)).limit(1);
  return row;
}

/**
 * Returns the local DB user for a Clerk user ID.
 * If the row doesn't exist yet (webhook not configured / first-time dev setup),
 * it fetches the profile from Clerk and upserts the row automatically.
 */
export async function getOrCreateLocalUser(clerkUserId: string) {
  const existing = await getLocalUser(clerkUserId);
  if (existing) return existing;

  console.log(`[users] local user not found for ${clerkUserId} — fetching from Clerk and creating`);

  const env = getEnv();
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  const clerkUser = await clerk.users.getUser(clerkUserId);

  const email =
    clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
      ?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    "";

  const displayName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    clerkUser.username ||
    null;

  const [created] = await db
    .insert(users)
    .values({ clerkUserId, email, displayName, role: "customer" })
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: { email, displayName, updatedAt: new Date() },
    })
    .returning();

  console.log(`[users] ✅ local user created: id=${created.id} email=${email}`);
  return created;
}
