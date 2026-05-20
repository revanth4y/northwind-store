import fs from "node:fs/promises";
import path from "node:path";

export const UPLOADS_DIR = path.join(process.cwd(), "uploads");

/**
 * Deletes a locally-stored upload file by its stored filename (imageKitFileId column).
 * Silently ignores missing files so deletes are always idempotent.
 */
export async function deleteLocalAsset(filename: string | null | undefined) {
  if (!filename) return;
  try {
    await fs.unlink(path.join(UPLOADS_DIR, filename));
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    // file already gone — that's fine
  }
}
