'use client';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const TONES = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'slate', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone], className)}>
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  PENDING: 'amber',
  APPROVED: 'blue',
  DISPATCHED: 'violet',
  DELIVERED: 'green',
  CANCELLED: 'red',
  UNPAID: 'amber',
  PARTIAL: 'blue',
  PAID: 'green',
  CURRENT: 'green',
  '1-30': 'amber',
  '31-60': 'amber',
  '61-90': 'red',
  '90+': 'red',
};

/** Fully-paid invoices are shown to admins as "Settled". */
export const paymentLabel = (o: { payment_status: string }) => (o.payment_status === 'PAID' ? 'SETTLED' : o.payment_status);

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} />;
}

export function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'red' | 'green' }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold', tone === 'red' && 'text-rose-600', tone === 'green' && 'text-emerald-700')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Alert({ tone = 'red', children, onClose }: { tone?: 'red' | 'green' | 'amber'; children: React.ReactNode; onClose?: () => void }) {
  const t = { red: 'border-rose-200 bg-rose-50 text-rose-800', green: 'border-emerald-200 bg-emerald-50 text-emerald-800', amber: 'border-amber-200 bg-amber-50 text-amber-900' }[tone];
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', t)} role="alert">
      <div className="flex-1">{children}</div>
      {onClose && (
        <button onClick={onClose} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-slate-500">{children}</div>;
}
