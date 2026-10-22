import Link from 'next/link';
import { Leaf, LogIn, PackageCheck, ShieldCheck, Truck } from 'lucide-react';
import { serviceClient } from '@/lib/supabase-server';
import type { Product } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata = {
  title: 'Akshat Fertilizer — Product Catalogue & Dealer Portal',
  description: 'Browse the Akshat Fertilizer range — water-soluble NPK, micronutrients, bio-stimulants and crop protection. Registered dealers log in to order.',
  robots: { index: true, follow: true },
};

const CAT_ORDER = ['Green House Grade Fertilizers', 'Special Premium Products', 'Micro Element Categories', 'Secondary Fertilizers', 'Biostimulant', 'Crop Protection'];

async function getCatalogue(): Promise<Product[]> {
  try {
    const db = serviceClient();
    const { data } = await db
      .from('products')
      .select('id, sku, name, category, subcategory, description, image_url, brochure_url, sort_order')
      .like('sku', 'AF-%')
      .order('sort_order');
    return (data as Product[]) ?? [];
  } catch {
    return [];
  }
}

export default async function PublicHome() {
  const products = await getCatalogue();
  const byCat = CAT_ORDER.map((c) => [c, products.filter((p) => p.category === c)] as const).filter(([, list]) => list.length);
  const firstLine = (d: string | null) => (d ?? '').split('\n')[0].slice(0, 150);

  return (
    <div className="min-h-screen bg-[linear-gradient(170deg,#f2f8ee,#f7f9f4_40%,#eef5ea)] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-emerald-100 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Leaf className="h-7 w-7 text-emerald-600" />
          <div className="font-extrabold tracking-tight">AKSHAT <span className="text-emerald-600">FERTILIZER</span></div>
          <nav className="ml-auto flex items-center gap-2">
            <a href="https://www.akshatfertilizer.com" target="_blank" rel="noopener" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:text-emerald-700 sm:block">Company site ↗</a>
            <Link href="/login" className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><LogIn className="h-4 w-4" /> Dealer login</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-10 pt-14 text-center">
        <p className="mb-3 inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">B2B Distribution Portal</p>
        <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">Plant nutrition for every stage of the crop.</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">Browse the full Akshat Fertilizer range — water-soluble NPK, chelated micronutrients, bio-stimulants and crop protection. Registered dealers sign in to see pricing, godown stock and place indents online.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href="/login" className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 font-semibold text-white hover:bg-emerald-700"><LogIn className="h-4 w-4" /> Dealer login</Link>
          <Link href="/register" className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-white px-5 py-3 font-semibold text-emerald-700 hover:bg-emerald-50">Become a dealer</Link>
        </div>
        <div className="mx-auto mt-10 grid max-w-3xl gap-4 text-left sm:grid-cols-3">
          {[
            { icon: PackageCheck, t: 'Live godown stock', d: 'Order from your nearest godown with real-time availability.' },
            { icon: Truck, t: 'Doorstep dispatch', d: 'State-wise freight and dispatch tracking on every indent.' },
            { icon: ShieldCheck, t: 'Credit terms', d: '15-day credit with approved limits for verified dealers.' },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="rounded-xl border border-emerald-100 bg-white/70 p-4">
              <Icon className="h-5 w-5 text-emerald-600" />
              <p className="mt-2 font-semibold">{t}</p>
              <p className="text-sm text-slate-600">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 pb-20">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Our products</h2>
          <p className="text-sm text-slate-500">{products.length} products · {byCat.length} categories</p>
        </div>

        {products.length === 0 ? (
          <div className="rounded-xl border border-dashed border-emerald-200 bg-white/60 p-12 text-center text-slate-500">Catalogue is loading. Please check back shortly.</div>
        ) : (
          <div className="space-y-12">
            {byCat.map(([category, list]) => (
              <section key={category}>
                <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-emerald-800"><Leaf className="h-4 w-4" /> {category}</h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((p) => (
                    <article key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm transition hover:shadow-md">
                      <div className="flex h-40 items-center justify-center bg-gradient-to-br from-emerald-50 to-white p-4">
                        {p.image_url ? <img src={p.image_url} alt={p.name} className="max-h-full max-w-full object-contain" loading="lazy" /> : <Leaf className="h-10 w-10 text-emerald-200" />}
                      </div>
                      <div className="flex flex-1 flex-col p-4">
                        {p.subcategory && <p className="text-xs font-medium uppercase tracking-wide text-emerald-600">{p.subcategory}</p>}
                        <h4 className="mt-0.5 font-semibold leading-snug">{p.name}</h4>
                        <p className="mt-1 line-clamp-3 text-sm text-slate-600">{firstLine(p.description)}</p>
                        <div className="mt-auto flex items-center gap-3 pt-3 text-sm">
                          {p.brochure_url && <a href={p.brochure_url} target="_blank" rel="noopener" className="font-medium text-emerald-700 hover:underline">Brochure ↗</a>}
                          <Link href="/login" className="ml-auto font-medium text-slate-500 hover:text-emerald-700">Login to order →</Link>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-emerald-100 bg-white/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-slate-500 sm:flex-row">
          <p>© {new Date().getFullYear()} Akshat Fertilizers &amp; Plant Nutrition Pvt. Ltd.</p>
          <div className="flex gap-4">
            <a href="https://www.akshatfertilizer.com" target="_blank" rel="noopener" className="hover:text-emerald-700">Company site</a>
            <Link href="/login" className="hover:text-emerald-700">Dealer login</Link>
            <Link href="/register" className="hover:text-emerald-700">Become a dealer</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
