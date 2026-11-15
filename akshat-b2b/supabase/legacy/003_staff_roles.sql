-- =============================================================================
-- 003: Staff roles with scoped admin access
--   Back-office users keep role='admin' (their login reaches /admin). A new
--   staff_role narrows WHAT they may do. Buyers are unaffected.
--
--   staff_role → areas
--     manager    : everything (orders, finance, products, stock, KYC, team)
--     operations : operations pipeline
--     finance    : finance & aging
--     stock      : products & pricing + godown stock transfer
--   NULL staff_role on an admin == manager (keeps existing admins full-access).
-- =============================================================================

alter table public.users
  add column if not exists staff_role text
    check (staff_role is null or staff_role in ('manager', 'operations', 'finance', 'stock'));

-- Effective staff role for the current user (manager if an admin hasn't been scoped).
create or replace function public.my_staff_role()
returns text language sql stable security definer set search_path = public as $$
  select case when role = 'admin' then coalesce(staff_role, 'manager') end
  from public.users where id = auth.uid()
$$;

-- Does the current user have access to an area? Managers always do.
create or replace function public.staff_can(p_area text)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.my_staff_role()
           when 'manager'    then true
           when 'operations' then p_area = 'operations'
           when 'finance'    then p_area = 'finance'
           when 'stock'      then p_area in ('products', 'stock')
           else false
         end
$$;

-- Manager-only: set a user's staff role (and flip them between buyer and staff).
create or replace function public.admin_set_staff_role(p_user_id uuid, p_staff_role text, p_actor uuid)
returns public.users language plpgsql security definer set search_path = public as $$
declare
  u public.users%rowtype;
begin
  -- Actor must be a manager (checked from the table, so it works when called via service role).
  if coalesce((select case when role = 'admin' then coalesce(staff_role, 'manager') end
               from public.users where id = p_actor), '') <> 'manager' then
    raise exception 'FORBIDDEN: only a manager can assign staff roles';
  end if;
  if p_user_id = p_actor then raise exception 'INVALID_TARGET: you cannot change your own role'; end if;
  if p_staff_role is not null and p_staff_role not in ('manager', 'operations', 'finance', 'stock') then
    raise exception 'INVALID_TARGET: unknown staff role %', p_staff_role;
  end if;

  select * into u from public.users where id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND: %', p_user_id; end if;

  update public.users set
    role        = case when p_staff_role is null then 'buyer'::public.user_role else 'admin'::public.user_role end,
    staff_role  = p_staff_role,
    -- Staff don't buy; clear buyer-only credit state when promoting.
    is_approved = case when p_staff_role is null then is_approved else false end,
    credit_limit = case when p_staff_role is null then credit_limit else 0 end
  where id = p_user_id
  returning * into u;
  return u;
end $$;

grant execute on function public.my_staff_role()         to authenticated;
grant execute on function public.staff_can(text)         to authenticated;
revoke execute on function public.admin_set_staff_role(uuid, text, uuid) from public, anon, authenticated;
grant  execute on function public.admin_set_staff_role(uuid, text, uuid) to service_role;
