import { useState, useMemo } from "react";
import { useAuth } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeftIcon,
  SendIcon,
  AlertCircleIcon,
  SearchIcon,
  PackageIcon,
  XIcon,
} from "lucide-react";
import { apiFetch } from "../lib/api";

const CATEGORIES = [
  { value: "product_issue", label: "Product Issue" },
  { value: "order_issue",   label: "Order Issue" },
  { value: "refund",        label: "Refund Request" },
  { value: "payment",       label: "Payment Problem" },
  { value: "technical",     label: "Technical Support" },
  { value: "delivery",      label: "Delivery Issue" },
  { value: "general",       label: "General Inquiry" },
];

const PRIORITIES = [
  { value: "low",    label: "Low",    color: "badge-ghost" },
  { value: "medium", label: "Medium", color: "badge-info" },
  { value: "high",   label: "High",   color: "badge-warning" },
  { value: "urgent", label: "Urgent", color: "badge-error" },
];

function ProductSearch({ value, onChange, getToken }) {
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);

  const { data } = useQuery({
    queryKey: ["products-search", query],
    queryFn: () => apiFetch(`/api/products${query.trim() ? `?search=${encodeURIComponent(query.trim())}` : ""}`, { getToken }),
    staleTime: 60_000,
  });

  const products = data?.products ?? [];

  const filtered = useMemo(() => {
    if (!query.trim()) return products.slice(0, 8);
    const q = query.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q)).slice(0, 8);
  }, [products, query]);

  function select(product) {
    onChange({ id: product.id, name: product.name });
    setQuery(product.name);
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setQuery("");
  }

  return (
    <div className="relative">
      <label className="input input-bordered flex items-center gap-2 w-full">
        <SearchIcon className="size-4 shrink-0 opacity-40" />
        <input
          type="text"
          placeholder="Search products…"
          value={value ? value.name : query}
          onChange={e => { setQuery(e.target.value); setOpen(true); if (value) onChange(null); }}
          onFocus={() => setOpen(true)}
          className="flex-1 min-w-0"
        />
        {(value || query) && (
          <button type="button" onClick={clear} className="shrink-0">
            <XIcon className="size-3.5 opacity-50 hover:opacity-100" />
          </button>
        )}
      </label>

      <AnimatePresence>
        {open && !value && filtered.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-xl border border-base-200 bg-base-100 shadow-lg"
            onMouseDown={e => e.preventDefault()}
          >
            {filtered.map(p => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => select(p)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-base-200"
                >
                  {p.imageUrl
                    ? <img src={p.imageUrl} alt="" className="size-8 shrink-0 rounded-lg object-cover" />
                    : <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-base-300"><PackageIcon className="size-4 opacity-40" /></div>
                  }
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="truncate text-xs text-base-content/50">{p.category} · ${(p.priceCents / 100).toFixed(2)}</p>
                  </div>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function NewTicketPage() {
  const { getToken, isSignedIn } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    title:          "",
    category:       "",
    priority:       "medium",
    description:    "",
    orderReference: "",
  });
  const [selectedProduct, setSelectedProduct] = useState(null);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const { mutate, isPending, error } = useMutation({
    mutationFn: () =>
      apiFetch("/api/tickets", {
        getToken,
        method: "POST",
        body: {
          ...form,
          productId:   selectedProduct?.id   ?? undefined,
          productName: selectedProduct?.name ?? undefined,
        },
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
      navigate(`/support/tickets/${data.ticket.id}`);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    mutate();
  };

  const isValid = form.title.trim() && form.category && form.description.trim();

  if (!isSignedIn) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-base-content/60">Sign in to create a support ticket.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/support" className="btn btn-ghost btn-sm mb-6 gap-1.5 pl-0">
        <ArrowLeftIcon className="size-4" />
        Back to portal
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="card bg-base-100 shadow-md"
      >
        <div className="card-body gap-6 p-6 sm:p-8">
          <div>
            <h1 className="text-2xl font-bold">Open a Support Ticket</h1>
            <p className="mt-1 text-sm text-base-content/60">
              Describe your issue and our team will get back to you.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Subject */}
            <div className="form-control gap-1.5">
              <label className="label py-0">
                <span className="label-text font-medium">Subject <span className="text-error">*</span></span>
              </label>
              <input
                type="text"
                className="input input-bordered w-full"
                placeholder="Brief description of your issue"
                maxLength={200}
                value={form.title}
                onChange={set("title")}
                required
              />
            </div>

            {/* Category + Priority */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="form-control gap-1.5">
                <label className="label py-0">
                  <span className="label-text font-medium">Category <span className="text-error">*</span></span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={form.category}
                  onChange={set("category")}
                  required
                >
                  <option value="" disabled>Select a category</option>
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-control gap-1.5">
                <label className="label py-0">
                  <span className="label-text font-medium">Priority</span>
                </label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {PRIORITIES.map(p => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, priority: p.value }))}
                      className={`badge cursor-pointer border-2 px-3 py-3 text-sm font-medium transition-all ${p.color} ${form.priority === p.value ? "border-primary ring-2 ring-primary/30" : "border-transparent opacity-55 hover:opacity-100"}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Product + Order reference */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="form-control gap-1.5">
                <label className="label py-0">
                  <span className="label-text font-medium">Related Product</span>
                  <span className="label-text-alt text-base-content/40">optional</span>
                </label>
                <ProductSearch
                  value={selectedProduct}
                  onChange={setSelectedProduct}
                  getToken={getToken}
                />
              </div>

              <div className="form-control gap-1.5">
                <label className="label py-0">
                  <span className="label-text font-medium">Order Reference</span>
                  <span className="label-text-alt text-base-content/40">optional</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="e.g. ORD-12345 or order #"
                  maxLength={100}
                  value={form.orderReference}
                  onChange={set("orderReference")}
                />
              </div>
            </div>

            {/* Description */}
            <div className="form-control gap-1.5">
              <label className="label py-0">
                <span className="label-text font-medium">Description <span className="text-error">*</span></span>
                <span className="label-text-alt text-base-content/40">{form.description.length}/5000</span>
              </label>
              <textarea
                className="textarea textarea-bordered min-h-[180px] w-full resize-y"
                placeholder="Please provide as much detail as possible — steps to reproduce, error messages, order numbers, etc."
                maxLength={5000}
                value={form.description}
                onChange={set("description")}
                required
              />
            </div>

            {/* Error */}
            {error && (
              <div className="alert alert-error py-2 text-sm">
                <AlertCircleIcon className="size-4 shrink-0" />
                {error.message ?? "Failed to create ticket. Please try again."}
              </div>
            )}

            {/* Submit */}
            <div className="flex justify-end gap-3 pt-2">
              <Link to="/support" className="btn btn-ghost">Cancel</Link>
              <button
                type="submit"
                disabled={!isValid || isPending}
                className="btn btn-primary gap-2"
              >
                {isPending ? <span className="loading loading-spinner loading-sm" /> : <SendIcon className="size-4" />}
                {isPending ? "Submitting…" : "Submit Ticket"}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
