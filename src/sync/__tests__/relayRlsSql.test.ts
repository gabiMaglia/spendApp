import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * T-147. Las migraciones del buzón las pega el PO a mano en el SQL editor de
 * Supabase. Este test sostiene que **el archivo que se va a pegar dice lo que el
 * plan dice**: cada caso es una propiedad de seguridad que, si se pierde en una
 * edición, reabre SEC-03/SEC-05 sin que nada más lo note.
 *
 * Lo que NO prueba: que Postgres se comporte así. Eso lo prueba la suite de
 * integración contra Supabase local (`npm run test:int`, ver
 * `scripts/supabase-int.sh`).
 */

const RAIZ = join(__dirname, '..', '..', '..');
const leer = (f: string) => readFileSync(join(RAIZ, 'supabase', f), 'utf8');
const sin = (s: string) => s.replace(/--.*$/gm, ''); // ignora comentarios

/** Desde `function public.<nombre>(` hasta el `$$;` que cierra su cuerpo. */
function cuerpoDe(sql: string, nombre: string): string {
  const desde = sql.indexOf(`function public.${nombre}(`);
  expect(desde).toBeGreaterThan(-1);
  const hasta = sql.indexOf('$$;', sql.indexOf('$$', desde) + 2);
  expect(hasta).toBeGreaterThan(desde);
  return sql.slice(desde, hasta);
}

describe('011a · aditiva', () => {
  const sql = sin(leer('011a_relay_rls_aditiva.sql'));

  it('no borra ni reemplaza ninguna policy vieja', () => {
    expect(sql).not.toMatch(/drop policy[^;]*(envelopes_read|envelopes_write|device_keys_read)/i);
    expect(sql).not.toMatch(/drop table public\.envelopes/i);
    expect(sql).not.toMatch(/alter publication/i);
  });
  it('la cuota nace en modo observar con 20/min y 20 MB/h', () => {
    expect(sql).toMatch(/enforce\s+boolean\s+not null\s+default\s+false/i);
    expect(sql).toMatch(/per_minute\s+integer\s+not null\s+default\s+20\b/i);
    expect(sql).toMatch(/bytes_per_hour\s+bigint\s+not null\s+default\s+20971520\b/i);
    expect(sql).toMatch(/retention\s+interval\s+not null\s+default\s+'8 days'/i);
  });
  it('ninguna tabla de cuota tiene topic (I3) y envelopes no gana uid', () => {
    for (const t of ['relay_quota', 'relay_quota_would_reject', 'relay_write_stats', 'relay_quota_config']) {
      const desde = sql.indexOf(`create table if not exists public.${t} (`);
      expect(desde).toBeGreaterThan(-1);
      const def = sql.slice(desde);
      expect(def.slice(0, def.indexOf(');'))).not.toMatch(/\btopic\b/i);
      expect(sql).toMatch(new RegExp(`revoke all on (table )?public\\.${t} from anon, authenticated`, 'i'));
      expect(sql).toMatch(new RegExp(`alter table public\\.${t} enable row level security`, 'i'));
    }
    expect(sql).not.toMatch(/alter table public\.envelopes add column[^;]*(uid|writer|user)/i);
  });
  it('la cuota lee rol y uid del JWT, rechaza con PT429 y es atómica', () => {
    const q = cuerpoDe(sql, 'relay_enforce_quota');
    expect(q).toMatch(/auth\.uid\(\)/);
    expect(q).toMatch(/auth\.jwt\(\)\s*->>\s*'role'/);
    expect(q).not.toMatch(/current_user/i);
    expect(q).toMatch(/errcode\s*=\s*'PT429'/i);
    expect(q).toMatch(/on conflict[\s\S]*returning n into/i);
    expect(sql).toMatch(/create trigger envelopes_a_quota\s+before insert on public\.envelopes/i);
  });
  it('fetch_since: definer, search_path fijo, tope 200 y 4 MB, progreso con rn = 1', () => {
    const f = cuerpoDe(sql, 'fetch_since');
    expect(f).toMatch(/security definer/i);
    expect(f).toMatch(/set search_path/i);
    expect(f).toMatch(/4194304/);
    expect(f).toMatch(/rn = 1 or acum <= 4194304/);
    expect(f).toMatch(/200/);
    expect(f).not.toMatch(/owner_tag/);
  });
  it('publish_envelope existe y es definer (H1)', () => {
    const p = cuerpoDe(sql, 'publish_envelope');
    expect(p).toMatch(/security definer/i);
    expect(p).toMatch(/set search_path/i);
    expect(p).toMatch(/returning seq, created_at/i);
  });
  it('el aviso es privado y no puede tumbar el insert', () => {
    const n = cuerpoDe(sql, 'relay_notify_news');
    expect(n).toMatch(/realtime\.send\([\s\S]*'envelopes:'\s*\|\|\s*new\.topic,\s*true\)/);
    expect(n).toMatch(/exception\s+when others\s+then/i);
    expect(sql).toMatch(/create trigger envelopes_z_notify\s+after insert on public\.envelopes/i);
    expect(sql).toMatch(/on realtime\.messages for select to authenticated/i);
    expect(sql).not.toMatch(/on realtime\.messages for (insert|all)/i);
  });
  it('account_keys pasa a definer', () => {
    expect(cuerpoDe(sql, 'account_keys')).toMatch(/security definer/i);
  });
  it('las RPC nuevas: sin EXECUTE a public, sí a anon y authenticated (hasta 011b)', () => {
    for (const fn of ['fetch_since', 'publish_envelope']) {
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public`, 'i'));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon, authenticated`, 'i'));
    }
  });
  it('trigger functions y purga sin EXECUTE para nadie (H3: nombra anon)', () => {
    for (const fn of ['relay_enforce_quota', 'relay_notify_news', 'purge_relay_quota']) {
      expect(sql).toMatch(
        new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`, 'i'),
      );
    }
  });
  it('agenda la purga de la cuota de forma idempotente', () => {
    expect(sql).toMatch(/cron\.unschedule\('purge_relay_quota'\)/);
    expect(sql).toMatch(/cron\.schedule\(\s*'purge_relay_quota'/);
  });
  it('refresca PostgREST fuera de la transacción', () => {
    expect(sql.lastIndexOf('notify pgrst')).toBeGreaterThan(sql.lastIndexOf('commit;'));
  });
});
