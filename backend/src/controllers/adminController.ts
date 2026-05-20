import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { getLocalUser } from "../lib/users";
import { isAdmin } from "../lib/roles";
import multer from "multer";
import path from "node:path";
import { getEnv } from "../lib/env";
import { db } from "../db";
import { orderItems, products } from "../db/schema";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { deleteLocalAsset, UPLOADS_DIR } from "../lib/localUpload";

const env = getEnv();

// ── Multer (local disk upload) ────────────────────────────────────────────────

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, WebP, and GIF images are allowed"));
    }
  },
});

export const uploadMiddleware = upload.single("file");

// ── Zod schemas ───────────────────────────────────────────────────────────────

const productCreate = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1).default("General"),
  description: z.string().default(""),
  priceCents: z.number().int().positive(),
  currency: z.string().min(1).default("usd"),
  imageUrl: z
    .union([z.string().url(), z.literal("")])
    .optional()
    .nullable(),
  imageKitFileId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  active: z.boolean().default(true),
});

const productPatch = productCreate.partial();

function buildProductUpdateSet(body: z.infer<typeof productPatch>) {
  const data: Partial<typeof products.$inferInsert> = {};
  if (body.slug !== undefined) data.slug = body.slug;
  if (body.name !== undefined) data.name = body.name;
  if (body.category !== undefined) data.category = body.category;
  if (body.description !== undefined) data.description = body.description;
  if (body.priceCents !== undefined) data.priceCents = body.priceCents;
  if (body.currency !== undefined) data.currency = body.currency;
  if (body.imageUrl !== undefined) data.imageUrl = body.imageUrl === "" ? null : body.imageUrl;
  if (body.imageKitFileId !== undefined) {
    data.imageKitFileId = body.imageKitFileId === "" ? null : body.imageKitFileId;
  }
  if (body.active !== undefined) data.active = body.active;
  return data;
}

// ── Middleware ────────────────────────────────────────────────────────────────

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    let user: Awaited<ReturnType<typeof getLocalUser>> | null = null;
    try {
      user = await getLocalUser(userId);
    } catch {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (!user || !isAdmin(user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    (req as Request & { adminUser: typeof user }).adminUser = user;
    next();
  } catch (e) {
    next(e);
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/upload
 * Accepts a single "file" field (multipart/form-data), saves it to /uploads,
 * and returns { url, fileId } compatible with the existing product schema.
 */
export function uploadProductImage(req: Request, res: Response, _next: NextFunction) {
  uploadMiddleware(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: "File too large (max 10 MB)" });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No file received" });
      return;
    }

    const backendUrl = env.BACKEND_URL.replace(/\/+$/, "");
    const url = `${backendUrl}/uploads/${req.file.filename}`;
    const fileId = req.file.filename;

    res.json({ url, fileId });
  });
}

export async function listAdminProducts(_req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await db.select().from(products).orderBy(desc(products.createdAt));
    res.json({ products: rows });
  } catch (e) {
    next(e);
  }
}

export async function createAdminProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = productCreate.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const { imageUrl, imageKitFileId, ...rest } = parsed.data;

    const [row] = await db
      .insert(products)
      .values({
        ...rest,
        imageUrl: imageUrl || null,
        imageKitFileId: imageKitFileId || null,
      })
      .returning();
    res.status(201).json({ product: row });
  } catch (e) {
    next(e);
  }
}

export async function updateAdminProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = productPatch.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }

    const data = buildProductUpdateSet(parsed.data);

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [row] = await db
      .update(products)
      .set(data)
      .where(eq(products.id, req.params.id as string))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json({ product: row });
  } catch (e) {
    next(e);
  }
}

export async function deleteAdminProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const [existing] = await db.select().from(products).where(eq(products.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [countRow] = await db
      .select({ c: count() })
      .from(orderItems)
      .where(eq(orderItems.productId, id));

    if (Number(countRow?.c ?? 0) > 0) {
      res.status(409).json({
        error:
          "This product is on one or more orders and cannot be deleted. Deactivate it instead.",
      });
      return;
    }

    // Delete local upload file if it was uploaded (not an external URL)
    await deleteLocalAsset(existing.imageKitFileId);

    await db.delete(products).where(eq(products.id, id));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}
