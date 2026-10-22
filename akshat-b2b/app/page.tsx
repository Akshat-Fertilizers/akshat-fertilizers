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
const slug = (c: string) => c.toLowerCase().replace(/[^a-z0-9]+/g, '-');

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
  const byCat = CAT_ORDER.map((c) => [c, products.filter((p) => p.category === c)] as const).filter(([, l]) => l.length);
  const firstLine = (d: string | null) => (d ?? '').split('\n')[0].slice(0, 140);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 shadow-sm backdrop-blur">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 text-2xl font-black text-white shadow-md">A</div>
            <h1 className="text-xl font-black tracking-tight text-gray-900 md:text-2xl">Akshat <span className="text-brand-600">Fertilizer</span></h1>
          </div>
          <div className="flex items-center gap-2">
            <a href="https://www.akshatfertilizer.com" target="_blank" rel="noopener" className="hidden rounded-xl px-3 py-2 text-sm font-bold text-gray-500 hover:text-brand-700 sm:block">Company site ↗</a>
            <Link href="/login" className="btn-primary"><LogIn className="h-4 w-4" /> Dealer Login</Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative flex h-[420px] items-center justify-center overflow-hidden bg-gray-900">
          <img src="https://images.unsplash.com/photo-1625246333195-78d9c38ad449?q=80&w=2000&auto=format&fit=crop" alt="" className="absolute inset-0 h-full w-full object-cover opacity-30 mix-blend-overlay" />
          <div className="absolute inset-0 bg-gradient-to-br from-brand-900/70 via-gray-900/60 to-gray-900/80" />
          <div className="relative z-10 mx-auto max-w-3xl px-4 text-center">
            <span className="mb-5 inline-block rounded-full border border-brand-500/40 bg-brand-500/20 px-3 py-1 text-xs font-bold uppercase tracking-widest text-brand-300">Direct From Manufacturer</span>
            <h2 className="mb-4 text-4xl font-black text-white drop-shadow-lg md:text-5xl">Premium Crop Nutrition</h2>
            <p className="mx-auto mb-8 max-w-xl text-lg text-gray-300">Water-soluble NPK, chelated micronutrients, bio-stimulants and crop protection — built for high yields. Registered dealers sign in for pricing, godown stock and online ordering.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/login" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3.5 font-black text-white shadow-lg transition hover:bg-brand-700"><LogIn className="h-4 w-4" /> Dealer Login</Link>
              <Link href="/register" className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-6 py-3.5 font-black text-white backdrop-blur transition hover:bg-white/20">Become a Dealer</Link>
            </div>
          </div>
        </section>

        {/* Value props */}
        <section className="mx-auto max-w-7xl px-4 md:px-6">
          <div className="-mt-10 grid gap-4 sm:grid-cols-3">
            {[
              { icon: PackageCheck, t: 'Live Godown Stock', d: 'Order from your nearest godown with real-time availability.' },
              { icon: Truck, t: 'Doorstep Dispatch', d: 'State-wise freight and dispatch tracking on every indent.' },
              { icon: ShieldCheck, t: 'Credit Terms', d: '15-day credit with approved limits for verified dealers.' },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t} className="card p-5">
                <div className="mb-2 inline-flex rounded-xl bg-brand-50 p-2.5 text-brand-600"><Icon className="h-5 w-5" /></div>
                <p className="font-black text-gray-900">{t}</p>
                <p className="mt-0.5 text-sm text-gray-500">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Catalogue */}
        <section className="mx-auto max-w-7xl px-4 py-12 md:px-6">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <h3 className="text-3xl font-black tracking-tight text-gray-900">Our Products</h3>
              <p className="mt-1 font-medium text-gray-500">{products.length} products across {byCat.length} categories</p>
            </div>
          </div>

          {/* Category pills (anchor nav) */}
          {byCat.length > 0 && (
            <div className="mb-8 flex w-full gap-2 overflow-x-auto pb-2">
              {byCat.map(([c]) => (
                <a key={c} href={`#${slug(c)}`} className="whitespace-nowrap rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-600 hover:border-brand-600 hover:text-brand-700">{c}</a>
              ))}
            </div>
          )}

          {products.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-brand-200 bg-white/60 p-12 text-center font-medium text-gray-500">Catalogue is loading. Please check back shortly.</div>
          ) : (
            <div className="space-y-12">
              {byCat.map(([category, list]) => (
                <div key={category} id={slug(category)} className="scroll-mt-24">
                  <h4 className="mb-5 flex items-center gap-2 text-xl font-black text-gray-900"><Leaf className="h-5 w-5 text-brand-600" /> {category}</h4>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                    {list.map((p) => (
                      <article key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:shadow-xl">
                        <div className="relative h-48 overflow-hidden bg-gradient-to-br from-brand-50 to-gray-100">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} className="h-full w-full object-contain p-3" loading="lazy" />
                          ) : (
                            <div className="flex h-full items-center justify-center"><Leaf className="h-12 w-12 text-brand-200" /></div>
                          )}
                          {p.subcategory && <div className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold text-brand-800 shadow-sm">{p.subcategory}</div>}
                        </div>
                        <div className="flex flex-1 flex-col p-5">
                          <h5 className="mb-2 text-lg font-black leading-snug text-gray-900">{p.name}</h5>
                          <p className="line-clamp-3 text-sm text-gray-500">{firstLine(p.description)}</p>
                          <div className="mt-auto flex items-center gap-3 pt-4">
                            {p.brochure_url && <a href={p.brochure_url} target="_blank" rel="noopener" className="text-sm font-bold text-brand-700 hover:underline">Brochure ↗</a>}
                            <Link href="/login" className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-700">Login to order</Link>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm font-medium text-gray-500 sm:flex-row md:px-6">
          <p>© {new Date().getFullYear()} Akshat Fertilizers &amp; Plant Nutrition Pvt. Ltd.</p>
          <div className="flex gap-4">
            <a href="https://www.akshatfertilizer.com" target="_blank" rel="noopener" className="hover:text-brand-700">Company site</a>
            <Link href="/login" className="hover:text-brand-700">Dealer login</Link>
            <Link href="/register" className="hover:text-brand-700">Become a dealer</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
