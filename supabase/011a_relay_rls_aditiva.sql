-- ---------------------------------------------------------------------------
-- 011a · Buzón cerrado a anónimos — parte ADITIVA  (T-147 · ADR-017 · SEC-03/05)
--
-- POR QUÉ
-- Con la anon key (que viaja dentro de la app y es pública) hoy cualquiera
-- puede: listar el buzón entero (P1), escribir basura sin límite en cualquier
-- topic (P2), escuchar en vivo cada sobre nuevo por Realtime (P4) y listar el
-- directorio de claves (P5). Ver `engram/plans/T-147.md` §1.
--
-- El arreglo va en DOS migraciones, como 008 → 009:
--   011a (ésta) agrega las piezas nuevas SIN tocar nada de lo que usan los
--        clientes viejos. No rompe a nadie.
--   011b (el corte) saca la lectura directa y la escritura anónima. Se corre
--        semanas después, con criterio medido (ver su docblock).
--
-- QUÉ AGREGA
--  1. Cuota por uid (20 sobres/min + 20 MB/h), en MODO OBSERVAR: anota a quién
--     habría frenado, no frena. El PO la activa con un `update` tras una
--     semana de datos (checklist F3); 011b la fuerza igual.
--     El contador NO guarda el topic (I3): uid + topic juntos en la base
--     serían un mapa persona↔grupo que hoy no existe.
--     Ventana FIJA (minuto/hora de reloj), no deslizante: en el borde de un
--     minuto se pueden colar hasta 2×20. Aceptado: es freno de abuso, no
--     facturación.
--  2. Estadística agregada de escrituras por ROL y día (sin uid, sin topic):
--     es el criterio A para correr 011b (0 escrituras `anon` en 7 días).
--  3. `publish_envelope` (escritura por RPC). Hace falta porque el cliente hoy
--     escribe con `insert().select()`, que PostgREST resuelve con
--     `INSERT … RETURNING`, y la RLS le aplica al RETURNING la policy de
--     SELECT — que 011b borra (hallazgo H1 del plan).
--  4. `fetch_since` (lectura por RPC): topic obligatorio, ≤ 200 filas y
--     ≤ 4 MB por página, pero SIEMPRE al menos una fila si existe (si no, un
--     sobre de 1 MB con un tope menor frenaría el cursor para siempre).
--  5. Aviso en vivo por Broadcast PRIVADO (`envelopes:<topic>`) disparado por
--     la base. Sólo `authenticated` escucha; nadie publica desde el cliente
--     (no hay policy de INSERT), así que no se pueden falsificar «pings».
--  6. `account_keys` pasa a `security definer`: cuando 011b borre
--     `device_keys_read`, la versión invoker devolvería vacío y la fase B de
--     ADR-004 lo leería como «esta cuenta no tiene claves».
--
-- QUÉ NO CAMBIA
-- `envelopes_read`, `envelopes_write`, `device_keys_read`, la publicación de
-- Realtime, el tope de 1 MB, la prenda (008/009), la compactación por ckey
-- (010) y el TTL (007). Los clientes viejos siguen exactamente igual.
-- ADR-003 intacto: la RLS es control de ABUSO, no confidencialidad; la
-- confidencialidad la da el cifrado de punta a punta.
--
-- ROLES Y GRANTS (hallazgos H3/H4)
-- Supabase da EXECUTE/ALL a `anon` y `authenticated` por *default privileges*
-- a todo lo nuevo en `public`: un `revoke … from public` NO alcanza. Por eso
-- cada revoke de abajo nombra a `anon` y `authenticated` explícitamente.
-- La cuota corre dentro de funciones `security definer`, donde `current_user`
-- es el dueño y no quien pide: el rol y el uid se leen SIEMPRE del JWT.
--
-- ORDEN
-- Primero ésta, después la app nueva (que habla con los dos esquemas), y
-- 011b recién con el criterio del checklist F4.
--
-- PRE-VUELO (no modifica nada). Correr antes y comparar con lo esperado:
--   select version();                                   -- PostgreSQL 15.x o 17.x
--   select extname from pg_extension
--    where extname in ('pg_cron','pg_stat_statements','pg_net') order by 1;
--                                                        -- al menos pg_cron
--   select count(*) from pg_policies
--    where schemaname = 'realtime' and tablename = 'messages';   -- 0
--   select exists (select 1 from pg_proc
--                   where pronamespace = 'realtime'::regnamespace
--                     and proname = 'send');             -- true
--   select relforcerowsecurity from pg_class
--    where oid = 'public.envelopes'::regclass;           -- false
-- Si algo da distinto, NO correr esto: avisar.
--
-- ROLLBACK
-- No hace falta para los clientes: nada de lo viejo cambió. Si se quisiera
-- deshacer igual: `drop trigger envelopes_a_quota` y `envelopes_z_notify`
-- on public.envelopes; `drop function` de publish_envelope, fetch_since,
-- relay_enforce_quota, relay_notify_news, purge_relay_quota; `drop table` de
-- las cuatro relay_*; `drop policy relay_news_listen on realtime.messages`;
-- `select cron.unschedule('purge_relay_quota')`; y re-correr
-- `005_claves_por_owner.sql` (vuelve account_keys a invoker).
--
-- Correrla dos veces no rompe nada (idempotente).
-- ---------------------------------------------------------------------------

