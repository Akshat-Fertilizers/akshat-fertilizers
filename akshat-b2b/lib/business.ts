// Business rules mirrored from supabase/migrations/001_init.sql (the DB is authoritative).
import { round2 } from '@/lib/utils';

export const MIN_ORDER_VALUE = 50_000;
export const CREDIT_DAYS = 15;
export const EARLY_DISCOUNT_PCT = 2;
export const INTEREST_APY = 0.18;
export const INTEREST_TRIGGER_DAYS = 90;

export const GODOWNS = { MH_GODOWN: 'Maharashtra Godown', MP_GODOWN: 'Madhya Pradesh Godown' } as const;
export type GodownId = keyof typeof GODOWNS;

export function freightForState(state?: string | null): number {
  switch ((state ?? '').trim().toLowerCase()) {
    case 'maharashtra':
      return 2500;
    case 'madhya pradesh':
      return 1500;
    default:
      return 3000;
  }
}

export interface CartLine {
  qty: number;
  price: number;
  gst_rate: number;
}

export function computeCart(lines: CartLine[], state?: string | null) {
  const subtotal = round2(lines.reduce((s, l) => s + round2(l.qty * l.price), 0));
  const gst = round2(lines.reduce((s, l) => s + round2((l.qty * l.price * l.gst_rate) / 100), 0));
  const freight = subtotal > 0 ? freightForState(state) : 0;
  const total = round2(subtotal + gst + freight);
  const earlyDiscount = round2((subtotal * EARLY_DISCOUNT_PCT) / 100);
  return {
    subtotal,
    gst,
    freight,
    total,
    earlyDiscount,
    payableIfEarly: round2(total - earlyDiscount),
    meetsMinimum: subtotal >= MIN_ORDER_VALUE,
    shortfall: Math.max(0, round2(MIN_ORDER_VALUE - subtotal)),
  };
}

/** penalty_interest = (base_amount * 0.18 / 365) * overdue_days, only once age > 90 days. */
export function projectedInterest(baseAmount: number, ageDays: number, daysPastDue: number) {
  if (ageDays <= INTEREST_TRIGGER_DAYS) return 0;
  return round2(((baseAmount * INTEREST_APY) / 365) * Math.max(0, daysPastDue));
}
