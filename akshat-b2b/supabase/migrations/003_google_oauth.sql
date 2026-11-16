-- =============================================================================
-- Akshat Fertilizers B2B — Google OAuth + onboarding (additive to 002)
-- Adds "Sign in with Google": a Google user arrives with NO Dealer/Farmer role,
-- so they land `onboarded = false` and must complete their profile once. Admin
-- promotion is NOT done here (no email hardcoded in SQL) — the app promotes
-- accounts whose email is in ADMIN_NOTIFICATION_EMAIL at login.
-- Idempotent & safe to run after 002.
-- =============================================================================

-- 1. onboarded flag -----------------------------------------------------------
-- Existing/password rows default to true (they registered with full details).
alter table public.profiles add column if not exists onboarded boolean not null default true;

-- 2. Sign-up trigger: OAuth users (no role in metadata) → onboarded = false ----
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m          jsonb   := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_has_role boolean := m ? 'role';   -- password signup sets role; Google OAuth does not
begin
  insert into public.profiles (id, role, status, onboarded, full_name, mobile, whatsapp, email, state, city, entity_name)
  values (
    new.id,
    (case upper(coalesce(m->>'role', 'FARMER')) when 'DEALER' then 'DEALER' else 'FARMER' end)::public.acct_role,
    'PENDING',
    v_has_role,  -- true for email/password registration; false for a first Google sign-in
    coalesce(nullif(btrim(m->>'full_name'), ''), nullif(btrim(m->>'name'), '')),
    nullif(btrim(m->>'mobile'), ''), nullif(btrim(m->>'whatsapp'), ''),
    coalesce(new.email, ''), nullif(btrim(m->>'state'), ''), nullif(btrim(m->>'city'), ''), nullif(btrim(m->>'entity_name'), '')
  );
  return new;
end $$;

-- 3. complete_onboarding(): a first-time Google user picks Dealer/Farmer -------
-- Updates only the caller's own, not-yet-onboarded profile → PENDING (offline KYC).
create or replace function public.complete_onboarding(
  p_role text, p_mobile text, p_whatsapp text default null,
  p_state text default null, p_city text default null, p_entity text default null)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare u public.profiles%rowtype; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if upper(coalesce(p_role, '')) not in ('DEALER', 'FARMER') then raise exception 'INVALID_ROLE: choose Dealer or Farmer'; end if;
  if length(coalesce(btrim(p_mobile), '')) < 10 then raise exception 'INVALID_MOBILE: a valid mobile number is required'; end if;
  if length(coalesce(btrim(p_entity), '')) < 2 then raise exception 'INVALID_ENTITY: business or farm name is required'; end if;
  update public.profiles set
    role        = upper(p_role)::public.acct_role,
    mobile      = btrim(p_mobile),
    whatsapp    = coalesce(nullif(btrim(p_whatsapp), ''), btrim(p_mobile)),
    state       = nullif(btrim(p_state), ''),
    city        = nullif(btrim(p_city), ''),
    entity_name = btrim(p_entity),
    status      = 'PENDING',
    onboarded   = true
  where id = v_uid and onboarded = false and role <> 'ADMIN'
  returning * into u;
  if not found then raise exception 'ALREADY_ONBOARDED: your profile is already set up'; end if;
  return u;
end $$;

grant execute on function public.complete_onboarding(text, text, text, text, text, text) to authenticated;