begin;

-- 1 · Tablas de cuota --------------------------------------------------------
-- Ninguna tiene `topic` (I3). RLS encendida SIN policies y sin grants para la
-- app: sólo las lee el dueño (SQL editor) y `service_role`.

create table if not exists public.relay_quota_config (
  id              boolean  primary key default true check (id),   -- una sola fila
  enforce         boolean  not null default false,
  per_minute      integer  not null default 20,
  bytes_per_hour  bigint   not null default 20971520,
  retention       interval not null default '8 days');
insert into public.relay_quota_config default values on conflict do nothing;

-- Contador por uid y ventana ('m' = minuto, 'h' = hora).
create table if not exists public.relay_quota (
  uid          uuid        not null,
  granularity  char(1)     not null check (granularity in ('m','h')),
  bucket       timestamptz not null,
  n            integer     not null default 0,
  bytes        bigint      not null default 0,
  primary key (uid, granularity, bucket));
create index if not exists relay_quota_bucket_idx on public.relay_quota (bucket);

-- A quién habría frenado la cuota mientras está en modo observar.
create table if not exists public.relay_quota_would_reject (
  at       timestamptz not null default now(),
  uid      uuid        not null,
  reason   text        not null,
  n_min    integer     not null,
  bytes_h  bigint      not null);
create index if not exists relay_quota_would_reject_at_idx on public.relay_quota_would_reject (at);

-- Escrituras por rol del JWT y día. Sin uid ni topic: es el criterio A de 011b.
create table if not exists public.relay_write_stats (
  day    date   not null,
  role   text   not null,
  n      bigint not null default 0,
  bytes  bigint not null default 0,
  primary key (day, role));

alter table public.relay_quota_config enable row level security;
alter table public.relay_quota enable row level security;
alter table public.relay_quota_would_reject enable row level security;
alter table public.relay_write_stats enable row level security;

revoke all on public.relay_quota_config from anon, authenticated;
revoke all on public.relay_quota from anon, authenticated;
revoke all on public.relay_quota_would_reject from anon, authenticated;
revoke all on public.relay_write_stats from anon, authenticated;

-- 2 · Trigger de cuota -------------------------------------------------------
-- BEFORE INSERT. El nombre `envelopes_a_quota` lo ordena ANTES de
-- `envelopes_stamp_owner` (Postgres dispara los triggers por orden alfabético):
-- si la cuota rechaza, no se sella nada.
--
-- Si rechaza, la transacción entera vuelve atrás — incluido el contador —,
-- así que un uid frenado no «gasta» cuota con los intentos rechazados.
create or replace function public.relay_enforce_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     text   := coalesce(auth.jwt() ->> 'role', 'none');
  v_uid      uuid   := auth.uid();
  v_bytes    bigint := octet_length(new.payload);
  v_cfg      public.relay_quota_config%rowtype;
  v_n_min    integer;
  v_bytes_h  bigint;
