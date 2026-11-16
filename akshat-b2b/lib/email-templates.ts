import 'server-only';
import type { Order, Role } from '@/lib/types';
import { formatDate, formatINR } from '@/lib/utils';
import { OFFICIAL_PHONE_DISPLAY } from '@/lib/whatsapp';

/** Branded HTML email templates (Akshat Fertilizers green theme). */

const BRAND = '#15803d'; // brand-700
const BRAND_DARK = '#14532d'; // brand-900
const BRAND_TINT = '#f0fdf4'; // brand-50
const BORDER = '#dcfce7'; // brand-100
const INK = '#14342a';
const MUTE = '#5b6b63';

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://akshat-b2b.vercel.app').replace(/\/$/, '');
}

const roleLabel = (r: Role | string) => (r === 'DEALER' ? 'Dealer' : r === 'FARMER' ? 'Farmer' : 'Admin');
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Page shell: header band + card + contact footer. Table-based for email clients. */
function shell(opts: { heading: string; intro?: string; body: string; cta?: { label: string; href: string } }): string {
  const cta = opts.cta
    ? `<tr><td style="padding:8px 0 4px"><a href="${opts.cta.href}" style="display:inline-block;background:${BRAND};color:#fff;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px;font-size:15px">${esc(opts.cta.label)}</a></td></tr>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f7f5;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid ${BORDER};border-radius:16px;overflow:hidden">
    <tr><td style="background:${BRAND_DARK};padding:20px 28px">
      <span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:.3px">AKSHAT&nbsp;FERTILIZER</span>
      <span style="color:#86efac;font-size:12px;display:block;margin-top:2px">B2B Dealer &amp; Farmer Portal</span>
    </td></tr>
    <tr><td style="padding:28px">
      <h1 style="margin:0 0 10px;font-size:20px;color:${BRAND_DARK}">${esc(opts.heading)}</h1>
      ${opts.intro ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${INK}">${opts.intro}</p>` : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${opts.body}${cta}</table>
    </td></tr>
    <tr><td style="padding:16px 28px;background:${BRAND_TINT};border-top:1px solid ${BORDER};font-size:12px;color:${MUTE}">
      Akshat Fertilizers · Call / WhatsApp ${OFFICIAL_PHONE_DISPLAY}<br>
      This is an automated message from the Akshat Fertilizers portal.
    </td></tr>
  </table></body></html>`;
}

function infoRow(label: string, value: string, strong = false): string {
  return `<tr>
    <td style="padding:6px 0;font-size:13px;color:${MUTE};width:46%">${esc(label)}</td>
    <td style="padding:6px 0;font-size:14px;color:${INK};font-weight:${strong ? 700 : 500};text-align:right">${value}</td>
  </tr>`;
}

function card(rowsHtml: string): string {
  return `<tr><td style="padding:4px 0 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:12px;padding:6px 16px;background:${BRAND_TINT}">${rowsHtml}</table></td></tr>`;
}

// ---------------------------------------------------------------- Customer ----

export function registrationReceived(name: string | null, role: Role | string) {
  return {
    subject: 'We received your Akshat Fertilizers registration',
    html: shell({
      heading: `Welcome${name ? ', ' + esc(name) : ''}!`,
      intro: `Thank you for registering with Akshat Fertilizers as a <b>${roleLabel(role)}</b>. Our team will contact you on WhatsApp or by phone to collect the required documents and complete your registration. In the meantime, you can continue browsing our website.`,
      body: card(infoRow('Account type', roleLabel(role), true) + infoRow('Status', 'Pending approval')),
      cta: { label: 'Browse the catalogue', href: siteUrl() },
    }),
  };
}

export function accountApproved(name: string | null, role: Role | string) {
  const dealer = role === 'DEALER';
  return {
    subject: 'Your Akshat Fertilizers account is approved ✓',
    html: shell({
      heading: `You're approved${name ? ', ' + esc(name) : ''}!`,
      intro: `Your ${roleLabel(role)} account has been <b>approved</b>. You can now log in to the portal to view ${dealer ? 'dealer pricing, volume discounts and 15-day credit' : 'farmer pricing'} and place orders.`,
      body: card(
        infoRow('Account type', roleLabel(role), true) +
          (dealer
            ? infoRow('Benefits', '15-day credit · volume discount slabs')
            : infoRow('Payment', 'Advance payment (we share instructions)')),
      ),
      cta: { label: 'Log in to the portal', href: `${siteUrl()}/login` },
    }),
  };
}

