'use client';
import { Loader2, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const TONES = {
  slate: 'bg-gray-100 text-gray-600',
  green: 'bg-brand-50 text-brand-700',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-50 text-blue-600',
  violet: 'bg-violet-100 text-violet-700',
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'slate', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider', TONES[tone], className)}>
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  PENDING: 'slate',
  APPROVED: 'blue',
  DISPATCHED: 'blue',
  DELIVERED: 'green',
  CANCELLED: 'red',
  UNPAID: 'amber',
  PARTIAL: 'blue',
  PAID: 'green',
  SETTLED: 'green',
  CURRENT: 'green',
  '1-30': 'amber',
  '31-60': 'amber',
  '61-90': 'red',
  '90+': 'red',
};

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} />;
}

export function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 text-brand-600">
      <Spinner className="h-7 w-7" />
    </div>
  );
}

const ACCENTS = {
  green: { bar: 'border-l-brand-500', chip: 'bg-brand-50 text-brand-600', value: 'text-gray-900' },
  amber: { bar: 'border-l-amber-400', chip: 'bg-amber-50 text-amber-500', value: 'text-amber-500' },
  blue: { bar: 'border-l-blue-500', chip: 'bg-blue-50 text-blue-500', value: 'text-gray-900' },
  red: { bar: 'border-l-red-500', chip: 'bg-red-50 text-red-500', value: 'text-red-600' },
  slate: { bar: 'border-l-gray-300', chip: 'bg-gray-100 text-gray-500', value: 'text-gray-900' },
} as const;

/** Dashboard metric card: coloured left border + icon chip, matching the platform demo. */
export function Metric({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'slate',
  pulse,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  accent?: keyof typeof ACCENTS;
  pulse?: boolean;
}) {
  const a = ACCENTS[accent];
  return (
    <div className={cn('relative overflow-hidden rounded-2xl border border-y border-r border-gray-100 border-l-4 bg-white p-6 shadow-sm', a.bar)}>
      {Icon && (
        <div className={cn('absolute right-4 top-4 rounded-xl p-2.5', a.chip, pulse && 'animate-pulse')}>
          <Icon className="h-6 w-6" />
        </div>
      )}
      <div className="mb-1 text-sm font-bold text-gray-500">{label}</div>
      <div className={cn('mb-2 text-3xl font-black', a.value)}>{value}</div>
      {hint && <div className="text-xs font-bold text-gray-400">{hint}</div>}
    </div>
  );
}

/** Back-compat alias used by older tabs. */
export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'red' | 'green' }) {
  return <Metric label={label} value={value} hint={hint} accent={tone === 'red' ? 'red' : tone === 'green' ? 'green' : 'slate'} />;
}

export function Alert({ tone = 'red', children, onClose }: { tone?: 'red' | 'green' | 'amber'; children: React.ReactNode; onClose?: () => void }) {
  const t = {
    red: 'border-red-200 bg-red-50 text-red-800',
    green: 'border-brand-200 bg-brand-50 text-brand-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
  }[tone];
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium', t)} role="alert">
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
  return <div className="px-4 py-12 text-center text-sm font-medium text-gray-500">{children}</div>;
}

/** Fully-paid invoices are shown to admins as "Settled". */
export const paymentLabel = (o: { payment_status: string }) => (o.payment_status === 'PAID' ? 'SETTLED' : o.payment_status);
