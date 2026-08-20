-- ============================================================================
-- T-032 · Compactación del buzón
--
-- Hoy la única retención es el TTL de 30 días. Pero los sobres de un grupo
-- llevan **estado completo**, así que de un mismo remitente sólo sirve el
-- último: si alguien publicó 50 veces, las 49 anteriores son ruido que ocupa
-- lugar, gasta cuota y obliga a un miembro nuevo a bajar y descartar 49 estados
-- superados antes de llegar al que vale.
--
-- ⚠️ ESTO ES SEGURO **SÓLO** PORQUE LOS SOBRES DE GRUPO LLEVAN ESTADO.
-- Si alguna vez se publica algo incremental ("sumale 500"), compactar deja de
-- ser una limpieza y pasa a ser PÉRDIDA DE DATOS SILENCIOSA. Es la misma
-- condición que ya sostiene al TTL de 30 días, y por eso se marca sobre por
-- sobre en vez de asumirla para toda la tabla.
--
-- Los buzones de CONTACTO y de INVITACIÓN llevan MENSAJES, no estado: una
-- tarjeta de contacto y una entrega de clave de grupo son cosas distintas que
-- viajan por el mismo topic y desde el mismo remitente. Compactarlas borraría
-- la tarjeta que el otro todavía no leyó. Por eso van con `compactable = false`
-- y el servidor no las toca.
-- ============================================================================

alter table public.envelopes
  add column if not exists compactable boolean not null default false;

/**
 * Deja sólo el último sobre compactable de cada (topic, sender).
 *
 * Corre como trigger y no como tarea periódica: así el buzón nunca acumula, sin
 * depender de un cron que haya que configurar aparte y que nadie recuerde
 * revisar.
 *
 * El cliente NO elige qué se borra — sólo marca si SU sobre es compactable.
 * Un atacante con la anon key puede, como mucho, hacer que se borren los suyos.
 */
create or replace function public.compact_envelopes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.compactable then
    delete from public.envelopes
    where topic = new.topic
      and sender = new.sender
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

-- Sin este índice, cada inserción compactable haría un scan de la tabla.
create index if not exists envelopes_compact_idx
  on public.envelopes (topic, sender, seq)
  where compactable;
