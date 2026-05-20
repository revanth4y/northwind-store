/**
 * Shiprocket API client
 * ─────────────────────
 * Handles authentication (JWT, 24-hour cache), order creation, AWB assignment,
 * and shipment tracking. All functions gracefully no-op when Shiprocket
 * credentials are not configured.
 *
 * Docs: https://apidocs.shiprocket.in/
 */

import { getEnv } from "./env";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ShiprocketOrderPayload {
  order_id:           string;   // our internal order UUID (used as external ref)
  order_date:         string;   // "YYYY-MM-DD HH:mm"
  pickup_location:    string;
  channel_id?:        string;
  comment?:           string;
  // Billing / shipping (same for now)
  billing_customer_name:  string;
  billing_last_name?:     string;
  billing_address:        string;
  billing_address_2?:     string;
  billing_city:           string;
  billing_pincode:        string;
  billing_state:          string;
  billing_country:        string;
  billing_email:          string;
  billing_phone:          string;
  shipping_is_billing:    boolean;
  // Shipment items
  order_items: {
    name:         string;
    sku:          string;
    units:        number;
    selling_price: number;
    discount?:    number;
    tax?:         string;
    hsn?:         number;
  }[];
  payment_method: "Prepaid" | "COD";
  shipping_charges?: number;
  giftwrap_charges?: number;
  transaction_charges?: number;
  total_discount?: number;
  sub_total:      number;
  length:         number;   // cm
  breadth:        number;   // cm
  height:         number;   // cm
  weight:         number;   // kg
}

export interface ShiprocketCreatedOrder {
  order_id:    number;
  shipment_id: number;
  status:      string;
  status_code: number;
  onboarding_completed_now: boolean;
  awb_code?:   string;
  courier_company_id?: number;
  courier_name?: string;
}

export interface ShiprocketAWBResponse {
  awb_assign_status: number;
  response: {
    data: {
      awb_code:           string;
      courier_company_id: number;
      courier_name:       string;
      shipment_id:        number;
      pickup_scheduled_date?: string;
      pickup_token_number?: string;
      routing_code?: string;
      rto_routing_code?: string;
    };
  };
}

export interface ShiprocketTrackingActivity {
  date:        string;
  activity:    string;
  location:    string;
  "sr-status"?: string;
  "sr-status-label"?: string;
}

export interface ShiprocketTrackingResponse {
  tracking_data: {
    track_status:    number;
    shipment_status: number;
    shipment_track:  {
      id:              number;
      awb_code:        string;
      courier_company_id: number;
      shipment_id:     number;
      order_id:        number;
      pickup_date?:    string;
      delivered_date?: string;
      weight:          string;
      packages:        number;
      current_status:  string;
      delivered_to:    string;
      destination:     string;
      consignee_name:  string;
      origin:          string;
      courier_agent_details?: string | null;
      courier_name:    string;
    }[];
    shipment_track_activities: ShiprocketTrackingActivity[];
    track_url?:  string;
    etd?:        string;
    qc_response?: unknown;
  };
}

// ── JWT token cache ────────────────────────────────────────────────────────────

let _token:     string | null = null;
let _tokenExp:  number        = 0;   // epoch ms

const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // 23 h (Shiprocket tokens expire in 24 h)

// ── Guard ──────────────────────────────────────────────────────────────────────

export function isShiprocketConfigured(): boolean {
  const env = getEnv();
  return !!(env.SHIPROCKET_EMAIL && env.SHIPROCKET_PASSWORD);
}

// ── Authentication ─────────────────────────────────────────────────────────────

