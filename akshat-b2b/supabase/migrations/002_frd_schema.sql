-- =============================================================================
-- Akshat Fertilizers B2B — FRD schema (Dealer/Farmer dual-pricing, offline KYC)
-- Clean reset: drops the legacy ERP model (users/godowns/inventory/tally/...),
-- KEEPS the existing `products` rows (adds dual-price columns), builds the FRD
-- model. Self-contained & idempotent — safe to run on the live project or a
-- fresh database.
-- =============================================================================
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. DROP LEGACY  (products is kept and altered below)
-- -----------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
drop view  if exists public.v_buyer_credit      cascade;
drop view  if exists public.v_receivables_aging cascade;
drop table if exists public.credit_logs      cascade;
drop table if exists public.stock_movements  cascade;
drop table if exists public.inventory        cascade;
drop table if exists public.godowns          cascade;
drop table if exists public.order_items      cascade;
drop table if exists public.orders           cascade;
drop table if exists public.users            cascade;

-- drop every legacy app function in public (skip extension-owned functions)
do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop execute 'drop function if exists ' || r.sig || ' cascade'; end loop;
end $$;

drop type if exists public.user_role          cascade;
drop type if exists public.order_status       cascade;
drop type if exists public.payment_status     cascade;
drop type if exists public.credit_event       cascade;
drop type if exists public.stock_movement_type cascade;

alter table if exists public.products drop constraint if exists products_active_needs_price;
alter table if exists public.products drop constraint if exists products_price_check;
drop sequence if exists public.order_no_seq cascade;

-- -----------------------------------------------------------------------------
-- 2. ENUMS
-- -----------------------------------------------------------------------------
create type public.acct_role   as enum ('ADMIN', 'DEALER', 'FARMER');
create type public.acct_status as enum ('PENDING', 'APPROVED', 'REJECTED');
create type public.staff_tier  as enum ('manager', 'operations', 'finance', 'catalog');
create type public.ord_status  as enum ('RECEIVED', 'CONFIRMED_OFFLINE', 'DISPATCHED', 'DELIVERED', 'CANCELLED');
create type public.pay_terms   as enum ('CREDIT_15D', 'ADVANCE');
create type public.pay_state   as enum ('UNPAID', 'PARTIAL', 'PAID', 'OVERDUE');

create or replace function public.af_today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date $$;

-- -----------------------------------------------------------------------------
-- 3. profiles  (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  role                public.acct_role   not null default 'FARMER',
  staff_tier          public.staff_tier,
  status              public.acct_status not null default 'PENDING',
  full_name           text,
  mobile              text,
  whatsapp            text,
  email               text,
  state               text,
  city                text,
  entity_name         text,                         -- Business Name (DEALER) or Farm Name (FARMER)
  custom_discount_pct numeric(5,2) check (custom_discount_pct is null or custom_discount_pct between 0 and 100),
  created_at          timestamptz not null default now(),
  constraint staff_tier_admin_only check (staff_tier is null or role = 'ADMIN')
);
create index profiles_role_status_idx on public.profiles(role, status);

