# Akshat Fertilizer — B2B ERP & Distribution Portal

Next.js 14 (App Router) · TypeScript · Tailwind · Supabase (Postgres + Auth + RLS) · Vercel

## Routes

| Path | Who | What |
|---|---|---|
| `/home` | dealers | Catalog of their state godown's stock, available-credit banner, cart with ₹50k minimum (`/` redirects here) |
| `/admin/dashboard` | admins | Operations pipeline (settle drawer) · Finance & aging · Godown stock transfer · KYC approvals |
| `/login`, `/register` | everyone | Supabase email/password auth; registration captures GSTIN, state and business name |

## Business rules (enforced in Postgres, mirrored in the API)

| Rule | Where |
|---|---|
| KYC: new dealers are `is_approved = false`; RLS hides all stock and the order RPC rejects them | `users`, `my_approved_godown()`, `create_b2b_order()` |
| ₹50,000 minimum on subtotal (ex-GST, ex-freight) | API pre-check + RPC + `orders.subtotal >= 50000` CHECK |
| Freight: Maharashtra ₹2,500 · Madhya Pradesh ₹1,500 · other ₹3,000 | `freight_for_state()` / `lib/business.ts` |
| Stock is per godown; dealers see only their state's godown; deduction is row-locked and atomic, shortfall → **HTTP 422** | `inventory`, `create_b2b_order()` |
| 15-day credit; 2% early-payment discount stripped once `today > due_date` | `recalculate_aging()` |
| > 90 days since purchase: `penalty = base × 0.18 / 365 × days_past_due` | `recalculate_aging()` |
| Admin can waive interest / re-apply discount / record payments | `/api/finance/adjust` |
| **Settle** an invoice from the Operations drawer: books the remaining balance as received on the chosen date; discount and interest are recomputed as of that date | `settle_order()` · `/api/admin/orders/:id/settle` |
| Tally Edit Log 7.1: only admin-locked, un-synced orders are exported; locked voucher fields are immutable (DB trigger) | `/api/tally/sync`, `tg_orders_tally_guard` |
| Credit limit: outstanding + new invoice must be ≤ limit | `create_b2b_order()` |

## Local setup

```bash
cp .env.local.example .env.local   # fill in Supabase keys
# Supabase dashboard -> SQL editor: run supabase/migrations/001_init.sql, then supabase/seed.sql
# (or: supabase link && supabase db push)
npm run dev
```

Create the first admin: register at `/register` (any GSTIN), then in the SQL editor:

```sql
update public.users set role = 'admin', is_approved = true where email = 'you@akshatfertilizer.com';
```

## API

| Method | Path | Auth |
|---|---|---|
| POST | `/api/orders/create` `{items:[{product_id,qty}], client_ref?}` | buyer bearer token |
| GET/POST | `/api/finance/aging[?as_of=YYYY-MM-DD]` | admin, or `Bearer $CRON_SECRET` |
| POST | `/api/finance/adjust` `{order_id, action: WAIVE_INTEREST\|REAPPLY_DISCOUNT\|RECORD_PAYMENT, amount?}` | admin |
| GET | `/api/tally/sync[?format=json]` → Tally XML (Import Data / Vouchers) | `x-api-key: $TALLY_SYNC_API_KEY` or admin |
| POST | `/api/tally/sync` `{order_ids:[...]}` → marks `tally_synced = true` after a successful import | same |
| POST | `/api/admin/orders/:id/status` `{status}` · `/api/admin/orders/:id/lock` | admin |
| POST | `/api/admin/orders/:id/settle` `{paid_on?, reference?, note?}` | admin |
| POST | `/api/admin/kyc` · `/api/admin/stock` | admin |

Tally connector loop (on the accounts PC, Tally listening on :9000):

```bash
curl -s -H "x-api-key: $KEY" https://b2b.akshatfertilizer.com/api/tally/sync -D h.txt -o v.xml
curl -s -X POST --data-binary @v.xml http://localhost:9000            # import into Tally Prime
IDS=$(grep -i '^x-order-ids:' h.txt | cut -d' ' -f2 | tr -d '\r')
[ -n "$IDS" ] && curl -s -X POST -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d "{\"order_ids\":[\"${IDS//,/\",\"}\"]}" https://b2b.akshatfertilizer.com/api/tally/sync
```

Only acknowledge after Tally reports `CREATED` with zero `ERRORS`. Party ledgers must exist in Tally with the dealer's business name; stock item names must match product names.

## Deploy: Vercel + cPanel subdomain (apex PHP site untouched)

1. Push this repo to GitHub → Vercel → **Add New Project** → import, and set **Root Directory** to `akshat-b2b` (the repo root is the static catalogue site, which ignores this folder via `/.vercelignore`). Add every variable from `.env.local.example` (Production + Preview).
2. Vercel → Project → **Settings → Domains** → add `b2b.akshatfertilizer.com`. Vercel shows the CNAME target to use.
3. cPanel → **Zone Editor** → `akshatfertilizer.com` → **+ CNAME Record**
   - Name: `b2b` · TTL: `300` · Record: the value Vercel shows (e.g. `cname.vercel-dns.com.`)
   - Do **not** edit the apex `A` record or `www` — the PHP site keeps running on the cPanel host.
   - If a `b2b` A record or a cPanel subdomain already exists, delete it first (a name cannot have both A and CNAME).
4. Wait for DNS (`dig +short b2b.akshatfertilizer.com CNAME`); Vercel issues the SSL certificate automatically.
5. Supabase → **Authentication → URL Configuration**: Site URL `https://b2b.akshatfertilizer.com`; add `https://b2b.akshatfertilizer.com/**` to Redirect URLs.
6. `CRON_SECRET` set in Vercel enables the daily aging cron from `vercel.json`.
