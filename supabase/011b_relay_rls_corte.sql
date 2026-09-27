-- ---------------------------------------------------------------------------
-- 011b · Buzón cerrado a anónimos — el CORTE  (T-147 · ADR-017 · SEC-03/05)
--
-- ⚠️ NO CORRER JUNTO CON 011a. Esta migración ROMPE a los clientes viejos:
-- dejan de sincronizar hasta que actualicen. No pierden datos —el sobre lleva
-- estado completo (regla 8); al actualizar republican y se ponen al día—, pero
-- mientras tanto no ven nada nuevo.
--
-- QUÉ HACE
--  1. Saca la lectura directa: `envelopes_read` y `device_keys_read` se van
--     (cierra P1 y P5). Leer queda sólo por `fetch_since` (topic obligatorio)
--     y `account_keys` (account_id obligatorio).
--  2. Nadie inserta directo: la escritura es SÓLO por `publish_envelope` (D2
--     del verificador, ronda 1). Con INSERT directo, cualquiera que conozca el
--     topic elegía `seq` (≈ 9,2e18) y `expires_at` (2099): envenenaba el
--     cursor del grupo para siempre (el cliente adopta el `seq` del último
--     sobre leído) y el TTL nunca lo levantaba. `publish_envelope` no recibe
--     `seq`, `created_at` ni `expires_at`: los pone el servidor.
--     El cliente nuevo ya publica por RPC y sólo cae al insert directo si la
--     función NO existe, lo que tras 011a nunca pasa.
--  3. `anon` y `authenticated` pierden TODO grant directo sobre `envelopes`
--     (leer y escribir van por RPC `security definer`); `anon` además pierde
--     la lectura del directorio y el EXECUTE de las RPC del buzón.
--  4. Higiene (D7/P6): nadie ejecuta la purga ni las funciones de trigger.
--  5. `envelopes` sale de la publicación de Realtime (cierra P4): el aviso en
--     vivo ya va por Broadcast privado (011a).
--  6. La cuota pasa de observar a RECHAZAR y su retención baja a 2 horas (H5:
--     sólo hace falta la ventana viva; guardar más es mapa uid↔horario).
--
-- CONDICIÓN PARA CORRERLA — verificable, no a ojo (checklist F4 del plan):
-- no antes de D+14 (D = día en que la app nueva salió a TestFlight/Play) Y las
-- dos consultas dan 0 mirando los últimos 7 días seguidos:
--
--   -- A) Nadie escribe como anónimo (= todo el que escribe tiene la app nueva)
--   select coalesce(sum(n), 0) as escrituras_anon_7_dias
--     from public.relay_write_stats where role = 'anon' and day > current_date - 7;
--
--   -- B) Nadie lee por el camino viejo (contador puesto en cero en D+7 con
--   --    `select pg_stat_statements_reset();`):
--   select calls, left(query, 100) as consulta
--     from pg_stat_statements
--    where (query ilike '%from "public"."envelopes"%'
--           or query ilike '%from "public"."device_keys"%')
--      and query not ilike '%insert into%'
--    order by calls desc;
--
-- Esperado: A = 0 y B sin filas (o todas con calls = 0). Si no llegan a 0 por
-- testers que no actualizaron, decide el PO (P-2: 2 semanas con aviso).
--
-- VERIFICACIÓN después de correrla:
--   select policyname, roles from pg_policies
--    where tablename in ('envelopes','device_keys') order by 1;
--     → device_keys_delete, device_keys_write   (ninguna de envelopes)
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'envelopes' and grantee in ('anon','authenticated');   → 0 filas
--   select count(*) as sigue_en_realtime from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename = 'envelopes';   → 0
--   select enforce, retention from public.relay_quota_config;           → t, 02:00:00
--
-- ROLLBACK: `supabase/011b_rollback.sql`. Devuelve policies, grants y
-- publicación como estaban antes del corte. 011a queda. No toca la cuota.
--
-- Idempotente: correrla dos veces no rompe nada.
-- ---------------------------------------------------------------------------

begin;

-- 1 · Sin lectura directa (I1) -----------------------------------------------
drop policy if exists envelopes_read on public.envelopes;
drop policy if exists device_keys_read on public.device_keys;

-- 2 · Sin escritura directa (D2) ----------------------------------------------
-- Sin policy de INSERT y sin grant: la única escritura es `publish_envelope`.
drop policy if exists envelopes_write on public.envelopes;

-- 3 · Sin grants directos de tabla ----------------------------------------------
-- anon y authenticated → «permission denied» sobre envelopes (no una lista
-- vacía que parezca un buzón vacío). Las RPC son `security definer`: corren
-- como dueño y no necesitan estos grants.
-- device_keys: `authenticated` conserva lo suyo (registrar y borrar sus claves
-- por las policies de 003); sin policy de SELECT ve 0 filas.
revoke all on public.envelopes from anon, authenticated;
revoke select on public.device_keys from anon;

-- 4 · RPC del buzón sólo para authenticated (H3: nombrar anon) ---------------
revoke execute on function
  public.fetch_since(text, bigint, text, integer),
  public.publish_envelope(text, text, text, boolean, text, text),
  public.account_keys(text),
  public.delete_my_envelopes(text, text)
  from public, anon;
grant execute on function
  public.fetch_since(text, bigint, text, integer),
  public.publish_envelope(text, text, text, boolean, text, text),
  public.account_keys(text),
  public.delete_my_envelopes(text, text)
  to authenticated;

-- 5 · Higiene (D7/P6) ----------------------------------------------------------
-- La purga la corre el cron (como dueño); las otras dos son de trigger, y un
-- trigger no chequea EXECUTE al dispararse.
revoke execute on function public.purge_expired_envelopes(), public.compact_envelopes(), public.stamp_owner_tag()
  from public, anon, authenticated;

-- 6 · Fuera de postgres_changes (P4) ------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime'
                and schemaname = 'public' and tablename = 'envelopes') then
    alter publication supabase_realtime drop table public.envelopes;
  end if;
end $$;

-- 7 · La cuota rechaza; retención corta (H5) ----------------------------------
update public.relay_quota_config set enforce = true, retention = interval '2 hours';

commit;

-- 8 · Refrescar el caché de esquema de PostgREST -----------------------------
notify pgrst, 'reload schema';
