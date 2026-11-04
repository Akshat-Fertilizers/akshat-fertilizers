#!/usr/bin/env bash
# =============================================================================
#  Akshat Fertilizer — B2B ERP & Distribution Portal : repository bootstrap
#
#  Usage:   chmod +x setup.sh && ./setup.sh [project-dir]     (default: akshat-b2b)
#  Needs:   macOS/Linux, Node.js >= 18.17, npm, git
#  Builds:  Next.js 14 (App Router, TS, Tailwind, @/* alias) + Supabase schema,
#           RLS, atomic order RPC, aging engine, Tally XML sync, buyer + admin UI.
# =============================================================================
set -euo pipefail

PROJECT_DIR="${1:-akshat-b2b}"
NEXT_MAJOR="14"   # spec: Next.js 14 — pinned so create-next-app does not pull a newer major

c_ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
c_step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
die()    { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

c_step "Pre-flight checks"
command -v node >/dev/null || die "Node.js is required (brew install node@20)"
command -v npm  >/dev/null || die "npm is required"
command -v git  >/dev/null || die "git is required"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
NODE_MINOR=$(node -p 'process.versions.node.split(".")[1]')
if [ "$NODE_MAJOR" -lt 18 ] || { [ "$NODE_MAJOR" -eq 18 ] && [ "$NODE_MINOR" -lt 17 ]; }; then
  die "Node.js >= 18.17 required (found $(node -v))"
fi
[ -e "$PROJECT_DIR" ] && die "'$PROJECT_DIR' already exists — choose another directory or remove it"
c_ok "node $(node -v), npm $(npm -v)"

c_step "Scaffolding Next.js ${NEXT_MAJOR} (App Router, TypeScript, Tailwind, ESLint, @/* alias)"
npx --yes "create-next-app@${NEXT_MAJOR}" "$PROJECT_DIR" \
  --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm
cd "$PROJECT_DIR"

c_step "Installing runtime dependencies"
npm install --save @supabase/supabase-js@^2 lucide-react clsx@^2 tailwind-merge@^2

c_step "Removing scaffold defaults replaced by route groups"
rm -f app/page.tsx            # "/" is served by app/(storefront)/page.tsx
rm -rf app/fonts              # system font stack used instead
rm -f next.config.js next.config.ts

c_step "Writing project files"

# ---------------------------------------------------------------- supabase/migrations/001_init.sql
mkdir -p "supabase/migrations"
cat << 'EOF' > "supabase/migrations/001_init.sql"
-- =============================================================================
-- Akshat Fertilizer B2B ERP & Distribution Portal — initial schema
-- Target: Supabase (PostgreSQL 15+)
--
-- Write model:
--   * Buyers write ONLY through create_b2b_order() (SECURITY DEFINER RPC).
--   * Admin writes go through Next.js API routes that verify the admin role and
--     then call the service-role-only functions below.
--   * Direct INSERT/UPDATE/DELETE from anon/authenticated is revoked.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.user_role      as enum ('buyer', 'admin');
create type public.order_status   as enum ('PENDING', 'APPROVED', 'DISPATCHED', 'DELIVERED', 'CANCELLED');
create type public.payment_status as enum ('UNPAID', 'PARTIAL', 'PAID');
create type public.credit_event   as enum (
  'ORDER_DEBIT', 'ORDER_REVERSAL', 'PAYMENT_CREDIT',
  'DISCOUNT_STRIPPED', 'DISCOUNT_REAPPLIED',
  'INTEREST_ACCRUED', 'INTEREST_WAIVED',
  'CREDIT_LIMIT_CHANGED', 'KYC_APPROVED', 'KYC_REVOKED'
);
create type public.stock_movement_type as enum ('INWARD', 'TRANSFER', 'WRITE_OFF');

-- -----------------------------------------------------------------------------
-- Business constants (single source of truth for SQL; mirrored in lib/business.ts)
-- -----------------------------------------------------------------------------
create or replace function public.af_min_order_value()       returns numeric language sql immutable as $$ select 50000::numeric $$;
create or replace function public.af_credit_days()           returns integer language sql immutable as $$ select 15 $$;
create or replace function public.af_early_discount_pct()    returns numeric language sql immutable as $$ select 2.00::numeric $$;
create or replace function public.af_interest_apy()          returns numeric language sql immutable as $$ select 0.18::numeric $$;
create or replace function public.af_interest_trigger_days() returns integer language sql immutable as $$ select 90 $$;
create or replace function public.af_today()                 returns date    language sql stable    as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- Dynamic state freight engine
create or replace function public.freight_for_state(p_state text)
returns numeric language sql immutable as $$
  select case lower(btrim(coalesce(p_state, '')))
           when 'maharashtra'    then 2500::numeric
           when 'madhya pradesh' then 1500::numeric
           else                       3000::numeric
         end
$$;

-- updated_at helper
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- godowns
-- -----------------------------------------------------------------------------
create table public.godowns (
  id            text primary key check (id ~ '^[A-Z][A-Z0-9_]*$'),
  name          text not null,
  state         text not null,
  gstin         text,
  served_states text[] not null default '{}',
  created_at    timestamptz not null default now()
);

insert into public.godowns (id, name, state, served_states) values
  ('MH_GODOWN', 'Maharashtra Godown',    'Maharashtra',    array['Maharashtra']),
  ('MP_GODOWN', 'Madhya Pradesh Godown', 'Madhya Pradesh', array['Madhya Pradesh']);

create or replace function public.godown_for_state(p_state text)
returns text language sql stable as $$
  select g.id from public.godowns g
  where exists (select 1 from unnest(g.served_states) s where lower(s) = lower(btrim(p_state)))
  order by g.id limit 1
$$;

-- -----------------------------------------------------------------------------
-- users (business profile, 1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  business_name text,
  gstin         text unique
                check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  state         text,
  phone         text,
  role          public.user_role not null default 'buyer',
  is_approved   boolean not null default false,
  credit_limit  numeric(14,2) not null default 0 check (credit_limit >= 0),
  godown_id     text references public.godowns (id),
  approved_at   timestamptz,
  approved_by   uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- An approved buyer must have complete KYC and a routed godown.
  constraint users_buyer_kyc_complete check (
    role = 'admin' or not is_approved
    or (gstin is not null and business_name is not null and state is not null and godown_id is not null)
  ),
  -- GSTIN state code must match the declared state for the godown states we serve.
  constraint users_gstin_state_match check (
    gstin is null or state is null
    or (lower(state) = 'maharashtra'    and left(gstin, 2) = '27')
    or (lower(state) = 'madhya pradesh' and left(gstin, 2) = '23')
    or lower(state) not in ('maharashtra', 'madhya pradesh')
  )
);
create index users_role_approved_idx on public.users (role, is_approved);
create trigger users_updated_at before update on public.users
  for each row execute function public.tg_set_updated_at();

-- Auto-provision profile on Supabase Auth sign-up (metadata from the register form).
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_state text := nullif(btrim(m->>'state'), '');
begin
  insert into public.users (id, email, business_name, gstin, state, phone, godown_id)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(btrim(m->>'business_name'), ''),
    nullif(upper(btrim(m->>'gstin')), ''),
    v_state,
    nullif(btrim(m->>'phone'), ''),
    public.godown_for_state(v_state)
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- products / inventory / stock movements
-- -----------------------------------------------------------------------------
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  sku          text not null unique,
  name         text not null,
  category     text not null default 'Fertilizer',
  hsn_code     text not null default '3105',
  unit         text not null default 'BAG',
  pack_size_kg numeric(10,2) not null default 50,
  price        numeric(12,2) not null check (price > 0),           -- per unit, ex-GST
  gst_rate     numeric(5,2)  not null default 5 check (gst_rate between 0 and 28),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger products_updated_at before update on public.products
  for each row execute function public.tg_set_updated_at();

create table public.inventory (
  godown_id  text not null references public.godowns (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  stock_qty  integer not null default 0 check (stock_qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (godown_id, product_id)
);
create index inventory_product_idx on public.inventory (product_id);

create table public.stock_movements (
  id             bigint generated always as identity primary key,
  movement_type  public.stock_movement_type not null,
  product_id     uuid not null references public.products (id),
  from_godown_id text references public.godowns (id),
  to_godown_id   text references public.godowns (id),
  qty            integer not null check (qty > 0),
  note           text,
  actor_id       uuid,
  created_at     timestamptz not null default now(),
  check (from_godown_id is distinct from to_godown_id),
  check (from_godown_id is not null or to_godown_id is not null)
);

-- -----------------------------------------------------------------------------
-- orders / order_items
-- -----------------------------------------------------------------------------
create sequence public.order_no_seq;

create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  order_no            text not null unique
                      default ('AF/' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '/'
                               || lpad(nextval('public.order_no_seq')::text, 6, '0')),
  client_ref          text,                                   -- idempotency key from the client
  buyer_id            uuid not null references public.users (id),
  godown_id           text not null references public.godowns (id),
  ship_to_state       text not null,
  status              public.order_status not null default 'PENDING',
  purchase_date       date not null default public.af_today(),
  due_date            date not null,
  subtotal            numeric(14,2) not null check (subtotal >= 50000),
  freight             numeric(14,2) not null check (freight >= 0),
  gst_amount          numeric(14,2) not null default 0 check (gst_amount >= 0),
  base_amount         numeric(14,2) not null,                 -- invoice value = subtotal + freight + GST
  early_discount_pct  numeric(5,2)  not null default 2,
  discount_amount     numeric(14,2) not null default 0 check (discount_amount >= 0),
  discount_stripped_at timestamptz,
  discount_override   boolean not null default false,         -- admin re-applied discount; aging won't strip it
  penalty_interest    numeric(14,2) not null default 0 check (penalty_interest >= 0),
  interest_waived     boolean not null default false,
  interest_waived_at  timestamptz,
  amount_due          numeric(14,2) generated always as (base_amount - discount_amount + penalty_interest) stored,
  amount_paid         numeric(14,2) not null default 0 check (amount_paid >= 0),
  payment_status      public.payment_status not null default 'UNPAID',
  paid_at             timestamptz,
  last_aged_on        date,
  notes               text,
  is_locked_for_tally boolean not null default false,
  locked_at           timestamptz,
  locked_by           uuid,
  tally_synced        boolean not null default false,
  tally_synced_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint orders_base_amount_ck   check (base_amount = subtotal + freight + gst_amount),
  constraint orders_due_ck           check (due_date >= purchase_date),
  constraint orders_sync_needs_lock  check (not tally_synced or is_locked_for_tally),
  constraint orders_client_ref_uq    unique (buyer_id, client_ref)
);
create index orders_buyer_idx    on public.orders (buyer_id, created_at desc);
create index orders_status_idx   on public.orders (status);
create index orders_open_ar_idx  on public.orders (due_date) where payment_status <> 'PAID' and status <> 'CANCELLED';
create index orders_tally_q_idx  on public.orders (locked_at) where is_locked_for_tally and not tally_synced;
create trigger orders_updated_at before update on public.orders
  for each row execute function public.tg_set_updated_at();

create table public.order_items (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references public.orders (id) on delete cascade,
  product_id   uuid not null references public.products (id),
  sku          text not null,
  product_name text not null,
  hsn_code     text not null,
  unit         text not null,
  qty          integer not null check (qty > 0),
  unit_price   numeric(12,2) not null check (unit_price > 0),
  gst_rate     numeric(5,2) not null,
  line_total   numeric(14,2) generated always as (round(qty * unit_price, 2)) stored,
  gst_amount   numeric(14,2) generated always as (round(qty * unit_price * gst_rate / 100, 2)) stored,
  unique (order_id, product_id)
);
create index order_items_order_idx on public.order_items (order_id);

-- -----------------------------------------------------------------------------
-- credit_logs (receivable ledger; + increases buyer's balance, - reduces it)
-- -----------------------------------------------------------------------------
create table public.credit_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.users (id) on delete cascade,
  order_id   uuid references public.orders (id),
  event      public.credit_event not null,
  amount     numeric(14,2) not null,
  note       text,
  actor_id   uuid,
  created_at timestamptz not null default now()
);
create index credit_logs_user_idx on public.credit_logs (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Tally Edit Log 7.1 guard: once an order is locked for Tally, the voucher-
-- relevant fields are immutable, it cannot be unlocked, cancelled or deleted,
-- and once synced it cannot be marked un-synced (prevents duplicate vouchers).
-- Payment / aging fields remain mutable (they are separate receipts/notes in Tally).
-- -----------------------------------------------------------------------------
create or replace function public.tg_orders_tally_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.is_locked_for_tally then
      raise exception 'TALLY_LOCKED: order % is locked for Tally and cannot be deleted', old.order_no;
    end if;
    return old;
  end if;

  if old.is_locked_for_tally then
    if not new.is_locked_for_tally then
      raise exception 'TALLY_LOCKED: order % cannot be unlocked', old.order_no;
    end if;
    if (new.order_no, new.buyer_id, new.godown_id, new.ship_to_state, new.purchase_date,
        new.subtotal, new.freight, new.gst_amount, new.base_amount)
       is distinct from
       (old.order_no, old.buyer_id, old.godown_id, old.ship_to_state, old.purchase_date,
        old.subtotal, old.freight, old.gst_amount, old.base_amount) then
      raise exception 'TALLY_LOCKED: voucher fields of % are immutable after lock', old.order_no;
    end if;
    if new.status = 'CANCELLED' and old.status <> 'CANCELLED' then
      raise exception 'TALLY_LOCKED: % is in Tally — raise a credit note instead of cancelling', old.order_no;
    end if;
  elsif new.is_locked_for_tally then
    if new.status not in ('APPROVED', 'DISPATCHED', 'DELIVERED') then
      raise exception 'NOT_LOCKABLE: only APPROVED/DISPATCHED/DELIVERED orders can be locked (got %)', new.status;
    end if;
    new.locked_at := coalesce(new.locked_at, now());
  end if;

  if old.tally_synced and not new.tally_synced then
    raise exception 'TALLY_LOCKED: % is already synced to Tally', old.order_no;
  end if;
  if new.tally_synced and not old.tally_synced then
    new.tally_synced_at := now();
  end if;
  return new;
end $$;

create trigger orders_tally_guard
  before update or delete on public.orders
  for each row execute function public.tg_orders_tally_guard();

create or replace function public.tg_order_items_tally_guard()
returns trigger language plpgsql as $$
declare
  v_locked boolean;
begin
  select is_locked_for_tally into v_locked
  from public.orders where id = coalesce(new.order_id, old.order_id);
  if coalesce(v_locked, false) then
    raise exception 'TALLY_LOCKED: line items of a Tally-locked order are immutable';
  end if;
  return coalesce(new, old);
end $$;

create trigger order_items_tally_guard
  before insert or update or delete on public.order_items
  for each row execute function public.tg_order_items_tally_guard();

-- -----------------------------------------------------------------------------
-- RLS helpers
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin')
$$;

-- The godown an approved buyer may see; NULL for unapproved users (=> no stock visible).
create or replace function public.my_approved_godown()
returns text language sql stable security definer set search_path = public as $$
  select godown_id from public.users
  where id = auth.uid() and role = 'buyer' and is_approved
$$;

-- -----------------------------------------------------------------------------
-- ATOMIC ORDER CREATION
--   p_items: [{ "product_id": "<uuid>", "qty": 10 }, ...]
--   Single transaction: KYC check -> row-lock stock in buyer's godown ->
--   price from DB -> ₹50k minimum -> freight -> credit limit -> insert -> deduct.
-- -----------------------------------------------------------------------------
create or replace function public.create_b2b_order(
  p_items      jsonb,
  p_client_ref text default null,
  p_notes      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_buyer       public.users%rowtype;
  v_existing    public.orders%rowtype;
  v_line        record;
  v_short       jsonb := '[]'::jsonb;
  v_subtotal    numeric(14,2) := 0;
  v_gst         numeric(14,2) := 0;
  v_freight     numeric(14,2);
  v_base        numeric(14,2);
  v_discount    numeric(14,2);
  v_outstanding numeric(14,2);
  v_today       date := public.af_today();
  v_order       public.orders%rowtype;
  v_updated     integer;
  v_lines       integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: no auth context';
  end if;

  -- Serialises concurrent orders of the same buyer (credit check + idempotency).
  select * into v_buyer from public.users where id = v_uid for update;
  if not found then raise exception 'PROFILE_NOT_FOUND: no business profile'; end if;
  if v_buyer.role <> 'buyer' then raise exception 'ONLY_BUYERS_CAN_ORDER: admins cannot place indents'; end if;
  if not v_buyer.is_approved then raise exception 'KYC_NOT_APPROVED: account pending KYC approval'; end if;
  if v_buyer.godown_id is null then raise exception 'NO_GODOWN_ASSIGNED: no godown mapped to your state'; end if;

  if p_client_ref is not null then
    select * into v_existing from public.orders where buyer_id = v_uid and client_ref = p_client_ref;
    if found then
      return jsonb_build_object('order_id', v_existing.id, 'order_no', v_existing.order_no,
                                'base_amount', v_existing.base_amount, 'idempotent_replay', true);
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'INVALID_ITEMS: items must be a non-empty array (max 100 lines)';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(e->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(e->>'qty', '') !~ '^[0-9]{1,6}$'
       or (e->>'qty')::integer <= 0
  ) then
    raise exception 'INVALID_ITEMS: each item needs a valid product_id and positive integer qty';
  end if;

  -- Lock the exact inventory rows in a deterministic order (deadlock-safe).
  perform 1
  from public.inventory i
  where i.godown_id = v_buyer.godown_id
    and i.product_id in (select (e->>'product_id')::uuid from jsonb_array_elements(p_items) e)
  order by i.product_id
  for update;

  for v_line in
    with req as (
      select (e->>'product_id')::uuid as product_id, sum((e->>'qty')::integer)::integer as qty
      from jsonb_array_elements(p_items) e group by 1
    )
    select r.product_id, r.qty, p.id is null as missing, coalesce(p.is_active, false) as is_active,
           p.sku, p.name, p.price, p.gst_rate, coalesce(i.stock_qty, 0) as stock_qty
    from req r
    left join public.products  p on p.id = r.product_id
    left join public.inventory i on i.product_id = r.product_id and i.godown_id = v_buyer.godown_id
    order by r.product_id
  loop
    if v_line.missing or not v_line.is_active then
      raise exception 'PRODUCT_NOT_AVAILABLE: product % is not available', v_line.product_id;
    end if;
    if v_line.stock_qty < v_line.qty then
      v_short := v_short || jsonb_build_object(
        'product_id', v_line.product_id, 'sku', v_line.sku, 'name', v_line.name,
        'requested', v_line.qty, 'available', v_line.stock_qty);
    end if;
    v_subtotal := v_subtotal + round(v_line.qty * v_line.price, 2);
    v_gst      := v_gst      + round(v_line.qty * v_line.price * v_line.gst_rate / 100, 2);
  end loop;

  if jsonb_array_length(v_short) > 0 then
    raise exception 'INSUFFICIENT_STOCK: requested quantity exceeds stock in %', v_buyer.godown_id
      using detail = v_short::text;
  end if;

  if v_subtotal < public.af_min_order_value() then
    raise exception 'MIN_ORDER_VALUE_NOT_MET: subtotal % is below minimum %', v_subtotal, public.af_min_order_value()
      using detail = jsonb_build_object('subtotal', v_subtotal, 'minimum', public.af_min_order_value(),
                                        'shortfall', public.af_min_order_value() - v_subtotal)::text;
  end if;

  v_freight  := public.freight_for_state(v_buyer.state);
  v_base     := v_subtotal + v_freight + v_gst;
  v_discount := round(v_subtotal * public.af_early_discount_pct() / 100, 2);

  select coalesce(sum(amount_due - amount_paid), 0) into v_outstanding
  from public.orders
  where buyer_id = v_uid and status <> 'CANCELLED' and payment_status <> 'PAID';

  if v_outstanding + v_base > v_buyer.credit_limit then
    raise exception 'CREDIT_LIMIT_EXCEEDED: order % + outstanding % exceeds limit %', v_base, v_outstanding, v_buyer.credit_limit
      using detail = jsonb_build_object('order_value', v_base, 'outstanding', v_outstanding,
                                        'credit_limit', v_buyer.credit_limit,
                                        'available', v_buyer.credit_limit - v_outstanding)::text;
  end if;

  insert into public.orders (
    client_ref, buyer_id, godown_id, ship_to_state, purchase_date, due_date,
    subtotal, freight, gst_amount, base_amount, early_discount_pct, discount_amount, notes
  ) values (
    p_client_ref, v_uid, v_buyer.godown_id, v_buyer.state, v_today, v_today + public.af_credit_days(),
    v_subtotal, v_freight, v_gst, v_base, public.af_early_discount_pct(), v_discount, nullif(btrim(p_notes), '')
  ) returning * into v_order;

  insert into public.order_items (order_id, product_id, sku, product_name, hsn_code, unit, qty, unit_price, gst_rate)
  select v_order.id, p.id, p.sku, p.name, p.hsn_code, p.unit, r.qty, p.price, p.gst_rate
  from (
    select (e->>'product_id')::uuid as product_id, sum((e->>'qty')::integer)::integer as qty
    from jsonb_array_elements(p_items) e group by 1
  ) r join public.products p on p.id = r.product_id;
  get diagnostics v_lines = row_count;

  update public.inventory i
     set stock_qty = i.stock_qty - r.qty, updated_at = now()
  from (
    select (e->>'product_id')::uuid as product_id, sum((e->>'qty')::integer)::integer as qty
    from jsonb_array_elements(p_items) e group by 1
  ) r
  where i.godown_id = v_buyer.godown_id and i.product_id = r.product_id and i.stock_qty >= r.qty;
  get diagnostics v_updated = row_count;

  if v_updated <> v_lines then  -- defensive; rows are locked so this should never happen
    raise exception 'INSUFFICIENT_STOCK: concurrent stock change detected in %', v_buyer.godown_id;
  end if;

  insert into public.credit_logs (user_id, order_id, event, amount, note, actor_id)
  values (v_uid, v_order.id, 'ORDER_DEBIT', v_order.amount_due,
          format('Indent %s (incl. provisional %s%% early-payment discount)', v_order.order_no, v_order.early_discount_pct),
          v_uid);

  return jsonb_build_object(
    'order_id', v_order.id, 'order_no', v_order.order_no, 'godown_id', v_order.godown_id,
    'subtotal', v_order.subtotal, 'freight', v_order.freight, 'gst_amount', v_order.gst_amount,
    'base_amount', v_order.base_amount, 'discount_amount', v_order.discount_amount,
    'amount_due', v_order.amount_due, 'due_date', v_order.due_date, 'idempotent_replay', false);
end $$;

-- -----------------------------------------------------------------------------
-- ADMIN: order status transitions (cancel restocks the exact godown)
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_order_status(p_order_id uuid, p_status public.order_status, p_actor uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND: %', p_order_id; end if;

  if not (
       (o.status = 'PENDING'    and p_status in ('APPROVED', 'CANCELLED'))
    or (o.status = 'APPROVED'   and p_status in ('DISPATCHED', 'CANCELLED'))
    or (o.status = 'DISPATCHED' and p_status = 'DELIVERED')
  ) then
    raise exception 'INVALID_TRANSITION: % -> % is not allowed', o.status, p_status;
  end if;

  if p_status = 'CANCELLED' then
    if o.amount_paid > 0 then
      raise exception 'INVALID_TRANSITION: order has payments recorded; refund first';
    end if;
    -- Lock the inventory rows deterministically, then restock.
    perform 1 from public.inventory i
    where i.godown_id = o.godown_id and i.product_id in (select product_id from public.order_items where order_id = o.id)
    order by i.product_id for update;

    insert into public.inventory (godown_id, product_id, stock_qty)
    select o.godown_id, oi.product_id, oi.qty from public.order_items oi where oi.order_id = o.id
    on conflict (godown_id, product_id)
    do update set stock_qty = public.inventory.stock_qty + excluded.stock_qty, updated_at = now();

    insert into public.credit_logs (user_id, order_id, event, amount, note, actor_id)
    values (o.buyer_id, o.id, 'ORDER_REVERSAL', -(o.amount_due - o.amount_paid), 'Order cancelled; stock returned to ' || o.godown_id, p_actor);
  end if;

  update public.orders set status = p_status where id = o.id returning * into o;
  return o;
end $$;

-- -----------------------------------------------------------------------------
-- ADMIN: Tally lock / sync acknowledgement
-- -----------------------------------------------------------------------------
create or replace function public.lock_order_for_tally(p_order_id uuid, p_actor uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND: %', p_order_id; end if;
  if o.is_locked_for_tally then return o; end if;   -- idempotent
  update public.orders
     set is_locked_for_tally = true, locked_by = p_actor, locked_at = now()
   where id = p_order_id
  returning * into o;
  return o;
end $$;

create or replace function public.mark_tally_synced(p_order_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  update public.orders
     set tally_synced = true
   where id = any (p_order_ids) and is_locked_for_tally and not tally_synced;
  get diagnostics n = row_count;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- ADMIN: KYC approval / credit limit / godown routing
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_kyc(
  p_user_id uuid, p_is_approved boolean, p_credit_limit numeric, p_godown_id text, p_actor uuid
)
returns public.users language plpgsql security definer set search_path = public as $$
declare
  u public.users%rowtype;
begin
  select * into u from public.users where id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND: %', p_user_id; end if;
  if u.role <> 'buyer' then raise exception 'INVALID_TARGET: only buyer accounts go through KYC'; end if;
  if p_credit_limit is not null and p_credit_limit < 0 then raise exception 'INVALID_AMOUNT: credit limit must be >= 0'; end if;
  if coalesce(p_is_approved, u.is_approved)
     and (u.gstin is null or u.business_name is null or u.state is null or coalesce(p_godown_id, u.godown_id) is null) then
    raise exception 'KYC_INCOMPLETE: GSTIN, business name, state and godown are required for approval';
  end if;

  if p_credit_limit is not null and p_credit_limit <> u.credit_limit then
    insert into public.credit_logs (user_id, event, amount, note, actor_id)
    values (u.id, 'CREDIT_LIMIT_CHANGED', p_credit_limit - u.credit_limit,
            format('Credit limit %s -> %s', u.credit_limit, p_credit_limit), p_actor);
  end if;
  if p_is_approved is not null and p_is_approved <> u.is_approved then
    insert into public.credit_logs (user_id, event, amount, note, actor_id)
    values (u.id, case when p_is_approved then 'KYC_APPROVED'::public.credit_event else 'KYC_REVOKED'::public.credit_event end,
            0, null, p_actor);
  end if;

  update public.users set
    is_approved  = coalesce(p_is_approved, is_approved),
    credit_limit = coalesce(p_credit_limit, credit_limit),
    godown_id    = coalesce(p_godown_id, godown_id),
    approved_at  = case when coalesce(p_is_approved, is_approved) and not is_approved then now()
                        when not coalesce(p_is_approved, is_approved) then null else approved_at end,
    approved_by  = case when coalesce(p_is_approved, is_approved) and not is_approved then p_actor
                        when not coalesce(p_is_approved, is_approved) then null else approved_by end
  where id = p_user_id
  returning * into u;
  return u;
end $$;

-- -----------------------------------------------------------------------------
-- ADMIN: stock inward / write-off / inter-godown transfer (atomic)
-- -----------------------------------------------------------------------------
create or replace function public.adjust_stock(p_product_id uuid, p_godown_id text, p_delta integer, p_actor uuid, p_note text default null)
returns public.inventory language plpgsql security definer set search_path = public as $$
declare
  r public.inventory%rowtype;
begin
  if p_delta is null or p_delta = 0 then raise exception 'INVALID_AMOUNT: delta must be non-zero'; end if;
  insert into public.inventory (godown_id, product_id, stock_qty) values (p_godown_id, p_product_id, 0)
  on conflict do nothing;
  select * into r from public.inventory where godown_id = p_godown_id and product_id = p_product_id for update;
  if r.stock_qty + p_delta < 0 then
    raise exception 'INSUFFICIENT_STOCK: only % units in %', r.stock_qty, p_godown_id
      using detail = jsonb_build_array(jsonb_build_object('product_id', p_product_id,
                       'requested', -p_delta, 'available', r.stock_qty))::text;
  end if;
  update public.inventory set stock_qty = stock_qty + p_delta, updated_at = now()
  where godown_id = p_godown_id and product_id = p_product_id returning * into r;
  insert into public.stock_movements (movement_type, product_id, from_godown_id, to_godown_id, qty, note, actor_id)
  values (case when p_delta > 0 then 'INWARD'::public.stock_movement_type else 'WRITE_OFF'::public.stock_movement_type end,
          p_product_id,
          case when p_delta < 0 then p_godown_id end,
          case when p_delta > 0 then p_godown_id end,
          abs(p_delta), p_note, p_actor);
  return r;
end $$;

create or replace function public.transfer_stock(
  p_product_id uuid, p_from_godown text, p_to_godown text, p_qty integer, p_actor uuid, p_note text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_from integer;
  v_to   integer;
begin
  if p_from_godown = p_to_godown then raise exception 'SAME_GODOWN: source and destination must differ'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'INVALID_AMOUNT: qty must be > 0'; end if;

  insert into public.inventory (godown_id, product_id, stock_qty) values (p_to_godown, p_product_id, 0)
  on conflict do nothing;
  -- Lock both rows in a deterministic order.
  perform 1 from public.inventory
  where product_id = p_product_id and godown_id in (p_from_godown, p_to_godown)
  order by godown_id for update;

  select stock_qty into v_from from public.inventory where godown_id = p_from_godown and product_id = p_product_id;
  if coalesce(v_from, 0) < p_qty then
    raise exception 'INSUFFICIENT_STOCK: only % units in %', coalesce(v_from, 0), p_from_godown
      using detail = jsonb_build_array(jsonb_build_object('product_id', p_product_id,
                       'requested', p_qty, 'available', coalesce(v_from, 0)))::text;
  end if;

  update public.inventory set stock_qty = stock_qty - p_qty, updated_at = now()
   where godown_id = p_from_godown and product_id = p_product_id returning stock_qty into v_from;
  update public.inventory set stock_qty = stock_qty + p_qty, updated_at = now()
   where godown_id = p_to_godown and product_id = p_product_id returning stock_qty into v_to;

  insert into public.stock_movements (movement_type, product_id, from_godown_id, to_godown_id, qty, note, actor_id)
  values ('TRANSFER', p_product_id, p_from_godown, p_to_godown, p_qty, p_note, p_actor);

  return jsonb_build_object('product_id', p_product_id, p_from_godown, v_from, p_to_godown, v_to);
end $$;

-- -----------------------------------------------------------------------------
-- FINANCE: aging engine
--   * as_of > due_date               -> strip early discount (unless admin override)
--   * as_of > purchase_date + 90     -> penalty = base * 18% / 365 * days_past_due
--   Deterministic for a given as_of date (safe to re-run; ledger logs deltas).
-- -----------------------------------------------------------------------------
create or replace function public.recalculate_aging(p_as_of date default null, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_as_of        date := coalesce(p_as_of, public.af_today());
  o              public.orders%rowtype;
  v_disc         numeric(14,2);
  v_int          numeric(14,2);
  v_overdue      integer;
  n_scanned      integer := 0;
  n_stripped     integer := 0;
  n_interest     integer := 0;
  v_int_delta    numeric(14,2) := 0;
begin
  for o in
    select * from public.orders
    where status <> 'CANCELLED' and payment_status <> 'PAID'
    order by id
    for update
  loop
    n_scanned := n_scanned + 1;
    v_overdue := greatest(v_as_of - o.due_date, 0);
    v_disc    := o.discount_amount;
    v_int     := 0;

    if v_as_of > o.due_date and not o.discount_override and o.discount_amount > 0 then
      v_disc := 0;
      n_stripped := n_stripped + 1;
      insert into public.credit_logs (user_id, order_id, event, amount, note, actor_id)
      values (o.buyer_id, o.id, 'DISCOUNT_STRIPPED', o.discount_amount,
              format('Paid after due date %s; early discount removed', o.due_date), p_actor);
    end if;

    if not o.interest_waived and v_as_of > o.purchase_date + public.af_interest_trigger_days() then
      v_int := round(o.base_amount * public.af_interest_apy() / 365 * v_overdue, 2);
    end if;

    if v_int <> o.penalty_interest then
      if v_int > 0 then n_interest := n_interest + 1; end if;
      v_int_delta := v_int_delta + (v_int - o.penalty_interest);
      insert into public.credit_logs (user_id, order_id, event, amount, note, actor_id)
      values (o.buyer_id, o.id, 'INTEREST_ACCRUED', v_int - o.penalty_interest,
              format('18%% p.a. on %s for %s days overdue (as of %s)', o.base_amount, v_overdue, v_as_of), p_actor);
    end if;

    update public.orders set
      discount_amount      = v_disc,
      discount_stripped_at = case when v_disc = 0 and o.discount_amount > 0 then now() else discount_stripped_at end,
      penalty_interest     = v_int,
      last_aged_on         = v_as_of,
      payment_status       = case when amount_paid >= base_amount - v_disc + v_int then 'PAID'::public.payment_status
                                  when amount_paid > 0 then 'PARTIAL'::public.payment_status
                                  else 'UNPAID'::public.payment_status end
    where id = o.id;
  end loop;

  return jsonb_build_object('as_of', v_as_of, 'scanned', n_scanned, 'discounts_stripped', n_stripped,
                            'orders_with_interest', n_interest, 'interest_delta', v_int_delta);
end $$;

create or replace function public.waive_interest(p_order_id uuid, p_actor uuid, p_note text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND: %', p_order_id; end if;
  insert into public.credit_logs (user_id, order_id, event, amount, note, actor_id)
  values (o.buyer_id, o.id, 'INTEREST_WAIVED', -o.penalty_interest, coalesce(p_note, 'Interest waived by admin'), p_actor);
  update public.orders set interest_waived = true, interest_waived_at = now(), penalty_interest = 0,
         payment_status = case when amount_paid >= base_amount - discount_amount then 'PAID'::public.payment_status else payment_status end,
         paid_at = case when amount_paid >= base_amount - discount_amount then coalesce(paid_at, now()) else paid_at end
  where id = o.id returning * into o;
  return o;
end $$;

create or replace function public.reapply_discount(p_order_id uuid, p_actor uuid, p_note text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o      public.orders%rowtype;
  v_disc numeric(14,2);
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND: %', p_order_id; end if;
  if o.payment_status = 'PAID' then raise exception 'ORDER_ALREADY_PAID: %', o.order_no; end if;
  v_disc := round(o.subtotal * o.early_discount_pct / 100, 2);
  insert into public.credit_logs (user_id, order_id, event, amount, note, actor_id)
  values (o.buyer_id, o.id, 'DISCOUNT_REAPPLIED', -(v_disc - o.discount_amount), coalesce(p_note, 'Early discount re-applied by admin'), p_actor);
  update public.orders set discount_override = true, discount_amount = v_disc, discount_stripped_at = null
  where id = o.id returning * into o;
  return o;
end $$;

create or replace function public.record_payment(
  p_order_id uuid, p_amount numeric, p_actor uuid, p_paid_on date default null, p_note text default null
)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o         public.orders%rowtype;
  v_paid_on date := coalesce(p_paid_on, public.af_today());
begin
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT: payment must be > 0'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND: %', p_order_id; end if;
  if o.status = 'CANCELLED' then raise exception 'INVALID_TRANSITION: order is cancelled'; end if;
  if o.payment_status = 'PAID' then raise exception 'ORDER_ALREADY_PAID: %', o.order_no; end if;

  -- Late payment: strip the discount now even if the aging job has not run yet.
  if v_paid_on > o.due_date and not o.discount_override and o.discount_amount > 0 then
    insert into public.credit_logs (user_id, order_id, event, amount, note, actor_id)
    values (o.buyer_id, o.id, 'DISCOUNT_STRIPPED', o.discount_amount, 'Paid after due date', p_actor);
    update public.orders set discount_amount = 0, discount_stripped_at = now() where id = o.id returning * into o;
  end if;

  if o.amount_paid + p_amount > o.amount_due + 0.01 then
    raise exception 'OVERPAYMENT: balance is %, received %', o.amount_due - o.amount_paid, p_amount
      using detail = jsonb_build_object('balance', o.amount_due - o.amount_paid)::text;
  end if;

  insert into public.credit_logs (user_id, order_id, event, amount, note, actor_id)
  values (o.buyer_id, o.id, 'PAYMENT_CREDIT', -p_amount, coalesce(p_note, 'Payment received ' || v_paid_on), p_actor);

  update public.orders set
    amount_paid    = amount_paid + p_amount,
    payment_status = case when amount_paid + p_amount >= amount_due - 0.01 then 'PAID'::public.payment_status
                          else 'PARTIAL'::public.payment_status end,
    paid_at        = case when amount_paid + p_amount >= amount_due - 0.01 then now() else paid_at end
  where id = o.id returning * into o;
  return o;
end $$;

-- -----------------------------------------------------------------------------
-- Views (security_invoker => caller's RLS applies)
-- -----------------------------------------------------------------------------
create view public.v_buyer_credit with (security_invoker = true) as
select u.id as user_id,
       u.credit_limit,
       coalesce(sum(o.amount_due - o.amount_paid) filter (where o.status <> 'CANCELLED' and o.payment_status <> 'PAID'), 0)::numeric(14,2) as outstanding,
       (u.credit_limit - coalesce(sum(o.amount_due - o.amount_paid) filter (where o.status <> 'CANCELLED' and o.payment_status <> 'PAID'), 0))::numeric(14,2) as available,
       count(o.id) filter (where o.status <> 'CANCELLED' and o.payment_status <> 'PAID' and o.due_date < public.af_today()) as overdue_orders
from public.users u
left join public.orders o on o.buyer_id = u.id
group by u.id, u.credit_limit;

create view public.v_receivables_aging with (security_invoker = true) as
select o.*,
       u.business_name, u.gstin, u.state as buyer_state,
       (public.af_today() - o.purchase_date)              as age_days,
       greatest(public.af_today() - o.due_date, 0)        as days_past_due,
       (o.amount_due - o.amount_paid)::numeric(14,2)      as balance,
       case
         when public.af_today() <= o.due_date                       then 'CURRENT'
         when public.af_today() - o.due_date <= 30                  then '1-30'
         when public.af_today() - o.due_date <= 60                  then '31-60'
         when public.af_today() - o.purchase_date <= 90             then '61-90'
         else '90+'
       end as bucket
from public.orders o
join public.users u on u.id = o.buyer_id
where o.status <> 'CANCELLED' and o.payment_status <> 'PAID';

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.users           enable row level security;
alter table public.godowns         enable row level security;
alter table public.products        enable row level security;
alter table public.inventory       enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;
alter table public.credit_logs     enable row level security;
alter table public.stock_movements enable row level security;

-- users: own row, admins see all
create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- godowns: readable by any signed-in user
create policy godowns_select on public.godowns for select to authenticated using (true);

-- products: active catalog for signed-in users; admins see inactive too
create policy products_select on public.products for select to authenticated
  using (is_active or public.is_admin());

-- inventory: ONLY approved buyers, ONLY their godown; admins see all godowns
create policy inventory_select on public.inventory for select to authenticated
  using (public.is_admin() or godown_id = public.my_approved_godown());

-- orders / items / ledger: own data or admin
create policy orders_select on public.orders for select to authenticated
  using (buyer_id = auth.uid() or public.is_admin());

create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.buyer_id = auth.uid() or public.is_admin())));

create policy credit_logs_select on public.credit_logs for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy stock_movements_select on public.stock_movements for select to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- Privileges: read-only for clients; all writes via RPC / service role.
-- -----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on function public.create_b2b_order(jsonb, text, text) to authenticated;
grant  execute on function public.is_admin()            to authenticated;
grant  execute on function public.my_approved_godown()  to authenticated;
grant  execute on function public.af_today()            to authenticated;
grant  execute on function public.freight_for_state(text) to authenticated;
grant  execute on all functions in schema public to service_role;

-- Functions created later in this schema must not be callable by clients by default.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
EOF

# ---------------------------------------------------------------- supabase/seed.sql
mkdir -p "supabase"
cat << 'EOF' > "supabase/seed.sql"
-- Sample catalog & opening stock (illustrative prices, ex-GST, per bag). Replace with live price list.
insert into public.products (sku, name, category, hsn_code, unit, pack_size_kg, price, gst_rate) values
  ('UREA-45',      'Neem Coated Urea 46% N',         'Straight N',  '3102', 'BAG', 45,  266.50, 5),
  ('DAP-50',       'DAP 18:46:0',                    'Phosphatic',  '3105', 'BAG', 50, 1350.00, 5),
  ('NPK-102626',   'NPK 10:26:26',                   'Complex',     '3105', 'BAG', 50, 1470.00, 5),
  ('NPK-121232',   'NPK 12:32:16',                   'Complex',     '3105', 'BAG', 50, 1450.00, 5),
  ('MOP-50',       'Muriate of Potash 60% K2O',      'Potassic',    '3104', 'BAG', 50, 1700.00, 5),
  ('SSP-50',       'Single Super Phosphate 16% P2O5','Phosphatic',  '3103', 'BAG', 50,  480.00, 5),
  ('ZNSO4-10',     'Zinc Sulphate Monohydrate 33%',  'Micronutrient','2833','BAG', 10,  720.00, 12),
  ('WSF-191919',   'Water Soluble NPK 19:19:19',     'Specialty',   '3105', 'BAG', 25, 2650.00, 5)
on conflict (sku) do nothing;

insert into public.inventory (godown_id, product_id, stock_qty)
select g.id, p.id,
       case g.id when 'MH_GODOWN' then 1200 else 600 end
from public.godowns g cross join public.products p
on conflict do nothing;
EOF

# ---------------------------------------------------------------- lib/utils.ts
mkdir -p "lib"
cat << 'EOF' > "lib/utils.ts"
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
export const formatINR = (n: number | string | null | undefined) => inr.format(Number(n ?? 0));

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const formatDate = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00+05:30` : d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
EOF

# ---------------------------------------------------------------- lib/business.ts
mkdir -p "lib"
cat << 'EOF' > "lib/business.ts"
// Business rules mirrored from supabase/migrations/001_init.sql (the DB is authoritative).
import { round2 } from '@/lib/utils';

export const MIN_ORDER_VALUE = 50_000;
export const CREDIT_DAYS = 15;
export const EARLY_DISCOUNT_PCT = 2;
export const INTEREST_APY = 0.18;
export const INTEREST_TRIGGER_DAYS = 90;

export const GODOWNS = { MH_GODOWN: 'Maharashtra Godown', MP_GODOWN: 'Madhya Pradesh Godown' } as const;
export type GodownId = keyof typeof GODOWNS;

export function freightForState(state?: string | null): number {
  switch ((state ?? '').trim().toLowerCase()) {
    case 'maharashtra':
      return 2500;
    case 'madhya pradesh':
      return 1500;
    default:
      return 3000;
  }
}

export interface CartLine {
  qty: number;
  price: number;
  gst_rate: number;
}

export function computeCart(lines: CartLine[], state?: string | null) {
  const subtotal = round2(lines.reduce((s, l) => s + round2(l.qty * l.price), 0));
  const gst = round2(lines.reduce((s, l) => s + round2((l.qty * l.price * l.gst_rate) / 100), 0));
  const freight = subtotal > 0 ? freightForState(state) : 0;
  const total = round2(subtotal + gst + freight);
  const earlyDiscount = round2((subtotal * EARLY_DISCOUNT_PCT) / 100);
  return {
    subtotal,
    gst,
    freight,
    total,
    earlyDiscount,
    payableIfEarly: round2(total - earlyDiscount),
    meetsMinimum: subtotal >= MIN_ORDER_VALUE,
    shortfall: Math.max(0, round2(MIN_ORDER_VALUE - subtotal)),
  };
}

/** penalty_interest = (base_amount * 0.18 / 365) * overdue_days, only once age > 90 days. */
export function projectedInterest(baseAmount: number, ageDays: number, daysPastDue: number) {
  if (ageDays <= INTEREST_TRIGGER_DAYS) return 0;
  return round2(((baseAmount * INTEREST_APY) / 365) * Math.max(0, daysPastDue));
}
EOF

# ---------------------------------------------------------------- lib/states.ts
mkdir -p "lib"
cat << 'EOF' > "lib/states.ts"
// Indian states / UTs with GST state codes (first two digits of a GSTIN).
export const INDIAN_STATES: { name: string; code: string }[] = [
  { name: 'Andaman and Nicobar Islands', code: '35' }, { name: 'Andhra Pradesh', code: '37' },
  { name: 'Arunachal Pradesh', code: '12' }, { name: 'Assam', code: '18' }, { name: 'Bihar', code: '10' },
  { name: 'Chandigarh', code: '04' }, { name: 'Chhattisgarh', code: '22' },
  { name: 'Dadra and Nagar Haveli and Daman and Diu', code: '26' }, { name: 'Delhi', code: '07' },
  { name: 'Goa', code: '30' }, { name: 'Gujarat', code: '24' }, { name: 'Haryana', code: '06' },
  { name: 'Himachal Pradesh', code: '02' }, { name: 'Jammu and Kashmir', code: '01' }, { name: 'Jharkhand', code: '20' },
  { name: 'Karnataka', code: '29' }, { name: 'Kerala', code: '32' }, { name: 'Ladakh', code: '38' },
  { name: 'Lakshadweep', code: '31' }, { name: 'Madhya Pradesh', code: '23' }, { name: 'Maharashtra', code: '27' },
  { name: 'Manipur', code: '14' }, { name: 'Meghalaya', code: '17' }, { name: 'Mizoram', code: '15' },
  { name: 'Nagaland', code: '13' }, { name: 'Odisha', code: '21' }, { name: 'Puducherry', code: '34' },
  { name: 'Punjab', code: '03' }, { name: 'Rajasthan', code: '08' }, { name: 'Sikkim', code: '11' },
  { name: 'Tamil Nadu', code: '33' }, { name: 'Telangana', code: '36' }, { name: 'Tripura', code: '16' },
  { name: 'Uttar Pradesh', code: '09' }, { name: 'Uttarakhand', code: '05' }, { name: 'West Bengal', code: '19' },
];

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function validateGstin(gstin: string, state: string): string | null {
  const g = gstin.trim().toUpperCase();
  if (!GSTIN_RE.test(g)) return 'GSTIN format is invalid (15 characters, e.g. 27ABCDE1234F1Z5).';
  const st = INDIAN_STATES.find((s) => s.name === state);
  if (!st) return 'Select a valid state.';
  if (g.slice(0, 2) !== st.code) return `GSTIN state code ${g.slice(0, 2)} does not match ${state} (${st.code}).`;
  return null;
}
EOF

# ---------------------------------------------------------------- lib/types.ts
mkdir -p "lib"
cat << 'EOF' > "lib/types.ts"
export type Role = 'buyer' | 'admin';
export type OrderStatus = 'PENDING' | 'APPROVED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface Profile {
  id: string;
  email: string;
  business_name: string | null;
  gstin: string | null;
  state: string | null;
  phone: string | null;
  role: Role;
  is_approved: boolean;
  credit_limit: number;
  godown_id: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface Godown {
  id: string;
  name: string;
  state: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  hsn_code: string;
  unit: string;
  pack_size_kg: number;
  price: number;
  gst_rate: number;
  is_active: boolean;
}

export interface InventoryRow {
  godown_id: string;
  product_id: string;
  stock_qty: number;
  updated_at: string;
}

export interface OrderItem {
  id: number;
  order_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  hsn_code: string;
  unit: string;
  qty: number;
  unit_price: number;
  gst_rate: number;
  line_total: number;
  gst_amount: number;
}

export interface Order {
  id: string;
  order_no: string;
  buyer_id: string;
  godown_id: string;
  ship_to_state: string;
  status: OrderStatus;
  purchase_date: string;
  due_date: string;
  subtotal: number;
  freight: number;
  gst_amount: number;
  base_amount: number;
  early_discount_pct: number;
  discount_amount: number;
  discount_override: boolean;
  penalty_interest: number;
  interest_waived: boolean;
  amount_due: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  notes: string | null;
  is_locked_for_tally: boolean;
  locked_at: string | null;
  tally_synced: boolean;
  tally_synced_at: string | null;
  created_at: string;
  order_items?: OrderItem[];
  buyer?: Pick<Profile, 'business_name' | 'gstin' | 'state' | 'email'> | null;
}

export interface BuyerCredit {
  user_id: string;
  credit_limit: number;
  outstanding: number;
  available: number;
  overdue_orders: number;
}

export type AgingBucket = 'CURRENT' | '1-30' | '31-60' | '61-90' | '90+';

export interface AgingRow extends Order {
  business_name: string | null;
  gstin: string | null;
  buyer_state: string | null;
  age_days: number;
  days_past_due: number;
  balance: number;
  bucket: AgingBucket;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
EOF

# ---------------------------------------------------------------- lib/api.ts
mkdir -p "lib"
cat << 'EOF' > "lib/api.ts"
'use client';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { ApiErrorBody } from '@/lib/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** fetch() wrapper that attaches the Supabase access token and normalises errors. */
export async function apiFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { data } = await supabaseBrowser().auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body, cache: 'no-store' });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const e = (payload as ApiErrorBody)?.error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_' + res.status, e?.message ?? res.statusText, e?.details);
  }
  return payload as T;
}
EOF

# ---------------------------------------------------------------- lib/tally.ts
mkdir -p "lib"
cat << 'EOF' > "lib/tally.ts"
// Tally Prime XML (Import Data -> Vouchers) builder for finalised B2B sales invoices.
// Sign convention: debit entries carry ISDEEMEDPOSITIVE=Yes and a negative AMOUNT.
import { round2 } from '@/lib/utils';

export interface TallyOrder {
  id: string;
  order_no: string;
  purchase_date: string; // YYYY-MM-DD
  ship_to_state: string;
  subtotal: number;
  freight: number;
  gst_amount: number;
  base_amount: number;
  buyer: { business_name: string | null; gstin: string | null; state: string | null } | null;
  godown: { name: string; state: string } | null;
  order_items: { sku: string; product_name: string; unit: string; qty: number; unit_price: number; line_total: number; gst_amount: number }[];
}

export interface TallyConfig {
  company: string;
  salesLedger: string;
  freightLedger: string;
  cgstLedger: string;
  sgstLedger: string;
  igstLedger: string;
}

export function tallyConfigFromEnv(): TallyConfig {
  return {
    company: process.env.TALLY_COMPANY_NAME || 'Akshat Fertilizer',
    salesLedger: process.env.TALLY_SALES_LEDGER || 'Sales - Fertilizers',
    freightLedger: process.env.TALLY_FREIGHT_LEDGER || 'Freight Outward',
    cgstLedger: process.env.TALLY_CGST_LEDGER || 'Output CGST',
    sgstLedger: process.env.TALLY_SGST_LEDGER || 'Output SGST',
    igstLedger: process.env.TALLY_IGST_LEDGER || 'Output IGST',
  };
}

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const amt = (n: number) => round2(Number(n)).toFixed(2);
const tallyDate = (d: string) => d.slice(0, 10).replace(/-/g, '');

function ledgerEntry(ledger: string, amount: number, debit: boolean, extra = '') {
  return `
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>${esc(ledger)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
          <ISPARTYLEDGER>${extra ? 'Yes' : 'No'}</ISPARTYLEDGER>
          <AMOUNT>${debit ? '-' : ''}${amt(amount)}</AMOUNT>${extra}
        </LEDGERENTRIES.LIST>`;
}

export function buildVoucher(o: TallyOrder, cfg: TallyConfig): string {
  const party = o.buyer?.business_name || o.buyer?.gstin || 'Unknown Party';
  const intraState = (o.godown?.state ?? '').toLowerCase() === (o.ship_to_state ?? '').toLowerCase();
  const gst = Number(o.gst_amount);
  const cgst = round2(gst / 2);
  const sgst = round2(gst - cgst);

  const inventory = o.order_items
    .map(
      (it) => `
        <ALLINVENTORYENTRIES.LIST>
          <STOCKITEMNAME>${esc(it.product_name)}</STOCKITEMNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <RATE>${amt(it.unit_price)}/${esc(it.unit)}</RATE>
          <AMOUNT>${amt(it.line_total)}</AMOUNT>
          <ACTUALQTY>${it.qty} ${esc(it.unit)}</ACTUALQTY>
          <BILLEDQTY>${it.qty} ${esc(it.unit)}</BILLEDQTY>
          <BATCHALLOCATIONS.LIST>
            <GODOWNNAME>${esc(o.godown?.name ?? 'Main Location')}</GODOWNNAME>
            <AMOUNT>${amt(it.line_total)}</AMOUNT>
            <ACTUALQTY>${it.qty} ${esc(it.unit)}</ACTUALQTY>
            <BILLEDQTY>${it.qty} ${esc(it.unit)}</BILLEDQTY>
          </BATCHALLOCATIONS.LIST>
          <ACCOUNTINGALLOCATIONS.LIST>
            <LEDGERNAME>${esc(cfg.salesLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${amt(it.line_total)}</AMOUNT>
          </ACCOUNTINGALLOCATIONS.LIST>
        </ALLINVENTORYENTRIES.LIST>`,
    )
    .join('');

  const partyBill = `
          <BILLALLOCATIONS.LIST>
            <NAME>${esc(o.order_no)}</NAME>
            <BILLTYPE>New Ref</BILLTYPE>
            <BILLCREDITPERIOD>15 Days</BILLCREDITPERIOD>
            <AMOUNT>-${amt(o.base_amount)}</AMOUNT>
          </BILLALLOCATIONS.LIST>`;

  const taxes = gst <= 0 ? '' : intraState
    ? ledgerEntry(cfg.cgstLedger, cgst, false) + ledgerEntry(cfg.sgstLedger, sgst, false)
    : ledgerEntry(cfg.igstLedger, gst, false);

  return `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER REMOTEID="${esc(o.id)}" VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
        <DATE>${tallyDate(o.purchase_date)}</DATE>
        <EFFECTIVEDATE>${tallyDate(o.purchase_date)}</EFFECTIVEDATE>
        <GUID>${esc(o.id)}</GUID>
        <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${esc(o.order_no)}</VOUCHERNUMBER>
        <REFERENCE>${esc(o.order_no)}</REFERENCE>
        <PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>
        <PARTYNAME>${esc(party)}</PARTYNAME>
        <PARTYGSTIN>${esc(o.buyer?.gstin)}</PARTYGSTIN>
        <STATENAME>${esc(o.buyer?.state)}</STATENAME>
        <PLACEOFSUPPLY>${esc(o.ship_to_state)}</PLACEOFSUPPLY>
        <BASICBUYERNAME>${esc(party)}</BASICBUYERNAME>
        <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
        <ISINVOICE>Yes</ISINVOICE>
        <NARRATION>${esc(`B2B portal indent ${o.order_no} | Godown: ${o.godown?.name ?? '-'} | 15-day credit`)}</NARRATION>${ledgerEntry(party, Number(o.base_amount), true, partyBill)}${inventory}${ledgerEntry(cfg.freightLedger, Number(o.freight), false)}${taxes}
      </VOUCHER>
    </TALLYMESSAGE>`;
}

export function buildEnvelope(orders: TallyOrder[], cfg: TallyConfig): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${esc(cfg.company)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>${orders.map((o) => buildVoucher(o, cfg)).join('')}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
}
EOF

# ---------------------------------------------------------------- lib/supabase/client.ts
mkdir -p "lib/supabase"
cat << 'EOF' > "lib/supabase/client.ts"
'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

/** Lazily-created browser client (session persisted in localStorage). */
export function supabaseBrowser(): SupabaseClient {
  if (!browserClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set');
    browserClient = createClient(url, anon, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'af-b2b-auth' },
    });
  }
  return browserClient;
}
EOF

# ---------------------------------------------------------------- lib/supabase/server.ts
mkdir -p "lib/supabase"
cat << 'EOF' > "lib/supabase/server.ts"
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
EOF

# ---------------------------------------------------------------- lib/hooks/useProfile.ts
mkdir -p "lib/hooks"
cat << 'EOF' > "lib/hooks/useProfile.ts"
'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Profile } from '@/lib/types';

export function useProfile() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const { data } = await supabaseBrowser().from('users').select('*').eq('id', s.user.id).single();
    setProfile((data as Profile) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') load(s);
      else setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const signOut = useCallback(async () => {
    await supabaseBrowser().auth.signOut();
    window.location.href = '/login';
  }, []);

  return { session, profile, loading, signOut, reload: () => load(session) };
}
EOF

# ---------------------------------------------------------------- app/api/orders/create/route.ts
mkdir -p "app/api/orders/create"
cat << 'EOF' > "app/api/orders/create/route.ts"
import { NextResponse } from 'next/server';
import { HttpError, readJson, requireUser, route, mapDbError } from '@/lib/supabase/server';
import { MIN_ORDER_VALUE } from '@/lib/business';
import { UUID_RE, round2 } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  items?: { product_id?: unknown; qty?: unknown }[];
  client_ref?: unknown;
  notes?: unknown;
}

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  const { profile } = ctx;

  // 1. KYC gate
  if (profile.role !== 'buyer') throw new HttpError(403, 'ONLY_BUYERS_CAN_ORDER', 'Admin accounts cannot place indents');
  if (!profile.is_approved) throw new HttpError(403, 'KYC_NOT_APPROVED', 'Your account is pending KYC approval');
  if (!profile.godown_id) throw new HttpError(409, 'NO_GODOWN_ASSIGNED', 'No godown is mapped to your account yet');

  // 2. Shape validation + de-duplication
  const body = await readJson<Body>(req);
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) {
    throw new HttpError(400, 'INVALID_ITEMS', 'items must be a non-empty array (max 100 lines)');
  }
  const merged = new Map<string, number>();
  for (const it of body.items) {
    const id = String(it?.product_id ?? '');
    const qty = Number(it?.qty);
    if (!UUID_RE.test(id) || !Number.isInteger(qty) || qty <= 0 || qty > 999_999) {
      throw new HttpError(400, 'INVALID_ITEMS', 'Each item needs a valid product_id and a positive integer qty');
    }
    merged.set(id, (merged.get(id) ?? 0) + qty);
  }
  const items = Array.from(merged, ([product_id, qty]) => ({ product_id, qty }));
  const clientRef = typeof body.client_ref === 'string' && body.client_ref.length <= 64 ? body.client_ref : null;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : null;

  // 3. ₹50,000 minimum on authoritative DB prices (never trust client prices)
  const { data: products, error } = await ctx.admin
    .from('products')
    .select('id, price, is_active')
    .in('id', items.map((i) => i.product_id));
  if (error) throw mapDbError(error);
  const priceOf = new Map((products ?? []).filter((p) => p.is_active).map((p) => [p.id as string, Number(p.price)]));
  const missing = items.filter((i) => !priceOf.has(i.product_id));
  if (missing.length) throw new HttpError(422, 'PRODUCT_NOT_AVAILABLE', 'Some products are not available', missing);
  const subtotal = round2(items.reduce((s, i) => s + round2(i.qty * priceOf.get(i.product_id)!), 0));
  if (subtotal < MIN_ORDER_VALUE) {
    throw new HttpError(422, 'MIN_ORDER_VALUE_NOT_MET', `Minimum indent value is ₹50,000 (current subtotal ₹${subtotal.toLocaleString('en-IN')})`, {
      subtotal,
      minimum: MIN_ORDER_VALUE,
      shortfall: round2(MIN_ORDER_VALUE - subtotal),
    });
  }

  // 4. Atomic transaction: stock lock + deduction from the buyer's godown, freight, credit check
  const { data, error: rpcErr } = await ctx.db.rpc('create_b2b_order', {
    p_items: items,
    p_client_ref: clientRef,
    p_notes: notes,
  });
  if (rpcErr) throw mapDbError(rpcErr);

  return NextResponse.json({ order: data }, { status: data?.idempotent_replay ? 200 : 201 });
});
EOF

# ---------------------------------------------------------------- app/api/finance/aging/route.ts
mkdir -p "app/api/finance/aging"
cat << 'EOF' > "app/api/finance/aging/route.ts"
import { NextResponse } from 'next/server';
import { HttpError, requireAdmin, route, safeEqual, serviceClient, unwrap, bearerToken } from '@/lib/supabase/server';
import type { AgingBucket, AgingRow } from '@/lib/types';
import { round2 } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Vercel Cron (Bearer CRON_SECRET) or an admin session. */
async function authorize(req: Request) {
  const secret = process.env.CRON_SECRET;
  const token = bearerToken(req);
  if (secret && token && safeEqual(token, secret)) return { actor: null as string | null, admin: serviceClient(), isCron: true };
  const ctx = await requireAdmin(req);
  return { actor: ctx.user.id, admin: ctx.admin, isCron: false };
}

async function run(req: Request) {
  const { actor, admin, isCron } = await authorize(req);
  const asOfParam = new URL(req.url).searchParams.get('as_of');
  if (asOfParam && (!/^\d{4}-\d{2}-\d{2}$/.test(asOfParam) || isCron)) {
    throw new HttpError(400, 'INVALID_DATE', 'as_of must be YYYY-MM-DD (admin only)');
  }

  // Strip early discounts past due date + accrue 18% APY on >90-day bills (atomic, idempotent per date)
  const summary = unwrap(await admin.rpc('recalculate_aging', { p_as_of: asOfParam, p_actor: actor }));
  if (isCron) return NextResponse.json({ summary });

  const rows = unwrap(
    await admin.from('v_receivables_aging').select('*').order('due_date', { ascending: true }).limit(2000),
  ) as AgingRow[];

  const buckets: Record<AgingBucket, { count: number; balance: number }> = {
    CURRENT: { count: 0, balance: 0 },
    '1-30': { count: 0, balance: 0 },
    '31-60': { count: 0, balance: 0 },
    '61-90': { count: 0, balance: 0 },
    '90+': { count: 0, balance: 0 },
  };
  let totalInterest = 0;
  for (const r of rows) {
    buckets[r.bucket].count += 1;
    buckets[r.bucket].balance = round2(buckets[r.bucket].balance + Number(r.balance));
    totalInterest += Number(r.penalty_interest);
  }
  return NextResponse.json({
    summary,
    buckets,
    totals: {
      receivable: round2(rows.reduce((s, r) => s + Number(r.balance), 0)),
      penalty_interest: round2(totalInterest),
    },
    orders: rows,
  });
}

export const GET = route(run);
export const POST = route(run);
EOF

# ---------------------------------------------------------------- app/api/finance/adjust/route.ts
mkdir -p "app/api/finance/adjust"
cat << 'EOF' > "app/api/finance/adjust/route.ts"
import { NextResponse } from 'next/server';
import { HttpError, readJson, requireAdmin, route, unwrap } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Action = 'WAIVE_INTEREST' | 'REAPPLY_DISCOUNT' | 'RECORD_PAYMENT';

export const POST = route(async (req) => {
  const ctx = await requireAdmin(req);
  const body = await readJson<{ order_id?: string; action?: Action; amount?: number; paid_on?: string; note?: string }>(req);
  if (!body.order_id || !UUID_RE.test(body.order_id)) throw new HttpError(400, 'INVALID_ORDER', 'order_id is required');
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

  let order;
  switch (body.action) {
    case 'WAIVE_INTEREST':
      order = unwrap(await ctx.admin.rpc('waive_interest', { p_order_id: body.order_id, p_actor: ctx.user.id, p_note: note }));
      break;
    case 'REAPPLY_DISCOUNT':
      order = unwrap(await ctx.admin.rpc('reapply_discount', { p_order_id: body.order_id, p_actor: ctx.user.id, p_note: note }));
      break;
    case 'RECORD_PAYMENT': {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'INVALID_AMOUNT', 'amount must be > 0');
      if (body.paid_on && !/^\d{4}-\d{2}-\d{2}$/.test(body.paid_on)) throw new HttpError(400, 'INVALID_DATE', 'paid_on must be YYYY-MM-DD');
      order = unwrap(
        await ctx.admin.rpc('record_payment', {
          p_order_id: body.order_id,
          p_amount: Math.round(amount * 100) / 100,
          p_actor: ctx.user.id,
          p_paid_on: body.paid_on ?? null,
          p_note: note,
        }),
      );
      break;
    }
    default:
      throw new HttpError(400, 'INVALID_ACTION', 'action must be WAIVE_INTEREST | REAPPLY_DISCOUNT | RECORD_PAYMENT');
  }
  return NextResponse.json({ order });
});
EOF

# ---------------------------------------------------------------- app/api/tally/sync/route.ts
mkdir -p "app/api/tally/sync"
cat << 'EOF' > "app/api/tally/sync/route.ts"
import { NextResponse } from 'next/server';
import { HttpError, readJson, requireAdmin, route, safeEqual, serviceClient, unwrap } from '@/lib/supabase/server';
import { buildEnvelope, tallyConfigFromEnv, type TallyOrder } from '@/lib/tally';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Tally connector authenticates with x-api-key; admins may also pull/preview with their session. */
async function authorize(req: Request) {
  const key = process.env.TALLY_SYNC_API_KEY;
  const given = req.headers.get('x-api-key');
  if (key && given && safeEqual(given, key)) return serviceClient();
  if (given) throw new HttpError(401, 'INVALID_API_KEY', 'Invalid Tally API key');
  return (await requireAdmin(req)).admin;
}

/**
 * GET /api/tally/sync[?format=json&limit=100]
 * Returns ONLY orders with is_locked_for_tally = true AND tally_synced = false
 * (Tally Prime Edit Log 7.1: vouchers are pushed once, from immutable data).
 * Read-only: call POST to acknowledge after Tally imports successfully.
 */
export const GET = route(async (req) => {
  const admin = await authorize(req);
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);

  const orders = unwrap(
    await admin
      .from('orders')
      .select(
        'id, order_no, purchase_date, ship_to_state, subtotal, freight, gst_amount, base_amount, locked_at,' +
          'buyer:users!orders_buyer_id_fkey(business_name, gstin, state),' +
          'godown:godowns(name, state),' +
          'order_items(sku, product_name, unit, qty, unit_price, line_total, gst_amount)',
      )
      .eq('is_locked_for_tally', true)
      .eq('tally_synced', false)
      .order('locked_at', { ascending: true })
      .limit(limit),
  ) as unknown as TallyOrder[];

  const ids = orders.map((o) => o.id);
  if (url.searchParams.get('format') === 'json') return NextResponse.json({ count: orders.length, order_ids: ids, orders });

  return new NextResponse(buildEnvelope(orders, tallyConfigFromEnv()), {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `inline; filename="tally-vouchers-${new Date().toISOString().slice(0, 10)}.xml"`,
      'X-Voucher-Count': String(orders.length),
      'X-Order-Ids': ids.join(','),
      'Cache-Control': 'no-store',
    },
  });
});

/** POST /api/tally/sync  { "order_ids": [...] } — acknowledge successful import. */
export const POST = route(async (req) => {
  const admin = await authorize(req);
  const body = await readJson<{ order_ids?: unknown }>(req);
  const ids = Array.isArray(body.order_ids) ? body.order_ids.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)) : [];
  if (!ids.length || ids.length > 500) throw new HttpError(400, 'INVALID_IDS', 'order_ids must contain 1–500 UUIDs');
  const marked = unwrap(await admin.rpc('mark_tally_synced', { p_order_ids: ids }));
  return NextResponse.json({ marked });
});
EOF

# ---------------------------------------------------------------- app/api/admin/orders/[id]/status/route.ts
mkdir -p "app/api/admin/orders/[id]/status"
cat << 'EOF' > "app/api/admin/orders/[id]/status/route.ts"
import { NextResponse } from 'next/server';
import { HttpError, readJson, requireAdmin, route, unwrap } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED = ['APPROVED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'] as const;

export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const ctx = await requireAdmin(req);
  if (!UUID_RE.test(params.id)) throw new HttpError(400, 'INVALID_ORDER', 'Invalid order id');
  const { status } = await readJson<{ status?: string }>(req);
  if (!status || !(ALLOWED as readonly string[]).includes(status)) {
    throw new HttpError(400, 'INVALID_STATUS', `status must be one of ${ALLOWED.join(', ')}`);
  }
  const order = unwrap(await ctx.admin.rpc('admin_set_order_status', { p_order_id: params.id, p_status: status, p_actor: ctx.user.id }));
  return NextResponse.json({ order });
});
EOF

# ---------------------------------------------------------------- app/api/admin/orders/[id]/lock/route.ts
mkdir -p "app/api/admin/orders/[id]/lock"
cat << 'EOF' > "app/api/admin/orders/[id]/lock/route.ts"
import { NextResponse } from 'next/server';
import { HttpError, requireAdmin, route, unwrap } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Admin "Lock & Sync to Tally": freezes voucher fields and queues the order for /api/tally/sync. */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const ctx = await requireAdmin(req);
  if (!UUID_RE.test(params.id)) throw new HttpError(400, 'INVALID_ORDER', 'Invalid order id');
  const order = unwrap(await ctx.admin.rpc('lock_order_for_tally', { p_order_id: params.id, p_actor: ctx.user.id }));
  return NextResponse.json({ order });
});
EOF

# ---------------------------------------------------------------- app/api/admin/kyc/route.ts
mkdir -p "app/api/admin/kyc"
cat << 'EOF' > "app/api/admin/kyc/route.ts"
import { NextResponse } from 'next/server';
import { HttpError, readJson, requireAdmin, route, unwrap } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = route(async (req) => {
  const ctx = await requireAdmin(req);
  const b = await readJson<{ user_id?: string; is_approved?: boolean; credit_limit?: number; godown_id?: string }>(req);
  if (!b.user_id || !UUID_RE.test(b.user_id)) throw new HttpError(400, 'INVALID_USER', 'user_id is required');
  if (b.credit_limit !== undefined && (!Number.isFinite(Number(b.credit_limit)) || Number(b.credit_limit) < 0)) {
    throw new HttpError(400, 'INVALID_AMOUNT', 'credit_limit must be a non-negative number');
  }
  if (b.godown_id !== undefined && !/^[A-Z][A-Z0-9_]*$/.test(b.godown_id)) throw new HttpError(400, 'INVALID_GODOWN', 'Invalid godown');
  const user = unwrap(
    await ctx.admin.rpc('admin_set_kyc', {
      p_user_id: b.user_id,
      p_is_approved: typeof b.is_approved === 'boolean' ? b.is_approved : null,
      p_credit_limit: b.credit_limit === undefined ? null : Math.round(Number(b.credit_limit) * 100) / 100,
      p_godown_id: b.godown_id ?? null,
      p_actor: ctx.user.id,
    }),
  );
  return NextResponse.json({ user });
});
EOF

# ---------------------------------------------------------------- app/api/admin/stock/route.ts
mkdir -p "app/api/admin/stock"
cat << 'EOF' > "app/api/admin/stock/route.ts"
import { NextResponse } from 'next/server';
import { HttpError, readJson, requireAdmin, route, unwrap } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GODOWN_RE = /^[A-Z][A-Z0-9_]*$/;

interface Body {
  action?: 'TRANSFER' | 'ADJUST';
  product_id?: string;
  from_godown_id?: string;
  to_godown_id?: string;
  godown_id?: string;
  qty?: number;
  note?: string;
}

export const POST = route(async (req) => {
  const ctx = await requireAdmin(req);
  const b = await readJson<Body>(req);
  const qty = Number(b.qty);
  if (!b.product_id || !UUID_RE.test(b.product_id)) throw new HttpError(400, 'INVALID_PRODUCT', 'product_id is required');
  if (!Number.isInteger(qty) || qty === 0) throw new HttpError(400, 'INVALID_AMOUNT', 'qty must be a non-zero integer');
  const note = typeof b.note === 'string' ? b.note.slice(0, 300) : null;

  if (b.action === 'TRANSFER') {
    if (!GODOWN_RE.test(b.from_godown_id ?? '') || !GODOWN_RE.test(b.to_godown_id ?? '')) {
      throw new HttpError(400, 'INVALID_GODOWN', 'from_godown_id and to_godown_id are required');
    }
    if (qty < 0) throw new HttpError(400, 'INVALID_AMOUNT', 'Transfer qty must be positive');
    const result = unwrap(
      await ctx.admin.rpc('transfer_stock', {
        p_product_id: b.product_id,
        p_from_godown: b.from_godown_id,
        p_to_godown: b.to_godown_id,
        p_qty: qty,
        p_actor: ctx.user.id,
        p_note: note,
      }),
    );
    return NextResponse.json({ result });
  }
  if (b.action === 'ADJUST') {
    if (!GODOWN_RE.test(b.godown_id ?? '')) throw new HttpError(400, 'INVALID_GODOWN', 'godown_id is required');
    const result = unwrap(
      await ctx.admin.rpc('adjust_stock', { p_product_id: b.product_id, p_godown_id: b.godown_id, p_delta: qty, p_actor: ctx.user.id, p_note: note }),
    );
    return NextResponse.json({ result });
  }
  throw new HttpError(400, 'INVALID_ACTION', 'action must be TRANSFER or ADJUST');
});
EOF

# ---------------------------------------------------------------- app/layout.tsx
mkdir -p "app"
cat << 'EOF' > "app/layout.tsx"
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Akshat Fertilizer — B2B Distribution Portal',
  description: 'Dealer indents, godown stock, credit and Tally-synced invoicing for Akshat Fertilizer.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
EOF

# ---------------------------------------------------------------- app/globals.css
mkdir -p "app"
cat << 'EOF' > "app/globals.css"
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  }
}

@layer components {
  .btn {
    @apply inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50;
  }
  .btn-primary { @apply btn bg-emerald-700 text-white hover:bg-emerald-800; }
  .btn-secondary { @apply btn border border-slate-300 bg-white text-slate-700 hover:bg-slate-50; }
  .btn-danger { @apply btn bg-rose-600 text-white hover:bg-rose-700; }
  .input {
    @apply w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20;
  }
  .label { @apply mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500; }
  .card { @apply rounded-xl border border-slate-200 bg-white shadow-sm; }
  .th { @apply px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500; }
  .td { @apply px-3 py-2 text-sm; }
}
EOF

# ---------------------------------------------------------------- app/(auth)/layout.tsx
mkdir -p "app/(auth)"
cat << 'EOF' > "app/(auth)/layout.tsx"
import { Sprout } from 'lucide-react';
import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 to-slate-100 px-4 py-12">
      <Link href="/" className="mb-6 flex items-center gap-2 text-emerald-800">
        <Sprout className="h-7 w-7" />
        <span className="text-lg font-semibold">Akshat Fertilizer · B2B Portal</span>
      </Link>
      <div className="card w-full max-w-md p-6">{children}</div>
    </div>
  );
}
EOF

# ---------------------------------------------------------------- app/(auth)/login/page.tsx
mkdir -p "app/(auth)/login"
cat << 'EOF' > "app/(auth)/login/page.tsx"
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Alert, Spinner } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const sb = supabaseBrowser();
    const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) {
      setError(error?.message ?? 'Sign-in failed');
      setBusy(false);
      return;
    }
    const { data: profile } = await sb.from('users').select('role').eq('id', data.user.id).single();
    router.replace(profile?.role === 'admin' ? '/dashboard' : '/');
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-semibold">Dealer sign in</h1>
      {error && <Alert>{error}</Alert>}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? <Spinner /> : <LogIn className="h-4 w-4" />} Sign in
      </button>
      <p className="text-center text-sm text-slate-500">
        New dealer? <Link className="font-medium text-emerald-700 hover:underline" href="/register">Register for a B2B account</Link>
      </p>
    </form>
  );
}
EOF

# ---------------------------------------------------------------- app/(auth)/register/page.tsx
mkdir -p "app/(auth)/register"
cat << 'EOF' > "app/(auth)/register/page.tsx"
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { INDIAN_STATES, validateGstin } from '@/lib/states';
import { Alert, Spinner } from '@/components/ui';

export default function RegisterPage() {
  const [form, setForm] = useState({ business_name: '', gstin: '', state: 'Maharashtra', phone: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const gstErr = validateGstin(form.gstin, form.state);
    if (gstErr) return setError(gstErr);
    if (form.business_name.trim().length < 3) return setError('Enter your registered business name.');
    if (form.password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    const { error } = await supabaseBrowser().auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: { business_name: form.business_name.trim(), gstin: form.gstin.trim().toUpperCase(), state: form.state, phone: form.phone.trim() },
      },
    });
    setBusy(false);
    if (error) {
      setError(/database error/i.test(error.message) ? 'This GSTIN is already registered or invalid.' : error.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Registration received</h1>
        <Alert tone="green">
          Please verify your email. Our accounts team will review your GSTIN and set your credit limit — you can view stock and place indents once
          your KYC is approved.
        </Alert>
        <Link href="/login" className="btn-secondary w-full">Back to sign in</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-semibold">Register as a B2B dealer</h1>
      {error && <Alert>{error}</Alert>}
      <div>
        <label className="label">Business name (as per GST)</label>
        <input className="input" required value={form.business_name} onChange={set('business_name')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">GSTIN</label>
          <input className="input uppercase" required maxLength={15} placeholder="27ABCDE1234F1Z5" value={form.gstin} onChange={set('gstin')} />
        </div>
        <div>
          <label className="label">State</label>
          <select className="input" value={form.state} onChange={set('state')}>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.name}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Mobile</label>
        <input className="input" type="tel" pattern="[0-9+ ]{10,15}" value={form.phone} onChange={set('phone')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" required autoComplete="new-password" value={form.password} onChange={set('password')} />
        </div>
      </div>
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? <Spinner /> : <UserPlus className="h-4 w-4" />} Submit for KYC approval
      </button>
      <p className="text-center text-sm text-slate-500">
        Already registered? <Link className="font-medium text-emerald-700 hover:underline" href="/login">Sign in</Link>
      </p>
    </form>
  );
}
EOF

# ---------------------------------------------------------------- app/(storefront)/page.tsx
mkdir -p "app/(storefront)"
cat << 'EOF' > "app/(storefront)/page.tsx"
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Minus, Package, Plus, Search, ShieldAlert, Warehouse } from 'lucide-react';
import { useProfile } from '@/lib/hooks/useProfile';
import { supabaseBrowser } from '@/lib/supabase/client';
import { apiFetch, ApiError } from '@/lib/api';
import { computeCart, GODOWNS, type GodownId } from '@/lib/business';
import type { BuyerCredit, InventoryRow, Order, Product } from '@/lib/types';
import { formatDate, formatINR } from '@/lib/utils';
import { AppHeader } from '@/components/AppHeader';
import { CreditBanner } from '@/components/storefront/CreditBanner';
import { CartPanel } from '@/components/storefront/CartPanel';
import { Alert, Badge, Empty, FullPageLoader, STATUS_TONE } from '@/components/ui';

type Shortage = { name?: string; sku?: string; requested: number; available: number };

export default function StorefrontPage() {
  const router = useRouter();
  const { session, profile, loading, signOut } = useProfile();
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [credit, setCredit] = useState<BuyerCredit | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ tone: 'red' | 'green'; msg: React.ReactNode } | null>(null);
  const [clientRef, setClientRef] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())));

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (profile?.role === 'admin') router.replace('/dashboard');
  }, [loading, session, profile, router]);

  const approved = profile?.role === 'buyer' && profile.is_approved;

  const refresh = useCallback(async () => {
    if (!profile || !approved) return;
    const sb = supabaseBrowser();
    // RLS returns ONLY the buyer's state-mapped godown stock.
    const [p, inv, c, o] = await Promise.all([
      sb.from('products').select('*').eq('is_active', true).order('category').order('name'),
      sb.from('inventory').select('*'),
      sb.from('v_buyer_credit').select('*').eq('user_id', profile.id).maybeSingle(),
      sb.from('orders').select('*').order('created_at', { ascending: false }).limit(10),
    ]);
    setProducts((p.data as Product[]) ?? []);
    setStock(Object.fromEntries(((inv.data as InventoryRow[]) ?? []).map((r) => [r.product_id, r.stock_qty])));
    setCredit((c.data as BuyerCredit) ?? null);
    setOrders((o.data as Order[]) ?? []);
  }, [profile, approved]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setQty = (id: string, qty: number) =>
    setCart((c) => {
      const max = stock[id] ?? 0;
      const next = { ...c, [id]: Math.max(0, Math.min(max, Math.floor(qty || 0))) };
      if (!next[id]) delete next[id];
      return next;
    });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? products.filter((p) => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(q)) : products;
  }, [products, query]);

  const cartTotal = useMemo(
    () => computeCart(products.filter((p) => cart[p.id]).map((p) => ({ qty: cart[p.id], price: Number(p.price), gst_rate: Number(p.gst_rate) })), profile?.state).total,
    [cart, products, profile?.state],
  );

  async function placeOrder() {
    setBusy(true);
    setFlash(null);
    try {
      const items = Object.entries(cart).map(([product_id, qty]) => ({ product_id, qty }));
      const res = await apiFetch<{ order: { order_no: string; amount_due: number; due_date: string } }>('/api/orders/create', {
        method: 'POST',
        json: { items, client_ref: clientRef },
      });
      setFlash({ tone: 'green', msg: <>Indent <b>{res.order.order_no}</b> placed. Pay {formatINR(res.order.amount_due)} by {formatDate(res.order.due_date)} to keep the early-payment discount.</> });
      setCart({});
      setClientRef(crypto.randomUUID());
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK' && Array.isArray(e.details)) {
        setFlash({
          tone: 'red',
          msg: (
            <>
              Stock changed while you were ordering:
              <ul className="mt-1 list-disc pl-5">
                {(e.details as Shortage[]).map((s, i) => (
                  <li key={i}>{s.name ?? s.sku}: requested {s.requested}, available {s.available}</li>
                ))}
              </ul>
            </>
          ),
        });
        await refresh();
      } else {
        setFlash({ tone: 'red', msg: e instanceof Error ? e.message : 'Could not place indent' });
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading || !session || !profile || profile.role === 'admin') return <FullPageLoader />;

  return (
    <div className="min-h-screen">
      <AppHeader profile={profile} onSignOut={signOut} />
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
        {!approved ? (
          <div className="card mx-auto max-w-xl p-8 text-center">
            <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
            <h1 className="mt-3 text-lg font-semibold">KYC approval pending</h1>
            <p className="mt-2 text-sm text-slate-600">
              Thanks for registering <b>{profile.business_name}</b> ({profile.gstin}). Our accounts team is verifying your GSTIN and setting your credit
              limit. Stock and ordering unlock automatically once approved.
            </p>
          </div>
        ) : (
          <>
            <CreditBanner credit={credit} pendingOrderValue={cartTotal} />
            {flash && <Alert tone={flash.tone} onClose={() => setFlash(null)}>{flash.msg}</Alert>}

            <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
              <section className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="flex items-center gap-2 text-lg font-semibold">
                    <Warehouse className="h-5 w-5 text-emerald-700" />
                    {GODOWNS[profile.godown_id as GodownId] ?? profile.godown_id} stock
                  </h1>
                  <div className="relative ml-auto w-full sm:w-64">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input className="input pl-9" placeholder="Search product / SKU" value={query} onChange={(e) => setQuery(e.target.value)} />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filtered.map((p) => {
                    const available = stock[p.id] ?? 0;
                    const qty = cart[p.id] ?? 0;
                    return (
                      <article key={p.id} className="card flex flex-col p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-medium text-slate-500">{p.category} · {p.sku}</p>
                            <h3 className="font-semibold leading-snug">{p.name}</h3>
                          </div>
                          <Package className="h-5 w-5 shrink-0 text-slate-300" />
                        </div>
                        <p className="mt-2 text-lg font-semibold">
                          {formatINR(p.price)}<span className="text-xs font-normal text-slate-500"> / {p.pack_size_kg} kg {p.unit.toLowerCase()} + {p.gst_rate}% GST</span>
                        </p>
                        <p className="mt-1 text-xs">
                          {available > 0 ? <Badge tone={available < 50 ? 'amber' : 'green'}>{available.toLocaleString('en-IN')} in stock</Badge> : <Badge tone="red">Out of stock</Badge>}
                        </p>
                        <div className="mt-auto flex items-center gap-2 pt-3">
                          <button className="btn-secondary px-2" disabled={qty <= 0} onClick={() => setQty(p.id, qty - 10)} aria-label="Less"><Minus className="h-4 w-4" /></button>
                          <input
                            className="input text-center"
                            type="number"
                            min={0}
                            max={available}
                            value={qty || ''}
                            placeholder="0"
                            disabled={available <= 0}
                            onChange={(e) => setQty(p.id, Number(e.target.value))}
                          />
                          <button className="btn-secondary px-2" disabled={qty >= available} onClick={() => setQty(p.id, qty + 10)} aria-label="More"><Plus className="h-4 w-4" /></button>
                        </div>
                      </article>
                    );
                  })}
                  {!filtered.length && <div className="card sm:col-span-2 xl:col-span-3"><Empty>No products match.</Empty></div>}
                </div>

                <div className="card">
                  <h2 className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 font-semibold"><Clock className="h-4 w-4" /> Recent indents</h2>
                  {orders.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-slate-50"><tr><th className="th">Indent</th><th className="th">Date</th><th className="th">Status</th><th className="th text-right">Due</th><th className="th">Due date</th><th className="th">Payment</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {orders.map((o) => (
                            <tr key={o.id}>
                              <td className="td font-medium">{o.order_no}</td>
                              <td className="td">{formatDate(o.purchase_date)}</td>
                              <td className="td"><Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge></td>
                              <td className="td text-right">{formatINR(Number(o.amount_due) - Number(o.amount_paid))}</td>
                              <td className="td">{formatDate(o.due_date)}</td>
                              <td className="td"><Badge tone={STATUS_TONE[o.payment_status]}>{o.payment_status}</Badge></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty>No indents yet.</Empty>
                  )}
                </div>
              </section>

              <CartPanel
                cart={cart}
                products={products}
                state={profile.state}
                availableCredit={Number(credit?.available ?? 0)}
                busy={busy}
                onQty={setQty}
                onClear={() => setCart({})}
                onSubmit={placeOrder}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
EOF

# ---------------------------------------------------------------- app/(admin)/dashboard/page.tsx
mkdir -p "app/(admin)/dashboard"
cat << 'EOF' > "app/(admin)/dashboard/page.tsx"
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, BadgeCheck, IndianRupee, LogOut, Sprout, Truck } from 'lucide-react';
import { useProfile } from '@/lib/hooks/useProfile';
import { cn } from '@/lib/utils';
import { FullPageLoader } from '@/components/ui';
import { OperationsTab } from '@/components/admin/OperationsTab';
import { FinanceTab } from '@/components/admin/FinanceTab';
import { StockTab } from '@/components/admin/StockTab';
import { KycTab } from '@/components/admin/KycTab';

const TABS = [
  { id: 'ops', label: 'Operations Pipeline', icon: Truck },
  { id: 'finance', label: 'Finance & Aging', icon: IndianRupee },
  { id: 'stock', label: 'Godown Stock Transfer', icon: ArrowLeftRight },
  { id: 'kyc', label: 'KYC Account Approvals', icon: BadgeCheck },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function AdminDashboardPage() {
  const router = useRouter();
  const { session, profile, loading, signOut } = useProfile();
  const [tab, setTab] = useState<TabId>('ops');

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (profile && profile.role !== 'admin') router.replace('/');
  }, [loading, session, profile, router]);

  useEffect(() => {
    const h = window.location.hash.slice(1) as TabId;
    if (TABS.some((t) => t.id === h)) setTab(h);
  }, []);

  if (loading || !profile || profile.role !== 'admin') return <FullPageLoader />;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-900 text-slate-200 md:flex">
        <div className="flex items-center gap-2 px-5 py-5 font-semibold text-white">
          <Sprout className="h-6 w-6 text-emerald-400" /> Akshat ERP
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                setTab(id);
                history.replaceState(null, '', `#${id}`);
              }}
              className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition', tab === id ? 'bg-emerald-600 text-white' : 'hover:bg-slate-800')}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-4 text-xs">
          <p className="truncate text-slate-400">{profile.email}</p>
          <button onClick={signOut} className="mt-2 flex items-center gap-2 text-slate-300 hover:text-white"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 flex gap-1 overflow-x-auto border-b border-slate-200 bg-white p-2 md:hidden">
          {TABS.map(({ id, label }) => (
            <button key={id} onClick={() => setTab(id)} className={cn('whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium', tab === id ? 'bg-emerald-600 text-white' : 'text-slate-600')}>
              {label}
            </button>
          ))}
        </div>
        <main className="mx-auto max-w-7xl p-4 md:p-8">
          {tab === 'ops' && <OperationsTab />}
          {tab === 'finance' && <FinanceTab />}
          {tab === 'stock' && <StockTab adminId={profile.id} />}
          {tab === 'kyc' && <KycTab />}
        </main>
      </div>
    </div>
  );
}
EOF

# ---------------------------------------------------------------- components/ui.tsx
mkdir -p "components"
cat << 'EOF' > "components/ui.tsx"
'use client';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const TONES = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'slate', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone], className)}>
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  PENDING: 'amber',
  APPROVED: 'blue',
  DISPATCHED: 'violet',
  DELIVERED: 'green',
  CANCELLED: 'red',
  UNPAID: 'amber',
  PARTIAL: 'blue',
  PAID: 'green',
  CURRENT: 'green',
  '1-30': 'amber',
  '31-60': 'amber',
  '61-90': 'red',
  '90+': 'red',
};

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} />;
}

export function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'red' | 'green' }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold', tone === 'red' && 'text-rose-600', tone === 'green' && 'text-emerald-700')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Alert({ tone = 'red', children, onClose }: { tone?: 'red' | 'green' | 'amber'; children: React.ReactNode; onClose?: () => void }) {
  const t = { red: 'border-rose-200 bg-rose-50 text-rose-800', green: 'border-emerald-200 bg-emerald-50 text-emerald-800', amber: 'border-amber-200 bg-amber-50 text-amber-900' }[tone];
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', t)} role="alert">
      <div className="flex-1">{children}</div>
      {onClose && (
        <button onClick={onClose} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-slate-500">{children}</div>;
}
EOF

# ---------------------------------------------------------------- components/AppHeader.tsx
mkdir -p "components"
cat << 'EOF' > "components/AppHeader.tsx"
'use client';
import Link from 'next/link';
import { LayoutDashboard, LogOut, Sprout, Store } from 'lucide-react';
import type { Profile } from '@/lib/types';

export function AppHeader({ profile, onSignOut }: { profile: Profile | null; onSignOut: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-emerald-800">
          <Sprout className="h-6 w-6" /> Akshat Fertilizer <span className="hidden text-slate-400 sm:inline">· B2B</span>
        </Link>
        <div className="flex-1" />
        {profile?.role === 'admin' ? (
          <Link href="/dashboard" className="btn-secondary"><LayoutDashboard className="h-4 w-4" /> Admin</Link>
        ) : (
          <Link href="/" className="hidden sm:inline-flex btn-secondary"><Store className="h-4 w-4" /> Catalog</Link>
        )}
        {profile && (
          <div className="hidden text-right text-xs leading-tight md:block">
            <p className="font-medium text-slate-800">{profile.business_name ?? profile.email}</p>
            <p className="text-slate-500">{profile.gstin ?? profile.role.toUpperCase()}</p>
          </div>
        )}
        <button onClick={onSignOut} className="btn-secondary" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
      </div>
    </header>
  );
}
EOF

# ---------------------------------------------------------------- components/storefront/CreditBanner.tsx
mkdir -p "components/storefront"
cat << 'EOF' > "components/storefront/CreditBanner.tsx"
'use client';
import { AlertTriangle, CreditCard } from 'lucide-react';
import type { BuyerCredit } from '@/lib/types';
import { cn, formatINR } from '@/lib/utils';

export function CreditBanner({ credit, pendingOrderValue }: { credit: BuyerCredit | null; pendingOrderValue: number }) {
  if (!credit) return null;
  const limit = Number(credit.credit_limit);
  const used = Number(credit.outstanding);
  const projected = used + pendingOrderValue;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
  const projPct = limit > 0 ? Math.min(100, (projected / limit) * 100) : 100;
  const over = projected > limit;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><CreditCard className="h-5 w-5" /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Credit limit</p>
            <p className="text-lg font-semibold">{formatINR(limit)}</p>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Outstanding</p>
          <p className="text-lg font-semibold">{formatINR(used)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Available</p>
          <p className={cn('text-lg font-semibold', Number(credit.available) <= 0 ? 'text-rose-600' : 'text-emerald-700')}>{formatINR(credit.available)}</p>
        </div>
        {credit.overdue_orders > 0 && (
          <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700">
            <AlertTriangle className="h-4 w-4" /> {credit.overdue_orders} bill(s) overdue — early discount removed; 18% p.a. applies after 90 days
          </p>
        )}
      </div>
      <div className="relative h-2 bg-slate-100">
        <div className={cn('absolute inset-y-0 left-0 opacity-40', over ? 'bg-rose-500' : 'bg-emerald-400')} style={{ width: `${projPct}%` }} />
        <div className={cn('absolute inset-y-0 left-0', pct > 85 ? 'bg-rose-500' : 'bg-emerald-600')} style={{ width: `${pct}%` }} />
      </div>
      {over && pendingOrderValue > 0 && (
        <p className="bg-rose-50 px-4 py-2 text-xs font-medium text-rose-700">This cart ({formatINR(pendingOrderValue)}) would exceed your available credit.</p>
      )}
    </section>
  );
}
EOF

# ---------------------------------------------------------------- components/storefront/CartPanel.tsx
mkdir -p "components/storefront"
cat << 'EOF' > "components/storefront/CartPanel.tsx"
'use client';
import { CheckCircle2, ShoppingCart, Trash2, Truck } from 'lucide-react';
import { computeCart, CREDIT_DAYS, EARLY_DISCOUNT_PCT, MIN_ORDER_VALUE } from '@/lib/business';
import type { Product } from '@/lib/types';
import { cn, formatINR } from '@/lib/utils';
import { Spinner } from '@/components/ui';

export function CartPanel({
  cart,
  products,
  state,
  availableCredit,
  busy,
  onQty,
  onClear,
  onSubmit,
}: {
  cart: Record<string, number>;
  products: Product[];
  state: string | null;
  availableCredit: number;
  busy: boolean;
  onQty: (id: string, qty: number) => void;
  onClear: () => void;
  onSubmit: () => void;
}) {
  const lines = products.filter((p) => (cart[p.id] ?? 0) > 0).map((p) => ({ product: p, qty: cart[p.id], price: Number(p.price), gst_rate: Number(p.gst_rate) }));
  const t = computeCart(lines, state);
  const progress = Math.min(100, (t.subtotal / MIN_ORDER_VALUE) * 100);
  const overCredit = t.total > availableCredit;
  const blockReason = !lines.length ? 'Cart is empty' : !t.meetsMinimum ? `Add ${formatINR(t.shortfall)} more to reach the ₹50,000 minimum` : overCredit ? 'Exceeds available credit' : null;

  return (
    <aside className="card sticky top-20 flex max-h-[calc(100vh-6rem)] flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold"><ShoppingCart className="h-4 w-4" /> Indent cart</h2>
        {lines.length > 0 && <button onClick={onClear} className="text-xs text-slate-500 hover:text-rose-600">Clear</button>}
      </div>

      <div className="flex-1 divide-y divide-slate-100 overflow-y-auto">
        {lines.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">Add products from your godown catalog.</p>}
        {lines.map(({ product, qty }) => (
          <div key={product.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{product.name}</p>
              <p className="text-xs text-slate-500">{qty} × {formatINR(product.price)}</p>
            </div>
            <p className="text-sm font-medium">{formatINR(qty * Number(product.price))}</p>
            <button onClick={() => onQty(product.id, 0)} aria-label="Remove" className="text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>

      <div className="space-y-3 border-t border-slate-100 p-4 text-sm">
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-medium text-slate-600">Minimum indent ₹50,000</span>
            {t.meetsMinimum ? (
              <span className="flex items-center gap-1 font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Met</span>
            ) : (
              <span className="text-slate-500">{formatINR(t.shortfall)} to go</span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={cn('h-full rounded-full transition-all', t.meetsMinimum ? 'bg-emerald-600' : 'bg-amber-500')} style={{ width: `${progress}%` }} />
          </div>
        </div>
        <dl className="space-y-1">
          <div className="flex justify-between"><dt className="text-slate-500">Subtotal (ex-GST)</dt><dd>{formatINR(t.subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">GST</dt><dd>{formatINR(t.gst)}</dd></div>
          <div className="flex justify-between">
            <dt className="flex items-center gap-1 text-slate-500"><Truck className="h-3.5 w-3.5" /> Freight ({state ?? 'Other'})</dt>
            <dd>{formatINR(t.freight)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-1 text-base font-semibold"><dt>Invoice total</dt><dd>{formatINR(t.total)}</dd></div>
          {t.subtotal > 0 && (
            <p className="text-xs text-emerald-700">
              Pay {formatINR(t.payableIfEarly)} within {CREDIT_DAYS} days ({EARLY_DISCOUNT_PCT}% early-payment discount).
            </p>
          )}
        </dl>
        <button className="btn-primary w-full" disabled={!!blockReason || busy} onClick={onSubmit}>
          {busy && <Spinner />} Place indent
        </button>
        {blockReason && lines.length > 0 && <p className="text-center text-xs text-amber-700">{blockReason}</p>}
      </div>
    </aside>
  );
}
EOF

# ---------------------------------------------------------------- components/admin/OperationsTab.tsx
mkdir -p "components/admin"
cat << 'EOF' > "components/admin/OperationsTab.tsx"
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Lock, PackageCheck, RefreshCw, Send, Truck, X, XCircle } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { apiFetch } from '@/lib/api';
import type { Order, OrderStatus } from '@/lib/types';
import { cn, formatDate, formatINR } from '@/lib/utils';
import { Alert, Badge, Empty, Spinner, STATUS_TONE } from '@/components/ui';

const FILTERS: (OrderStatus | 'ALL' | 'TALLY_QUEUE')[] = ['ALL', 'PENDING', 'APPROVED', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'TALLY_QUEUE'];
const NEXT: Partial<Record<OrderStatus, { status: OrderStatus; label: string; icon: typeof Truck }[]>> = {
  PENDING: [{ status: 'APPROVED', label: 'Approve', icon: CheckCircle2 }],
  APPROVED: [{ status: 'DISPATCHED', label: 'Mark dispatched', icon: Truck }],
  DISPATCHED: [{ status: 'DELIVERED', label: 'Mark delivered', icon: PackageCheck }],
};

export function OperationsTab() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('PENDING');
  const [selected, setSelected] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabaseBrowser()
      .from('orders')
      .select('*, buyer:users!orders_buyer_id_fkey(business_name, gstin, state, email), order_items(*)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) setError(error.message);
    setOrders((data as Order[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () =>
      orders.filter((o) =>
        filter === 'ALL' ? true : filter === 'TALLY_QUEUE' ? o.is_locked_for_tally && !o.tally_synced : o.status === filter,
      ),
    [orders, filter],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: orders.length, TALLY_QUEUE: 0 };
    for (const o of orders) {
      c[o.status] = (c[o.status] ?? 0) + 1;
      if (o.is_locked_for_tally && !o.tally_synced) c.TALLY_QUEUE += 1;
    }
    return c;
  }, [orders]);

  async function act(order: Order, path: string, body?: unknown) {
    setBusy(path);
    setError(null);
    try {
      const res = await apiFetch<{ order: Order }>(`/api/admin/orders/${order.id}/${path}`, { method: 'POST', json: body ?? {} });
      const merged = { ...order, ...res.order };
      setOrders((os) => os.map((o) => (o.id === order.id ? merged : o)));
      setSelected(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Operations pipeline</h1>
        <button onClick={load} className="btn-secondary ml-auto"><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn('rounded-full border px-3 py-1 text-xs font-medium', filter === f ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-slate-600')}>
            {f === 'TALLY_QUEUE' ? 'Queued for Tally' : f} <span className="opacity-70">({counts[f] ?? 0})</span>
          </button>
        ))}
      </div>
      {error && <Alert onClose={() => setError(null)}>{error}</Alert>}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr><th className="th">Indent</th><th className="th">Dealer</th><th className="th">Godown</th><th className="th">Date</th><th className="th text-right">Invoice</th><th className="th">Status</th><th className="th">Tally</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((o) => (
              <tr key={o.id} onClick={() => setSelected(o)} className="cursor-pointer hover:bg-emerald-50/50">
                <td className="td font-medium">{o.order_no}</td>
                <td className="td">{o.buyer?.business_name}<p className="text-xs text-slate-500">{o.buyer?.gstin}</p></td>
                <td className="td">{o.godown_id}</td>
                <td className="td">{formatDate(o.purchase_date)}</td>
                <td className="td text-right">{formatINR(o.base_amount)}</td>
                <td className="td"><Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge></td>
                <td className="td">
                  {o.tally_synced ? <Badge tone="green">Synced</Badge> : o.is_locked_for_tally ? <Badge tone="violet"><Lock className="h-3 w-3" /> Queued</Badge> : <Badge>Open</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && !loading && <Empty>No orders in this stage.</Empty>}
      </div>

      {/* Slide-out order drawer */}
      <div className={cn('fixed inset-0 z-40 bg-slate-900/40 transition-opacity', selected ? 'opacity-100' : 'pointer-events-none opacity-0')} onClick={() => setSelected(null)} />
      <aside className={cn('fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-white shadow-2xl transition-transform duration-300', selected ? 'translate-x-0' : 'translate-x-full')}>
        {selected && (
          <>
            <div className="flex items-start justify-between border-b border-slate-200 p-5">
              <div>
                <p className="text-xs text-slate-500">Indent</p>
                <h2 className="text-lg font-semibold">{selected.order_no}</h2>
                <div className="mt-1 flex gap-2">
                  <Badge tone={STATUS_TONE[selected.status]}>{selected.status}</Badge>
                  <Badge tone={STATUS_TONE[selected.payment_status]}>{selected.payment_status}</Badge>
                  {selected.is_locked_for_tally && <Badge tone="violet"><Lock className="h-3 w-3" /> {selected.tally_synced ? 'In Tally' : 'Locked'}</Badge>}
                </div>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5 text-sm">
              <section className="grid grid-cols-2 gap-3">
                <div><p className="label">Dealer</p><p className="font-medium">{selected.buyer?.business_name}</p><p className="text-xs text-slate-500">{selected.buyer?.gstin} · {selected.buyer?.email}</p></div>
                <div><p className="label">Ship-to / Godown</p><p className="font-medium">{selected.ship_to_state}</p><p className="text-xs text-slate-500">{selected.godown_id}</p></div>
                <div><p className="label">Purchase date</p><p>{formatDate(selected.purchase_date)}</p></div>
                <div><p className="label">Due date (15 days)</p><p>{formatDate(selected.due_date)}</p></div>
              </section>

              <section>
                <p className="label">Line items</p>
                <table className="w-full rounded-lg border border-slate-200">
                  <thead className="bg-slate-50"><tr><th className="th">Product</th><th className="th text-right">Qty</th><th className="th text-right">Rate</th><th className="th text-right">Amount</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {(selected.order_items ?? []).map((it) => (
                      <tr key={it.id}>
                        <td className="td">{it.product_name}<p className="text-xs text-slate-500">{it.sku} · HSN {it.hsn_code} · GST {it.gst_rate}%</p></td>
                        <td className="td text-right">{it.qty}</td>
                        <td className="td text-right">{formatINR(it.unit_price)}</td>
                        <td className="td text-right">{formatINR(it.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <dl className="space-y-1 rounded-lg bg-slate-50 p-4">
                {[
                  ['Subtotal', selected.subtotal],
                  ['GST', selected.gst_amount],
                  ['Freight', selected.freight],
                  ['Invoice value', selected.base_amount],
                  [`Early discount (${selected.early_discount_pct}%)`, -Number(selected.discount_amount)],
                  ['Penalty interest', selected.penalty_interest],
                  ['Paid', -Number(selected.amount_paid)],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between"><dt className="text-slate-500">{k}</dt><dd>{formatINR(v as number)}</dd></div>
                ))}
                <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Balance</dt><dd>{formatINR(Number(selected.amount_due) - Number(selected.amount_paid))}</dd></div>
              </dl>
              {selected.notes && <p className="rounded-lg border border-slate-200 p-3 text-slate-600">{selected.notes}</p>}
              {selected.is_locked_for_tally && (
                <Alert tone="amber">Locked for Tally on {formatDate(selected.locked_at)} — voucher fields are immutable (Edit Log 7.1). Corrections must be raised as credit/debit notes.</Alert>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-slate-200 p-4">
              {(NEXT[selected.status] ?? []).map(({ status, label, icon: Icon }) => (
                <button key={status} className="btn-secondary" disabled={!!busy} onClick={() => act(selected, 'status', { status })}>
                  {busy === 'status' ? <Spinner /> : <Icon className="h-4 w-4" />} {label}
                </button>
              ))}
              {['PENDING', 'APPROVED'].includes(selected.status) && !selected.is_locked_for_tally && (
                <button
                  className="btn-danger"
                  disabled={!!busy}
                  onClick={() => confirm(`Cancel ${selected.order_no}? Stock returns to ${selected.godown_id}.`) && act(selected, 'status', { status: 'CANCELLED' })}
                >
                  <XCircle className="h-4 w-4" /> Cancel
                </button>
              )}
              <div className="flex-1" />
              <button
                className="btn-primary"
                disabled={!!busy || selected.is_locked_for_tally || !['APPROVED', 'DISPATCHED', 'DELIVERED'].includes(selected.status)}
                title={selected.status === 'PENDING' ? 'Approve the order first' : undefined}
                onClick={() => confirm(`Lock ${selected.order_no} and queue it for Tally? This cannot be undone.`) && act(selected, 'lock')}
              >
                {busy === 'lock' ? <Spinner /> : <Send className="h-4 w-4" />} {selected.is_locked_for_tally ? (selected.tally_synced ? 'Synced to Tally' : 'Queued for Tally') : 'Lock & Sync to Tally'}
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
EOF

# ---------------------------------------------------------------- components/admin/FinanceTab.tsx
mkdir -p "components/admin"
cat << 'EOF' > "components/admin/FinanceTab.tsx"
'use client';
import { useCallback, useEffect, useState } from 'react';
import { BadgePercent, Calculator, HandCoins, Percent, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { AgingBucket, AgingRow } from '@/lib/types';
import { formatDate, formatINR } from '@/lib/utils';
import { Alert, Badge, Empty, Spinner, Stat, STATUS_TONE } from '@/components/ui';

interface AgingResponse {
  summary: { as_of: string; scanned: number; discounts_stripped: number; orders_with_interest: number; interest_delta: number };
  buckets: Record<AgingBucket, { count: number; balance: number }>;
  totals: { receivable: number; penalty_interest: number };
  orders: AgingRow[];
}

const BUCKETS: AgingBucket[] = ['CURRENT', '1-30', '31-60', '61-90', '90+'];

export function FinanceTab() {
  const [data, setData] = useState<AgingResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);
  const [bucket, setBucket] = useState<AgingBucket | 'ALL'>('ALL');

  const run = useCallback(async () => {
    setBusy('aging');
    try {
      setData(await apiFetch<AgingResponse>('/api/finance/aging', { method: 'POST' }));
    } catch (e) {
      setMsg({ tone: 'red', text: e instanceof Error ? e.message : 'Aging run failed' });
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  async function adjust(row: AgingRow, action: 'WAIVE_INTEREST' | 'REAPPLY_DISCOUNT' | 'RECORD_PAYMENT') {
    let amount: number | undefined;
    let note: string | undefined;
    if (action === 'RECORD_PAYMENT') {
      const v = prompt(`Payment received for ${row.order_no} (balance ${formatINR(row.balance)})`, String(row.balance));
      if (!v) return;
      amount = Number(v);
    } else {
      const v = prompt(action === 'WAIVE_INTEREST' ? `Reason for waiving ${formatINR(row.penalty_interest)} interest on ${row.order_no}` : `Reason for re-applying early discount on ${row.order_no}`);
      if (v === null) return;
      note = v || undefined;
    }
    setBusy(row.id + action);
    try {
      await apiFetch('/api/finance/adjust', { method: 'POST', json: { order_id: row.id, action, amount, note } });
      setMsg({ tone: 'green', text: `${row.order_no}: ${action.replace('_', ' ').toLowerCase()} done` });
      await run();
    } catch (e) {
      setMsg({ tone: 'red', text: e instanceof Error ? e.message : 'Adjustment failed' });
    } finally {
      setBusy(null);
    }
  }

  const rows = (data?.orders ?? []).filter((r) => bucket === 'ALL' || r.bucket === bucket);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Finance & receivables aging</h1>
        <button onClick={run} className="btn-primary ml-auto" disabled={busy === 'aging'}>
          {busy === 'aging' ? <Spinner /> : <Calculator className="h-4 w-4" />} Run aging engine
        </button>
      </div>
      <p className="text-sm text-slate-500">
        15-day credit · early discount auto-stripped after due date · 18% p.a. penalty on bills older than 90 days (base × 18% ÷ 365 × days past due). Runs daily via Vercel Cron.
      </p>
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total receivable" value={formatINR(data.totals.receivable)} hint={`${data.orders.length} open bills`} />
            <Stat label="Penalty interest" value={formatINR(data.totals.penalty_interest)} tone="red" hint={`${data.summary.orders_with_interest} bills > 90 days`} />
            <Stat label="Discounts stripped (this run)" value={data.summary.discounts_stripped} />
            <Stat label="Last run" value={formatDate(data.summary.as_of)} hint={<span className="inline-flex items-center gap-1"><RefreshCw className="h-3 w-3" /> {data.summary.scanned} scanned</span>} />
          </div>
          <div className="grid grid-cols-5 gap-2">
            {BUCKETS.map((b) => (
              <button key={b} onClick={() => setBucket(bucket === b ? 'ALL' : b)} className={`card p-3 text-left ${bucket === b ? 'ring-2 ring-emerald-600' : ''}`}>
                <Badge tone={STATUS_TONE[b]}>{b === 'CURRENT' ? 'Not due' : `${b} days`}</Badge>
                <p className="mt-2 font-semibold">{formatINR(data.buckets[b].balance)}</p>
                <p className="text-xs text-slate-500">{data.buckets[b].count} bills</p>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Bill</th><th className="th">Dealer</th><th className="th">Due</th><th className="th text-right">Age</th>
              <th className="th text-right">Invoice</th><th className="th text-right">Discount</th><th className="th text-right">Interest</th><th className="th text-right">Balance</th><th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="td font-medium">{r.order_no}<div><Badge tone={STATUS_TONE[r.bucket]}>{r.bucket}</Badge></div></td>
                <td className="td">{r.business_name}<p className="text-xs text-slate-500">{r.gstin}</p></td>
                <td className="td">{formatDate(r.due_date)}{r.days_past_due > 0 && <p className="text-xs text-rose-600">{r.days_past_due}d overdue</p>}</td>
                <td className="td text-right">{r.age_days}d</td>
                <td className="td text-right">{formatINR(r.base_amount)}</td>
                <td className="td text-right">
                  {Number(r.discount_amount) > 0 ? <span className="text-emerald-700">−{formatINR(r.discount_amount)}</span> : <span className="text-xs text-slate-400">stripped</span>}
                  {r.discount_override && <p className="text-xs text-slate-500">admin override</p>}
                </td>
                <td className="td text-right">
                  {r.interest_waived ? <span className="text-xs text-slate-400">waived</span> : <span className={Number(r.penalty_interest) > 0 ? 'text-rose-600' : ''}>{formatINR(r.penalty_interest)}</span>}
                </td>
                <td className="td text-right font-semibold">{formatINR(r.balance)}</td>
                <td className="td">
                  <div className="flex gap-1">
                    <button title="Record payment" className="btn-secondary px-2 py-1" disabled={!!busy} onClick={() => adjust(r, 'RECORD_PAYMENT')}><HandCoins className="h-4 w-4" /></button>
                    <button title="Waive interest" className="btn-secondary px-2 py-1" disabled={!!busy || r.interest_waived || Number(r.penalty_interest) <= 0} onClick={() => adjust(r, 'WAIVE_INTEREST')}><Percent className="h-4 w-4" /></button>
                    <button title="Re-apply early discount" className="btn-secondary px-2 py-1" disabled={!!busy || Number(r.discount_amount) > 0} onClick={() => adjust(r, 'REAPPLY_DISCOUNT')}><BadgePercent className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && busy !== 'aging' && <Empty>No open receivables.</Empty>}
      </div>
    </div>
  );
}
EOF

# ---------------------------------------------------------------- components/admin/StockTab.tsx
mkdir -p "components/admin"
cat << 'EOF' > "components/admin/StockTab.tsx"
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, PackagePlus, RefreshCw } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { apiFetch } from '@/lib/api';
import type { Godown, InventoryRow, Product } from '@/lib/types';
import { cn, formatDate } from '@/lib/utils';
import { Alert, Spinner } from '@/components/ui';

interface Movement { id: number; movement_type: string; product_id: string; from_godown_id: string | null; to_godown_id: string | null; qty: number; note: string | null; created_at: string }

export function StockTab({ adminId }: { adminId: string }) {
  const [godowns, setGodowns] = useState<Godown[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inv, setInv] = useState<InventoryRow[]>([]);
  const [moves, setMoves] = useState<Movement[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);
  const [t, setT] = useState({ product_id: '', from: 'MH_GODOWN', to: 'MP_GODOWN', qty: '', note: '' });
  const [a, setA] = useState({ product_id: '', godown: 'MH_GODOWN', qty: '', note: '' });

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [g, p, i, m] = await Promise.all([
      sb.from('godowns').select('*').order('id'),
      sb.from('products').select('*').order('name'),
      sb.from('inventory').select('*'),
      sb.from('stock_movements').select('*').order('created_at', { ascending: false }).limit(25),
    ]);
    setGodowns((g.data as Godown[]) ?? []);
    setProducts((p.data as Product[]) ?? []);
    setInv((i.data as InventoryRow[]) ?? []);
    setMoves((m.data as Movement[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load, adminId]);

  const qty = useMemo(() => {
    const m = new Map<string, number>();
    inv.forEach((r) => m.set(`${r.godown_id}|${r.product_id}`, r.stock_qty));
    return (g: string, p: string) => m.get(`${g}|${p}`) ?? 0;
  }, [inv]);
  const pname = (id: string) => products.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  async function submit(json: Record<string, unknown>, reset: () => void) {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch('/api/admin/stock', { method: 'POST', json });
      setMsg({ tone: 'green', text: 'Stock updated' });
      reset();
      await load();
    } catch (e) {
      setMsg({ tone: 'red', text: e instanceof Error ? e.message : 'Stock update failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Godown stock</h1>
        <button onClick={load} className="btn-secondary ml-auto"><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr><th className="th">Product</th>{godowns.map((g) => <th key={g.id} className="th text-right">{g.name}</th>)}<th className="th text-right">Total</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {products.map((p) => {
              const total = godowns.reduce((s, g) => s + qty(g.id, p.id), 0);
              return (
                <tr key={p.id} className={cn(!p.is_active && 'opacity-50')}>
                  <td className="td font-medium">{p.name}<p className="text-xs text-slate-500">{p.sku}</p></td>
                  {godowns.map((g) => {
                    const q = qty(g.id, p.id);
                    return <td key={g.id} className={cn('td text-right tabular-nums', q === 0 ? 'text-rose-600' : q < 100 ? 'text-amber-700' : '')}>{q.toLocaleString('en-IN')}</td>;
                  })}
                  <td className="td text-right font-semibold tabular-nums">{total.toLocaleString('en-IN')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <form
          className="card space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ action: 'TRANSFER', product_id: t.product_id, from_godown_id: t.from, to_godown_id: t.to, qty: Number(t.qty), note: t.note }, () => setT({ ...t, qty: '', note: '' }));
          }}
        >
          <h2 className="font-semibold">Inter-godown transfer</h2>
          <select className="input" required value={t.product_id} onChange={(e) => setT({ ...t, product_id: e.target.value })}>
            <option value="">Select product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <select className="input" value={t.from} onChange={(e) => setT({ ...t, from: e.target.value })}>
              {godowns.map((g) => <option key={g.id} value={g.id}>{g.name} ({t.product_id ? qty(g.id, t.product_id) : '–'})</option>)}
            </select>
            <ArrowRight className="h-5 w-5 shrink-0 text-slate-400" />
            <select className="input" value={t.to} onChange={(e) => setT({ ...t, to: e.target.value })}>
              {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input className="input" type="number" min={1} required placeholder="Qty (bags)" value={t.qty} onChange={(e) => setT({ ...t, qty: e.target.value })} />
            <input className="input col-span-2" placeholder="Note / truck no." value={t.note} onChange={(e) => setT({ ...t, note: e.target.value })} />
          </div>
          <button className="btn-primary w-full" disabled={busy || t.from === t.to}>{busy ? <Spinner /> : <ArrowRight className="h-4 w-4" />} Transfer stock</button>
        </form>

        <form
          className="card space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ action: 'ADJUST', product_id: a.product_id, godown_id: a.godown, qty: Number(a.qty), note: a.note }, () => setA({ ...a, qty: '', note: '' }));
          }}
        >
          <h2 className="font-semibold">Inward receipt / write-off</h2>
          <select className="input" required value={a.product_id} onChange={(e) => setA({ ...a, product_id: e.target.value })}>
            <option value="">Select product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="input" value={a.godown} onChange={(e) => setA({ ...a, godown: e.target.value })}>
            {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <div className="grid grid-cols-3 gap-2">
            <input className="input" type="number" required placeholder="+in / −out" value={a.qty} onChange={(e) => setA({ ...a, qty: e.target.value })} />
            <input className="input col-span-2" placeholder="GRN / reason" value={a.note} onChange={(e) => setA({ ...a, note: e.target.value })} />
          </div>
          <button className="btn-secondary w-full" disabled={busy}>{busy ? <Spinner /> : <PackagePlus className="h-4 w-4" />} Post adjustment</button>
        </form>
      </div>

      <div className="card">
        <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Recent movements</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {moves.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <span className="w-24 text-xs text-slate-500">{formatDate(m.created_at)}</span>
              <span className="font-medium">{m.movement_type}</span>
              <span>{m.qty} × {pname(m.product_id)}</span>
              <span className="text-slate-500">{m.from_godown_id ?? '—'} → {m.to_godown_id ?? '—'}</span>
              {m.note && <span className="text-xs text-slate-400">{m.note}</span>}
            </li>
          ))}
          {!moves.length && <li className="px-4 py-6 text-center text-slate-500">No movements yet.</li>}
        </ul>
      </div>
    </div>
  );
}
EOF

# ---------------------------------------------------------------- components/admin/KycTab.tsx
mkdir -p "components/admin"
cat << 'EOF' > "components/admin/KycTab.tsx"
'use client';
import { useCallback, useEffect, useState } from 'react';
import { Ban, CheckCircle2, Save } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { apiFetch } from '@/lib/api';
import type { Godown, Profile } from '@/lib/types';
import { formatDate, formatINR } from '@/lib/utils';
import { Alert, Badge, Empty, Spinner } from '@/components/ui';

type Draft = { credit_limit: string; godown_id: string };

export function KycTab() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [godowns, setGodowns] = useState<Godown[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [view, setView] = useState<'pending' | 'approved'>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [u, g] = await Promise.all([
      sb.from('users').select('*').eq('role', 'buyer').order('created_at', { ascending: false }),
      sb.from('godowns').select('*').order('id'),
    ]);
    const list = (u.data as Profile[]) ?? [];
    setUsers(list);
    setGodowns((g.data as Godown[]) ?? []);
    setDrafts(Object.fromEntries(list.map((x) => [x.id, { credit_limit: String(x.credit_limit ?? 0), godown_id: x.godown_id ?? '' }])));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(u: Profile, is_approved?: boolean) {
    const d = drafts[u.id];
    setBusy(u.id);
    setMsg(null);
    try {
      await apiFetch('/api/admin/kyc', {
        method: 'POST',
        json: { user_id: u.id, is_approved, credit_limit: Number(d.credit_limit), godown_id: d.godown_id || undefined },
      });
      setMsg({ tone: 'green', text: `${u.business_name ?? u.email} updated` });
      await load();
    } catch (e) {
      setMsg({ tone: 'red', text: e instanceof Error ? e.message : 'Update failed' });
    } finally {
      setBusy(null);
    }
  }

  const list = users.filter((u) => (view === 'pending' ? !u.is_approved : u.is_approved));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">KYC account approvals</h1>
        <div className="ml-auto flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
          {(['pending', 'approved'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 capitalize ${view === v ? 'bg-emerald-600 text-white' : 'text-slate-600'}`}>
              {v} ({users.filter((u) => (v === 'pending' ? !u.is_approved : u.is_approved)).length})
            </button>
          ))}
        </div>
      </div>
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr><th className="th">Business</th><th className="th">GSTIN / State</th><th className="th">Registered</th><th className="th">Godown</th><th className="th">Credit limit (₹)</th><th className="th">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((u) => {
              const d = drafts[u.id] ?? { credit_limit: '0', godown_id: '' };
              const set = (k: keyof Draft, v: string) => setDrafts((s) => ({ ...s, [u.id]: { ...d, [k]: v } }));
              return (
                <tr key={u.id}>
                  <td className="td">
                    <p className="font-medium">{u.business_name ?? '—'}</p>
                    <p className="text-xs text-slate-500">{u.email}{u.phone ? ` · ${u.phone}` : ''}</p>
                  </td>
                  <td className="td">
                    <p className="font-mono text-xs">{u.gstin ?? <Badge tone="red">missing</Badge>}</p>
                    <p className="text-xs text-slate-500">{u.state ?? '—'}</p>
                  </td>
                  <td className="td">{formatDate(u.created_at)}</td>
                  <td className="td">
                    <select className="input py-1" value={d.godown_id} onChange={(e) => set('godown_id', e.target.value)}>
                      <option value="">Unassigned</option>
                      {godowns.map((g) => <option key={g.id} value={g.id}>{g.id}</option>)}
                    </select>
                  </td>
                  <td className="td">
                    <input className="input w-36 py-1" type="number" min={0} step={1000} value={d.credit_limit} onChange={(e) => set('credit_limit', e.target.value)} />
                    <p className="mt-0.5 text-xs text-slate-500">current {formatINR(u.credit_limit)}</p>
                  </td>
                  <td className="td">
                    <div className="flex gap-1">
                      {u.is_approved ? (
                        <>
                          <button className="btn-secondary px-2 py-1" disabled={busy === u.id} onClick={() => save(u)} title="Save limit / godown"><Save className="h-4 w-4" /></button>
                          <button className="btn-secondary px-2 py-1 text-rose-600" disabled={busy === u.id} onClick={() => confirm('Revoke approval? The dealer loses stock visibility and ordering.') && save(u, false)} title="Revoke"><Ban className="h-4 w-4" /></button>
                        </>
                      ) : (
                        <button className="btn-primary py-1" disabled={busy === u.id || !u.gstin || !d.godown_id} onClick={() => save(u, true)}>
                          {busy === u.id ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />} Approve
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length && <Empty>No {view} accounts.</Empty>}
      </div>
    </div>
  );
}
EOF

# ---------------------------------------------------------------- next.config.mjs
mkdir -p "."
cat << 'EOF' > "next.config.mjs"
/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
EOF

# ---------------------------------------------------------------- vercel.json
mkdir -p "."
cat << 'EOF' > "vercel.json"
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["bom1"],
  "crons": [{ "path": "/api/finance/aging", "schedule": "30 0 * * *" }]
}
EOF

# ---------------------------------------------------------------- .env.local.example
mkdir -p "."
cat << 'EOF' > ".env.local.example"
# --- Supabase (Project Settings -> API) ---
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Server only. NEVER expose to the browser.
SUPABASE_SERVICE_ROLE_KEY=

# --- Vercel Cron: daily aging run (06:00 IST). Vercel sends "Authorization: Bearer $CRON_SECRET" ---
CRON_SECRET=

# --- Tally Prime connector (sends header "x-api-key") ---
TALLY_SYNC_API_KEY=
TALLY_COMPANY_NAME=Akshat Fertilizer
TALLY_SALES_LEDGER=Sales - Fertilizers
TALLY_FREIGHT_LEDGER=Freight Outward
TALLY_CGST_LEDGER=Output CGST
TALLY_SGST_LEDGER=Output SGST
TALLY_IGST_LEDGER=Output IGST
EOF

# ---------------------------------------------------------------- README.md
mkdir -p "."
cat << 'EOF' > "README.md"
# Akshat Fertilizer — B2B ERP & Distribution Portal

Next.js 14 (App Router) · TypeScript · Tailwind · Supabase (Postgres + Auth + RLS) · Vercel

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

1. Push this repo to GitHub → Vercel → **Add New Project** → import. Add every variable from `.env.local.example` (Production + Preview).
2. Vercel → Project → **Settings → Domains** → add `b2b.akshatfertilizer.com`. Vercel shows the CNAME target to use.
3. cPanel → **Zone Editor** → `akshatfertilizer.com` → **+ CNAME Record**
   - Name: `b2b` · TTL: `300` · Record: the value Vercel shows (e.g. `cname.vercel-dns.com.`)
   - Do **not** edit the apex `A` record or `www` — the PHP site keeps running on the cPanel host.
   - If a `b2b` A record or a cPanel subdomain already exists, delete it first (a name cannot have both A and CNAME).
4. Wait for DNS (`dig +short b2b.akshatfertilizer.com CNAME`); Vercel issues the SSL certificate automatically.
5. Supabase → **Authentication → URL Configuration**: Site URL `https://b2b.akshatfertilizer.com`; add `https://b2b.akshatfertilizer.com/**` to Redirect URLs.
6. `CRON_SECRET` set in Vercel enables the daily aging cron from `vercel.json`.
EOF

c_step "Type-checking"
npx tsc --noEmit || die "TypeScript check failed"
c_ok "TypeScript OK"

c_step "Committing initial scaffold"
git add -A >/dev/null 2>&1 || true
git -c user.name="${GIT_AUTHOR_NAME:-Akshat Setup}" -c user.email="${GIT_AUTHOR_EMAIL:-setup@localhost}" \
  commit -qm "feat: Akshat Fertilizer B2B ERP & distribution portal scaffold" >/dev/null 2>&1 || true

cat << 'DONE'

────────────────────────────────────────────────────────────────────────
 ✔ Repository ready.

 Next steps
  1. cp .env.local.example .env.local   → fill Supabase URL / anon / service-role keys
  2. Supabase SQL editor: run supabase/migrations/001_init.sql, then supabase/seed.sql
  3. Register your admin login at /register, then in SQL editor:
       update public.users set role='admin', is_approved=true where email='you@…';
  4. npm run dev   → http://localhost:3000  (buyer)  ·  /dashboard (admin)
  5. Deploy: see README.md → "Deploy: Vercel + cPanel subdomain"
────────────────────────────────────────────────────────────────────────
DONE
