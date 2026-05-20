import { useState } from "react";
import {
  HeadphonesIcon,
  LogInIcon,
  MinusIcon,
  PlusIcon,
  ShoppingCartIcon,
  Trash2Icon,
  TruckIcon,
  XIcon,
} from "lucide-react";
import useCartPage from "../hooks/useCartPage";
import EmptyCart from "../components/EmptyCart";
import { CartSkeleton } from "../components/LoadingSkeletons";
import { PageError } from "../components/PageError";
import { IK_PRESETS, imageKitOptimizedUrl } from "../lib/imagekitUrl";
import { Link } from "react-router";
import { formatPrice } from "../utils/format";
import { Show, SignInButton } from "@clerk/react";
import { motion, AnimatePresence } from "framer-motion";

// ── Shipping address modal ─────────────────────────────────────────────────────

const EMPTY_ADDR = {
  name: "", phone: "", email: "",
  line1: "", line2: "",
  city: "", state: "", pincode: "", country: "India",
};

function ShippingModal({ isOpen, onClose, onConfirm, loading }) {
  const [addr, setAddr] = useState(EMPTY_ADDR);
  const [errors, setErrors] = useState({});

  const set = (k) => (e) => setAddr(prev => ({ ...prev, [k]: e.target.value }));

  function validate() {
    const errs = {};
    if (!addr.name.trim())    errs.name    = "Required";
    if (!addr.phone.trim())   errs.phone   = "Required";
    if (!addr.email.trim())   errs.email   = "Required";
    if (!addr.line1.trim())   errs.line1   = "Required";
    if (!addr.city.trim())    errs.city    = "Required";
    if (!addr.state.trim())   errs.state   = "Required";
    if (!addr.pincode.trim()) errs.pincode = "Required";
    if (!addr.country.trim()) errs.country = "Required";
    return errs;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    onConfirm(addr);
  }

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 24 }}
            className="card bg-base-100 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          >
            <div className="card-body p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <TruckIcon className="size-5 text-primary" />
                  Shipping Address
                </h2>
                <button onClick={onClose} className="btn btn-ghost btn-sm btn-square">
                  <XIcon className="size-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                {/* Full name + phone */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Full name" error={errors.name} required>
                    <input className="input input-bordered input-sm w-full" value={addr.name} onChange={set("name")} placeholder="John Doe" />
                  </Field>
                  <Field label="Phone" error={errors.phone} required>
                    <input className="input input-bordered input-sm w-full" value={addr.phone} onChange={set("phone")} placeholder="9876543210" />
                  </Field>
                </div>

                {/* Email */}
                <Field label="Email" error={errors.email} required>
                  <input className="input input-bordered input-sm w-full" type="email" value={addr.email} onChange={set("email")} placeholder="you@example.com" />
                </Field>

                {/* Address lines */}
                <Field label="Address line 1" error={errors.line1} required>
                  <input className="input input-bordered input-sm w-full" value={addr.line1} onChange={set("line1")} placeholder="House/flat no., street name" />
                </Field>
                <Field label="Address line 2 (optional)">
                  <input className="input input-bordered input-sm w-full" value={addr.line2} onChange={set("line2")} placeholder="Landmark, area" />
                </Field>

                {/* City + State */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="City" error={errors.city} required>
                    <input className="input input-bordered input-sm w-full" value={addr.city} onChange={set("city")} placeholder="Mumbai" />
                  </Field>
                  <Field label="State" error={errors.state} required>
                    <input className="input input-bordered input-sm w-full" value={addr.state} onChange={set("state")} placeholder="Maharashtra" />
                  </Field>
                </div>

                {/* Pincode + Country */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Pincode" error={errors.pincode} required>
                    <input className="input input-bordered input-sm w-full" value={addr.pincode} onChange={set("pincode")} placeholder="400001" maxLength={10} />
                  </Field>
                  <Field label="Country" error={errors.country} required>
                    <input className="input input-bordered input-sm w-full" value={addr.country} onChange={set("country")} placeholder="India" />
                  </Field>
                </div>

                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={onClose} className="btn btn-ghost btn-sm flex-1">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="btn btn-primary btn-sm flex-1 gap-2"
                  >
                    {loading
                      ? <span className="loading loading-spinner loading-xs" />
                      : <ShoppingCartIcon className="size-3.5" />}
                    {loading ? "Redirecting…" : "Continue to payment"}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ label, children, error, required }) {
  return (
    <div className="form-control gap-0.5">
      <label className="label py-0.5">
        <span className="label-text text-xs font-medium">
          {label}{required && <span className="text-error ml-0.5">*</span>}
        </span>
      </label>
      {children}
      {error && <span className="text-xs text-error mt-0.5">{error}</span>}
    </div>
  );
}

// ── Main CartPage ──────────────────────────────────────────────────────────────

