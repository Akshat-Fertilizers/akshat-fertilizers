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
  settled_on          date,                                   -- date the money was received (interest stops here)
  settled_by          uuid,
  settlement_ref      text,                                   -- UTR / cheque no. / receipt no.
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
create index orders_settled_idx  on public.orders (paid_at desc) where payment_status = 'PAID';
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
--   age_order() is the single implementation; the daily job, payments and
--   settlements all call it so interest always stops on the receipt date.
-- -----------------------------------------------------------------------------
create or replace function public.age_order(p_order_id uuid, p_as_of date, p_actor uuid default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o       public.orders%rowtype;
  v_disc  numeric(14,2);
  v_int   numeric(14,2) := 0;
  v_days  integer;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND: %', p_order_id; end if;
  if o.status = 'CANCELLED' or o.payment_status = 'PAID' then return o; end if;

  v_days := greatest(p_as_of - o.due_date, 0);
  v_disc := case when p_as_of > o.due_date and not o.discount_override then 0
                 else round(o.subtotal * o.early_discount_pct / 100, 2) end;
  if not o.interest_waived and p_as_of > o.purchase_date + public.af_interest_trigger_days() then
    v_int := round(o.base_amount * public.af_interest_apy() / 365 * v_days, 2);
  end if;

  if v_disc <> o.discount_amount then
    insert into public.credit_logs (user_id, order_id, event, amount, note, actor_id)
    values (o.buyer_id, o.id,
            case when v_disc = 0 then 'DISCOUNT_STRIPPED'::public.credit_event else 'DISCOUNT_REAPPLIED'::public.credit_event end,
            o.discount_amount - v_disc,
            case when v_disc = 0 then format('Unpaid after due date %s; early discount removed', o.due_date)
                 else format('Paid by due date %s; early discount restored', o.due_date) end,
            p_actor);
  end if;
  if v_int <> o.penalty_interest then
    insert into public.credit_logs (user_id, order_id, event, amount, note, actor_id)
    values (o.buyer_id, o.id, 'INTEREST_ACCRUED', v_int - o.penalty_interest,
            format('18%% p.a. on %s for %s days overdue (as of %s)', o.base_amount, v_days, p_as_of), p_actor);
  end if;

  update public.orders set
    discount_amount      = v_disc,
    discount_stripped_at = case when v_disc = 0 and o.discount_amount > 0 then now()
                                when v_disc > 0 then null else discount_stripped_at end,
    penalty_interest     = v_int,
    last_aged_on         = p_as_of,
    payment_status       = case when amount_paid > 0 then 'PARTIAL'::public.payment_status
                                else 'UNPAID'::public.payment_status end
  where id = o.id
  returning * into o;
  return o;
end $$;

create or replace function public.recalculate_aging(p_as_of date default null, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_as_of     date := coalesce(p_as_of, public.af_today());
  o           public.orders%rowtype;
  n           public.orders%rowtype;
  n_scanned   integer := 0;
  n_stripped  integer := 0;
  n_interest  integer := 0;
  v_int_delta numeric(14,2) := 0;
begin
  for o in
    select * from public.orders
    where status <> 'CANCELLED' and payment_status <> 'PAID'
    order by id
    for update
  loop
    n := public.age_order(o.id, v_as_of, p_actor);
    n_scanned   := n_scanned + 1;
    n_stripped  := n_stripped + (o.discount_amount > 0 and n.discount_amount = 0)::integer;
    n_interest  := n_interest + (n.penalty_interest > 0)::integer;
    v_int_delta := v_int_delta + (n.penalty_interest - o.penalty_interest);
  end loop;

  return jsonb_build_object('as_of', v_as_of, 'scanned', n_scanned, 'discounts_stripped', n_stripped,
                            'orders_with_interest', n_interest, 'interest_delta', v_int_delta);
end $$;

create or replace function public.waive_interest(p_order_id uuid, p_actor uuid, p_note text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o       public.orders%rowtype;
  v_clear boolean;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND: %', p_order_id; end if;
  if o.payment_status = 'PAID' then raise exception 'ORDER_ALREADY_PAID: %', o.order_no; end if;
  if o.interest_waived then return o; end if;   -- idempotent
  v_clear := o.amount_paid >= o.base_amount - o.discount_amount - 0.01;
  insert into public.credit_logs (user_id, order_id, event, amount, note, actor_id)
  values (o.buyer_id, o.id, 'INTEREST_WAIVED', -o.penalty_interest, coalesce(p_note, 'Interest waived by admin'), p_actor);
  update public.orders set
    interest_waived = true, interest_waived_at = now(), penalty_interest = 0,
    payment_status  = case when v_clear then 'PAID'::public.payment_status else payment_status end,
    paid_at         = case when v_clear then now() else paid_at end,
    settled_on      = case when v_clear then public.af_today() else settled_on end,
    settled_by      = case when v_clear then p_actor else settled_by end
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

-- Validates a receipt date and ages the order to it (shared by payments and settlement).
create or replace function public.age_for_receipt(p_order_id uuid, p_paid_on date, p_actor uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND: %', p_order_id; end if;
  if o.status = 'CANCELLED' then raise exception 'INVALID_TRANSITION: order % is cancelled', o.order_no; end if;
  if o.payment_status = 'PAID' then raise exception 'ORDER_ALREADY_PAID: % is already settled', o.order_no; end if;
  if p_paid_on < o.purchase_date or p_paid_on > public.af_today() then
    raise exception 'INVALID_DATE: receipt date must be between % and today', o.purchase_date;
  end if;
  return public.age_order(o.id, p_paid_on, p_actor);
end $$;

create or replace function public.record_payment(
  p_order_id uuid, p_amount numeric, p_actor uuid, p_paid_on date default null, p_note text default null
)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o         public.orders%rowtype;
  v_paid_on date := coalesce(p_paid_on, public.af_today());
  v_clear   boolean;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT: payment must be > 0'; end if;
  -- Discount / interest exactly as of the receipt date.
  o := public.age_for_receipt(p_order_id, v_paid_on, p_actor);

  if o.amount_paid + p_amount > o.amount_due + 0.01 then
    raise exception 'OVERPAYMENT: balance is %, received %', o.amount_due - o.amount_paid, p_amount
      using detail = jsonb_build_object('balance', o.amount_due - o.amount_paid)::text;
  end if;
  v_clear := o.amount_paid + p_amount >= o.amount_due - 0.01;

  insert into public.credit_logs (user_id, order_id, event, amount, note, actor_id)
  values (o.buyer_id, o.id, 'PAYMENT_CREDIT', -p_amount, coalesce(p_note, 'Payment received ' || v_paid_on), p_actor);

  update public.orders set
    amount_paid    = amount_paid + p_amount,
    payment_status = case when v_clear then 'PAID'::public.payment_status else 'PARTIAL'::public.payment_status end,
    paid_at        = case when v_clear then now() else paid_at end,
    settled_on     = case when v_clear then v_paid_on else settled_on end,
    settled_by     = case when v_clear then p_actor else settled_by end
  where id = o.id returning * into o;
  return o;
end $$;

-- Operations "Mark as Settled": receives the full remaining balance as of the
-- receipt date (discount/interest recomputed for that date) and closes the invoice.
create or replace function public.settle_order(
  p_order_id uuid, p_actor uuid, p_paid_on date default null, p_reference text default null, p_note text default null
)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o         public.orders%rowtype;
  v_paid_on date := coalesce(p_paid_on, public.af_today());
  v_ref     text := nullif(btrim(coalesce(p_reference, '')), '');
  v_balance numeric(14,2);
begin
  o := public.age_for_receipt(p_order_id, v_paid_on, p_actor);
  v_balance := greatest(o.amount_due - o.amount_paid, 0);

  if v_balance > 0 then
    insert into public.credit_logs (user_id, order_id, event, amount, note, actor_id)
    values (o.buyer_id, o.id, 'PAYMENT_CREDIT', -v_balance,
            coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Invoice settled') || ' · received ' || v_paid_on
              || coalesce(' · ref ' || v_ref, ''),
            p_actor);
  end if;

  update public.orders set
    amount_paid    = amount_paid + v_balance,
    payment_status = 'PAID',
    paid_at        = now(),
    settled_on     = v_paid_on,
    settled_by     = p_actor,
    settlement_ref = v_ref
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
