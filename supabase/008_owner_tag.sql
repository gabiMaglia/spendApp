-- ---------------------------------------------------------------------------
-- 008 · Prenda de escritura por fila  (T-087 · ADR-009 · cierra T-086)
--
-- QUÉ ARREGLA
-- `compact_envelopes()` (004) es `security definer` y borra por
-- `topic + sender` de la fila recién insertada. `sender` lo elige el cliente
-- (`relayEngine.ts:78-84`) y se lee del buzón (`001_mailbox.sql:64-66`), así que
-- CUALQUIERA que conozca un topic le borra los sobres a otro miembro. No hace
-- falta ningún permiso de DELETE. El docblock de `004_compaction.sql:33-34`
-- afirmaba lo contrario y era FALSO; esta migración lo vuelve cierto.
--
-- CÓMO
-- Cada sobre lleva `owner_tag`: una huella que el SERVIDOR deriva de un valor
-- de tránsito, nunca copia de la fila entrante. Quien lee la tag no puede
-- fabricar una fila con esa tag. La compactación pasa a operar por tag.
--
-- Lo que viaja en cada INSERT es `sha256(secreto)`, y lo que se guarda es
-- `sha256(sha256(secreto))`. Así el valor de alta frecuencia NO es el
-- credencial de borrado: si el sello se rompiera y ese valor quedara expuesto,
-- quien lo tenga podría forjar inserts (el daño que ya existe hoy) pero NO
-- llamar a `delete_my_envelopes`.
--
-- QUÉ NO CAMBIA
-- El tope de 1 MB, la RLS, el TTL, y la distinción estado/mensaje: los sobres
-- de contacto e invitación siguen con `compactable = false` y el servidor
-- sigue sin tocarlos. La compactación sigue siendo por ESTADO, jamás
-- incremental — la advertencia de `004_compaction.sql:10-14` sigue vigente.
--
-- ORDEN — IMPORTA: primero esto, después la app (T-088). Al revés, un cliente
-- que manda `owner_proof` contra un servidor sin la columna recibe un error de
-- PostgREST; el cliente lo tolera (degradado de T-088 §4) pero publica sin
-- prenda hasta que reinicie.
-- ---------------------------------------------------------------------------

-- PRE-VUELO (no modifica nada). Tiene que devolver una fila; anotá el schema:
--   select extname, extnamespace::regnamespace as schema
--     from pg_extension where extname = 'pgcrypto';
-- Si el schema NO es `public` ni `extensions`, agregalo a los `search_path` de
-- abajo antes de correr esto.

begin;

-- 1 · Columnas -------------------------------------------------------------
alter table public.envelopes add column if not exists owner_tag   text;
alter table public.envelopes add column if not exists owner_proof text;

-- La tag es un SHA-256 en hex o nada. Las filas viejas tienen null y pasan.
alter table public.envelopes drop constraint if exists envelopes_owner_tag_hex;
alter table public.envelopes
  add constraint envelopes_owner_tag_hex
  check (owner_tag is null or owner_tag ~ '^[0-9a-f]{64}$');

-- 2 · El sello ------------------------------------------------------------
-- Convierte el valor de tránsito en la prenda, y borra el rastro.
--
-- Tres cosas, y las tres son la seguridad de esto:
--  a. deriva la tag EN EL SERVIDOR — el cliente nunca elige lo que se guarda;
--  b. PISA cualquier `owner_tag` que venga en el INSERT: si el cliente pudiera
--     mandar la tag, copiaría la ajena y el arreglo no arreglaría nada;
--  c. anula `owner_proof` SIEMPRE, así el valor de tránsito no se persiste, no
--     entra en la WAL de la fila y no sale por el `postgres_changes` de
--     Realtime, que emite la fila ya escrita.
--
-- Sin `owner_proof` no hace nada: el cliente viejo inserta como siempre.
--
-- NO es `security definer` a propósito: sólo modifica NEW y no toca ninguna
-- tabla, así que correr con privilegios ajenos sería superficie de más.
create or replace function public.stamp_owner_tag()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.owner_proof ~ '^[0-9a-f]{64}$' then
    new.owner_tag := encode(digest(new.owner_proof, 'sha256'), 'hex');
  else
    new.owner_tag := null;   -- (b): nunca se confía en lo que mandó el cliente
  end if;
  new.owner_proof := null;   -- (c): siempre, venga o no venga
  return new;