-- Auto-provision a PENDING profile on sign-up. ADMIN can never be self-assigned.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, role, status, full_name, mobile, whatsapp, email, state, city, entity_name)
  values (
    new.id,
    (case upper(coalesce(m->>'role', 'FARMER')) when 'DEALER' then 'DEALER' else 'FARMER' end)::public.acct_role,
    'PENDING',
    nullif(btrim(m->>'full_name'), ''), nullif(btrim(m->>'mobile'), ''), nullif(btrim(m->>'whatsapp'), ''),
    coalesce(new.email, ''), nullif(btrim(m->>'state'), ''), nullif(btrim(m->>'city'), ''), nullif(btrim(m->>'entity_name'), '')
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- 4. products  (reuse existing rows; add dual-price + specs)
-- -----------------------------------------------------------------------------
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  sku         text,
  name        text not null,
  category    text,
  description text,
  unit        text default 'BAG',
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.products add column if not exists description    text;
alter table public.products add column if not exists specifications text;
alter table public.products add column if not exists unit           text default 'BAG';
alter table public.products add column if not exists dealer_price   numeric(12,2) check (dealer_price is null or dealer_price > 0);
alter table public.products add column if not exists farmer_price   numeric(12,2) check (farmer_price is null or farmer_price > 0);
alter table public.products add column if not exists is_active      boolean not null default false;
alter table public.products add column if not exists image_url      text;   -- kept from legacy catalogue (public cards)

-- -----------------------------------------------------------------------------
-- 5. discount_slabs  (order-value slabs; seeded per FRD)
-- -----------------------------------------------------------------------------
create table public.discount_slabs (
  id           uuid primary key default gen_random_uuid(),
  min_amount   numeric(12,2) not null,
  max_amount   numeric(12,2),
  discount_pct numeric(5,2)  not null check (discount_pct between 0 and 100),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
insert into public.discount_slabs (min_amount, max_amount, discount_pct) values
  (50000, 69999, 0), (70000, 99999, 10), (100000, null, 15);

-- -----------------------------------------------------------------------------
-- 6. orders / order_items / payment_logs
-- -----------------------------------------------------------------------------
create sequence if not exists public.order_seq start 1001;
create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  order_number       text unique not null default ('AKF-' || nextval('public.order_seq')),
  user_id            uuid not null references public.profiles(id),
  customer_type      public.acct_role not null,
  subtotal           numeric(14,2) not null,
  discount_amount    numeric(14,2) not null default 0,
  final_amount       numeric(14,2) not null,
  is_below_min_order boolean not null default false,
  order_status       public.ord_status not null default 'RECEIVED',
  payment_terms      public.pay_terms  not null,
  payment_status     public.pay_state  not null default 'UNPAID',
  amount_paid        numeric(14,2) not null default 0,
  due_date           date,
  overdue_interest   numeric(14,2) not null default 0,
  created_at         timestamptz not null default now()
);
create index orders_user_idx   on public.orders(user_id, created_at desc);
create index orders_status_idx on public.orders(order_status);

create table public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  product_id   uuid references public.products(id),
  product_name text not null,
  quantity     integer not null check (quantity > 0),
  unit_price   numeric(12,2) not null,
  total_price  numeric(14,2) not null
);
create index order_items_order_idx on public.order_items(order_id);

create table public.payment_logs (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  user_id        uuid not null references public.profiles(id),
  amount         numeric(14,2) not null check (amount > 0),
  payment_mode   text,
  reference_note text,
  recorded_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 7. role / staff helpers  (auth.uid()-based; call via the user-scoped client)
-- -----------------------------------------------------------------------------
create or replace function public.my_role() returns public.acct_role
  language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() $$;
create or replace function public.my_status() returns public.acct_status
  language sql stable security definer set search_path = public as $$
  select status from public.profiles where id = auth.uid() $$;
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'ADMIN') $$;
create or replace function public.my_staff_tier() returns text
  language sql stable security definer set search_path = public as $$
  select case when role = 'ADMIN' then coalesce(staff_tier::text, 'manager') end
  from public.profiles where id = auth.uid() $$;
create or replace function public.staff_can(p_area text) returns boolean
  language sql stable security definer set search_path = public as $$
  select case public.my_staff_tier()
    when 'manager'    then true
    when 'operations' then p_area = 'operations'
    when 'finance'    then p_area = 'finance'
    when 'catalog'    then p_area = 'catalog'
    else false end $$;

-- -----------------------------------------------------------------------------
-- 8. public catalogue (NO prices) + role-priced catalogue
-- -----------------------------------------------------------------------------
-- Owner-rights view: exposes ONLY non-price columns of active products to anon.
create or replace view public.v_public_catalog as
  select id, name, category, description, specifications, unit, image_url, created_at
  from public.products where is_active = true;

