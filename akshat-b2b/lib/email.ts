import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Gmail SMTP transport (smtp.gmail.com:465, secure). Credentials come from env:
 *   GMAIL_USER             – the sending Gmail address
 *   GMAIL_APP_PASSWORD     – a 16-char Google App Password (NOT the account password)
 *   ADMIN_NOTIFICATION_EMAIL – comma-separated inbox(es) for admin alerts + the
 *                              login admin-bypass list (falls back to GMAIL_USER)
 *
 * Everything degrades gracefully: with no credentials set, sendMail() logs a
 * warning and returns false instead of throwing, so registration / orders /
 * approvals keep working before the Gmail integration is configured.
 */
const GMAIL_USER = process.env.GMAIL_USER?.trim();
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, ''); // Google shows it in 4-char groups

let transporter: Transporter | null = null;
function getTransport(): Transporter | null {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
  }
  return transporter;
}

export function emailConfigured(): boolean {
  return Boolean(GMAIL_USER && GMAIL_APP_PASSWORD);
}

/** Admin alert recipients + the login admin-bypass allow-list (lower-cased). */
export function adminEmails(): string[] {
  const raw = process.env.ADMIN_NOTIFICATION_EMAIL || GMAIL_USER || '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

interface MailOpts {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}

/**
 * Best-effort send — never throws. Returns true only if Gmail accepted the mail.
 * Callers can ignore the result; a transient SMTP failure must not break the API
 * action that triggered the notification.
 */
export async function sendMail(opts: MailOpts): Promise<boolean> {
  const t = getTransport();
  const to = (Array.isArray(opts.to) ? opts.to : [opts.to]).map((s) => s.trim()).filter(Boolean);
  if (!to.length) return false;
  if (!t) {
    console.warn(`[email] skipped "${opts.subject}" — GMAIL_USER / GMAIL_APP_PASSWORD not configured`);
    return false;
  }
  try {
    await t.sendMail({
      from: `"Akshat Fertilizers" <${GMAIL_USER}>`,
      to: to.join(', '),
      subject: opts.subject,
      html: opts.html,
      replyTo: opts.replyTo,
    });
    return true;
  } catch (err) {
    console.error(`[email] failed to send "${opts.subject}":`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Fire-and-forget helper: sends in the background, swallows any error. */
export function sendMailSafe(opts: MailOpts): void {
  void sendMail(opts).catch(() => {});
}
