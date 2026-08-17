-- ============================================================================
-- ADR-003 · Buzón store-and-forward para sync en tiempo real
--
-- El servidor es un BUZÓN TONTO: guarda sobres que no puede abrir y los
-- entrega cuando el destinatario aparece. Nunca ve un gasto, ni el nombre de
-- un grupo, ni quién le debe a quién.
--
-- SEGURIDAD — leer antes de tocar nada:
-- La `anon key` viaja DENTRO del binario de la app y cualquiera puede
-- extraerla. No es un secreto y no pretende serlo. Lo único que separa estos
-- datos del mundo es el RLS de abajo. Una tabla sin RLS en este proyecto es
-- una tabla pública.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- envelopes: un sobre cifrado dirigido a un topic.
--
-- `topic` se deriva en el cliente de SHA256(secreto_del_grupo ‖ época), así que
-- para el servidor es un identificador opaco: no puede saber a qué grupo
-- corresponde ni relacionarlo con el topic de otra época.
-- ---------------------------------------------------------------------------
create table if not exists public.envelopes (
  -- `seq` es el cursor: cada dispositivo recuerda hasta dónde leyó. Es bigserial
  -- y no un timestamp a propósito — dos relojes distintos no dan orden, un
  -- contador del servidor sí.
  seq         bigserial primary key,
  topic       text        not null,
  -- Ciphertext opaco. El servidor NO puede abrirlo.
  payload     text        not null,
  -- Quién lo mandó, sólo para que el receptor no se procese a sí mismo.
  -- Es un id de dispositivo, no una identidad de persona.
  sender      text        not null,
  created_at  timestamptz not null default now(),
  -- Purga automática. 30 días es seguro SÓLO porque los sobres llevan ESTADO y
  -- no operaciones: perder uno viejo no rompe nada, el estado más nuevo lo
  -- reemplaza igual. Si alguna vez se manda una operación incremental, este
  -- TTL pasa a ser pérdida de datos.
  expires_at  timestamptz not null default now() + interval '30 days'
);

create index if not exists envelopes_topic_seq_idx on public.envelopes (topic, seq);
create index if not exists envelopes_expires_idx    on public.envelopes (expires_at);

-- Tope de tamaño: sin esto, cualquiera con la anon key llena el disco.
alter table public.envelopes
  add constraint envelopes_payload_size check (octet_length(payload) <= 262144);

-- ---------------------------------------------------------------------------
-- RLS
--
-- Modelo del spike: quien conoce el `topic` puede leer y escribir en él. El
-- topic se deriva de un secreto que sólo tienen los miembros del grupo, así
-- que conocerlo ES la credencial. Nadie puede listar topics ajenos porque no
-- hay forma de enumerarlos: hay que saberlos de antemano.
--
-- LIMITACIÓN CONOCIDA DEL SPIKE: quien conozca un topic puede inyectar sobres
-- basura en él. No puede leer nada (no tiene la clave), pero sí hacer ruido.
-- El cierre es firmar los sobres y descartar los de remitentes fuera del
-- roster — ver ADR-003 §2. NO ir a producción sin eso.
-- ---------------------------------------------------------------------------
alter table public.envelopes enable row level security;

drop policy if exists envelopes_read on public.envelopes;
create policy envelopes_read on public.envelopes
  for select to anon, authenticated
  using (true);

drop policy if exists envelopes_write on public.envelopes;
create policy envelopes_write on public.envelopes
  for insert to anon, authenticated
  with check (octet_length(payload) <= 262144);

-- Nadie borra ni edita sobres: sólo los expira la purga. Sin políticas de
-- update/delete, RLS las niega por defecto.

-- ---------------------------------------------------------------------------
-- Purga de expirados. Se puede llamar desde el cliente o por cron.
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_envelopes()
returns integer
language sql
security definer
set search_path = public
as $$
  with borrados as (
    delete from public.envelopes where expires_at < now() returning 1
  )
  select count(*)::integer from borrados;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: el push es sólo un AVISO de que hay algo nuevo. La fuente de
-- verdad es siempre leer por `seq` desde el cursor (ADR-003 §4). Si el aviso
-- se pierde, la próxima lectura lo recupera igual.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.envelopes;
