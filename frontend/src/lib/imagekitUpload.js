const raw = import.meta.env.VITE_API_URL;
const base = typeof raw === "string" ? raw.replace(/\/+$/, "") : "http://localhost:3001";

/**
 * Uploads a product image to the local backend (/api/admin/upload).
 * Returns { url, fileId } — same shape as the old ImageKit uploader.
 */
export async function uploadImageToImageKit(file, getToken, _opts = {}) {
  const token = getToken ? await getToken() : null;

  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${base}/api/admin/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error ?? "Upload failed");
  }

  return { url: data.url, fileId: data.fileId ?? null };
}
