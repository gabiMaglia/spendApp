-- OPCIONAL (cosmético, pero ahorra debugging).
--
-- El tope de tamaño estaba duplicado: en el CHECK de la tabla y en el
-- `with check` del RLS. El RLS evalúa primero, así que un payload grande se
-- rechazaba con "violates row-level security policy" — un error que manda a
-- investigar permisos cuando el problema es el tamaño.
--
-- El CHECK de la tabla aplica a TODA escritura sin importar el rol, así que el
-- del RLS era redundante. Se quita y el error pasa a nombrar la causa real.
drop policy if exists envelopes_write on public.envelopes;
create policy envelopes_write on public.envelopes
  for insert to anon, authenticated
  with check (true);
