-- ---------------------------------------------------------------------------
-- 009 · Cierre de la rama sin prenda  (T-087 §6)
--
-- ⚠️ NO CORRER JUNTO CON 008. Esta migración rompe a los clientes que todavía
-- no actualizaron: sus sobres dejan de compactarse y se quedan en el buzón
-- hasta el TTL de 30 días. No pierden datos —el sobre lleva estado completo—
-- pero el buzón crece.
--
-- POR QUÉ EXISTE
-- 008 conserva, por compatibilidad hacia atrás, una rama que compacta por
-- `sender` cuando el sobre no trae prenda. Esa rama SIGUE SIENDO FALSIFICABLE:
-- es el último resto del defecto de T-086. Esto la saca.
--
-- CONDICIÓN PARA CORRERLA — verificable, no a ojo:
--   select count(*) as sin_tag_ultima_semana
--     from public.envelopes
--    where compactable
--      and owner_tag is null
--      and created_at > now() - interval '7 days';
-- Correr 009 sólo cuando esto dé 0 durante una semana seguida.
--
-- ROLLBACK: volver a aplicar 008. Es idempotente y recrea la función y el
-- índice tal como estaban.
-- ---------------------------------------------------------------------------

begin;

create or replace function public.compact_envelopes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sin prenda no se compacta nada. Un sobre sin tag ya no borra nada de nadie:
  -- se queda hasta el TTL. Es el cierre del vector de T-086.
  if new.compactable and new.owner_tag is not null then
    delete from public.envelopes
     where topic = new.topic
       and owner_tag = new.owner_tag
       and compactable
       and seq < new.seq;
  end if;
  return null;
end;
$$;

-- El índice por `sender` ya no lo usa nadie: la rama que lo necesitaba se fue.
drop index if exists public.envelopes_compact_idx;

commit;
