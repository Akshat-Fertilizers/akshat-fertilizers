export type Role = 'ADMIN' | 'DEALER' | 'FARMER';
export type Status = 'PENDING' | 'APPROVED' | 'REJECTED';
export type StaffTier = 'manager' | 'operations' | 'finance' | 'catalog';
export type StaffArea = 'operations' | 'finance' | 'catalog' | 'customers' | 'team';
export type OrderStatus = 'RECEIVED' | 'CONFIRMED_OFFLINE' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
export type PaymentTerms = 'CREDIT_15D' | 'ADVANCE';
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';

export interface Profile {
  id: string;
  role: Role;
  staff_tier: StaffTier | null;
  status: Status;
  full_name: string | null;
  mobile: string | null;
  whatsapp: string | null;
  email: string | null;
  state: string | null;
  city: string | null;
  entity_name: string | null; // Business Name (DEALER) or Farm Name (FARMER)
  custom_discount_pct: number | null;
  onboarded: boolean; // false for a first-time Google sign-in until the profile is completed
  created_at: string;
}

export interface Product {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  description: string | null;
  specifications: string | null;
  unit: string | null;
  dealer_price: number | null;
  farmer_price: number | null;
  is_active: boolean;
  image_url: string | null;
  created_at: string;
}

/** A catalogue row as returned by the my_catalog() RPC (single role-appropriate price). */
export interface CatalogItem {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  specifications: string | null;
  unit: string | null;
  image_url: string | null;
  price: number | null;
}

export interface DiscountSlab {
  id: string;
  min_amount: number;
  max_amount: number | null;
  discount_pct: number;
  is_active: boolean;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

export interface Order {
  id: string;
  order_number: string;
  user_id: string;
  customer_type: Role;
  subtotal: number;
  discount_amount: number;
  final_amount: number;
  is_below_min_order: boolean;
  order_status: OrderStatus;
  payment_terms: PaymentTerms;
  payment_status: PaymentStatus;
  amount_paid: number;
  due_date: string | null;
  overdue_interest: number;
  created_at: string;
  order_items?: OrderItem[];
  buyer?: Pick<Profile, 'full_name' | 'entity_name' | 'mobile' | 'whatsapp' | 'email' | 'role' | 'state' | 'city'> | null;
}

export interface PaymentLog {
  id: string;
  order_id: string;
  user_id: string;
  amount: number;
  payment_mode: string | null;
  reference_note: string | null;
  recorded_at: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
