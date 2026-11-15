'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Leaf, Phone } from 'lucide-react';

const PHONE = '+919131283429';

type Slide = {
  kind: 'split' | 'image' | 'gradient';
  bg: string; // tailwind bg classes (gradient) for split/gradient
  image?: string; // full-bleed image for 'image'
  poster?: string; // featured portrait for 'split'
  eyebrow: string;
  title: string;
  accent?: string; // highlighted word, gradient-filled
  subtitle: string;
  hindi?: string;
};

const SLIDES: Slide[] = [
  {
    kind: 'split',
    bg: 'bg-[radial-gradient(120%_120%_at_0%_0%,#052e16_0%,#14532d_45%,#166534_100%)]',
    poster: '/brand/seerin-poster.png',
    eyebrow: 'Seerin® · Good Seeds, Healthy Field',
    title: 'Nutrition right to the',
    accent: 'roots',
    subtitle: 'Fully water-soluble crop nutrition that reaches where it matters — engineered by Akshat for stronger roots and higher yields.',
    hindi: 'सीरीन उर्वरक — जड़ों तक पोषण',
  },
  {
    kind: 'image',
    bg: '',
    image: '/brand/1579185604slide1.jpg',
    eyebrow: 'Direct from the manufacturer',
    title: 'Healthy crops.',
    accent: 'Higher yields.',
    subtitle: 'Water-soluble NPK, micronutrients, bio-stimulants and crop protection — trusted by farmers across India.',
  },
  {
    kind: 'gradient',
    bg: 'bg-[radial-gradient(130%_130%_at_100%_0%,#166534_0%,#15803d_40%,#22c55e_100%)]',
    eyebrow: '56 products · 6 categories',
    title: 'One trusted source for your',
    accent: 'whole season',
    subtitle: 'From greenhouse-grade NPK to premium crop specials — browse the full Akshat range and order in a tap.',
  },
];

export function HeroCarousel() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = SLIDES.length;
  const go = useCallback((d: number) => setI((p) => (p + d + n) % n), [n]);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setI((p) => (p + 1) % n), 5500);
    return () => clearInterval(t);
  }, [paused, n]);

  return (
    <section
      className="relative mx-auto mt-4 max-w-[1400px] overflow-hidden rounded-[2rem] px-0 shadow-2xl shadow-brand-900/10"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
    >
      <div className="relative h-[560px] sm:h-[600px]">
        {SLIDES.map((s, idx) => {
          const active = idx === i;
          return (
            <div
              key={idx}
              className={`absolute inset-0 transition-all duration-700 ease-out ${active ? 'z-10 scale-100 opacity-100' : 'pointer-events-none scale-[1.03] opacity-0'}`}
              aria-hidden={!active}
            >
              {/* Background */}
              {s.kind === 'image' ? (
                <>
                  <img src={s.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-r from-brand-950/90 via-brand-950/55 to-transparent" />
                </>
              ) : (
                <div className={`absolute inset-0 ${s.bg}`} />
              )}
              {/* soft lime glow accent */}
              <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-400/20 blur-3xl" />

              {/* Content */}
              <div className="relative z-10 mx-auto flex h-full max-w-7xl items-center px-6 md:px-10">
                <div className={`grid w-full items-center gap-8 ${s.poster ? 'md:grid-cols-[1.1fr_0.9fr]' : 'grid-cols-1'}`}>
                  <div className={`max-w-xl ${active ? 'animate-[fadeIn_0.7s_ease-out]' : ''}`}>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-black uppercase tracking-widest text-brand-100 backdrop-blur">
                      <Leaf className="h-3.5 w-3.5" /> {s.eyebrow}
                    </span>
                    <h2 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight text-white drop-shadow sm:text-5xl md:text-6xl">
                      {s.title}{' '}
                      {s.accent && <span className="bg-gradient-to-r from-brand-300 to-lime-200 bg-clip-text text-transparent">{s.accent}</span>}
                    </h2>
                    {s.hindi && <p className="mt-3 text-xl font-bold text-brand-200">{s.hindi}</p>}
                    <p className="mt-4 max-w-md text-base font-medium text-white/80 sm:text-lg">{s.subtitle}</p>
                    <div className="mt-7 flex flex-wrap gap-3">
                      <a href="#products" className="group inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 font-black text-brand-800 shadow-lg transition hover:bg-brand-50">
                        See Products <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                      </a>
                      <a href={`tel:${PHONE}`} className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-6 py-3.5 font-black text-white backdrop-blur transition hover:bg-white/20">
                        <Phone className="h-4 w-4" /> Call to Order
                      </a>
                    </div>
                  </div>

                  {s.poster && (
                    <div className="hidden justify-center md:flex">
                      <div className="relative">
                        <div className="absolute -inset-4 rounded-[1.75rem] bg-brand-400/20 blur-2xl" />
                        <img
                          src={s.poster}
                          alt="Seerin fertilizer"
                          className="relative w-[260px] rotate-2 rounded-2xl border-4 border-white/80 shadow-2xl transition duration-700 hover:rotate-0 lg:w-[300px]"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Arrows */}
        <button onClick={() => go(-1)} aria-label="Previous slide" className="absolute left-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/20 bg-white/10 p-2.5 text-white backdrop-blur transition hover:bg-white/25 md:left-5">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button onClick={() => go(1)} aria-label="Next slide" className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/20 bg-white/10 p-2.5 text-white backdrop-blur transition hover:bg-white/25 md:right-5">
          <ChevronRight className="h-5 w-5" />
        </button>

        {/* Dots */}
        <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 gap-2">
          {SLIDES.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setI(idx)}
              aria-label={`Go to slide ${idx + 1}`}
              className={`h-2.5 rounded-full transition-all duration-300 ${idx === i ? 'w-8 bg-white' : 'w-2.5 bg-white/40 hover:bg-white/70'}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
