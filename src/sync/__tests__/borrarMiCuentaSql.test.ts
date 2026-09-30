import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Auditoría pre-tiendas 2026-09-29 (B-1): borrar la cuenta tiene que borrarla
 * también en el servidor. App Store 5.1.1(v) y Google Play piden que se borre la
 * cuenta y sus datos asociados, y en Supabase quedaban el usuario de
 * `auth.users` (con el mail, si entró con Google o Apple), su fila de
 * `device_keys` y los contadores de cuota.
 */
const SQL = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '012_borrar_mi_cuenta.sql'), 'utf8')
  .toLowerCase();

describe('012 · delete_my_account', () => {
  it('es una función del esquema public, security definer y con search_path fijo', () => {
    expect(SQL).toMatch(/create or replace function public\.delete_my_account\(\)/);
    expect(SQL).toMatch(/security definer/);
    expect(SQL).toMatch(/set search_path/);
  });

  it('borra sólo lo de quien llama, y se niega sin sesión', () => {
    expect(SQL).toMatch(/auth\.uid\(\)/);
    expect(SQL).toMatch(/raise exception/);
  });

  it('borra las claves, los contadores y, al final, el usuario', () => {
    const claves = SQL.indexOf('delete from public.device_keys');
    const cuota = SQL.indexOf('delete from public.relay_quota ');
    const diaria = SQL.indexOf('delete from public.relay_quota_daily');
    const usuario = SQL.indexOf('delete from auth.users');
    for (const i of [claves, cuota, diaria, usuario]) expect(i).toBeGreaterThan(-1);
    expect(usuario).toBeGreaterThan(Math.max(claves, cuota, diaria));
  });

  it('sólo la puede ejecutar una sesión autenticada', () => {
    expect(SQL).toMatch(/revoke all on function public\.delete_my_account\(\) from public, anon/);
    expect(SQL).toMatch(/grant execute on function public\.delete_my_account\(\) to authenticated/);
  });
});
