// Business rules mirrored from supabase/migrations/002_frd_schema.sql (the DB is authoritative).
import { round2 } from '@/lib/utils';
import type { DiscountSlab, Profile, StaffArea } from '@/lib/types';

export const MIN_ORDER_VALUE = 50_000; // dealer standard minimum order
export const CREDIT_DAYS = 15;
export const DEFAULT_APY = 18; // overdue interest, % p.a.

/** Highest matching active slab discount for a dealer subtotal. */
export function discountPctForSubtotal(slabs: DiscountSlab[], subtotal: number): number {
  const matched = slabs
    .filter((s) => s.is_active && subtotal >= Number(s.min_amount) && (s.max_amount == null || subtotal <= Number(s.max_amount)))
    .map((s) => Number(s.discount_pct));
  return matched.length ? Math.max(...matched) : 0;
}

export interface CartLine {
  quantity: number;
  price: number;
}

/** Cart totals for a DEALER (slab/custom discount, ₹50k gate) or FARMER (advance, no discount). */
export function computeCart(
  lines: CartLine[],
  opts: { role: 'DEALER' | 'FARMER'; slabs: DiscountSlab[]; customPct?: number | null },
) {
  const subtotal = round2(lines.reduce((s, l) => s + round2(l.quantity * l.price), 0));
  const meetsMin = subtotal >= MIN_ORDER_VALUE;
  let discountPct = 0;
  if (opts.role === 'DEALER' && meetsMin) {
    discountPct = opts.customPct != null ? Number(opts.customPct) : discountPctForSubtotal(opts.slabs, subtotal);
  }
  const discount = round2((subtotal * discountPct) / 100);
  return {
    subtotal,
    discountPct,
    discount,
    final: round2(subtotal - discount),
    meetsMin,
    shortfall: Math.max(0, round2(MIN_ORDER_VALUE - subtotal)),
  };
}

// --- Staff access (client-safe mirror of requireArea in lib/supabase-server.ts) ---
export function effectiveStaffTier(p?: Profile | null): string | null {
  return p?.role === 'ADMIN' ? (p.staff_tier ?? 'manager') : null;
}

export function staffCan(p: Profile | null | undefined, area: StaffArea): boolean {
  switch (effectiveStaffTier(p)) {
    case 'manager':
      return true; // manager sees every module, incl. customers & team
    case 'operations':
      return area === 'operations';
    case 'finance':
      return area === 'finance';
    case 'catalog':
      return area === 'catalog';
    default:
      return false;
  }
}

export const STAFF_TIER_LABEL: Record<string, string> = {
  manager: 'Manager (full access)',
  operations: 'Operations',
  finance: 'Finance',
  catalog: 'Catalogue & Pricing',
};
