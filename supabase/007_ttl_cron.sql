-- ---------------------------------------------------------------------------
-- 007 · Agendar la purga del buzón  (T-058 / ADR-007)
--
-- POR QUÉ
-- `purge_expired_envelopes()` existe desde `001_mailbox.sql` y **nunca corrió**.
-- No se la llama desde ningún lado del repo y no había cron versionado. Se
-- confirmó el 2026-09-01: `select ... from cron.job` devolvió
-- «relation "cron.job" does not exist» — pg_cron ni siquiera estaba instalado.
--
-- Consecuencia: el TTL de 30 días que la app promete NO se aplica. Cada sobre
-- que se publicó desde el primer día sigue en la tabla. Y como el sobre lleva
-- el ESTADO COMPLETO del grupo (regla #8 / ADR-007), cada publicación es una
-- copia entera del grupo — a un sobre cada vez que alguien toca algo, con
-- debounce de 1,5 s.
--
-- QUÉ HACE
-- Instala pg_cron y agenda la purga todos los días a las 03:15 UTC.
--
-- DESPUÉS DE CORRERLO: la primera purga puede borrar mucho. Es lo esperado —
-- son sobres vencidos hace meses que nadie va a volver a leer. Los sobres
-- vigentes (< 30 días) no se tocan, y un peer que se atrasó más de 30 días
-- reconstruye igual, porque cada sobre nuevo trae el estado completo.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

-- Idempotente: si ya existiera de una corrida anterior, se reemplaza.
select cron.unschedule('purge_expired_envelopes')
  where exists (select 1 from cron.job where jobname = 'purge_expired_envelopes');

select cron.schedule(
  'purge_expired_envelopes',
  '15 3 * * *',
  $$ select public.purge_expired_envelopes(); $$
);

-- Verificación: esto tiene que devolver UNA fila.
-- select jobname, schedule, active from cron.job where jobname = 'purge_expired_envelopes';