export function accountRejected(name: string | null) {
  return {
    subject: 'About your Akshat Fertilizers registration',
    html: shell({
      heading: `Hello${name ? ', ' + esc(name) : ''}`,
      intro:
        'Thank you for your interest in Akshat Fertilizers. We were unable to approve your registration at this time. Please contact our team on WhatsApp or phone and we will be glad to help you proceed.',
      body: card(infoRow('Status', 'Not approved', true)),
      cta: { label: 'Contact us', href: siteUrl() },
    }),
  };
}

export function orderConfirmation(order: Order, name: string | null) {
  const dealer = order.customer_type === 'DEALER';
  const rows =
    infoRow('Order number', esc(order.order_number), true) +
    infoRow('Subtotal', formatINR(order.subtotal)) +
    (Number(order.discount_amount) > 0 ? infoRow('Discount applied', '– ' + formatINR(order.discount_amount)) : '') +
    infoRow('Order total', formatINR(order.final_amount), true) +
    infoRow('Payment terms', dealer ? '15-day credit' : 'Advance payment') +
    (order.due_date ? infoRow('Payment due by', formatDate(order.due_date)) : '') +
    (order.is_below_min_order ? infoRow('Note', 'Below ₹50,000 — under commercial review') : '');
  return {
    subject: `Order ${order.order_number} received — Akshat Fertilizers`,
    html: shell({
      heading: 'Order received',
      intro: `Thank you${name ? ', ' + esc(name) : ''} — we have received your order. Our team will confirm it offline and share the next steps${dealer ? '' : ', including advance-payment instructions'}.`,
      body: card(rows),
      cta: { label: 'View your orders', href: `${siteUrl()}/portal` },
    }),
  };
}

// ------------------------------------------------------------------- Admin ----

export function adminNewRegistration(p: { full_name?: string | null; role: Role | string; email?: string | null; mobile?: string | null; entity_name?: string | null; state?: string | null; city?: string | null }) {
  return {
    subject: `New ${roleLabel(p.role)} registration: ${p.entity_name || p.full_name || p.email || 'customer'}`,
    html: shell({
      heading: 'New registration to review',
      intro: 'A new customer has registered and is pending KYC approval.',
      body: card(
        infoRow('Name', esc(p.full_name || '—'), true) +
          infoRow('Type', roleLabel(p.role)) +
          infoRow('Business / Farm', esc(p.entity_name || '—')) +
          infoRow('Mobile', esc(p.mobile || '—')) +
          infoRow('Email', esc(p.email || '—')) +
          infoRow('Location', esc([p.city, p.state].filter(Boolean).join(', ') || '—')),
      ),
      cta: { label: 'Open the admin dashboard', href: `${siteUrl()}/admin/dashboard` },
    }),
  };
}

export function adminNewOrder(order: Order, p: { full_name?: string | null; entity_name?: string | null; role: Role | string }) {
  return {
    subject: `New order ${order.order_number} · ${formatINR(order.final_amount)}`,
    html: shell({
      heading: 'New order received',
      intro: 'A customer has placed a new order on the portal.',
      body: card(
        infoRow('Order number', esc(order.order_number), true) +
          infoRow('Customer', esc(p.entity_name || p.full_name || '—')) +
          infoRow('Type', roleLabel(p.role)) +
          infoRow('Order total', formatINR(order.final_amount), true) +
          infoRow('Payment terms', order.customer_type === 'DEALER' ? '15-day credit' : 'Advance payment') +
          (order.is_below_min_order ? infoRow('Flag', 'Below ₹50,000 request') : ''),
      ),
      cta: { label: 'Open the admin dashboard', href: `${siteUrl()}/admin/dashboard` },
    }),
  };
}

export function adminEnquiry(p: { name: string; mobile: string; message: string }) {
  return {
    subject: `Website enquiry from ${p.name || p.mobile || 'a visitor'}`,
    html: shell({
      heading: 'New website enquiry',
      intro: 'Someone submitted the enquiry form on the public website.',
      body: card(
        infoRow('Name', esc(p.name || '—'), true) +
          infoRow('Mobile', esc(p.mobile || '—')) +
          `<tr><td colspan="2" style="padding:10px 0 4px;font-size:13px;color:${MUTE}">Message</td></tr>
           <tr><td colspan="2" style="padding:0 0 6px;font-size:14px;color:${INK};line-height:1.5">${esc(p.message || '—')}</td></tr>`,
      ),
    }),
  };
}
