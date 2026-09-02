-- ---------------------------------------------------------------------------
-- 006 · Subir el tope del sobre de 256 KB a 1 MB  (T-058)
--
-- POR QUÉ
-- Un grupo de 5 personas con 200 gastos (≈6 meses de uso normal) produce
-- 319.528 bytes en el cable contra un tope de 262.144: **122%**. `publishToGroup`
-- devuelve `too_large` y ese grupo DEJA DE SINCRONIZAR PARA SIEMPRE. Está
-- medido con arné real, no estimado, y quitar todas las fotos no lo salva
-- (104,8%): el término dominante son los gastos, no los avatares.
--
-- El techo efectivo no son 256 KB de datos sino ~196 KB de JSON: `sealEnvelope`
-- devuelve base64 y el chequeo corre sobre ese string, así que el ×4/3 se paga
-- antes de medir.
--
-- DE DÓNDE SALÍA EL 256 KB
-- De una línea del engram marcada "no verificados, verificar en el spike", que
-- venía de los límites de Supabase **Realtime** — y los sobres no viajan por
-- Realtime: se leen por REST. Se probó el proyecto real con sondas de 1 KB,
-- 256 KB, 1 MB, 2 MB y 8 MB: ninguna dio 413. **El tope es nuestro.**
--
-- QUÉ COMPRA
-- El techo por grupo pasa de ~160 gastos a ~650. No es infinito y no reemplaza
-- al arreglo de fondo (ADR-007), pero saca a los grupos reales de la zona donde
-- dejan de sincronizar en silencio.
--
-- QUÉ NO CAMBIA
-- El sobre sigue llevando el ESTADO COMPLETO del grupo (regla #8 / ADR-007).
-- Filtrar por fecha NO es una opción: la compactación del buzón, el TTL de 30
-- días y el descarte barato de sobres dependen de que lleve estado.
--
-- ORDEN DE APLICACIÓN — IMPORTA
-- Primero esto, después el cliente. Al revés, un cliente que cree que puede
-- mandar 1 MB choca contra un servidor que sigue en 256 KB y el publish falla.
-- Al derecho no rompe nada: un cliente viejo se auto-limita más abajo.
-- ---------------------------------------------------------------------------

alter table public.envelopes
  drop constraint if exists envelopes_payload_size;

alter table public.envelopes
  add constraint envelopes_payload_size check (octet_length(payload) <= 1048576);

-- El tope está replicado en la policy de INSERT a propósito (defensa en
-- profundidad): el constraint protege la tabla, la policy protege la escritura
-- vía PostgREST. Los dos números tienen que moverse juntos o el más chico manda.
drop policy if exists envelopes_write on public.envelopes;
create policy envelopes_write on public.envelopes
  for insert to anon, authenticated
  with check (octet_length(payload) <= 1048576);
