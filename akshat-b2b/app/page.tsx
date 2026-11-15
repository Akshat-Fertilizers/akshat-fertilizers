import Link from 'next/link';
import { Award, Building2, Leaf, Lock, LogIn, Mail, Phone, ShieldCheck, Sprout, Target } from 'lucide-react';
import { serviceClient } from '@/lib/supabase-server';
import { OFFICIAL_PHONE_DISPLAY, telLink } from '@/lib/whatsapp';
import { HeroCarousel } from '@/components/public/HeroCarousel';
import { LandingPopup } from '@/components/public/LandingPopup';
import { EnquiryForm } from '@/components/public/EnquiryForm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata = {
  title: 'Akshat Fertilizers — Dealer & Farmer Portal',
  description: 'Akshat Fertilizers & Chemicals — water-soluble NPK, micronutrients, bio-stimulants and crop protection. Register as a dealer or farmer for pricing and online ordering.',
  robots: { index: true, follow: true },
};

interface PublicProduct { id: string; name: string; category: string | null; description: string | null; image_url: string | null }

async function getCatalogue(): Promise<PublicProduct[]> {
  try {
    const { data } = await serviceClient().from('v_public_catalog').select('id, name, category, description, image_url').order('category');
    return (data as PublicProduct[]) ?? [];
  } catch {
    return [];
  }
}

const LEADERS = [
  { icon: Building2, role: 'Managing Director', blurb: 'Steering Akshat Fertilizers’ vision of accessible, high-quality crop nutrition for every farmer.' },
  { icon: Target, role: 'Director — Operations', blurb: 'Overseeing manufacturing, quality control and nationwide dealer distribution.' },
  { icon: Award, role: 'Director — Sales & Agronomy', blurb: 'Leading field support, dealer partnerships and on-ground agronomy guidance.' },
];