begin
  insert into public.relay_write_stats (day, role, n, bytes)
    values (current_date, v_role, 1, v_bytes)
    on conflict (day, role)
    do update set n = relay_write_stats.n + 1, bytes = relay_write_stats.bytes + excluded.bytes;

  -- `anon` (y service_role) no tienen uid: no hay a quién contarle. Al `anon`
  -- lo corta 011b.
  if v_uid is null then
    return new;
  end if;

  -- Upsert atómico con `returning`: dos inserts concurrentes del mismo uid se
  -- serializan en la fila del contador y cada uno ve su propio total.
  insert into public.relay_quota (uid, granularity, bucket, n, bytes)
    values (v_uid, 'm', date_trunc('minute', now()), 1, v_bytes)
    on conflict (uid, granularity, bucket)
    do update set n = relay_quota.n + 1, bytes = relay_quota.bytes + excluded.bytes
    returning n into v_n_min;

  insert into public.relay_quota (uid, granularity, bucket, n, bytes)
    values (v_uid, 'h', date_trunc('hour', now()), 1, v_bytes)
    on conflict (uid, granularity, bucket)
    do update set n = relay_quota.n + 1, bytes = relay_quota.bytes + excluded.bytes
    returning bytes into v_bytes_h;

  select * into v_cfg from public.relay_quota_config where id;
  if not found then
    return new;   -- sin config no se frena a nadie (fallar abierto: es un freno, no un permiso)
  end if;

  if v_n_min > v_cfg.per_minute or v_bytes_h > v_cfg.bytes_per_hour then
    if v_cfg.enforce then
      -- PostgREST traduce SQLSTATE 'PTxyz' a HTTP xyz → 429.
      raise exception 'relay_quota_exceeded'
        using errcode = 'PT429', hint = 'reintentar en el próximo minuto';
    end if;
    insert into public.relay_quota_would_reject (uid, reason, n_min, bytes_h)
      values (v_uid,
              case when v_n_min > v_cfg.per_minute then 'per_minute' else 'bytes_per_hour' end,
              v_n_min, v_bytes_h);
  end if;

  return new;
end;
$$;

drop trigger if exists envelopes_a_quota on public.envelopes;
create trigger envelopes_a_quota
  before insert on public.envelopes
  for each row
  execute function public.relay_enforce_quota();

-- 3 · Escritura por RPC (H1) -------------------------------------------------
-- El sello (`stamp_owner_tag`), la compactación, la cuota y el aviso corren por
-- sus triggers exactamente como con un insert directo. El tope de 1 MB lo
-- sigue dando el CHECK de la tabla. `security definer` porque tras 011b no hay
-- policy de SELECT para el RETURNING; la cuota igual lee el uid del JWT.
create or replace function public.publish_envelope(
  p_topic        text,
  p_payload      text,
  p_sender       text,
  p_compactable  boolean default false,
  p_owner_proof  text    default null,
  p_ckey         text    default null)