end;
$$;

drop trigger if exists envelopes_stamp_owner on public.envelopes;
create trigger envelopes_stamp_owner
  before insert on public.envelopes
  for each row
  execute function public.stamp_owner_tag();

-- 3 · La compactación, ahora por prenda ------------------------------------
-- Deja sólo el último sobre compactable de cada dueño en cada topic.
--
-- DOS RAMAS, a propósito:
--  - con prenda: borra por `owner_tag`. Es el arreglo: el `where` ya no
--    depende de un valor que el atacante elige.
--  - sin prenda (sobre viejo o cliente sin actualizar): se conserva EXACTAMENTE
--    el comportamiento de 004, incluido `sender = new.sender`. Un
--    `owner_tag is not distinct from` habría hecho que dos clientes viejos
--    DISTINTOS se borraran entre sí — null is not distinct from null es TRUE —,
--    que es peor que hoy.
--
-- La rama sin prenda sigue siendo falsificable: es el precio de la
-- compatibilidad hacia atrás. Se cierra con 009, después de que todos los
-- clientes hayan actualizado.
--
-- `and compactable` en el predicado de borrado NO es decorativo: los buzones de
-- contacto e invitación llevan MENSAJES y viajan con `compactable = false`.
-- Compactarlos borraría la tarjeta que el otro todavía no leyó.
create or replace function public.compact_envelopes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.compactable then
    return null;
  end if;

  if new.owner_tag is not null then
    delete from public.envelopes
     where topic = new.topic
       and owner_tag = new.owner_tag
       and compactable
       and seq < new.seq;
  else
    delete from public.envelopes
     where topic = new.topic
       and owner_tag is null
       and sender = new.sender
       and compactable
       and seq < new.seq;
  end if;

  return null; -- AFTER trigger: el valor de retorno se ignora
end;
$$;

-- El trigger AFTER de 004 no cambia de forma; se re-crea por idempotencia.
drop trigger if exists envelopes_compact on public.envelopes;
create trigger envelopes_compact
  after insert on public.envelopes
  for each row
  execute function public.compact_envelopes();

-- 4 · Índice de la rama nueva ---------------------------------------------
-- El de `sender` (004:61-63) NO se borra: lo usa la rama sin prenda.
create index if not exists envelopes_owner_compact_idx
  on public.envelopes (topic, owner_tag, seq)
  where compactable;

-- 5 · Borrado explícito ----------------------------------------------------
-- Borra los sobres propios de un topic. Se presenta el PREIMAGEN, nunca la
-- huella: conocer `owner_tag` (que es público, la lectura es `using(true)`) no
-- habilita nada.
--
-- No hay política de DELETE: la RLS sigue negando el borrado directo y ésta es
-- la única vía.
create or replace function public.delete_my_envelopes(p_topic text, p_secret text)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tag text;
  v_n   integer;
begin
  if p_topic is null or p_secret !~ '^[0-9a-f]{64}$' then
    return 0;
  end if;

  -- sha256(sha256(secreto)): el mismo doble hash que estampa el sello, porque
  -- lo que viajó en el INSERT ya era sha256(secreto).
  v_tag := encode(digest(encode(digest(p_secret, 'sha256'), 'hex'), 'sha256'), 'hex');

  with borradas as (
    delete from public.envelopes
     where topic = p_topic
       and owner_tag = v_tag
    returning 1
  )
  select count(*)::integer into v_n from borradas;

  return v_n;
end;
$$;

grant execute on function public.delete_my_envelopes(text, text) to anon, authenticated;

commit;

-- 6 · Refrescar el caché de esquema de PostgREST ---------------------------
-- Sin esto, PostgREST puede seguir sin conocer `owner_proof` y rechazar los
-- INSERT del cliente nuevo con «Could not find the 'owner_proof' column … in
-- the schema cache». Supabase suele recargarlo solo por event trigger, pero
-- avisar es gratis y el modo de falla es que el grupo deja de sincronizar.
notify pgrst, 'reload schema';
