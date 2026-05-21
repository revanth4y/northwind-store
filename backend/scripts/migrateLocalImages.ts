/**
 * migrateLocalImages.ts
 *
 * Finds every product whose imageUrl points to a local /uploads/ path,
 * uploads the file to Cloudinary, then updates imageUrl + imageKitFileId
 * in PostgreSQL with the permanent Cloudinary URL.
 *
 * Safe to re-run: products that already have a Cloudinary URL are skipped.
 *
 * Usage:
 *   npx tsx scripts/migrateLocalImages.ts
 *
 * Requires env:
 *   DATABASE_URL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 */

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { v2 as cloudinary } from "cloudinary";
import { products } from "../src/db/schema.js";
import { eq, like, or } from "drizzle-orm";

// ── DB ────────────────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// ── Cloudinary ────────────────────────────────────────────────────────────────

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const CLOUDINARY_FOLDER = "northwind-products";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Upload a Buffer to Cloudinary and return { url, publicId }. */
function uploadBuffer(
  buffer: Buffer,
  publicId: string,
): Promise<{ url: string; publicId: string }> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        public_id: publicId,
        resource_type: "image",
        overwrite: true,
        transformation: [{ quality: "auto", fetch_format: "auto" }],
      },
      (err, result) => {
        if (err) return reject(err);
        if (!result) return reject(new Error("Cloudinary returned no result"));
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    ).end(buffer);
  });
}

/**
 * Extract the filename from a local imageUrl.
 * Handles both:
 *   http://localhost:3001/uploads/1778776981868-jveftp.jpg
 *   https://northwind-store-9kn2.onrender.com/uploads/1778776981868-jveftp.jpg
 */
function extractLocalFilename(imageUrl: string): string | null {
  const match = imageUrl.match(/\/uploads\/([^/?#]+)$/);
  return match ? match[1] : null;
}

function isLocalImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes("/uploads/");
}

function isCloudinaryUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes("res.cloudinary.com");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🔍  Scanning for products with local image paths…\n");

  // Fetch all products that might have a local URL
  const allProducts = await db.select().from(products);

  const localProducts = allProducts.filter(
    (p) => isLocalImageUrl(p.imageUrl) && !isCloudinaryUrl(p.imageUrl),
  );

  // Also find products where imageKitFileId is a local filename (no slash = plain filename)
  const localFileIdProducts = allProducts.filter(
    (p) =>
      p.imageKitFileId &&
      !p.imageKitFileId.includes("/") &&       // not a Cloudinary public_id (folder/name)
      !isCloudinaryUrl(p.imageUrl) &&
      !localProducts.find((lp) => lp.id === p.id), // not already in localProducts
  );

  const toMigrate = [...localProducts, ...localFileIdProducts];

  if (toMigrate.length === 0) {
    console.log("✅  No local images found — nothing to migrate.\n");
    await pool.end();
    return;
  }

  console.log(`Found ${toMigrate.length} product(s) with local images:\n`);
  for (const p of toMigrate) {
    console.log(`  • [${p.slug}]  imageUrl=${p.imageUrl ?? "—"}  fileId=${p.imageKitFileId ?? "—"}`);
  }
  console.log();

  // Also scan the uploads directory for orphan files not linked to any product
  let uploadFiles: string[] = [];
  try {
    const entries = await fs.readdir(UPLOADS_DIR);
    uploadFiles = entries.filter((f) => f !== ".gitkeep" && !f.startsWith("."));
  } catch {
    console.warn(`  ⚠️  Could not read uploads dir (${UPLOADS_DIR}) — skipping orphan scan`);
  }

  console.log(`📂  Files in uploads/: ${uploadFiles.length === 0 ? "(none)" : uploadFiles.join(", ")}\n`);

  let migrated = 0;
  let failed = 0;
  let skipped = 0;

  // ── Migrate products with local imageUrl ──────────────────────────────────

  for (const product of toMigrate) {
    const filename =
      (product.imageUrl ? extractLocalFilename(product.imageUrl) : null) ??
      product.imageKitFileId ??
      null;

    if (!filename) {
      console.log(`  ⏭  [${product.slug}] — no filename to derive; skipping`);
      skipped++;
      continue;
    }

    const filePath = path.join(UPLOADS_DIR, filename);

    // Check file exists
    try {
      await fs.access(filePath);
    } catch {
      console.warn(`  ⚠️  [${product.slug}] — file not found: ${filePath}`);
      failed++;
      continue;
    }

    // Read file
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch (e) {
      console.error(`  ✗  [${product.slug}] — could not read file: ${e}`);
      failed++;
      continue;
    }

    // Generate a stable Cloudinary public_id from the slug
    const publicId = `${product.slug}-${Date.now()}`;

    // Upload to Cloudinary
    let cloudUrl: string;
    let cloudPublicId: string;
    try {
      const result = await uploadBuffer(buffer, publicId);
      cloudUrl = result.url;
      cloudPublicId = result.publicId;
      console.log(`  ☁️  [${product.slug}] — uploaded → ${cloudUrl}`);
    } catch (e) {
      console.error(`  ✗  [${product.slug}] — Cloudinary upload failed: ${e}`);
      failed++;
      continue;
    }

    // Update DB
    try {
      await db
        .update(products)
        .set({ imageUrl: cloudUrl, imageKitFileId: cloudPublicId })
        .where(eq(products.id, product.id));
      console.log(`  ✅  [${product.slug}] — DB updated`);
      migrated++;
    } catch (e) {
      console.error(`  ✗  [${product.slug}] — DB update failed: ${e}`);
      failed++;
    }
  }

  // ── Handle orphan files (in uploads/ but not linked to any product) ────────

  const linkedFilenames = new Set(
    toMigrate.map((p) =>
      p.imageUrl ? extractLocalFilename(p.imageUrl) : p.imageKitFileId,
    ).filter(Boolean),
  );

  const orphans = uploadFiles.filter((f) => !linkedFilenames.has(f));

  if (orphans.length > 0) {
    console.log(`\n⚠️  Orphan files (in uploads/ but not linked to any product):`);
    for (const f of orphans) {
      console.log(`   • ${f} — uploading to Cloudinary as orphan…`);
      try {
        const buf = await fs.readFile(path.join(UPLOADS_DIR, f));
        const result = await uploadBuffer(buf, `orphan-${path.parse(f).name}`);
        console.log(`     → ${result.url}  (public_id: ${result.publicId})`);
        console.log(`     ℹ️  Assign this URL manually to a product in the admin panel.`);
      } catch (e) {
        console.error(`     ✗ upload failed: ${e}`);
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Migrated  : ${migrated}
  Skipped   : ${skipped}
  Failed    : ${failed}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${migrated > 0 ? "  ✔  Image migration complete.\n  Run migrateLocalProducts.ts if you haven't already." : "  ℹ️  Nothing to migrate."}
`);

  await pool.end();
}

main().catch((e) => {
  console.error("Migration failed:", e);
  pool.end();
  process.exit(1);
});
