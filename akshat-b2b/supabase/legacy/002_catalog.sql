-- =============================================================================
-- 002: Real product catalogue (akshatfertilizer.com) + admin pricing
--   * Rich product content: description, subcategory, photo, brochure, spec table
--   * Products may exist without a price, but only priced products can be active
--     (dealers only ever see active products via RLS)
--   * set_stock(): admin sets the absolute opening/physical stock for a godown
-- =============================================================================

alter table public.products
  add column if not exists description  text,
  add column if not exists subcategory  text,
  add column if not exists pack_label   text,                     -- e.g. "25 kg bag", "1 L bottle"
  add column if not exists image_url    text,
  add column if not exists brochure_url text,
  add column if not exists specs        jsonb not null default '[]'::jsonb,   -- [["Specification","Grade"], ...]
  add column if not exists source_url   text,
  add column if not exists sort_order   integer not null default 0;

alter table public.products alter column price drop not null;
alter table public.products alter column is_active set default false;
alter table public.products drop constraint if exists products_price_check;
alter table public.products add constraint products_price_check check (price is null or price > 0);
alter table public.products add constraint products_active_needs_price check (not is_active or price is not null);
alter table public.products add constraint products_specs_is_array check (jsonb_typeof(specs) = 'array');

create index if not exists products_catalog_idx on public.products (category, sort_order, name);

-- -----------------------------------------------------------------------------
-- ADMIN: set absolute stock in one godown (opening stock / physical count).
-- Logs the difference as INWARD or WRITE_OFF so the movement history stays complete.
-- -----------------------------------------------------------------------------
create or replace function public.set_stock(p_product_id uuid, p_godown_id text, p_qty integer, p_actor uuid, p_note text default null)
returns public.inventory language plpgsql security definer set search_path = public as $$
declare
  r       public.inventory%rowtype;
  v_delta integer;
begin
  if p_qty is null or p_qty < 0 then raise exception 'INVALID_AMOUNT: stock must be >= 0'; end if;
  if not exists (select 1 from public.products where id = p_product_id) then raise exception 'PRODUCT_NOT_AVAILABLE: %', p_product_id; end if;
  if not exists (select 1 from public.godowns where id = p_godown_id) then raise exception 'INVALID_TARGET: unknown godown %', p_godown_id; end if;

  insert into public.inventory (godown_id, product_id, stock_qty) values (p_godown_id, p_product_id, 0)
  on conflict do nothing;
  select * into r from public.inventory where godown_id = p_godown_id and product_id = p_product_id for update;
  v_delta := p_qty - r.stock_qty;
  if v_delta = 0 then return r; end if;

  update public.inventory set stock_qty = p_qty, updated_at = now()
  where godown_id = p_godown_id and product_id = p_product_id returning * into r;
  insert into public.stock_movements (movement_type, product_id, from_godown_id, to_godown_id, qty, note, actor_id)
  values (case when v_delta > 0 then 'INWARD'::public.stock_movement_type else 'WRITE_OFF'::public.stock_movement_type end,
          p_product_id,
          case when v_delta < 0 then p_godown_id end,
          case when v_delta > 0 then p_godown_id end,
          abs(v_delta), coalesce(p_note, 'Stock set to ' || p_qty), p_actor);
  return r;
end $$;

revoke execute on function public.set_stock(uuid, text, integer, uuid, text) from public, anon, authenticated;
grant  execute on function public.set_stock(uuid, text, integer, uuid, text) to service_role;
