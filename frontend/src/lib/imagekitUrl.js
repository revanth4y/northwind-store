/**
 * Previously contained ImageKit URL transformation helpers.
 * Now that images are served from local storage, all URLs are returned as-is.
 * Export names are kept identical so no other file needs updating.
 */

/**
 * Returns the image URL unchanged (no CDN transforms needed for local storage).
 * @param {string | null | undefined} url
 * @returns {string | undefined}
 */
export function imageKitOptimizedUrl(url, _opts = {}) {
  return url ?? undefined;
}

/**
 * Returns the image URL unchanged (watermarking not available for local storage).
 * @param {string | null | undefined} url
 * @returns {string | undefined}
 */
export function imageKitWatermarkedUrl(url, _opts = {}) {
  return url ?? undefined;
}

/**
 * Legacy preset constants — kept for import compatibility.
 * Values are ignored; local images are displayed at their native size via CSS.
 */
export const IK_PRESETS = {
  catalogCard:    {},
  productHero:    {},
  adminThumb:     {},
  cartThumb:      {},
  orderLineThumb: {},
  orderPreviewMd: {},
  orderPreviewLg: {},
  formPreview:    {},
};
