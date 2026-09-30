-- ---------------------------------------------------------------------------
-- 012 · Borrar mi cuenta en el servidor  (auditoría pre-tiendas 2026-09-29, B-1)
--
-- App Store 5.1.1(v) y Google Play piden que borrar la cuenta desde la app
-- borre la cuenta y sus datos asociados. Hasta acá el borrado purgaba los sobres
-- propios del buzón (`delete_my_envelopes`) y todo lo local, pero en Supabase
-- quedaban: el usuario de `auth.users` (con Google o Apple, con el mail y el id
-- del proveedor), sus filas de `device_keys` y sus contadores de cuota.
--
-- La llama `deleteAccount.ts` con la sesión de quien se borra, DESPUÉS de purgar
-- sus sobres (esa purga no depende de la sesión, pero sí de la prenda), y el
-- usuario va al final: sin él, la sesión deja de valer.
--
-- Los sobres NO tienen clave foránea a `auth.users` (`owner_tag` es texto), así
-- que borrar el usuario no arrastra ni traba nada del buzón: los sobres de otra
-- instalación se van solos con el TTL de 30 días.
--
-- Idempotente y segura de correr más de una vez.
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'delete_my_account: sin sesión';
  end if;

  delete from public.device_keys where owner = v_uid;
  delete from public.relay_quota where uid = v_uid;
  delete from public.relay_quota_daily where uid = v_uid;

  -- Al final: sin el usuario, la sesión que hizo esta llamada deja de valer.
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
