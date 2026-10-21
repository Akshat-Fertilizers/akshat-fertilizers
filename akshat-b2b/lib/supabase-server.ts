import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { Profile } from '@/lib/types';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new HttpError(500, 'CONFIG_ERROR', `Server misconfigured: ${name} is not set`);
  return v;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** Service-role client. Bypasses RLS — only use after authorising the caller. */
export function serviceClient(): SupabaseClient {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), noSession);
}

/** Client acting as the end user: RLS + auth.uid() apply. */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    ...noSession,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export interface AuthContext {
  user: User;
  profile: Profile;
  token: string;
  db: SupabaseClient;
  admin: SupabaseClient;
}

export function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() || null : null;
}

export async function requireUser(req: Request): Promise<AuthContext> {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Missing bearer token');
  const admin = serviceClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Session expired — please sign in again');
  const { data: profile, error: pErr } = await admin.from('users').select('*').eq('id', data.user.id).single();
  if (pErr || !profile) throw new HttpError(403, 'PROFILE_NOT_FOUND', 'No business profile linked to this login');
  return { user: data.user, profile: profile as Profile, token, db: userClient(token), admin };
}

export async function requireAdmin(req: Request): Promise<AuthContext> {
  const ctx = await requireUser(req);
  if (ctx.profile.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Admin access required');
  return ctx;
}

/** Constant-time string compare for API keys / cron secrets. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Maps `RAISE EXCEPTION 'CODE: message'` from PL/pgSQL to HTTP status codes.
const DB_ERROR_STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  KYC_NOT_APPROVED: 403,
  ONLY_BUYERS_CAN_ORDER: 403,
  PROFILE_NOT_FOUND: 403,
  NO_GODOWN_ASSIGNED: 409,
  INVALID_ITEMS: 400,
  INVALID_AMOUNT: 400,
  INVALID_TARGET: 400,
  INVALID_DATE: 400,
  SAME_GODOWN: 400,
  PRODUCT_NOT_AVAILABLE: 422,
  INSUFFICIENT_STOCK: 422,
  MIN_ORDER_VALUE_NOT_MET: 422,
  CREDIT_LIMIT_EXCEEDED: 422,
  OVERPAYMENT: 422,
  KYC_INCOMPLETE: 422,
  ORDER_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  NOT_LOCKABLE: 409,
  TALLY_LOCKED: 409,
  ORDER_ALREADY_PAID: 409,
};

export function mapDbError(err: { message: string; details?: string | null; code?: string }): HttpError {
  const m = /^([A-Z_]+):\s*([\s\S]*)$/.exec(err.message ?? '');
  let details: unknown = err.details ?? undefined;
  if (typeof details === 'string') {
    try {
      details = JSON.parse(details);
    } catch {
      /* keep raw string */
    }
  }
  if (m && DB_ERROR_STATUS[m[1]]) return new HttpError(DB_ERROR_STATUS[m[1]], m[1], m[2], details);
  if (err.code === '23514') return new HttpError(422, 'CONSTRAINT_VIOLATION', err.message, details);
  if (err.code === '23505') return new HttpError(409, 'DUPLICATE', err.message, details);
  if (err.code === '42501') return new HttpError(403, 'FORBIDDEN', 'Not permitted');
  console.error('[db]', err);
  return new HttpError(500, 'DB_ERROR', 'Unexpected database error');
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  console.error('[api]', err);
  return NextResponse.json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, { status: 500 });
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler with uniform JSON error handling. */
export function route<C = { params: Record<string, string> }>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
}

/** Throws a mapped HttpError if a Supabase call failed; returns data otherwise. */
export function unwrap<T>(res: { data: T | null; error: { message: string; details?: string | null; code?: string } | null }): T {
  if (res.error) throw mapDbError(res.error);
  return res.data as T;
}
