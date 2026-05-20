import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),

  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().optional(),

  FRONTEND_URL: z.string().url(),
  /** Public-facing backend origin used to build uploaded-image URLs. */
  BACKEND_URL: z.string().url().default("http://localhost:3001"),

  POLAR_ACCESS_TOKEN: z.string().optional(),
  POLAR_WEBHOOK_SECRET: z.string().optional(),
  POLAR_API_BASE: z.string().url().default("https://api.polar.sh"),

  POLAR_CHECKOUT_PRODUCT_ID: z.string().min(1),

  SENTRY_DSN: z.string().url().optional(),

  // ── Shiprocket (optional — logistics disabled when absent) ─────────────────
  SHIPROCKET_EMAIL:           z.string().email().optional(),
  SHIPROCKET_PASSWORD:        z.string().optional(),
  SHIPROCKET_PICKUP_LOCATION: z.string().optional().default("Primary"),
  SHIPROCKET_SELLER_NAME:     z.string().optional().default("Northwind Store"),
  SHIPROCKET_SELLER_PHONE:    z.string().optional().default("9999999999"),

  // ── ImageKit (optional — image uploads disabled when absent) ───────────────
  IMAGEKIT_PUBLIC_KEY:  z.string().optional(),
  IMAGEKIT_PRIVATE_KEY: z.string().optional(),
  IMAGEKIT_URL_ENDPOINT: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }

  return parsed.data;
}

let cachedEnv: Env | null = null;

export function getEnv() {
  if (!cachedEnv) {
    cachedEnv = loadEnv();
  }
  return cachedEnv;
}