returns table (seq bigint, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_seq  bigint;
  v_at   timestamptz;
begin
  if p_topic is null or p_topic = '' then
    raise exception 'publish_envelope: topic requerido' using errcode = '22023';
  end if;

  insert into public.envelopes (topic, payload, sender, compactable, owner_proof, ckey)
    values (p_topic, p_payload, p_sender, coalesce(p_compactable, false), p_owner_proof, p_ckey)
    returning seq, created_at into v_seq, v_at;

  return query select v_seq, v_at;
end;
$$;

-- 4 · Lectura por RPC (D4) ---------------------------------------------------
-- Misma semántica que `fetchSince` del cliente: cursor `seq` EXCLUSIVO, orden
-- por `seq`, excluye el `sender` propio. Nunca devuelve `owner_tag` ni `topic`.
-- `more` vale lo mismo en todas las filas: true si quedó algo sin entregar.
-- Progreso garantizado: la primera fila sale aunque sola supere el tope.
create or replace function public.fetch_since(
  p_topic           text,
  p_since           bigint,
  p_exclude_sender  text    default null,
  p_limit           integer default 200)
returns table (seq bigint, payload text, sender text, created_at timestamptz, ckey text, more boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_lim integer := least(greatest(coalesce(p_limit, 200), 1), 200);
begin
  if p_topic is null or p_topic = '' then
    return;   -- sin topic no hay nada que listar (I1)
  end if;

  return query
  with cand as (
    select e.seq, e.payload, e.sender, e.created_at, e.ckey,
           sum(octet_length(e.payload)) over (order by e.seq) as acum,
           row_number() over (order by e.seq) as rn
      from public.envelopes e
     where e.topic = p_topic
       and e.seq > coalesce(p_since, 0)
       and (p_exclude_sender is null or e.sender <> p_exclude_sender)
     order by e.seq
     limit v_lim + 1),
  corte as (
    select * from cand
     where rn <= v_lim
       and (rn = 1 or acum <= 4194304))
  select c.seq, c.payload, c.sender, c.created_at, c.ckey,
         (select count(*) from cand) > (select count(*) from corte)
    from corte c
   order by c.seq;
end;
$$;

-- 5 · Aviso en vivo por Broadcast privado (D5) -------------------------------
-- Sólo dice «hay novedades» (payload vacío); la fuente de verdad sigue siendo
-- leer por cursor. Si el aviso falla, NUNCA tumba el insert: se traga el error
-- y el próximo poll lo recupera (invariante 1 de relay.ts).
create or replace function public.relay_notify_news()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send('{}'::jsonb, 'news', 'envelopes:' || new.topic, true);
  exception when others then
    null;
  end;
  return null;   -- AFTER trigger: el valor de retorno se ignora
end;
$$;

drop trigger if exists envelopes_z_notify on public.envelopes;
create trigger envelopes_z_notify
  after insert on public.envelopes
  for each row
  execute function public.relay_notify_news();

-- Escucha: sólo `authenticated`, sólo broadcast, sólo canales `envelopes:*`.
-- Conocer el topic sigue siendo la credencial. NO hay policy de INSERT: nadie
-- puede publicar en estos canales desde un cliente.
drop policy if exists relay_news_listen on realtime.messages;
create policy relay_news_listen on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast'
         and (select realtime.topic()) like 'envelopes:%');

-- 6 · account_keys como definer (D6) -----------------------------------------
-- Idéntica a 005 salvo `security definer`. Sólo devuelve claves PÚBLICAS de la
-- cuenta pedida (y de los otros dispositivos del mismo owner): no lista nada.
create or replace function public.account_keys(p_account_id text)
returns table (public_key text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct dk.public_key
  from public.device_keys dk
  where dk.account_id = p_account_id
     or dk.owner in (
       select o.owner
       from public.device_keys o
       where o.account_id = p_account_id
     );
$$;

-- 7 · Purga de la cuota (H5) --------------------------------------------------
-- `retention` = 8 días mientras se mide; 011b la baja a 2 horas (sólo hace
-- falta la ventana viva). La estadística por rol no tiene uid: se guarda 90 días.
create or replace function public.purge_relay_quota()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ret  interval;
  v_n    integer;
  v_m    integer;
begin
  select coalesce((select retention from public.relay_quota_config where id), interval '8 days')
    into v_ret;

  delete from public.relay_quota where bucket < now() - v_ret;
  get diagnostics v_n = row_count;
  delete from public.relay_quota_would_reject where at < now() - v_ret;
  get diagnostics v_m = row_count;
  delete from public.relay_write_stats where day < current_date - 90;

  return v_n + v_m;
end;
$$;

select cron.unschedule('purge_relay_quota')
  where exists (select 1 from cron.job where jobname = 'purge_relay_quota');
select cron.schedule(
  'purge_relay_quota',
  '7 * * * *',
  $$ select public.purge_relay_quota(); $$
);

-- 8 · Grants (H3) ------------------------------------------------------------
-- RPC del buzón: `anon` también, porque en F2 el cliente nuevo puede no tener
-- sesión todavía. 011b le saca `anon`.
revoke execute on function public.fetch_since(text, bigint, text, integer) from public;
grant execute on function public.fetch_since(text, bigint, text, integer) to anon, authenticated;
revoke execute on function public.publish_envelope(text, text, text, boolean, text, text) from public;
grant execute on function public.publish_envelope(text, text, text, boolean, text, text) to anon, authenticated;
revoke execute on function public.account_keys(text) from public;
grant execute on function public.account_keys(text) to anon, authenticated;

-- Funciones de trigger y de cron: nadie las llama desde la app.
revoke execute on function public.relay_enforce_quota() from public, anon, authenticated;
revoke execute on function public.relay_notify_news() from public, anon, authenticated;
revoke execute on function public.purge_relay_quota() from public, anon, authenticated;

commit;

-- 9 · Refrescar el caché de esquema de PostgREST (fuera de la transacción) ----
-- Sin esto PostgREST puede no conocer las RPC nuevas: «Could not find the
-- function public.fetch_since … in the schema cache».
notify pgrst, 'reload schema';

-- VERIFICACIÓN (checklist F1):
--   select proname from pg_proc where proname in ('fetch_since','publish_envelope',
--     'relay_enforce_quota','relay_notify_news','purge_relay_quota') order by 1;   -- 5
--   select enforce, per_minute, bytes_per_hour / 1048576 as mb_por_hora, retention
--     from public.relay_quota_config;                    -- false, 20, 20, 8 days
--   select jobname, schedule, active from cron.job
--    where jobname in ('purge_expired_envelopes','purge_relay_quota') order by 1;  -- 2
--   select policyname from pg_policies
--    where tablename in ('envelopes','device_keys') order by 1;   -- siguen las 5 de siempre
