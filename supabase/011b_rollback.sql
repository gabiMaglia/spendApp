-- ---------------------------------------------------------------------------
-- 011b · ROLLBACK del corte  (T-147)
--
-- Cuándo: si después de correr 011b algo que tenía que seguir sincronizando
-- dejó de hacerlo. Devuelve la lectura y la escritura directas (anon y
-- authenticated) y el aviso por
-- postgres_changes como estaban antes del corte, con 011a aplicada (policies de
-- 003/006, grants de 005/008/011a —insert por columnas—, publicación de 001).
--
-- Qué NO toca:
--  - 011a queda entera (RPC, cuota, Broadcast, estadística): es aditiva y los
--    clientes nuevos la usan.
--  - La cuota: `enforce` y `retention` siguen como los dejó 011b. Si también
--    hay que apagarla es una decisión aparte del PO:
--      update public.relay_quota_config set enforce = false, retention = interval '8 days';
--  - La higiene de EXECUTE de purga/trigger (D7): nadie legítimo la usaba.
--
-- Idempotente: se puede correr dos veces.
-- ---------------------------------------------------------------------------

begin;

drop policy if exists envelopes_read on public.envelopes;
create policy envelopes_read on public.envelopes
  for select to anon, authenticated
  using (true);

drop policy if exists envelopes_write on public.envelopes;
create policy envelopes_write on public.envelopes
  for insert to anon, authenticated
  with check (octet_length(payload) <= 1048576);

drop policy if exists device_keys_read on public.device_keys;
create policy device_keys_read on public.device_keys
  for select using (true);

-- Vuelve al estado de 011a, NO al de antes: el insert directo sigue limitado a
-- las columnas del cliente (seq/created_at/expires_at los pone el servidor).
grant select on public.envelopes to anon, authenticated;
grant insert (topic, payload, sender, compactable, owner_proof, ckey) on public.envelopes to anon, authenticated;
grant select on public.device_keys to anon;

grant execute on function
  public.fetch_since(text, bigint, text, integer),
  public.publish_envelope(text, text, text, boolean, text, text),
  public.account_keys(text),
  public.delete_my_envelopes(text, text)
  to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'public' and tablename = 'envelopes') then
    alter publication supabase_realtime add table public.envelopes;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
