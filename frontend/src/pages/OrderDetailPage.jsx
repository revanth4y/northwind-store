import { Link, Outlet } from "react-router";
import { OrderDetailSkeleton } from "../components/LoadingSkeletons";
import { PageError } from "../components/PageError";
import { useOrderDetailPage } from "../hooks/useOrderDetailPage";
import {
  ArrowLeftIcon,
  LayoutListIcon,
  VideoIcon,
} from "lucide-react";
import { formatOrderWhen, formatPrice } from "../utils/format";
import { TrackingWidget } from "../components/shipment/TrackingWidget";

function OrderDetailPage() {
  const { id, order, items, paid, isLoading, error } = useOrderDetailPage();

  if (isLoading) {
    return <OrderDetailSkeleton />;
  }

  if (error || !order) {
    return (
      <PageError message="Order not found." action={{ to: "/orders", label: "Back to orders" }} />
    );
  }

  return (
    <div className="space-y-8 text-left">
      <Link
        to="/orders"
        className="btn btn-ghost btn-sm gap-2 px-0 text-base-content/70 hover:text-primary"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        Back to orders
      </Link>

      {/* ── Order header card ── */}
      <div className="overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-lg">
        <div className="bg-linear-to-br from-primary/12 via-base-100 to-base-200/90 px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                Order details
              </p>

              <h1 className="mt-1 font-mono text-2xl font-bold tracking-tight text-base-content sm:text-3xl">
                #{order.id.slice(0, 8)}
              </h1>

              <p className="mt-2 text-sm text-base-content/70">
                {formatOrderWhen(order.createdAt, { dateStyle: "full" })}
              </p>
              <p className="mt-2 break-all font-mono text-xs text-base-content/45">{order.id}</p>
            </div>

            <div className="flex flex-col gap-3 border-t border-base-300/80 pt-4 lg:border-t-0 lg:pt-0 lg:text-right">
              <span
                className={`badge badge-lg w-fit capitalize lg:ml-auto ${
                  paid
                    ? "badge-success"
                    : order.status === "pending"
                      ? "badge-warning"
                      : "badge-error"
                }`}
              >
                {order.status}
              </span>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-base-content/50">
                  Order total
                </p>
                <p className="text-2xl font-bold tabular-nums text-base-content sm:text-3xl">
                  {formatPrice(order.totalCents, "usd")}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-base-300 bg-base-200/40 px-5 py-4 sm:px-8">
          <p className="max-w-3xl text-sm leading-relaxed text-base-content/80">
            Need help with shipping or returns?{" "}
            <Link to="/meet" className="font-semibold text-primary hover:underline">
              Start a Video Meeting
            </Link>{" "}
            with our support team — no account required, just share a room ID.
          </p>
        </div>
      </div>

      {/* ── Order content ── */}
      <div>
        <div className="flex items-center gap-2 border-b border-base-300 pb-3">
          <LayoutListIcon className="size-5 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-base-content">
            Order summary
          </h2>
        </div>

        {/* Quick-access video meet link for paid orders */}
        {paid && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-base-300 bg-base-100 p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-box bg-primary/15 text-primary">
              <VideoIcon className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Need live support?</p>
              <p className="text-xs text-base-content/60">
                Join a private video room with our team instantly.
              </p>
            </div>
            <Link to="/meet" className="btn btn-primary btn-sm shrink-0 gap-2">
              <VideoIcon className="size-3.5" aria-hidden />
              Meet now
            </Link>
          </div>
        )}

        {/* Shipment tracking widget (only for paid orders with shipment data) */}
        {paid && order.shipmentStatus && (
          <div className="mt-5">
            <TrackingWidget order={order} />
          </div>
        )}

        <div className="mt-5">
          <Outlet context={{ order, items, paid }} />
        </div>
      </div>
    </div>
  );
}

export default OrderDetailPage;
