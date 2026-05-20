/**
 * TrackOrderPage
 * ──────────────
 * Amazon/Flipkart-style shipment tracking page.
 * Route: /orders/:id/track
 */

import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { motion } from "framer-motion";
import {
  ArrowLeftIcon,
  PackageIcon,
  TruckIcon,
  CheckCircleIcon,
  ClockIcon,
  MapPinIcon,
  AlertCircleIcon,
  XCircleIcon,
  RefreshCwIcon,
  PhoneIcon,
  HomeIcon,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { formatPrice } from "../utils/format";

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_STEPS = [
  { key: "pending",          label: "Order Placed",      icon: PackageIcon },
  { key: "processing",       label: "Processing",        icon: ClockIcon },
  { key: "packed",           label: "Packed",            icon: PackageIcon },
  { key: "shipped",          label: "Shipped",           icon: TruckIcon },
  { key: "out_for_delivery", label: "Out for Delivery",  icon: TruckIcon },
  { key: "delivered",        label: "Delivered",         icon: CheckCircleIcon },
];

const STATUS_ORDER = STATUS_STEPS.map(s => s.key);

const STATUS_LABEL = {
  pending:          "Order Placed",
  processing:       "Processing",
  packed:           "Packed",
  shipped:          "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered:        "Delivered",
  delayed:          "Delayed",
  returned:         "Returned",
  cancelled:        "Cancelled",
};

const STATUS_COLOR = {
  pending:          "text-base-content/60",
  processing:       "text-info",
  packed:           "text-info",
  shipped:          "text-primary",
  out_for_delivery: "text-warning",
  delivered:        "text-success",
  delayed:          "text-warning",
  returned:         "text-error",
  cancelled:        "text-error",
};

function stepIndex(status) {
  const idx = STATUS_ORDER.indexOf(status);
  return idx === -1 ? 0 : idx;
}

// ── Progress stepper ───────────────────────────────────────────────────────────

function ProgressStepper({ status }) {
  const current = stepIndex(status);
  const isTerminal = ["cancelled", "returned"].includes(status);

  if (isTerminal) {
    return (
      <div className={`flex items-center gap-2 rounded-xl px-4 py-3 ${status === "cancelled" ? "bg-error/10" : "bg-warning/10"}`}>
        <XCircleIcon className={`size-5 ${status === "cancelled" ? "text-error" : "text-warning"}`} />
        <span className={`font-semibold ${status === "cancelled" ? "text-error" : "text-warning"}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>
    );
  }

  return (
    <div className="relative flex items-start justify-between gap-0 overflow-x-auto pb-2">
      {STATUS_STEPS.map((step, i) => {
        const done    = i < current;
        const active  = i === current;
        const Icon    = step.icon;
        return (
          <div key={step.key} className="flex flex-1 flex-col items-center gap-1 min-w-[64px]">
            {/* connector line */}
            <div className="flex w-full items-center">
              <div className={`h-0.5 flex-1 transition-colors ${i === 0 ? "invisible" : done || active ? "bg-primary" : "bg-base-300"}`} />
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                className={`flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors
                  ${done   ? "border-primary bg-primary text-primary-content"
                  : active ? "border-primary bg-base-100 text-primary"
                           : "border-base-300 bg-base-100 text-base-content/30"}`}
              >
                <Icon className="size-4" />
              </motion.div>
              <div className={`h-0.5 flex-1 transition-colors ${i === STATUS_STEPS.length - 1 ? "invisible" : done ? "bg-primary" : "bg-base-300"}`} />
            </div>
            <span className={`text-center text-[10px] leading-tight font-medium
              ${active ? "text-primary" : done ? "text-base-content/70" : "text-base-content/30"}`}>
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Timeline row ───────────────────────────────────────────────────────────────

function TimelineRow({ event, isLast }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <div className="size-2.5 rounded-full bg-primary" />
        </div>
        {!isLast && <div className="mt-1 w-0.5 flex-1 bg-base-300" />}
      </div>
      <div className="pb-4 min-w-0 flex-1 pt-1">
        <p className="text-sm font-medium text-base-content">{event.description}</p>
        {event.location && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-base-content/50">
            <MapPinIcon className="size-3" />
            {event.location}
          </p>
        )}
        <p className="mt-0.5 text-xs text-base-content/40">
          {new Date(event.timestamp).toLocaleString(undefined, {
            month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TrackOrderPage() {
  const { id } = useParams();
  const { getToken, isSignedIn } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["order-tracking", id],
    queryFn: () => apiFetch(`/api/orders/${id}/tracking`, { getToken }),
    enabled: isSignedIn && !!id,
    refetchInterval: 60_000, // auto-refresh every minute
  });

  const { mutate: cancelShipment, isPending: cancelling } = useMutation({
    mutationFn: () => apiFetch(`/api/orders/${id}/cancel-shipment`, { getToken, method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order-tracking", id] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  if (!isSignedIn) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-base-content/60">Sign in to track your order.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="skeleton h-8 w-40" />
        <div className="skeleton h-32 w-full rounded-2xl" />
        <div className="skeleton h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !data?.order) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="alert alert-error">
          <AlertCircleIcon className="size-4" />
          {error?.message ?? "Order not found."}
        </div>
      </div>
    );
  }

  const { order, events } = data;
  const status = order.shipmentStatus ?? "pending";
  const canCancel = !["shipped", "out_for_delivery", "delivered", "returned", "cancelled"].includes(status);
  const isDelivered = status === "delivered";

  // Reverse-sort for display (newest first)
  const sortedEvents = [...(events ?? [])].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Back */}
      <Link to={`/orders/${id}`} className="btn btn-ghost btn-sm gap-1.5 pl-0">
        <ArrowLeftIcon className="size-4" />
        Back to order
      </Link>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="card bg-base-100 shadow-sm"
      >
        <div className="card-body p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">Track Shipment</h1>
              <p className="mt-0.5 text-xs text-base-content/50">
                Order ID: <span className="font-mono">{id.slice(0, 8)}…</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${STATUS_COLOR[status] ?? ""}`}>
                {STATUS_LABEL[status] ?? status}
              </span>
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="btn btn-ghost btn-xs btn-square"
                title="Refresh"
              >
                <RefreshCwIcon className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Progress stepper */}
          <div className="mt-6">
            <ProgressStepper status={status} />
          </div>

          {/* Courier info */}
          {(order.awbCode || order.courierName) && (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 text-sm">
              {order.courierName && (
                <div>
                  <p className="text-xs text-base-content/50">Courier</p>
                  <p className="font-medium">{order.courierName}</p>
                </div>
              )}
              {order.awbCode && (
                <div>
                  <p className="text-xs text-base-content/50">AWB / Tracking #</p>
                  <p className="font-mono font-medium text-xs">{order.awbCode}</p>
                </div>
              )}
              {order.estimatedDelivery && (
                <div>
                  <p className="text-xs text-base-content/50">Est. Delivery</p>
                  <p className="font-medium">
                    {new Date(order.estimatedDelivery).toLocaleDateString(undefined, {
                      month: "short", day: "numeric",
                    })}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Delivered banner */}
          {isDelivered && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-success/10 px-4 py-2.5 text-sm text-success">
              <CheckCircleIcon className="size-4 shrink-0" />
              <span>
                Delivered
                {order.deliveryDate
                  ? ` on ${new Date(order.deliveryDate).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`
                  : ""}
              </span>
            </div>
          )}

          {/* External tracking link */}
          {order.trackingUrl && (
            <a
              href={order.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline btn-sm mt-4 gap-1.5 w-fit"
            >
              <TruckIcon className="size-3.5" />
              Track on courier site
            </a>
          )}

          {/* Cancel button */}
          {canCancel && (
            <button
              onClick={() => {
                if (window.confirm("Cancel this shipment? This cannot be undone.")) cancelShipment();
              }}
              disabled={cancelling}
              className="btn btn-error btn-outline btn-sm mt-2 gap-1.5 w-fit"
            >
              {cancelling
                ? <span className="loading loading-spinner loading-xs" />
                : <XCircleIcon className="size-3.5" />}
              Cancel Shipment
            </button>
          )}
        </div>
      </motion.div>

      {/* Shipping address */}
      {order.shippingAddress && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="card bg-base-100 shadow-sm"
        >
          <div className="card-body p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <HomeIcon className="size-4 text-primary" />
              Delivery Address
            </h2>
            <div className="mt-3 text-sm leading-relaxed text-base-content/70">
              <p className="font-semibold text-base-content">{order.shippingAddress.name}</p>
              <p>{order.shippingAddress.line1}</p>
              {order.shippingAddress.line2 && <p>{order.shippingAddress.line2}</p>}
              <p>
                {order.shippingAddress.city}, {order.shippingAddress.state} — {order.shippingAddress.pincode}
              </p>
              <p>{order.shippingAddress.country}</p>
              <p className="mt-1 flex items-center gap-1">
                <PhoneIcon className="size-3" />
                {order.shippingAddress.phone}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Timeline */}
      {sortedEvents.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="card bg-base-100 shadow-sm"
        >
          <div className="card-body p-5 sm:p-6">
            <h2 className="mb-4 text-base font-semibold">Shipment Activity</h2>
            {sortedEvents.map((evt, i) => (
              <TimelineRow key={evt.id} event={evt} isLast={i === sortedEvents.length - 1} />
            ))}
          </div>
        </motion.div>
      )}

      {/* No events yet */}
      {sortedEvents.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-base-300 py-12 text-center">
          <TruckIcon className="size-10 text-base-content/20" />
          <p className="text-sm text-base-content/50">
            No tracking events yet. Check back after your order ships.
          </p>
        </div>
      )}
    </div>
  );
}
