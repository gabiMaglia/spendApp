import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * T-087. La migración de la prenda de escritura la pega una persona a mano en
 * el editor de Supabase, y no hay Postgres en el pipeline de tests: montar uno
 * para esto sería infraestructura que nadie pidió.
 *
 * Lo que sí se puede sostener desde acá es que **el archivo que se va a pegar
 * dice lo que la spec dice**. Cada caso de abajo corresponde a una propiedad de
 * seguridad concreta que, si se pierde en una edición, deja el defecto de T-086
 * abierto sin que nada más lo note.
 *
 * Lo que NO prueba: que Postgres se comporte como esperamos. Eso se verifica a
 * mano con la prueba funcional de `engram/plans/T-087.md` §7.
 */

const RAIZ = join(__dirname, '..', '..', '..');
const sql008 = readFileSync(join(RAIZ, 'supabase', '008_owner_tag.sql'), 'utf8');
const sql009 = readFileSync(join(RAIZ, 'supabase', '009_owner_tag_only.sql'), 'utf8');

/** El cuerpo de una función plpgsql: lo que hay entre los dos `$$`. */
function cuerpoDe(sql: string, nombre: string): string {
  const desde = sql.indexOf(`function public.${nombre}(`);
  expect(desde).toBeGreaterThan(-1);
  const abre = sql.indexOf('as $$', desde);
  const cierra = sql.indexOf('$$;', abre);
  expect(abre).toBeGreaterThan(-1);
  expect(cierra).toBeGreaterThan(abre);
  return sql.slice(abre, cierra);
}

describe('008 · la migración de la prenda', () => {
  it('define las tres piezas, y el sello ANTES de la compactación', () => {
    const sello = sql008.indexOf('function public.stamp_owner_tag(');
    const before = sql008.indexOf('before insert on public.envelopes');
    const compact = sql008.indexOf('function public.compact_envelopes(');
    const borrado = sql008.indexOf('function public.delete_my_envelopes(');

    expect(sello).toBeGreaterThan(-1);
    expect(before).toBeGreaterThan(sello);
    expect(compact).toBeGreaterThan(before);
    expect(borrado).toBeGreaterThan(compact);
  });

  it('el sello anula `owner_proof` SIEMPRE, fuera de todo `if`', () => {
    // Si esa línea quedara dentro de una rama, un INSERT con un proof inválido
    // persistiría el valor de tránsito y saldría por Realtime (ADR-009 §7.3).
    const cuerpo = cuerpoDe(sql008, 'stamp_owner_tag');
    const finDelIf = cuerpo.indexOf('end if;');
    const anula = cuerpo.indexOf('new.owner_proof := null');
    expect(finDelIf).toBeGreaterThan(-1);
    expect(anula).toBeGreaterThan(finDelIf);
  });

  it('el sello PISA la tag que venga del cliente en vez de copiarla', () => {
    // La restricción dura de ADR-009 §3.2: si el cliente pudiera elegir la tag,
    // copiaría la ajena y no arreglaríamos nada.
    const cuerpo = cuerpoDe(sql008, 'stamp_owner_tag');
    expect(cuerpo).toContain('new.owner_tag := null');
    expect(cuerpo).toMatch(/new\.owner_tag\s*:=\s*encode\(digest\(new\.owner_proof/);
  });

  it('la compactación conserva `and compactable` en las DOS ramas', () => {
    // Es el guard de la distinción estado/mensaje: los sobres de contacto e
    // invitación viajan con `compactable = false` y no se tocan.
    const cuerpo = cuerpoDe(sql008, 'compact_envelopes');
    expect(cuerpo.match(/and compactable/g)).toHaveLength(2);
  });

  it('la compactación NO usa `is not distinct from`', () => {
    // `null is not distinct from null` es TRUE: dos clientes viejos distintos
    // se borrarían entre sí, que es PEOR que hoy. Desvío 1 de T-087 §2.
    const cuerpo = cuerpoDe(sql008, 'compact_envelopes');
    expect(cuerpo).not.toContain('is not distinct from');
    expect(cuerpo).toContain('and sender = new.sender');
  });

  it('el borrado exige el preimagen: dos hashes, no uno', () => {
    // Lo que viaja en cada INSERT es sha256(secreto). Si acá hubiera un solo
    // digest, el valor de alta frecuencia SERÍA el credencial de borrado.
    const cuerpo = cuerpoDe(sql008, 'delete_my_envelopes');
    expect(cuerpo.match(/digest\(/g)).toHaveLength(2);
    expect(cuerpo).toContain('p_secret');
  });

  it('no se agrega ninguna política de DELETE', () => {
    // La única vía de borrado es la función. La RLS sigue negando el resto.
    expect(sql008.toLowerCase()).not.toMatch(/create policy[\s\S]{0,120}for delete/);
  });

  it('las funciones que hashean encuentran a pgcrypto esté donde esté', () => {
    // `001_mailbox.sql` crea la extensión sin schema; en Supabase suele quedar
    // en `extensions`. Sin esto, `digest()` no resuelve y el trigger revienta
    // en CADA insert.
    for (const nombre of ['stamp_owner_tag', 'delete_my_envelopes']) {
      const desde = sql008.indexOf(`function public.${nombre}(`);
      const cabecera = sql008.slice(desde, sql008.indexOf('as $$', desde));
      expect(cabecera).toContain('search_path = public, extensions');
    }
  });

  it('avisa a PostgREST que recargue el esquema', () => {
    // Sin esto el cliente nuevo puede recibir «could not find the column» y el
    // grupo deja de sincronizar hasta que alguien recuerde recargar.
    expect(sql008).toContain("notify pgrst, 'reload schema'");
  });
});

describe('009 · el cierre de la rama sin prenda', () => {
  it('sin prenda ya no se compacta nada', () => {
    const cuerpo = cuerpoDe(sql009, 'compact_envelopes');
    expect(cuerpo).toContain('new.owner_tag is not null');
    expect(cuerpo).not.toContain('sender = new.sender');
  });

  it('viene marcada para no correrse junto con 008', () => {
    // Correrla el mismo día rompe a todo cliente que no actualizó todavía.
    expect(sql009).toContain('NO CORRER JUNTO CON 008');
  });
});
