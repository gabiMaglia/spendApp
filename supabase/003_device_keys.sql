-- ADR-004 — Directorio de claves públicas por cuenta.
--
-- Qué guarda: `cuenta ↔ clave pública del dispositivo`. NADA más.
-- No hay gastos, ni grupos, ni montos. La regla de privacidad del PO dice que
-- las CUENTAS pueden ser conocidas por el servidor; los GASTOS no. Esto está
-- del lado permitido, y por eso puede vivir en una tabla legible.
--
-- Lo único que esta tabla tiene que garantizar es que **nadie registre una
-- clave bajo la cuenta de otro**. Eso lo hace la RLS contra `auth.identities`,
-- no el cliente.

create table if not exists public.device_keys (
  -- Id de cuenta de la app: el `sub` del proveedor OAuth.
  account_id  text        not null,
  -- Ed25519 en hex (64 bytes → 128 chars). Pública: no es un secreto.
  public_key  text        not null check (public_key ~ '^[0-9a-f]{64}$'),
  -- Para que el dueño pueda limpiar lo suyo y para diagnosticar.
  owner       uuid        not null default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (account_id, public_key)
);

create index if not exists device_keys_account_idx on public.device_keys (account_id);

alter table public.device_keys enable row level security;

/**
 * ¿Esta cuenta es de quien está autenticado?
 *
 * `auth.identities` tiene una fila por proveedor vinculado, con el `provider_id`
 * que es exactamente el `sub` que la app usa como id de cuenta. Preguntar por
 * ahí —y no por `auth.uid()`— es lo que hace que funcione el caso "la cuenta
 * canónica es la de Apple pero la sesión es de Google".
 */
create or replace function public.owns_account(p_account_id text)
returns boolean
language sql
stable
security definer
set search_path = auth, public
as $$
  select exists (
    select 1 from auth.identities i
    where i.user_id = auth.uid()
      and i.provider_id = p_account_id
  );
$$;

-- Las claves públicas son públicas: cualquiera necesita poder verificar una
-- firma. Guardar esto en secreto no protegería nada y rompería la verificación.
drop policy if exists device_keys_read on public.device_keys;
create policy device_keys_read on public.device_keys
  for select using (true);

-- ESTA es la política que sostiene todo el ADR.
drop policy if exists device_keys_write on public.device_keys;
create policy device_keys_write on public.device_keys
  for insert to authenticated
  with check (public.owns_account(account_id) and owner = auth.uid());

-- Poder sacar un dispositivo perdido. Sólo el dueño, sólo lo suyo.
drop policy if exists device_keys_delete on public.device_keys;
create policy device_keys_delete on public.device_keys
  for delete to authenticated
  using (owner = auth.uid());

-- Sin UPDATE a propósito: una clave no se "edita". Se agrega otra, o se borra.
