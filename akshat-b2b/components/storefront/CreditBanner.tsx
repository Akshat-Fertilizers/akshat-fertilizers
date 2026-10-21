'use client';
import { AlertTriangle, CreditCard } from 'lucide-react';
import type { BuyerCredit } from '@/lib/types';
import { cn, formatINR } from '@/lib/utils';

export function CreditBanner({ credit, pendingOrderValue }: { credit: BuyerCredit | null; pendingOrderValue: number }) {
  if (!credit) return null;
  const limit = Number(credit.credit_limit);
  const used = Number(credit.outstanding);
  const projected = used + pendingOrderValue;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
  const projPct = limit > 0 ? Math.min(100, (projected / limit) * 100) : 100;
  const over = projected > limit;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><CreditCard className="h-5 w-5" /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Credit limit</p>
            <p className="text-lg font-semibold">{formatINR(limit)}</p>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Outstanding</p>
          <p className="text-lg font-semibold">{formatINR(used)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Available</p>
          <p className={cn('text-lg font-semibold', Number(credit.available) <= 0 ? 'text-rose-600' : 'text-emerald-700')}>{formatINR(credit.available)}</p>
        </div>
        {credit.overdue_orders > 0 && (
          <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700">
            <AlertTriangle className="h-4 w-4" /> {credit.overdue_orders} bill(s) overdue — early discount removed; 18% p.a. applies after 90 days
          </p>
        )}
      </div>
      <div className="relative h-2 bg-slate-100">
        <div className={cn('absolute inset-y-0 left-0 opacity-40', over ? 'bg-rose-500' : 'bg-emerald-400')} style={{ width: `${projPct}%` }} />
        <div className={cn('absolute inset-y-0 left-0', pct > 85 ? 'bg-rose-500' : 'bg-emerald-600')} style={{ width: `${pct}%` }} />
      </div>
      {over && pendingOrderValue > 0 && (
        <p className="bg-rose-50 px-4 py-2 text-xs font-medium text-rose-700">This cart ({formatINR(pendingOrderValue)}) would exceed your available credit.</p>
      )}
    </section>
  );
}
