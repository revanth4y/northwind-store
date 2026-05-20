import { pgTable, text, integer, timestamp, uuid, boolean, jsonb, serial } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export type OrderStatus = "pending" | "paid" | "failed";
export type UserRole = "customer" | "support" | "admin";

// Support session status lifecycle
export type SupportSessionStatus = "queued" | "active" | "ended" | "rejected" | "abandoned";
// Reason a session moved out of "active" state
export type SupportEndReason =
  | "customer_ended"
  | "admin_ended"
  | "customer_disconnected"
  | "admin_disconnected"
  | "rejected"
  | "cancelled";

export type CheckoutSessionLine = {
  productId: string;
  quantity: number;
  unitPriceCents: number;
};

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull().default(""),
  displayName: text("display_name"),
  role: text("role").$type<UserRole>().notNull().default("customer"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull().default("General"),
  description: text("description").notNull().default(""),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  imageUrl: text("image_url"),
  /** ImageKit `fileId` for deletes */
  imageKitFileId: text("image_kit_file_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const checkoutSessions = pgTable("checkout_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  polarCheckoutId: text("polar_checkout_id").unique(),
  lines: jsonb("lines").$type<CheckoutSessionLine[]>().notNull(),
  totalCents: integer("total_cents").notNull(),
  currency: text("currency").notNull(),
  shippingAddress: jsonb("shipping_address").$type<ShippingAddress>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").$type<OrderStatus>().notNull().default("pending"),
  polarCheckoutId: text("polar_checkout_id"),
  polarOrderId: text("polar_order_id").unique(),
  totalCents: integer("total_cents").notNull().default(0),
  // ── Shipping address ───────────────────────────────────────────────────────
  shippingAddress: jsonb("shipping_address").$type<ShippingAddress>(),
  // ── Shipment / courier tracking ────────────────────────────────────────────
  shiprocketOrderId:    text("shiprocket_order_id"),
  shiprocketShipmentId: text("shiprocket_shipment_id"),
  awbCode:              text("awb_code"),
  courierName:          text("courier_name"),
  courierPartnerId:     text("courier_partner_id"),
  trackingUrl:          text("tracking_url"),
  shipmentStatus:       text("shipment_status").$type<ShipmentStatus>(),
  estimatedDelivery:    timestamp("estimated_delivery",   { withTimezone: true }),
  shipmentCreatedAt:    timestamp("shipment_created_at",  { withTimezone: true }),
  deliveryDate:         timestamp("delivery_date",        { withTimezone: true }),
  // ── Timestamps ─────────────────────────────────────────────────────────────
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** One row per courier / admin status update on a shipment. Immutable audit log. */
export const shipmentEvents = pgTable("shipment_events", {
  id:          uuid("id").defaultRandom().primaryKey(),
  orderId:     uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  status:      text("status").notNull(),
  description: text("description"),
  location:    text("location"),
  source:      text("source").notNull().default("system"), // 'shiprocket' | 'manual' | 'system'
  timestamp:   timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
});

export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
});

