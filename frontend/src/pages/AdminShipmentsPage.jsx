/**
 * AdminShipmentsPage
 * ──────────────────
 * Admin dashboard for managing all shipments.
 * Route: /admin/shipments
 *
 * Features:
 *  - List all orders with shipment status
 *  - Filter by status
 *  - Manually update status
 *  - Sync tracking from Shiprocket
 *  - Cancel shipments
 */

import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  TruckIcon,
  RefreshCwIcon,
  PackageIcon,
  CheckCircleIcon,
  XCircleIcon,
  AlertCircleIcon,
  SearchIcon,
  MapPinIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { formatPrice } from "../utils/format";

// ── Config ────────────────────────────────────────────────────────────────────

const SHIPMENT_STATUSES = [
  { value: "",                label: "All" },
  { value: "pending",         label: "Pending" },
  { value: "processing",      label: "Processing" },
  { value: "packed",          label: "Packed" },
  { value: "shipped",         label: "Shipped" },
  { value: "out_for_delivery",label: "Out for Delivery" },
  { value: "delivered",       label: "Delivered" },
  { value: "delayed",         label: "Delayed" },
  { value: "returned",        label: "Returned" },
  { value: "cancelled",       label: "Cancelled" },
];

const STATUS_BADGE = {
  pending:          "badge-ghost",
  processing:       "badge-info",
  packed:           "badge-info",
  shipped:          "badge-primary",
  out_for_delivery: "badge-warning",
  delivered:        "badge-success",
  delayed:          "badge-warning",
  returned:         "badge-error",
  cancelled:        "badge-error",
};

const STATUS_LABEL = {
  pending:          "Pending",
  processing:       "Processing",
  packed:           "Packed",
  shipped:          "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered:        "Delivered",
  delayed:          "Delayed",
  returned:         "Returned",
  cancelled:        "Cancelled",
};

// ── Status update modal ───────────────────────────────────────────────────────