create or replace function public.my_catalog()
returns table (id uuid, name text, category text, description text, specifications text,
               unit text, image_url text, price numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.category, p.description, p.specifications, p.unit, p.image_url,
    case when public.my_status() = 'APPROVED' and public.my_role() = 'DEALER' then p.dealer_price
         when public.my_status() = 'APPROVED' and public.my_role() = 'FARMER' then p.farmer_price
         else null end as price
  from public.products p where p.is_active = true order by p.category nulls last, p.name $$;

-- -----------------------------------------------------------------------------
-- 9. ORDER CREATION  (role-priced, dealer slab discount, ₹50k soft-gate)
-- -----------------------------------------------------------------------------
create or replace function public.create_order(p_items jsonb, p_below_min boolean default false)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  me      public.profiles%rowtype;
  v_sub   numeric(14,2) := 0;
  v_disc  numeric(14,2) := 0;
  v_slab  numeric(5,2)  := 0;
  v_terms public.pay_terms;
  v_due   date;
  v_below boolean := false;
  v_order public.orders%rowtype;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into me from public.profiles where id = v_uid for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if me.role = 'ADMIN' then raise exception 'ADMINS_CANNOT_ORDER'; end if;
  if me.status <> 'APPROVED' then raise exception 'NOT_APPROVED: your account is %', me.status; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'INVALID_ITEMS'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             where (e->>'product_id') !~* '^[0-9a-f-]{36}$' or (e->>'quantity') !~ '^[0-9]+$' or (e->>'quantity')::int <= 0) then
    raise exception 'INVALID_ITEMS'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             left join public.products p on p.id = (e->>'product_id')::uuid and p.is_active
             where p.id is null) then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             join public.products p on p.id = (e->>'product_id')::uuid
             where (case when me.role = 'DEALER' then p.dealer_price else p.farmer_price end) is null) then
    raise exception 'PRICE_NOT_SET'; end if;

  select coalesce(sum(round((e->>'quantity')::int *
           (case when me.role = 'DEALER' then p.dealer_price else p.farmer_price end), 2)), 0)
    into v_sub
  from jsonb_array_elements(p_items) e join public.products p on p.id = (e->>'product_id')::uuid;
  if v_sub <= 0 then raise exception 'INVALID_ITEMS'; end if;

  if me.role = 'DEALER' then
    v_terms := 'CREDIT_15D'; v_due := public.af_today() + 15;
    if v_sub < 50000 then
      if not p_below_min then
        raise exception 'MIN_ORDER_NOT_MET: subtotal % below 50000', v_sub
          using detail = jsonb_build_object('subtotal', v_sub, 'minimum', 50000)::text;
      end if;
      v_below := true;                          -- flagged for offline commercial review
    elsif me.custom_discount_pct is not null then
      v_slab := me.custom_discount_pct;
    else
      select coalesce(max(discount_pct), 0) into v_slab from public.discount_slabs
      where is_active and v_sub >= min_amount and (max_amount is null or v_sub <= max_amount);
    end if;
    v_disc := round(v_sub * v_slab / 100, 2);
  else                                          -- FARMER: advance payment, no slab/credit
    v_terms := 'ADVANCE'; v_due := null; v_disc := 0;
  end if;

  insert into public.orders (user_id, customer_type, subtotal, discount_amount, final_amount,
                             is_below_min_order, payment_terms, due_date)
  values (v_uid, me.role, v_sub, v_disc, v_sub - v_disc, v_below, v_terms, v_due)
  returning * into v_order;

  insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price)
  select v_order.id, p.id, p.name, (e->>'quantity')::int,
         (case when me.role = 'DEALER' then p.dealer_price else p.farmer_price end),
         round((e->>'quantity')::int * (case when me.role = 'DEALER' then p.dealer_price else p.farmer_price end), 2)
  from jsonb_array_elements(p_items) e join public.products p on p.id = (e->>'product_id')::uuid;

  return v_order;
end $$;

-- -----------------------------------------------------------------------------
-- 10. ADMIN actions
-- -----------------------------------------------------------------------------
create or replace function public.set_customer_status(p_user uuid, p_status public.acct_status)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare u public.profiles%rowtype;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  update public.profiles set status = p_status
  where id = p_user and role in ('DEALER', 'FARMER') returning * into u;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  return u;
end $$;