// support_sessions: one row per customer support call, created on queue entry,
// updated at every lifecycle transition (accept, reject, end, disconnect).
// Customer/admin identity is denormalised so records survive account deletion.
export const supportSessions = pgTable("support_sessions", {
  // Same UUID as the socket-layer sessionId.
  id: uuid("id").primaryKey(),

  // Customer identity
  customerClerkId: text("customer_clerk_id"),
  customerName:    text("customer_name").notNull().default(""),
  customerEmail:   text("customer_email").notNull().default(""),
  customerAvatar:  text("customer_avatar"),

  // Agent identity (populated on accept)
  adminClerkId: text("admin_clerk_id"),
  adminName:    text("admin_name"),

  // Timing
  queuedAt:        timestamp("queued_at",   { withTimezone: true }).defaultNow().notNull(),
  acceptedAt:      timestamp("accepted_at", { withTimezone: true }),
  endedAt:         timestamp("ended_at",    { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),

  // Status
  status:    text("status").$type<SupportSessionStatus>().notNull().default("queued"),
  endReason: text("end_reason").$type<SupportEndReason>(),

  // Audit
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Ticket system ──────────────────────────────────────────────────────────────

// ── Shipment / logistics types ────────────────────────────────────────────────

export type ShipmentStatus =
  | "pending"            // order paid, awaiting shipment creation
  | "processing"         // shipment created in courier system
  | "packed"             // packed at warehouse
  | "shipped"            // AWB generated, in transit
  | "out_for_delivery"   // out for delivery
  | "delivered"          // successfully delivered
  | "delayed"            // delivery delayed
  | "returned"           // returned to sender
  | "cancelled";         // shipment cancelled

export type ShippingAddress = {
  name:     string;
  phone:    string;
  email:    string;
  line1:    string;
  line2?:   string;
  city:     string;
  state:    string;
  pincode:  string;
  country:  string;
};

// ── Ticket system ─────────────────────────────────────────────────────────────

export type TicketStatus   = "open" | "in_progress" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketCategory =
  | "product_issue" | "order_issue" | "refund" | "payment"
  | "technical" | "delivery" | "general";
export type TicketEventType =
  | "created"
  | "status_changed"
  | "priority_changed"
  | "assigned";

export const tickets = pgTable("tickets", {
  id:             uuid("id").defaultRandom().primaryKey(),
  ticketNumber:   serial("ticket_number"),           // sequential display number
  // Customer identity (denormalised so records survive account changes)
  userId:         uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  customerClerkId: text("customer_clerk_id"),
  customerName:   text("customer_name").notNull(),
  customerEmail:  text("customer_email").notNull(),
  // Content
  title:          text("title").notNull(),
  description:    text("description").notNull(),
  category:       text("category").$type<TicketCategory>().notNull(),
  priority:       text("priority").$type<TicketPriority>().notNull().default("medium"),
  status:         text("status").$type<TicketStatus>().notNull().default("open"),
  // Product / order context (optional — customer fills in at creation time)
  productId:      uuid("product_id").references(() => products.id, { onDelete: "set null" }),
  productName:    text("product_name"),
  orderReference: text("order_reference"),
  // Assignment
  assignedToId:   uuid("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
  assignedToName: text("assigned_to_name"),
  // Timestamps
  createdAt:      timestamp("created_at",  { withTimezone: true }).defaultNow().notNull(),
  updatedAt:      timestamp("updated_at",  { withTimezone: true }).defaultNow().notNull(),
  resolvedAt:     timestamp("resolved_at", { withTimezone: true }),
  closedAt:       timestamp("closed_at",   { withTimezone: true }),
  closedByName:   text("closed_by_name"),
});

/** Immutable audit log — one row per lifecycle event on a ticket. */
export const ticketEvents = pgTable("ticket_events", {
  id:           uuid("id").defaultRandom().primaryKey(),
  ticketId:     uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  actorClerkId: text("actor_clerk_id"),
  actorName:    text("actor_name").notNull(),
  actorRole:    text("actor_role").$type<UserRole>().notNull(),
  eventType:    text("event_type").$type<TicketEventType>().notNull(),
  fromValue:    text("from_value"),   // e.g. old status / old priority
  toValue:      text("to_value"),     // e.g. new status / new priority
  note:         text("note"),         // optional resolution note
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const ticketMessages = pgTable("ticket_messages", {
  id:           uuid("id").defaultRandom().primaryKey(),
  ticketId:     uuid("ticket_id").references(() => tickets.id, { onDelete: "cascade" }).notNull(),
  authorClerkId: text("author_clerk_id"),
  authorName:   text("author_name").notNull(),
  authorRole:   text("author_role").$type<UserRole>().notNull(),
  content:      text("content").notNull(),
  isInternal:   boolean("is_internal").notNull().default(false),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// cascade = "delete children when parent is deleted"; restrict = "don’t delete the parent if any child still points at it."

// a user can have many orders over time.
export const usersRelations = relations(users, ({ many }) => ({
  orders: many(orders),
}));

// the same product can show up on many order lines
export const productsRelations = relations(products, ({ many }) => ({
  orderItems: many(orderItems),
}));

// each order belongs to exactly one user; each order can have many line items.
export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  items: many(orderItems),
}));

// each line item is for exactly one order and one product
export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));
