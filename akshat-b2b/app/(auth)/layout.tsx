import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-gray-50 to-gray-100 px-4 py-12">
      <Link href="/" className="mb-6"><img src="/brand/logo.png" alt="Akshat Fertilizers" className="h-12 w-auto" /></Link>
      <div className="card w-full max-w-md p-7 shadow-lg">{children}</div>
      <Link href="/" className="mt-6 text-sm font-bold text-gray-400 hover:text-brand-700">← Back to catalogue</Link>
    </div>
  );
}
