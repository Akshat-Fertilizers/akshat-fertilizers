import { Sprout } from 'lucide-react';
import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 to-slate-100 px-4 py-12">
      <Link href="/home" className="mb-6 flex items-center gap-2 text-emerald-800">
        <Sprout className="h-7 w-7" />
        <span className="text-lg font-semibold">Akshat Fertilizer · B2B Portal</span>
      </Link>
      <div className="card w-full max-w-md p-6">{children}</div>
    </div>
  );
}
