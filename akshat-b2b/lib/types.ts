export type Role = 'buyer' | 'admin';
export type StaffRole = 'manager' | 'operations' | 'finance' | 'stock';
export type StaffArea = 'operations' | 'finance' | 'products' | 'stock' | 'kyc' | 'team';
export type OrderStatus = 'PENDING' | 'APPROVED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface Profile {
  id: string;
  email: string;
  business_name: string | null;
  gstin: string | null;
  state: string | null;
  phone: string | null;
  role: Role;
  staff_role: StaffRole | null;
  is_approved: boolean;
  credit_limit: number;
  godown_id: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface Godown {
  id: string;
  name: string;
  state: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  hsn_code: string;
  unit: string;
  pack_size_kg: number;
  /** null until the admin prices it; only priced products can be active. */
  price: number | null;
  gst_rate: number;
  is_active: boolean;
  description: string | null;
  subcategory: string | null;
  pack_label: string | null;
  image_url: string | null;
  brochure_url: string | null;
  specs: string[][];
  source_url: string | null;
  sort_order: number;
}

export interface InventoryRow {
  godown_id: string;
  product_id: string;
  stock_qty: number;
  updated_at: string;
}

export interface OrderItem {
  id: number;
  order_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  hsn_code: string;
  unit: string;
  qty: number;
  unit_price: number;
  gst_rate: number;
  line_total: number;
  gst_amount: number;
}

export interface Order {
  id: string;
  order_no: string;
  buyer_id: string;
  godown_id: string;
  ship_to_state: string;
  status: OrderStatus;
  purchase_date: string;
  due_date: string;
  subtotal: number;
  freight: number;
  gst_amount: number;
  base_amount: number;
  early_discount_pct: number;
  discount_amount: number;
  discount_override: boolean;
  penalty_interest: number;
  interest_waived: boolean;
  amount_due: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  paid_at: string | null;
  settled_on: string | null;
  settled_by: string | null;
  settlement_ref: string | null;
  notes: string | null;
  is_locked_for_tally: boolean;
  locked_at: string | null;
  tally_synced: boolean;
  tally_synced_at: string | null;
  created_at: string;
  order_items?: OrderItem[];
  buyer?: Pick<Profile, 'business_name' | 'gstin' | 'state' | 'email'> | null;
}

export interface BuyerCredit {
  user_id: string;
  credit_limit: number;
  outstanding: number;
  available: number;
  overdue_orders: number;
}

export type AgingBucket = 'CURRENT' | '1-30' | '31-60' | '61-90' | '90+';

export interface AgingRow extends Order {
  business_name: string | null;
  gstin: string | null;
  buyer_state: string | null;
  age_days: number;
  days_past_due: number;
  balance: number;
  bucket: AgingBucket;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
