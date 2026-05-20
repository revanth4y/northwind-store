/**
 * ConfirmModal
 * ─────────────
 * Reusable DaisyUI modal for destructive/important confirmations.
 * Renders a backdrop click / ESC close via the native <dialog> element.
 */

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * @param {{
 *   isOpen: boolean,
 *   title: string,
 *   description?: string,
 *   confirmLabel?: string,
 *   confirmClass?: string,
 *   loading?: boolean,
 *   onConfirm: () => void,
 *   onCancel: () => void,
 *   children?: React.ReactNode,   // extra content (e.g. textarea for note)
 * }} props
 */
export function ConfirmModal({
  isOpen,
  title,
  description,
  confirmLabel = "Confirm",
  confirmClass = "btn-primary",
  loading = false,
  onConfirm,
  onCancel,
  children,
}) {
  const dialogRef = useRef(null);

  // Sync open/close with the native dialog element
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (isOpen) {
      if (!el.open) el.showModal();
    } else {
      if (el.open) el.close();
    }
  }, [isOpen]);

  // Close on ESC (native dialog handles this, but we need to sync state)
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handler = () => onCancel();
    el.addEventListener("cancel", handler);
    return () => el.removeEventListener("cancel", handler);
  }, [onCancel]);

  return (
    <dialog ref={dialogRef} className="modal">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="modal-box max-w-md"
          >
            <h3 className="text-lg font-bold">{title}</h3>
            {description && (
              <p className="mt-2 text-sm text-base-content/70">{description}</p>
            )}

            {children && <div className="mt-4">{children}</div>}

            <div className="modal-action mt-6">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onCancel}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${confirmClass}`}
                onClick={onConfirm}
                disabled={loading}
              >
                {loading && <span className="loading loading-spinner loading-sm" />}
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Backdrop */}
      <form method="dialog" className="modal-backdrop">
        <button type="submit" onClick={onCancel}>close</button>
      </form>
    </dialog>
  );
}