create or replace function public.record_payment(p_order uuid, p_amount numeric, p_mode text default null, p_note text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; v_total numeric(14,2);
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  v_total := o.final_amount + o.overdue_interest;
  if o.amount_paid + p_amount > v_total + 0.01 then
    raise exception 'OVERPAYMENT: balance is %', v_total - o.amount_paid
      using detail = jsonb_build_object('balance', v_total - o.amount_paid)::text; end if;
  insert into public.payment_logs (order_id, user_id, amount, payment_mode, reference_note)
    values (o.id, o.user_id, p_amount, p_mode, p_note);
  update public.orders set
    amount_paid = amount_paid + p_amount,
    payment_status = case when amount_paid + p_amount >= v_total - 0.01 then 'PAID'::public.pay_state
                          when amount_paid + p_amount > 0 then 'PARTIAL'::public.pay_state
                          else 'UNPAID'::public.pay_state end
  where id = o.id returning * into o;
  return o;
end $$;

create or replace function public.set_order_status(p_order uuid, p_status public.ord_status)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  update public.orders set order_status = p_status where id = p_order returning * into o;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  return o;
end $$;

-- Manual override of overdue interest on one order.
create or replace function public.set_overdue_interest(p_order uuid, p_amount numeric)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'INVALID_AMOUNT'; end if;
  update public.orders set overdue_interest = round(p_amount, 2),
    payment_status = case when amount_paid >= final_amount + round(p_amount,2) - 0.01 then 'PAID'::public.pay_state
                          when amount_paid > 0 then 'PARTIAL'::public.pay_state else payment_status end
  where id = p_order returning * into o;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  return o;
end $$;

-- Recompute >90-day overdue interest for unpaid dealer credit orders (default 18% p.a.).
create or replace function public.recalc_overdue(p_as_of date default null, p_apy numeric default 18)
returns integer language plpgsql security definer set search_path = public as $$
declare v_as_of date := coalesce(p_as_of, public.af_today()); o public.orders%rowtype; n int := 0; v_days int; v_int numeric(14,2);
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  for o in select * from public.orders
           where payment_terms = 'CREDIT_15D' and payment_status <> 'PAID' and order_status <> 'CANCELLED' for update
  loop
    v_days := v_as_of - o.created_at::date;
    if v_days > 90 and (o.final_amount - o.amount_paid) > 0 then
      v_int := round((o.final_amount - o.amount_paid) * p_apy / 100 / 365 * (v_days - 90), 2);
      update public.orders set overdue_interest = v_int, payment_status = 'OVERDUE' where id = o.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Manager-only: assign ADMIN staff tier (or revoke to a FARMER).
create or replace function public.set_staff_tier(p_user uuid, p_tier text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare u public.profiles%rowtype;
begin
  if coalesce(public.my_staff_tier(), '') <> 'manager' then raise exception 'FORBIDDEN'; end if;
  if p_user = auth.uid() then raise exception 'INVALID_TARGET: cannot change your own tier'; end if;
  if p_tier is not null and p_tier not in ('manager','operations','finance','catalog') then
    raise exception 'INVALID_TARGET'; end if;
  update public.profiles set
    role = case when p_tier is null then 'FARMER' else 'ADMIN' end::public.acct_role,
    staff_tier = p_tier::public.staff_tier,
    status = case when p_tier is null then status else 'APPROVED' end
  where id = p_user returning * into u;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  return u;
end $$;

-- -----------------------------------------------------------------------------
-- 11. RLS
-- -----------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.products       enable row level security;
alter table public.discount_slabs enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.payment_logs   enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy products_admin_all on public.products for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy slabs_read  on public.discount_slabs for select to authenticated using (true);
create policy slabs_admin on public.discount_slabs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy orders_select on public.orders for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));
create policy payments_select on public.payment_logs for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- -----------------------------------------------------------------------------
-- 12. Privileges: writes to orders/items/payments only via SECURITY DEFINER RPCs
-- -----------------------------------------------------------------------------
revoke all on public.orders, public.order_items, public.payment_logs from anon, authenticated;
grant  select on public.orders, public.order_items, public.payment_logs to authenticated;
grant  select on public.v_public_catalog to anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant  execute on function public.my_catalog()                                   to authenticated;
grant  execute on function public.create_order(jsonb, boolean)                   to authenticated;
grant  execute on function public.set_customer_status(uuid, public.acct_status)  to authenticated;
grant  execute on function public.record_payment(uuid, numeric, text, text)      to authenticated;
grant  execute on function public.set_order_status(uuid, public.ord_status)      to authenticated;
grant  execute on function public.set_overdue_interest(uuid, numeric)            to authenticated;
grant  execute on function public.recalc_overdue(date, numeric)                  to authenticated;
grant  execute on function public.set_staff_tier(uuid, text)                     to authenticated;
grant  execute on function public.my_role()        to authenticated;
grant  execute on function public.my_status()      to authenticated;
grant  execute on function public.is_admin()       to authenticated;
grant  execute on function public.my_staff_tier()  to authenticated;
grant  execute on function public.staff_can(text)  to authenticated;
grant  execute on function public.af_today()       to authenticated, anon;
