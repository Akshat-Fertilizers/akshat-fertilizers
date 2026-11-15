'use client';
import { useState } from 'react';
import { MessageCircle, Phone, Send } from 'lucide-react';
import { OFFICIAL_PHONE_DISPLAY, telLink, waLink } from '@/lib/whatsapp';

/** Enquiry form → composes a WhatsApp message (offline coordination), plus a Call CTA. */
export function EnquiryForm() {
  const [f, setF] = useState({ name: '', mobile: '', message: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const text = `Enquiry from ${f.name || 'a customer'} (${f.mobile || 'no number'}): ${f.message || 'I would like to know more about Akshat products.'}`;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="text-2xl font-black text-gray-900">Have a question?</h3>
        <p className="mt-2 text-gray-600">Send us an enquiry on WhatsApp or call us directly — our team will help you with products, pricing and dealership.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href={telLink()} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-black text-white hover:bg-brand-700"><Phone className="h-4 w-4" /> {OFFICIAL_PHONE_DISPLAY}</a>
          <a href={waLink('Hello Akshat Fertilizers, I have an enquiry.')} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl border border-brand-300 bg-brand-50 px-5 py-3 font-black text-brand-700 hover:bg-brand-100"><MessageCircle className="h-4 w-4" /> WhatsApp</a>
        </div>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); window.open(waLink(text), '_blank'); }}
        className="card space-y-3 p-5"
      >
        <div><label className="label">Your name</label><input className="input" required value={f.name} onChange={set('name')} /></div>
        <div><label className="label">Mobile</label><input className="input" type="tel" required value={f.mobile} onChange={set('mobile')} /></div>
        <div><label className="label">Message</label><textarea className="input" rows={3} value={f.message} onChange={set('message')} placeholder="I'm interested in…" /></div>
        <button className="btn-primary w-full"><Send className="h-4 w-4" /> Send on WhatsApp</button>
      </form>
    </div>
  );
}
