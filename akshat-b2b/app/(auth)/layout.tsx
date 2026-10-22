import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-gray-50 to-gray-100 px-4 py-12">
      <Link href="/" className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 text-2xl font-black text-white shadow-md">A</div>
        <span className="text-lg font-black tracking-tight text-gray-900">Akshat <span className="text-brand-600">Fertilizer</span></span>
      </Link>
      <div className="card w-full max-w-md p-7 shadow-lg">{children}</div>
      <Link href="/" className="mt-6 text-sm font-bold text-gray-400 hover:text-brand-700">← Back to catalogue</Link>
    </div>
  );
}
