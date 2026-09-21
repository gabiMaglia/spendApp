-- ---------------------------------------------------------------------------
-- 010 · Compactación por rebanada (ckey)  (ADR-007, T-058 de fondo)
--
-- QUÉ ARREGLA
-- Hoy compact_envelopes() (009_owner_tag_only.sql) borra TODO sobre anterior
-- del mismo owner_tag en el topic. Eso es correcto cuando cada sobre lleva el
-- estado COMPLETO del grupo. Con este cambio, un dispositivo publica el
-- estado partido en varias "rebanadas" (una por sobre) más un manifiesto —
-- así que publicar la rebanada 2 NO debe borrar la rebanada 1: son estado
-- completo de PORCIONES distintas, no versiones sucesivas de lo mismo.
--
-- CÓMO
-- Una columna nueva, `ckey`, identifica la rebanada (opaca para el servidor,
-- derivada de la clave del grupo — ver src/sync/slices.ts). La compactación
-- pasa a operar por (topic, owner_tag, ckey): sólo reemplaza la versión
-- ANTERIOR de la MISMA rebanada del MISMO dispositivo.
--
-- QUÉ NO CAMBIA
-- La prenda de escritura (owner_tag/owner_proof, 008/009) seguí exactamente
-- igual — no hace falta un secreto nuevo por rebanada. Sigue siendo
-- imposible que un tercero sin el secreto del dispositivo fabrique su
-- owner_tag, y ahora tampoco puede borrar sólo UNA rebanada ajena sin
-- también conocer ese secreto. La rama sin prenda que 009 ya cerró
-- (envelopes sin owner_tag no se compactan, sólo expiran por TTL) no se
-- reabre acá.
--
-- ORDEN — esta migración se aplica ANTES de desplegar la app que publica
-- rebanadas (ver Global Constraints del plan). Un cliente viejo sigue
-- publicando con ckey = null y compactando exactamente como hoy.
-- ---------------------------------------------------------------------------

begin;

-- 1 · Columna nueva ---------------------------------------------------------
alter table public.envelopes add column if not exists ckey text;

-- 2 · Compactación, ahora también por rebanada ------------------------------
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
       and ckey is not distinct from new.ckey
       and compactable
       and seq < new.seq;
  end if;

  return null; -- AFTER trigger: el valor de retorno se ignora
end;
$$;

drop trigger if exists envelopes_compact on public.envelopes;
create trigger envelopes_compact
  after insert on public.envelopes
  for each row
  execute function public.compact_envelopes();

-- 3 · Índice para la compactación por rebanada ------------------------------
create index if not exists envelopes_owner_ckey_idx
  on public.envelopes (topic, owner_tag, ckey, seq)
  where compactable and owner_tag is not null;

commit;

-- 4 · Refrescar el caché de esquema de PostgREST ----------------------------
notify pgrst, 'reload schema';