function CartPage() {
  const {
    checkout,
    checkoutLoading,
    items,
    lines,
    productsError,
    productsLoading,
    removeItem,
    setQty,
    subtotal,
  } = useCartPage();

  const [showAddressModal, setShowAddressModal] = useState(false);

  function handleCheckoutClick() {
    setShowAddressModal(true);
  }

  async function handleAddressConfirm(addr) {
    await checkout(addr);
    // modal stays open while redirecting; will close if an error occurs
    setShowAddressModal(false);
  }

  return (
    <div className="text-left">
      <h1 className="mb-8 flex items-center gap-2 text-3xl font-bold text-base-content">
        <ShoppingCartIcon className="size-8 text-primary" aria-hidden />
        Cart
      </h1>

      {items.length === 0 ? (
        <EmptyCart />
      ) : productsLoading ? (
        <CartSkeleton lines={items.length} />
      ) : productsError ? (
        <PageError message="Could not load product details. Refresh the page or try again shortly." />
      ) : (
        <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
          <ul className="space-y-4">
            {lines.map(({ line, product: p }) => (
              <li
                key={line.productId}
                className="card card-side border border-base-300 bg-base-100 shadow-sm"
              >
                <figure className="p-4">
                  {p?.imageUrl ? (
                    <img
                      src={imageKitOptimizedUrl(p.imageUrl, IK_PRESETS.cartThumb)}
                      alt=""
                      className="h-24 w-24 rounded-box object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="h-24 w-24 rounded-box bg-base-300" />
                  )}
                </figure>
                <div className="card-body min-w-0 flex-row flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="card-title text-base">
                      {p ? (
                        <Link to={`/product/${p.slug}`} className="link-hover link-primary">
                          {p.name}
                        </Link>
                      ) : (
                        "Unknown product"
                      )}
                    </div>
                    {p ? (
                      <p className="text-sm text-base-content/60">
                        {formatPrice(p.priceCents, p.currency)} each
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <span className="text-sm text-base-content/70">Qty</span>
                      <div className="join border border-base-300">
                        <button
                          type="button"
                          className="btn btn-sm join-item gap-0 px-2.5"
                          onClick={() => setQty(line.productId, line.quantity - 1)}
                          aria-label={line.quantity <= 1 ? "Remove from cart" : "Decrease quantity"}
                        >
                          <MinusIcon className="size-4" aria-hidden />
                        </button>
                        <span
                          className="join-item flex min-w-10 items-center justify-center bg-base-200 px-3 text-sm font-medium tabular-nums text-base-content"
                          aria-live="polite"
                        >
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm join-item gap-0 px-2.5"
                          onClick={() => setQty(line.productId, Math.min(99, line.quantity + 1))}
                          disabled={line.quantity >= 99}
                          aria-label="Increase quantity"
                        >
                          <PlusIcon className="size-4" aria-hidden />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(line.productId)}
                        className="btn btn-ghost btn-square btn-sm text-error hover:bg-error/10"
                        aria-label="Remove from cart"
                        title="Remove from cart"
                      >
                        <Trash2Icon className="size-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                  <div className="text-right font-semibold text-base-content">
                    {p ? formatPrice(p.priceCents * line.quantity, p.currency) : "-"}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <aside className="card border border-base-300 bg-base-100 p-6 shadow-md">
            <div className="flex justify-between text-sm">
              <span className="text-base-content/70">Subtotal</span>
              <span className="font-semibold text-base-content">
                {formatPrice(subtotal, lines[0]?.product?.currency ?? "usd")}
              </span>
            </div>

            <Show when="signed-in">
              <button
                type="button"
                onClick={handleCheckoutClick}
                disabled={checkoutLoading}
                aria-busy={checkoutLoading}
                className="btn btn-primary mt-6 w-full gap-2"
              >
                {checkoutLoading ? (
                  <span className="loading loading-spinner loading-sm" aria-hidden />
                ) : (
                  <TruckIcon className="size-4" aria-hidden />
                )}
                {checkoutLoading ? "Opening checkout…" : "Checkout securely"}
              </button>
            </Show>

            <Show when="signed-out">
              <SignInButton mode="modal">
                <button type="button" className="btn btn-outline btn-primary mt-6 w-full gap-2">
                  <LogInIcon className="size-4" aria-hidden />
                  Sign in to checkout
                </button>
              </SignInButton>
            </Show>

            <p className="mt-4 flex items-start gap-2 text-xs text-base-content/60">
              <HeadphonesIcon className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              <span>
                After payment, open your order for{" "}
                <strong className="text-base-content">support chat</strong>. Video invites appear in
                that thread.
              </span>
            </p>
          </aside>
        </div>
      )}

      <ShippingModal
        isOpen={showAddressModal}
        onClose={() => setShowAddressModal(false)}
        onConfirm={handleAddressConfirm}
        loading={checkoutLoading}
      />
    </div>
  );
}
export default CartPage;
