/**
 * TrackingWidget
 * ──────────────
 * Compact shipment status card embedded in OrderDetailPage.
 * Shows current status, AWB, courier, estimated delivery, and a link
 * to the full tracking page.
 */

import { Link } from "react-router";
import {
  TruckIcon,
  PackageIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  AlertTriangleIcon,
  ExternalLinkIcon,
} from "lucide-react";

const STATUS_LABEL = {
  pending:          "Order Placed",
  processing:       "Processing",
  packed:           "Packed at Warehouse",
  shipped:          "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered:        "Delivered",
  delayed:          "Delayed",
  returned:         "Returned to Sender",
  cancelled:        "Shipment Cancelled",
};

const STATUS_ICON = {
  pending:          PackageIcon,
  processing:       ClockIcon,
  packed:           PackageIcon,
  shipped:          TruckIcon,
  out_for_delivery: TruckIcon,
  delivered:        CheckCircleIcon,
  delayed:          AlertTriangleIcon,
  returned:         XCircleIcon,
  cancelled:        XCircleIcon,
};

const STATUS_CLS = {
  pending:          "bg-base-200 text-base-content/60",
  processing:       "bg-info/10 text-info",
  packed:           "bg-info/10 text-info",
  shipped:          "bg-primary/10 text-primary",
  out_for_delivery: "bg-warning/10 text-warning",
  delivered:        "bg-success/10 text-success",
  delayed:          "bg-warning/10 text-warning",
  returned:         "bg-error/10 text-error",
  cancelled:        "bg-error/10 text-error",
};

export function TrackingWidget({ order }) {
  if (!order) return null;

  const status = order.shipmentStatus ?? "pending";
  const Icon   = STATUS_ICON[status] ?? PackageIcon;
  const label  = STATUS_LABEL[status] ?? status;
  const cls    = STATUS_CLS[status] ?? "bg-base-200 text-base-content/60";

  return (
    <div className="card bg-base-100 shadow-sm border border-base-200">
      <div className="card-body p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <TruckIcon className="size-4 text-primary" />
            Shipment
          </h3>
          <Link
            to={`/orders/${order.id}/track`}
            className="btn btn-ghost btn-xs gap-1 text-primary"
          >
            Track
            <ExternalLinkIcon className="size-3" />
          </Link>
        </div>

        {/* Status badge */}
        <div className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${cls}`}>
          <Icon className="size-4 shrink-0" />
          {label}
        </div>

        {/* Details grid */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          {order.courierName && (
            <>
              <span className="text-base-content/50">Courier</span>
              <span className="font-medium text-right">{order.courierName}</span>
            </>
          )}
          {order.awbCode && (
            <>
              <span className="text-base-content/50">AWB</span>
              <span className="font-mono font-medium text-right truncate">{order.awbCode}</span>
            </>
          )}
          {order.estimatedDelivery && (
            <>
              <span className="text-base-content/50">Est. Delivery</span>
              <span className="font-medium text-right">
                {new Date(order.estimatedDelivery).toLocaleDateString(undefined, {
                  month: "short", day: "numeric",
                })}
              </span>
            </>
          )}
          {order.deliveryDate && status === "delivered" && (
            <>
              <span className="text-base-content/50">Delivered on</span>
              <span className="font-medium text-right">
                {new Date(order.deliveryDate).toLocaleDateString(undefined, {
                  month: "short", day: "numeric", year: "numeric",
                })}
              </span>
            </>
          )}
        </div>

        {/* External courier tracking link */}
        {order.trackingUrl && (
          <a
            href={order.trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline btn-xs mt-3 gap-1 w-fit"
          >
            <ExternalLinkIcon className="size-3" />
            Track on courier site
          </a>
        )}
      </div>
    </div>
  );
}