export default async function Home() {
  const products = await getCatalogue();
  const cats = Array.from(new Set(products.map((p) => p.category ?? 'Other')));
  const firstLine = (d: string | null) => (d ?? '').split('\n')[0].slice(0, 120);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <LandingPopup />

      <div className="bg-brand-700 text-white">
        <div className="mx-auto flex h-10 max-w-7xl items-center justify-between gap-4 px-4 text-sm font-medium md:px-6">
          <div className="flex items-center gap-4">
            <a href={telLink()} className="flex items-center gap-1.5 hover:text-brand-100"><Phone className="h-3.5 w-3.5" /> {OFFICIAL_PHONE_DISPLAY}</a>
            <a href="mailto:akshatfertilizers@gmail.com" className="hidden items-center gap-1.5 hover:text-brand-100 md:flex"><Mail className="h-3.5 w-3.5" /> akshatfertilizers@gmail.com</a>
          </div>
          <a href="https://www.akshatfertilizer.com" target="_blank" rel="noopener" className="hidden font-semibold text-brand-100 hover:text-white sm:block">www.akshatfertilizer.com ↗</a>
        </div>
      </div>

      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 md:px-6">
          <Link href="/"><img src="/brand/logo.png" alt="Akshat Fertilizers" className="h-11 w-auto md:h-12" /></Link>
          <nav className="flex items-center gap-2">
            <Link href="/register?type=dealer" className="hidden rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm font-black text-brand-700 hover:bg-brand-100 sm:flex"><Building2 className="mr-1 h-4 w-4" /> Become a Dealer</Link>
            <Link href="/login" className="btn-primary"><LogIn className="h-4 w-4" /> Login</Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="px-3 md:px-6"><HeroCarousel /></div>

        {/* CTA row */}
        <section className="mx-auto max-w-7xl px-4 md:px-6">
          <div className="-mt-4 grid gap-4 sm:grid-cols-3">
            {[
              { icon: Building2, t: 'Dealer Login', d: 'Volume pricing, discount slabs & 15-day credit.', href: '/login' },
              { icon: Sprout, t: 'Farmer Registration', d: 'Direct farmer pricing on genuine products.', href: '/register?type=farmer' },
              { icon: Building2, t: 'Become a Dealer', d: 'Partner with Akshat across your region.', href: '/register?type=dealer' },
            ].map(({ icon: Icon, t, d, href }) => (
              <Link key={t} href={href} className="card flex items-center gap-3 p-4 transition hover:shadow-md">
                <div className="shrink-0 rounded-xl bg-brand-50 p-3 text-brand-600"><Icon className="h-5 w-5" /></div>
                <div><p className="font-black text-gray-900">{t}</p><p className="text-sm text-gray-500">{d}</p></div>
              </Link>
            ))}
          </div>
        </section>

        {/* Leadership / Directors */}
        <section className="mx-auto max-w-7xl px-4 py-12 md:px-6">
          <div className="text-center">
            <h2 className="text-3xl font-black tracking-tight text-gray-900">Our Leadership</h2>
            <p className="mx-auto mt-1 max-w-2xl font-medium text-gray-500">The directors driving Akshat Fertilizers’ commitment to quality crop nutrition and dependable dealer partnerships.</p>
          </div>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {LEADERS.map(({ icon: Icon, role, blurb }) => (
              <div key={role} className="card p-6 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-white"><Icon className="h-6 w-6" /></div>
                <p className="font-black text-gray-900">{role}</p>
                <p className="mt-2 text-sm text-gray-500">{blurb}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Catalogue — prices hidden */}
        <section id="products" className="bg-white py-12">
          <div className="mx-auto max-w-7xl px-4 md:px-6">
            <div className="mb-2 text-center">
              <h2 className="text-3xl font-black tracking-tight text-gray-900">Our Products</h2>
              <p className="mt-1 inline-flex items-center gap-1.5 font-medium text-gray-500"><Lock className="h-3.5 w-3.5" /> {products.length} products · log in to see pricing</p>
            </div>
            {products.length === 0 ? (
              <div className="mt-8 rounded-2xl border border-dashed border-brand-200 p-12 text-center font-medium text-gray-500">Catalogue is loading — please check back shortly, or call us to order.</div>
            ) : (
              <div className="mt-8 space-y-10">
                {cats.map((cat) => (
                  <div key={cat}>
                    <h3 className="mb-4 flex items-center gap-2 text-xl font-black text-gray-900"><Leaf className="h-5 w-5 text-brand-600" /> {cat}</h3>
                    <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
                      {products.filter((p) => (p.category ?? 'Other') === cat).map((p) => (
                        <article key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                          <div className="relative aspect-square overflow-hidden bg-white">
                            {p.image_url ? <img src={p.image_url} alt={p.name} className="h-full w-full object-contain p-3" loading="lazy" /> : <div className="flex h-full items-center justify-center bg-brand-50"><Leaf className="h-12 w-12 text-brand-200" /></div>}
                          </div>
                          <div className="flex flex-1 flex-col border-t border-gray-100 p-4">
                            <h4 className="text-base font-black leading-snug text-gray-900">{p.name}</h4>
                            <p className="mt-1 line-clamp-2 text-sm text-gray-500">{firstLine(p.description)}</p>
                            <Link href="/login" className="mt-3 inline-flex items-center gap-1.5 text-sm font-black text-brand-700 hover:underline"><Lock className="h-3.5 w-3.5" /> View Price</Link>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Enquiry */}
        <section className="mx-auto max-w-7xl px-4 py-12 md:px-6"><EnquiryForm /></section>

        {/* Dealer CTA band */}
        <section className="bg-brand-700">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-10 text-center md:flex-row md:px-6 md:text-left">
            <div>
              <h3 className="text-2xl font-black text-white">Ready to order?</h3>
              <p className="mt-1 font-medium text-brand-100">Register as a dealer or farmer, get approved, and order online with pricing built for you.</p>
            </div>
            <div className="flex gap-3">
              <Link href="/register?type=dealer" className="rounded-xl bg-white px-6 py-3.5 font-black text-brand-800 hover:bg-brand-50">Become a Dealer</Link>
              <Link href="/register?type=farmer" className="rounded-xl border border-white/40 px-6 py-3.5 font-black text-white hover:bg-white/10">Farmer Registration</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-gray-900 text-gray-400">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:grid-cols-3 md:px-6">
          <div>
            <img src="/brand/logo2.png" alt="Akshat Fertilizers" className="mb-3 h-12 w-auto brightness-0 invert" />
            <p className="text-sm">Akshat Fertilizers &amp; Chemicals Industries Ltd. — crop nutrition for healthy fields and higher yields.</p>
          </div>
          <div>
            <p className="mb-2 font-black text-white">Contact</p>
            <p className="text-sm"><a href={telLink()} className="hover:text-white">{OFFICIAL_PHONE_DISPLAY}</a></p>
            <p className="text-sm"><a href="mailto:akshatfertilizers@gmail.com" className="hover:text-white">akshatfertilizers@gmail.com</a></p>
          </div>
          <div>
            <p className="mb-2 flex items-center gap-1.5 font-black text-white"><ShieldCheck className="h-4 w-4" /> Customers</p>
            <p className="text-sm"><Link href="/login" className="hover:text-white">Login</Link></p>
            <p className="text-sm"><Link href="/register?type=dealer" className="hover:text-white">Become a dealer</Link> · <Link href="/register?type=farmer" className="hover:text-white">Farmer registration</Link></p>
          </div>
        </div>
        <div className="border-t border-gray-800 py-4 text-center text-xs">© {new Date().getFullYear()} Akshat Fertilizers &amp; Chemicals Industries Ltd.</div>
      </footer>
    </div>
  );
}