function StatusModal({ order, onClose, onSave }) {
  const [status, setStatus]     = useState(order.shipmentStatus ?? "pending");
  const [note, setNote]         = useState("");
  const [location, setLocation] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card bg-base-100 shadow-xl w-full max-w-md"
      >
        <div className="card-body p-6">
          <h3 className="font-bold text-lg mb-4">Update Shipment Status</h3>
          <p className="text-sm text-base-content/60 mb-4">
            Order <span className="font-mono">#{order.id.slice(0,8)}</span>
          </p>

          <div className="form-control gap-1 mb-3">
            <label className="label-text text-xs font-medium">Status</label>
            <select
              className="select select-bordered select-sm"
              value={status}
              onChange={e => setStatus(e.target.value)}
            >
              {SHIPMENT_STATUSES.filter(s => s.value).map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="form-control gap-1 mb-3">
            <label className="label-text text-xs font-medium">Location (optional)</label>
            <input
              className="input input-bordered input-sm"
              placeholder="e.g. Mumbai Hub"
              value={location}
              onChange={e => setLocation(e.target.value)}
            />
          </div>

          <div className="form-control gap-1 mb-5">
            <label className="label-text text-xs font-medium">Note (optional)</label>
            <textarea
              className="textarea textarea-bordered resize-none text-sm"
              rows={2}
              placeholder="Admin note about this status update"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={500}
            />
          </div>

          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-ghost btn-sm flex-1">Cancel</button>
            <button
              onClick={() => onSave({ shipmentStatus: status, note: note.trim() || undefined, location: location.trim() || undefined })}
              className="btn btn-primary btn-sm flex-1"
            >
              Save
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Shipment row ──────────────────────────────────────────────────────────────

function ShipmentRow({ shipment, onUpdateStatus, onSync, onCancel }) {
  const status      = shipment.shipmentStatus ?? "pending";
  const badgeCls    = STATUS_BADGE[status] ?? "badge-ghost";
  const label       = STATUS_LABEL[status] ?? status;
  const canCancel   = !["delivered", "returned", "cancelled"].includes(status);
  const hasAWB      = !!shipment.awbCode;
  const previewName = shipment.previewItems?.[0]?.name ?? "—";
  const moreItems   = (shipment.previewItems?.length ?? 0) - 1;

  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="hover"
    >
      <td className="font-mono text-xs">
        #{shipment.id.slice(0, 8)}
        <p className="text-base-content/40 text-[10px]">
          {new Date(shipment.createdAt).toLocaleDateString()}
        </p>
      </td>
      <td className="text-sm max-w-[160px]">
        <p className="truncate font-medium">{previewName}</p>
        {moreItems > 0 && (
          <p className="text-xs text-base-content/50">+{moreItems} more</p>
        )}
      </td>
      <td>
        <span className={`badge badge-sm ${badgeCls}`}>{label}</span>
      </td>
      <td className="text-xs">
        {shipment.courierName ?? <span className="text-base-content/30">—</span>}
        {shipment.awbCode && (
          <p className="font-mono text-[10px] text-base-content/50">{shipment.awbCode}</p>
        )}
      </td>
      <td className="text-xs">
        {shipment.estimatedDelivery
          ? new Date(shipment.estimatedDelivery).toLocaleDateString(undefined, { month: "short", day: "numeric" })
          : <span className="text-base-content/30">—</span>}
      </td>
      <td className="text-right font-semibold tabular-nums text-sm">
        {formatPrice(shipment.totalCents, "usd")}
      </td>
      <td>
        <div className="flex items-center gap-1 justify-end flex-wrap">
          <button
            onClick={() => onUpdateStatus(shipment)}
            className="btn btn-ghost btn-xs"
            title="Update status"
          >
            <PackageIcon className="size-3.5" />
          </button>
          {hasAWB && (
            <button
              onClick={() => onSync(shipment.id)}
              className="btn btn-ghost btn-xs"
              title="Sync from Shiprocket"
            >
              <RefreshCwIcon className="size-3.5" />
            </button>
          )}
          {shipment.trackingUrl && (
            <a
              href={shipment.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-xs"
              title="Track on courier site"
            >
              <ExternalLinkIcon className="size-3.5" />
            </a>
          )}
          {canCancel && (
            <button
              onClick={() => onCancel(shipment.id)}
              className="btn btn-ghost btn-xs text-error"
              title="Cancel shipment"
            >
              <XCircleIcon className="size-3.5" />
            </button>
          )}
        </div>
      </td>
    </motion.tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminShipmentsPage() {
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch]             = useState("");
  const [statusModal, setStatusModal]   = useState(null); // shipment object | null

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-shipments"],
    queryFn: () => apiFetch("/api/admin/shipments", { getToken }),
    refetchInterval: 30_000,
  });

  const { mutate: updateStatus, isPending: updatingStatus } = useMutation({
    mutationFn: ({ id, body }) => apiFetch(`/api/admin/shipments/${id}/status`, {
      getToken, method: "PATCH", body,
    }),
    onSuccess: () => {
      setStatusModal(null);
      qc.invalidateQueries({ queryKey: ["admin-shipments"] });
    },
  });

  const { mutate: syncTracking } = useMutation({
    mutationFn: (id) => apiFetch(`/api/admin/shipments/${id}/sync`, { getToken, method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-shipments"] }),
  });

  const { mutate: cancelShipment } = useMutation({
    mutationFn: (id) => apiFetch(`/api/admin/shipments/${id}/cancel`, { getToken, method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-shipments"] }),
  });

  function handleCancel(id) {
    if (window.confirm("Cancel this shipment? This cannot be undone.")) {
      cancelShipment(id);
    }
  }

  const all = data?.shipments ?? [];

  // Filter + search
  const filtered = all.filter(s => {
    const matchStatus = !filterStatus || s.shipmentStatus === filterStatus;
    const q = search.trim().toLowerCase();
    const matchSearch = !q
      || s.id.toLowerCase().includes(q)
      || (s.awbCode ?? "").toLowerCase().includes(q)
      || (s.courierName ?? "").toLowerCase().includes(q)
      || (s.previewItems ?? []).some(i => i.name.toLowerCase().includes(q));
    return matchStatus && matchSearch;
  });

  // Stats
  const stats = {
    total:    all.length,
    active:   all.filter(s => !["delivered","cancelled","returned"].includes(s.shipmentStatus ?? "pending")).length,
    delivered:all.filter(s => s.shipmentStatus === "delivered").length,
    issues:   all.filter(s => ["delayed","returned","cancelled"].includes(s.shipmentStatus ?? "")).length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <TruckIcon className="size-6 text-primary" />
          Shipments
        </h1>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["admin-shipments"] })}
          className="btn btn-ghost btn-sm gap-1.5"
        >
          <RefreshCwIcon className="size-4" />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total",     value: stats.total,     cls: "bg-base-200" },
          { label: "Active",    value: stats.active,    cls: "bg-primary/10 text-primary" },
          { label: "Delivered", value: stats.delivered, cls: "bg-success/10 text-success" },
          { label: "Issues",    value: stats.issues,    cls: "bg-error/10 text-error" },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-4 ${s.cls}`}>
            <p className="text-2xl font-bold tabular-nums">{s.value}</p>
            <p className="text-sm opacity-70">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <label className="input input-bordered input-sm flex items-center gap-2 flex-1 min-w-[200px]">
          <SearchIcon className="size-4 text-base-content/40 shrink-0" />
          <input
            type="text"
            placeholder="Search ID, AWB, courier, item…"
            className="grow"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </label>
        <select
          className="select select-bordered select-sm"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          {SHIPMENT_STATUSES.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {error && (
        <div className="alert alert-error">
          <AlertCircleIcon className="size-4" />
          Failed to load shipments.
        </div>
      )}

      {isLoading && (
        <div className="space-y-2">
          {[1,2,3,4].map(i => <div key={i} className="skeleton h-14 w-full rounded-xl" />)}
        </div>
      )}

      {!isLoading && !error && (
        <div className="overflow-x-auto rounded-xl border border-base-200">
          <table className="table table-sm w-full">
            <thead>
              <tr className="text-xs text-base-content/50">
                <th>Order</th>
                <th>Items</th>
                <th>Status</th>
                <th>Courier / AWB</th>
                <th>Est. Delivery</th>
                <th className="text-right">Total</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {filtered.map(s => (
                  <ShipmentRow
                    key={s.id}
                    shipment={s}
                    onUpdateStatus={setStatusModal}
                    onSync={syncTracking}
                    onCancel={handleCancel}
                  />
                ))}
              </AnimatePresence>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-base-content/40">
                    <TruckIcon className="size-10 mx-auto mb-2 opacity-20" />
                    No shipments found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Status update modal */}
      <AnimatePresence>
        {statusModal && (
          <StatusModal
            order={statusModal}
            onClose={() => setStatusModal(null)}
            onSave={(body) => updateStatus({ id: statusModal.id, body })}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
