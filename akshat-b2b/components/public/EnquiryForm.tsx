'use client';
import { useState } from 'react';
import { CheckCircle2, MessageCircle, Phone, Send } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { OFFICIAL_PHONE_DISPLAY, telLink, waLink } from '@/lib/whatsapp';
import { Alert, Spinner } from '@/components/ui';

/** Enquiry form → emails the admin inbox, with WhatsApp & Call quick-actions. */
export function EnquiryForm() {
  const [f, setF] = useState({ name: '', mobile: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const text = `Enquiry from ${f.name || 'a customer'} (${f.mobile || 'no number'}): ${f.message || 'I would like to know more about Akshat products.'}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.name.trim().length < 2) return setError('Please enter your name.');
    if (!/^[0-9+ ]{10,15}$/.test(f.mobile.trim())) return setError('Please enter a valid mobile number.');
    setBusy(true);
    try {
      await apiFetch('/api/enquiry', { method: 'POST', json: f });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your enquiry. Please WhatsApp us instead.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="text-2xl font-black text-gray-900">Have a question?</h3>
        <p className="mt-2 text-gray-600">Send us an enquiry — we’ll get back to you. You can also reach us instantly on WhatsApp or by phone for products, pricing and dealership.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href={telLink()} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-black text-white hover:bg-brand-700"><Phone className="h-4 w-4" /> {OFFICIAL_PHONE_DISPLAY}</a>
          <a href={waLink('Hello Akshat Fertilizers, I have an enquiry.')} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl border border-brand-300 bg-brand-50 px-5 py-3 font-black text-brand-700 hover:bg-brand-100"><MessageCircle className="h-4 w-4" /> WhatsApp</a>
        </div>
      </div>
      {sent ? (
        <div className="card flex flex-col items-center justify-center gap-3 p-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-brand-600" />
          <h4 className="text-lg font-black text-gray-900">Thank you!</h4>
          <p className="text-sm text-gray-600">Your enquiry has reached our team. We’ll contact you shortly on the number you provided.</p>
          <button type="button" onClick={() => { setSent(false); setF({ name: '', mobile: '', message: '' }); }} className="btn-secondary">Send another</button>
        </div>
      ) : (
        <form onSubmit={submit} className="card space-y-3 p-5">
          {error && <Alert>{error}</Alert>}
          <div><label className="label">Your name</label><input className="input" required value={f.name} onChange={set('name')} /></div>
          <div><label className="label">Mobile</label><input className="input" type="tel" required value={f.mobile} onChange={set('mobile')} /></div>
          <div><label className="label">Message</label><textarea className="input" rows={3} value={f.message} onChange={set('message')} placeholder="I'm interested in…" /></div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" disabled={busy}>{busy ? <Spinner /> : <Send className="h-4 w-4" />} Send enquiry</button>
            <a href={waLink(text)} target="_blank" rel="noopener" className="btn-secondary" title="Send on WhatsApp instead"><MessageCircle className="h-4 w-4" /></a>
          </div>
        </form>
      )}
    </div>
  );
}
