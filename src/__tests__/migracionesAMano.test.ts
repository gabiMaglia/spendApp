import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Las migraciones de `supabase/` **las pega una persona a mano** en el editor
 * del proyecto: no hay `supabase db push` en este repo ni un runner que lleve
 * la cuenta de cuáles corrieron. La única red contra correr una dos veces —o
 * contra dudar de si se corrió— es que sean idempotentes.
 *
 * Este guard fija esa propiedad como regla del repo en vez de dejarla en la
 * memoria de quien escribe la próxima.
 */

const SUPABASE = join(__dirname, '..', '..', 'supabase');
const MIGRACIONES = readdirSync(SUPABASE).filter(f => f.endsWith('.sql')).sort();

describe('las migraciones se pueden correr dos veces', () => {
  it('hay migraciones para revisar', () => {
    // Si el directorio se moviera, los casos de abajo pasarían en vacío.
    expect(MIGRACIONES.length).toBeGreaterThan(0);
  });

  it.each(MIGRACIONES)('%s', (archivo) => {
    const sql = readFileSync(join(SUPABASE, archivo), 'utf8');
    const ofensas: string[] = [];

    for (const m of sql.matchAll(/create index (?!if not exists)/gi)) {
      ofensas.push(`create index sin "if not exists" (offset ${m.index})`);
    }
    for (const m of sql.matchAll(/add column (?!if not exists)/gi)) {
      ofensas.push(`add column sin "if not exists" (offset ${m.index})`);
    }
    // Los triggers y los constraints no tienen `if not exists`: la forma
    // idempotente es tirarlos primero.
    for (const m of sql.matchAll(/create trigger (\w+)/gi)) {
      if (!new RegExp(`drop trigger if exists ${m[1]}`, 'i').test(sql)) {
        ofensas.push(`create trigger ${m[1]} sin su "drop ... if exists"`);
      }
    }
    for (const m of sql.matchAll(/add constraint (\w+)/gi)) {
      if (!new RegExp(`drop constraint if exists ${m[1]}`, 'i').test(sql)) {
        ofensas.push(`add constraint ${m[1]} sin su "drop ... if exists"`);
      }
    }

    expect(ofensas).toEqual([]);
  });
});
