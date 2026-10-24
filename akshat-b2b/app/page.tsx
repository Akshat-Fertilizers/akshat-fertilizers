import Link from 'next/link';
import { Leaf, LogIn, Mail, Phone, ShieldCheck, Sprout, Truck } from 'lucide-react';
import { serviceClient } from '@/lib/supabase-server';
import type { Product } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata = {
  title: 'Akshat Fertilizer — Crop Nutrition & Dealer Portal',
  description: 'Akshat Fertilizers & Chemicals — water-soluble NPK, micronutrients, bio-stimulants and crop protection for healthy crops and higher yields.',
  robots: { index: true, follow: true },
};

const PHONE = '+919131283429';
const EMAIL = 'akshatfertilizers@gmail.com';
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
  const firstLine = (d: string | null) => (d ?? '').split('\n')[0].slice(0, 130);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Contact bar */}
      <div className="bg-brand-700 text-white">
        <div className="mx-auto flex h-10 max-w-7xl items-center justify-between gap-4 px-4 text-sm font-medium md:px-6">
          <div className="flex items-center gap-4">
            <a href={`tel:${PHONE}`} className="flex items-center gap-1.5 hover:text-brand-100"><Phone className="h-3.5 w-3.5" /> +91 91312 83429</a>
            <span className="hidden sm:inline text-brand-100">+91 99939 86981</span>
            <a href={`mailto:${EMAIL}`} className="hidden items-center gap-1.5 hover:text-brand-100 md:flex"><Mail className="h-3.5 w-3.5" /> {EMAIL}</a>
          </div>
          <a href="https://www.akshatfertilizer.com" target="_blank" rel="noopener" className="hidden font-semibold text-brand-100 hover:text-white sm:block">www.akshatfertilizer.com ↗</a>
        </div>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 md:px-6">
          <Link href="/"><img src="/brand/logo.png" alt="Akshat Fertilizers & Chemicals Industries Ltd." className="h-11 w-auto md:h-12" /></Link>
          <div className="flex items-center gap-2">
            <a href={`tel:${PHONE}`} className="hidden items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm font-black text-brand-700 hover:bg-brand-100 sm:flex"><Phone className="h-4 w-4" /> Call to Order</a>
            <Link href="/login" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-brand-700"><LogIn className="h-4 w-4" /> Login</Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero — bright crop photo */}
        <section className="relative flex min-h-[460px] items-center overflow-hidden">
          <img src="/brand/1579185604slide1.jpg" alt="Healthy flowering crops" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-brand-950/85 via-brand-900/55 to-transparent" />
          <div className="relative z-10 mx-auto w-full max-w-7xl px-4 py-16 md:px-6">
            <div className="max-w-xl">
              <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-black uppercase tracking-widest text-white backdrop-blur"><Sprout className="h-3.5 w-3.5" /> Good Seeds · Healthy Field</span>
              <h1 className="text-4xl font-black leading-tight text-white drop-shadow-md md:text-5xl">Healthy crops.<br />Higher yields.</h1>
              <p className="mt-4 max-w-md text-lg font-medium text-white/90">Water-soluble NPK, micronutrients, bio-stimulants and crop protection — made by Akshat Fertilizers for farmers across India.</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <a href="#products" className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 font-black text-brand-800 shadow-lg transition hover:bg-brand-50"><Leaf className="h-4 w-4" /> See Products</a>
                <a href={`tel:${PHONE}`} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3.5 font-black text-white shadow-lg transition hover:bg-brand-500"><Phone className="h-4 w-4" /> Call to Order</a>
              </div>
            </div>
          </div>
        </section>

        {/* Value strip */}
        <section className="border-b border-gray-100 bg-white">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:grid-cols-3 md:px-6">
            {[
              { icon: Leaf, t: 'Trusted Quality', d: 'ISO-certified plant nutrition, straight from the manufacturer.' },
              { icon: Truck, t: 'Doorstep Delivery', d: 'Delivered to your nearest godown across the state.' },
              { icon: ShieldCheck, t: 'Easy Credit for Dealers', d: '15-day credit with approved limits for our partners.' },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t} className="flex items-start gap-3">
                <div className="shrink-0 rounded-xl bg-brand-50 p-3 text-brand-600"><Icon className="h-6 w-6" /></div>
                <div>
                  <p className="font-black text-gray-900">{t}</p>
                  <p className="text-sm text-gray-500">{d}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Catalogue */}
        <section id="products" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-12 md:px-6">
          <div className="mb-2 text-center">
            <h2 className="text-3xl font-black tracking-tight text-gray-900">Our Products</h2>
            <p className="mt-1 font-medium text-gray-500">{products.length} products across {byCat.length} categories · dealers log in to see prices &amp; order</p>
          </div>

          {byCat.length > 0 && (
            <div className="my-8 flex w-full justify-start gap-2 overflow-x-auto pb-2 md:justify-center">
              {byCat.map(([c]) => (
                <a key={c} href={`#${slug(c)}`} className="whitespace-nowrap rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-600 hover:border-brand-600 hover:bg-brand-50 hover:text-brand-700">{c}</a>
              ))}
            </div>
          )}

          {products.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-brand-200 bg-white p-12 text-center font-medium text-gray-500">Products are loading. Please check back shortly, or call us to order.</div>
          ) : (
            <div className="space-y-12">
              {byCat.map(([category, list]) => (
                <div key={category} id={slug(category)} className="scroll-mt-24">
                  <h3 className="mb-5 flex items-center gap-2 text-xl font-black text-gray-900"><Leaf className="h-5 w-5 text-brand-600" /> {category}</h3>
                  <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
                    {list.map((p) => (
                      <article key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                        <div className="relative aspect-square overflow-hidden bg-white">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} className="h-full w-full object-contain p-3" loading="lazy" />
                          ) : (
                            <div className="flex h-full items-center justify-center bg-brand-50"><Leaf className="h-12 w-12 text-brand-200" /></div>
                          )}
                          {p.subcategory && <div className="absolute left-2 top-2 rounded-full bg-brand-600/95 px-2.5 py-1 text-[10px] font-bold text-white shadow-sm">{p.subcategory}</div>}
                        </div>
                        <div className="flex flex-1 flex-col border-t border-gray-100 p-4">
                          <h4 className="text-base font-black leading-snug text-gray-900">{p.name}</h4>
                          <p className="mt-1 line-clamp-2 text-sm text-gray-500">{firstLine(p.description)}</p>
                          <div className="mt-auto flex items-center gap-3 pt-3">
                            {p.brochure_url && <a href={p.brochure_url} target="_blank" rel="noopener" className="text-xs font-bold text-brand-700 hover:underline">Details ↗</a>}
                            <a href={`tel:${PHONE}`} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-black text-white transition hover:bg-brand-700"><Phone className="h-3.5 w-3.5" /> Order</a>
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

        {/* CTA band */}
        <section className="bg-brand-700">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-10 text-center md:flex-row md:px-6 md:text-left">
            <div>
              <h3 className="text-2xl font-black text-white">Are you a dealer?</h3>
              <p className="mt-1 font-medium text-brand-100">Log in to see prices, godown stock and place orders online.</p>
            </div>
            <div className="flex gap-3">
              <Link href="/login" className="rounded-xl bg-white px-6 py-3.5 font-black text-brand-800 hover:bg-brand-50">Dealer Login</Link>
              <Link href="/register" className="rounded-xl border border-white/40 px-6 py-3.5 font-black text-white hover:bg-white/10">Become a Dealer</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-gray-900 text-gray-400">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:grid-cols-3 md:px-6">
          <div>
            <img src="/brand/logo2.png" alt="Akshat Fertilizer" className="mb-3 h-12 w-auto brightness-0 invert" />
            <p className="text-sm">Akshat Fertilizers &amp; Chemicals Industries Ltd. — crop nutrition for healthy fields and higher yields.</p>
          </div>
          <div>
            <p className="mb-2 font-black text-white">Contact</p>
            <p className="text-sm"><a href={`tel:${PHONE}`} className="hover:text-white">+91 91312 83429</a> · +91 99939 86981</p>
            <p className="text-sm"><a href={`mailto:${EMAIL}`} className="hover:text-white">{EMAIL}</a></p>
            <a href="https://www.akshatfertilizer.com" target="_blank" rel="noopener" className="text-sm hover:text-white">www.akshatfertilizer.com ↗</a>
          </div>
          <div>
            <p className="mb-2 font-black text-white">For Dealers</p>
            <p className="text-sm"><Link href="/login" className="hover:text-white">Dealer login</Link></p>
            <p className="text-sm"><Link href="/register" className="hover:text-white">Become a dealer</Link></p>
          </div>
        </div>
        <div className="border-t border-gray-800 py-4 text-center text-xs">© {new Date().getFullYear()} Akshat Fertilizers &amp; Chemicals Industries Ltd. All rights reserved.</div>
      </footer>
    </div>
  );
}
