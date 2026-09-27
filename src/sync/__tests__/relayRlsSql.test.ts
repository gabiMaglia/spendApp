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
    for (const t of ['relay_quota', 'relay_quota_daily', 'relay_write_stats', 'relay_quota_config']) {
      const desde = sql.indexOf(`create table if not exists public.${t} (`);
      expect(desde).toBeGreaterThan(-1);
      const def = sql.slice(desde);
      expect(def.slice(0, def.indexOf(');'))).not.toMatch(/\btopic\b/i);
      expect(sql).toMatch(new RegExp(`revoke all on (table )?public\\.${t} from anon, authenticated`, 'i'));
      expect(sql).toMatch(new RegExp(`alter table public\\.${t} enable row level security`, 'i'));
    }
    expect(sql).not.toMatch(/alter table public\.envelopes add column[^;]*(uid|writer|user)/i);
  });
  it('D1: ningún dato de cuota se puede unir con envelopes (sin hora exacta, sin bytes por minuto)', () => {
    for (const t of ['relay_quota', 'relay_quota_daily', 'relay_write_stats', 'relay_quota_config']) {
      const def = sql.slice(sql.indexOf(`create table if not exists public.${t} (`));
      const cuerpo = def.slice(0, def.indexOf(');'));
      expect(cuerpo).not.toMatch(/default\s+now\(\)/i); // now() del insert == envelopes.created_at
    }
    expect(sql).not.toMatch(/create table if not exists public\.relay_quota_would_reject/i);
    const q = cuerpoDe(sql, 'relay_enforce_quota');
    expect(q).toMatch(/values \(v_uid, 'm', date_trunc\('minute', now\(\)\), 1, 0\)/); // minuto: sólo cuenta
    expect(q).toMatch(/random\(\)/); // bytes por hora con relleno: no calza con la suma de un topic
    expect(q).not.toMatch(/relay_quota_would_reject/);
  });
  it('D1: la purga deja sólo las ventanas vivas y corre seguido', () => {
    const p = cuerpoDe(sql, 'purge_relay_quota');
    expect(p).toMatch(/granularity = 'm' and bucket < date_trunc\('minute', now\(\)\)/);
    expect(p).toMatch(/granularity = 'h' and bucket < date_trunc\('hour', now\(\)\)/);
    expect(sql).toMatch(/cron\.schedule\(\s*'purge_relay_quota',\s*'\*\/5 \* \* \* \*'/);
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
  it('insert directo limitado a las columnas del cliente: seq/created_at/expires_at los pone el servidor', () => {
    expect(sql).toMatch(/revoke insert on public\.envelopes from anon, authenticated/i);
    expect(sql).toMatch(
      /grant insert \(topic, payload, sender, compactable, owner_proof, ckey\) on public\.envelopes to anon, authenticated/i,
    );
    expect(sql).not.toMatch(/grant insert on public\.envelopes/i);
  });
  it('agenda la purga de la cuota de forma idempotente', () => {
    expect(sql).toMatch(/cron\.unschedule\('purge_relay_quota'\)/);
    expect(sql).toMatch(/cron\.schedule\(\s*'purge_relay_quota'/);
  });
  it('refresca PostgREST fuera de la transacción', () => {
    expect(sql.lastIndexOf('notify pgrst')).toBeGreaterThan(sql.lastIndexOf('commit;'));
  });
});

describe('011b · corte', () => {
  const sql = sin(leer('011b_relay_rls_corte.sql'));
  const crudo = leer('011b_relay_rls_corte.sql');

  it('avisa que no va junto con 011a y copia la condición medida', () => {
    expect(crudo).toMatch(/NO CORRER JUNTO CON 011a/);
    expect(crudo).toMatch(/relay_write_stats where role = 'anon'/);
    expect(crudo).toMatch(/pg_stat_statements/);
  });
  it('saca la lectura directa de los dos lados (I1)', () => {
    expect(sql).toMatch(/drop policy if exists envelopes_read on public\.envelopes/i);
    expect(sql).toMatch(/drop policy if exists device_keys_read on public\.device_keys/i);
    expect(sql).not.toMatch(/create policy envelopes_read/i);
    expect(sql).not.toMatch(/create policy device_keys_read/i);
  });
  it('D2: nadie inserta directo — la escritura es sólo por publish_envelope', () => {
    expect(sql).toMatch(/drop policy if exists envelopes_write on public\.envelopes/i);
    expect(sql).not.toMatch(/create policy envelopes_write/i);
    expect(sql).toMatch(/revoke all on public\.envelopes from anon, authenticated/i);
  });
  it('anon pierde los grants directos de tabla', () => {
    expect(sql).toMatch(/revoke select on public\.device_keys from anon/i);
  });
  it('las RPC del buzón pierden anon (H3: nombra anon, no sólo public)', () => {
    for (const fn of ['fetch_since', 'publish_envelope', 'account_keys', 'delete_my_envelopes']) {
      expect(sql).toMatch(new RegExp(`revoke execute on function[\\s\\S]*public\\.${fn}\\([\\s\\S]*from public, anon`, 'i'));
      expect(sql).toMatch(new RegExp(`grant execute on function[\\s\\S]*public\\.${fn}\\([\\s\\S]*to authenticated`, 'i'));
    }
  });
  it('higiene D7/P6: purga y funciones de trigger sin EXECUTE para nadie', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.purge_expired_envelopes\(\), public\.compact_envelopes\(\), public\.stamp_owner_tag\(\)\s+from public, anon, authenticated/i,
    );
  });
  it('fuera de postgres_changes (P4) y cuota rechazando con retención corta (H5)', () => {
    expect(sql).toMatch(/alter publication supabase_realtime drop table public\.envelopes/i);
    expect(sql).toMatch(/set enforce = true, retention = interval '2 hours'/i);
  });
  it('transaccional y refresca PostgREST después', () => {
    expect(sql).toMatch(/^\s*begin;/m);
    expect(sql.lastIndexOf('notify pgrst')).toBeGreaterThan(sql.lastIndexOf('commit;'));
  });
});

describe('011b · rollback', () => {
  const sql = sin(leer('011b_rollback.sql'));
  it('devuelve las tres policies y la publicación', () => {
    expect(sql).toMatch(/create policy envelopes_read[\s\S]*to anon, authenticated[\s\S]*using \(true\)/i);
    expect(sql).toMatch(/create policy envelopes_write[\s\S]*to anon, authenticated/i);
    expect(sql).toMatch(/create policy device_keys_read/i);
    expect(sql).toMatch(/alter publication supabase_realtime add table public\.envelopes/i);
  });
  it('devuelve los grants de anon', () => {
    expect(sql).toMatch(/grant select on public\.envelopes to anon, authenticated/i);
    // Vuelve al estado de 011a, no al de antes: el insert sigue limitado a las columnas del cliente.
    expect(sql).toMatch(
      /grant insert \(topic, payload, sender, compactable, owner_proof, ckey\) on public\.envelopes to anon, authenticated/i,
    );
    expect(sql).not.toMatch(/grant (select, )?insert on public\.envelopes/i);
    expect(sql).toMatch(/grant select on public\.device_keys to anon/i);
    for (const fn of ['fetch_since', 'publish_envelope', 'account_keys', 'delete_my_envelopes']) {
      expect(sql).toMatch(new RegExp(`grant execute on function[\\s\\S]*public\\.${fn}\\([\\s\\S]*to anon`, 'i'));
    }
  });
  it('no toca la cuota (la decide el PO aparte)', () => {
    expect(sql).not.toMatch(/relay_quota_config/i);
  });
});
