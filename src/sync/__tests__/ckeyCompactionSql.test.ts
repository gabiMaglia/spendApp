import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(__dirname, '../../../supabase/010_ckey_compaction.sql'), 'utf8');

function cuerpoDe(sql: string, fnName: string): string {
  const start = sql.indexOf(`function public.${fnName}(`);
  if (start === -1) throw new Error(`no se encontró ${fnName}`);
  const end = sql.indexOf('$$;', start);
  return sql.slice(start, end);
}

describe('010_ckey_compaction.sql', () => {
  it('agrega la columna ckey como nullable, sin default', () => {
    expect(sql).toMatch(/alter table public\.envelopes\s+add column if not exists ckey text;/);
  });

  it('compact_envelopes reemplazado incluye ckey en el predicado con prenda', () => {
    const cuerpo = cuerpoDe(sql, 'compact_envelopes');
    expect(cuerpo).toMatch(/and\s+ckey\s+is\s+not\s+distinct\s+from\s+new\.ckey/);
  });

  it('la rama sin prenda de 009 no se toca (no hay owner_tag is null en este archivo)', () => {
    // 009 ya cerró esa rama; esta migración no la reabre.
    expect(sql).not.toMatch(/owner_tag is null/);
  });

  it('agrega un índice que incluye ckey', () => {
    expect(sql).toMatch(/create index if not exists envelopes_owner_ckey_idx/);
    expect(sql).toMatch(/\(topic, owner_tag, ckey, seq\)/);
  });

  it('no borra ni reescribe filas existentes (sin DELETE ni UPDATE fuera de una función)', () => {
    const fueraDeFunciones = sql
      .split(/create or replace function/i)[0]; // todo lo anterior a la primera función
    expect(fueraDeFunciones).not.toMatch(/\bdelete\s+from\b/i);
    expect(fueraDeFunciones).not.toMatch(/\bupdate\s+public\.envelopes\b/i);
  });

  it('recarga el cache de esquema de PostgREST al final', () => {
    expect(sql.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
