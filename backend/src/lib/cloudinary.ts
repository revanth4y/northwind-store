import { v2 as cloudinary } from "cloudinary";
import { getEnv } from "./env";

let configured = false;

function getCld() {
  if (!configured) {
    const env = getEnv();
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}

export function isCloudinaryConfigured(): boolean {
  const env = getEnv();
  return !!(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

/**
 * Upload a file buffer to Cloudinary.
 * Returns the CDN URL and the public_id (used for deletes).
 */
export async function uploadToCloudinary(
  buffer: Buffer,
  folder = "northwind-products",
): Promise<{ url: string; publicId: string }> {
  const cld = getCld();

  return new Promise((resolve, reject) => {
    const stream = cld.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        overwrite: true,
        // Auto-select best format (WebP/AVIF) and compress
        transformation: [{ quality: "auto", fetch_format: "auto" }],
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error("Cloudinary returned no result"));
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

/**
 * Delete an asset from Cloudinary by its public_id.
 * Silently ignores missing assets so deletes are always idempotent.
 */
export async function deleteFromCloudinary(publicId: string | null | undefined): Promise<void> {
  if (!publicId) return;
  try {
    const cld = getCld();
    await cld.uploader.destroy(publicId, { resource_type: "image" });
  } catch (e) {
    // Non-fatal — log and continue
    console.error("[Cloudinary] delete failed for", publicId, e);
  }
}