async function authenticate(): Promise<string> {
  if (_token && Date.now() < _tokenExp) return _token;

  const env = getEnv();
  const res = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email:    env.SHIPROCKET_EMAIL,
      password: env.SHIPROCKET_PASSWORD,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shiprocket auth failed [${res.status}]: ${text}`);
  }

  const data = await res.json() as { token: string };
  _token    = data.token;
  _tokenExp = Date.now() + TOKEN_TTL_MS;
  return _token;
}

// ── Low-level fetch wrapper ────────────────────────────────────────────────────

async function sr<T>(
  path:    string,
  options: RequestInit = {},
): Promise<T> {
  const token = await authenticate();
  const url   = `https://apiv2.shiprocket.in/v1/external${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shiprocket ${options.method ?? "GET"} ${path} [${res.status}]: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Create a new order in Shiprocket and get a shipment_id.
 * Returns null when Shiprocket is not configured.
 */
export async function createShiprocketOrder(
  payload: ShiprocketOrderPayload,
): Promise<ShiprocketCreatedOrder | null> {
  if (!isShiprocketConfigured()) return null;

  return sr<ShiprocketCreatedOrder>("/orders/create/adhoc", {
    method: "POST",
    body:   JSON.stringify(payload),
  });
}

/**
 * Auto-assign the best courier and generate an AWB code for a shipment.
 * Returns null when Shiprocket is not configured.
 */
export async function generateAWB(
  shipmentId: number,
  courierId?: number,
): Promise<ShiprocketAWBResponse | null> {
  if (!isShiprocketConfigured()) return null;

  return sr<ShiprocketAWBResponse>("/courier/assign/awb", {
    method: "POST",
    body:   JSON.stringify({
      shipment_id:        String(shipmentId),
      courier_id:         courierId ?? undefined,
    }),
  });
}

/**
 * Track a shipment by its AWB code.
 * Returns null when Shiprocket is not configured or AWB is blank.
 */
export async function trackShipmentByAWB(
  awb: string,
): Promise<ShiprocketTrackingResponse | null> {
  if (!isShiprocketConfigured() || !awb) return null;

  return sr<ShiprocketTrackingResponse>(`/courier/track/awb/${awb}`);
}

/**
 * Cancel one or more shipments by their AWB codes.
 * Returns null when Shiprocket is not configured.
 */
export async function cancelShipmentByAWBs(
  awbs: string[],
): Promise<{ message: string; status: number } | null> {
  if (!isShiprocketConfigured()) return null;

  return sr<{ message: string; status: number }>("/orders/cancel/shipment/awbs", {
    method: "POST",
    body:   JSON.stringify({ awbs }),
  });
}

/**
 * Get recommended couriers for a shipment.
 */
export async function getRecommendedCouriers(
  shipmentId: number,
): Promise<unknown | null> {
  if (!isShiprocketConfigured()) return null;

  return sr<unknown>(`/courier/serviceability/?shipment_id=${shipmentId}`);
}

// ── Helper: build a Shiprocket order payload from our domain objects ───────────

export interface BuildOrderPayloadArgs {
  orderId:     string;
  orderDate:   Date;
  items: {
    name:          string;
    sku:           string;
    quantity:      number;
    unitPriceCents: number;
  }[];
  shipping: {
    name:    string;
    phone:   string;
    email:   string;
    line1:   string;
    line2?:  string;
    city:    string;
    state:   string;
    pincode: string;
    country: string;
  };
  totalCents: number;
}

export function buildShiprocketPayload(
  args: BuildOrderPayloadArgs,
): ShiprocketOrderPayload {
  const env = getEnv();

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const d    = args.orderDate;
  const dateStr = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  const [firstName, ...rest] = (args.shipping.name ?? "Customer").split(" ");

  return {
    order_id:        args.orderId,
    order_date:      dateStr,
    pickup_location: env.SHIPROCKET_PICKUP_LOCATION ?? "Primary",
    billing_customer_name: firstName,
    billing_last_name:     rest.join(" ") || undefined,
    billing_address:       args.shipping.line1,
    billing_address_2:     args.shipping.line2,
    billing_city:          args.shipping.city,
    billing_pincode:       args.shipping.pincode,
    billing_state:         args.shipping.state,
    billing_country:       args.shipping.country,
    billing_email:         args.shipping.email,
    billing_phone:         args.shipping.phone,
    shipping_is_billing:   true,
    order_items: args.items.map(i => ({
      name:          i.name,
      sku:           i.sku,
      units:         i.quantity,
      selling_price: parseFloat((i.unitPriceCents / 100).toFixed(2)),
    })),
    payment_method: "Prepaid",
    sub_total:      parseFloat((args.totalCents / 100).toFixed(2)),
    // Default parcel dimensions — override per product if you have real data
    length:  20,
    breadth: 15,
    height:  10,
    weight:  0.5,
  };
}
