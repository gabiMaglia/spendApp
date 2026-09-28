import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { mergeByIdLevels, mergeRecord, coreWins } from '../mergeLevels';
import { canonical } from '../lww';
import { verifyCore, signCore } from '@/src/sync/confianza/recordSign';
import { toHex } from '@/src/sync/nucleo/hexBytes';
import { CORE_KINDS, coreFieldsOf, type CoreKind } from '@/src/sync/confianza/recordCore';
import { FIXTURES } from '@/src/test-utils/recordFixtures';

/**
 * `ed25519` viene congelado, así que el espía va en el módulo. Se delega en el
 * real —no se simula la verificación— para que el resto del archivo siga
 * firmando y verificando de verdad.
 */
jest.mock('@noble/curves/ed25519.js', () => {
  const real = jest.requireActual('@noble/curves/ed25519.js');
  return {
    ...real,
    ed25519: {
      ...real.ed25519,
      verify: jest.fn((...args: unknown[]) => real.ed25519.verify(...args)),
    },
  };
});

/**
 * **Convergencia y costo del merge por niveles** (T-041 · S7).
 *
 * Dos dispositivos que reciben lo mismo en distinto orden tienen que terminar
 * IGUALES. No es una propiedad deseable: es la única que impide que un balance
 * valga distinto en dos teléfonos sin que nadie se entere. Por eso se prueba
 * con órdenes distintos y no se asume.
 */

const PRIV = toHex(new Uint8Array(32).fill(5));
const PUB  = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(5)));
// Mayor que cualquier `updatedAt` de los fixtures de este archivo (~5 000 o ~1.7e12).
const NOW = 1_800_000_000_000;

type Registro = Record<string, unknown>;

const sinFirma = (r: Registro): Registro => {
  const copia = { ...r };
  delete copia.k;
  delete copia.s;
  return copia;
};

/** Tres versiones del mismo id que compiten en los tres niveles a la vez. */
function versiones(_kind: CoreKind, base: Registro): Registro[] {
  return [
    { ...sinFirma(base), rev: 100, updatedAt: 10, isDeleted: false },
    // Núcleo más nuevo, `updatedAt` más viejo: los dos niveles tiran para
    // lados distintos, que es donde un merge de un solo nivel se equivoca.
    { ...sinFirma(base), rev: 300, updatedAt: 5, isDeleted: false, createdAt: 7 },
    // Sin `rev`: un peer que no actualizó, compitiendo contra los dos.
    { ...sinFirma(base), updatedAt: 30, isDeleted: true, createdAt: 9 },
  ];
}

function aplicar(kind: CoreKind, orden: Registro[]): Registro {
  let estado: Registro[] = [];
  for (const v of orden) estado = mergeByIdLevels(kind, estado as never, [v] as never, NOW) as never;
  return estado[0]!;
}

function permutaciones<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) =>
    permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)]).map(resto => [x, ...resto]),
  );
}

describe.each(FIXTURES)('$kind — convergencia', ({ kind, record }) => {
  const vs = versiones(kind, record as Registro);

  it('los 6 órdenes de llegada terminan en el MISMO registro', () => {
    const resultados = permutaciones(vs).map(orden => canonical(aplicar(kind, orden)));
    expect(new Set(resultados).size).toBe(1);
  });

  it('volver a mergear lo mismo no cambia nada, y ni siquiera crea un objeto nuevo', () => {
    const uno = mergeByIdLevels(kind, [] as never, vs as never, NOW);
    const dos = mergeByIdLevels(kind, uno, vs as never, NOW);
    expect(canonical(dos[0]!)).toEqual(canonical(uno[0]!));
    // Identidad, no sólo igualdad: el sobre trae el estado completo del grupo
    // cada 20 s y un objeto nuevo por registro es un re-render y una escritura
    // a disco de todo, cada vuelta.
    expect(dos[0]).toBe(uno[0]);
  });

  /**
   * El hueco que encontró la mutación M3: copiar los campos del ganador **sin
   * borrar los que no tiene** deja pasar los del perdedor. Es el caso de un
   * autor que SACA un dato —una nota, un desglose de pagadores— y de un peer que
   * todavía tiene la versión con él: el registro resultante ya no es el que se
   * firmó, y la firma que viaja al lado pasa a leerse `invalida`. Acusaríamos al
   * autor honesto de una mezcla que hicimos nosotros.
   */
  it.each(coreFieldsOf(kind).filter(c => c !== 'id' && c !== 'rev'))(
    'un `%s` que el autor SACÓ no vuelve del perdedor', (campo) => {
      const base: Registro = { ...sinFirma(record as Registro), rev: 500, updatedAt: 1 };
      delete base[campo];
      const ganador = { ...base, ...signCore(kind, base as never, PRIV) };
      // El perdedor sí lo tiene, y encima gana el `updatedAt`.
      const perdedor = { ...sinFirma(record as Registro), rev: 10, updatedAt: 9_999 };

      const [out] = mergeByIdLevels(kind, [perdedor] as never, [ganador] as never, NOW);
      expect((out as unknown as Registro)[campo]).toBeUndefined();
      expect(verifyCore(kind, out as never, [PUB])).toBe('valida');
    });

  it('el ganador del núcleo se lleva su firma entera', () => {
    const firmado = { ...sinFirma(record as Registro), rev: 500, updatedAt: 1 };
    const conFirma = { ...firmado, ...signCore(kind, firmado as never, PRIV) };
    // El perdedor tiene el `updatedAt` mayor y un núcleo distinto: si algún
    // campo suyo se colara, la firma del ganador dejaría de verificar y
    // acusaríamos al autor honesto de una mezcla que hicimos nosotros.
    const otro = { ...sinFirma(record as Registro), rev: 10, updatedAt: 9_999, createdAt: 123 };

    const [out] = mergeByIdLevels(kind, [otro] as never, [conFirma] as never, NOW);
    expect(verifyCore(kind, out as never, [PUB])).toBe('valida');
  });
});

describe('coreWins', () => {
  const base = FIXTURES[0]!.record as Registro;

  it('gana el `rev` mayor, aunque llegue con `updatedAt` menor', () => {
    expect(coreWins('expense',
      { ...base, rev: 2, updatedAt: 1 } as never,
      { ...base, rev: 1, updatedAt: 9 } as never, NOW)).toBe(true);
  });

  it('`rev` ausente cuenta como 0', () => {
    const sinRev = { ...base };
    delete sinRev.rev;
    expect(coreWins('expense', sinRev as never, { ...base, rev: 1 } as never, NOW)).toBe(false);
    expect(coreWins('expense', { ...base, rev: 1 } as never, sinRev as never, NOW)).toBe(true);
  });

  it('sin `rev` de los dos lados manda `updatedAt`, como siempre', () => {
    const a: Registro = { ...base, updatedAt: 1 }; delete a.rev;
    const b: Registro = { ...base, updatedAt: 2 }; delete b.rev;
    expect(coreWins('expense', b as never, a as never, NOW)).toBe(true);
    expect(coreWins('expense', a as never, b as never, NOW)).toBe(false);
  });

  it('empate de `rev`: exactamente uno de los dos sentidos gana', () => {
    const a = { ...base, rev: 7, description: 'aaa' };
    const b = { ...base, rev: 7, description: 'zzz' };
    expect(coreWins('expense', a as never, b as never, NOW))
      .not.toBe(coreWins('expense', b as never, a as never, NOW));
  });
});

describe('el merge NO toca la curva (D9)', () => {
  const gastoFirmado = () => {
    const base = { ...sinFirma(FIXTURES[0]!.record as Registro), rev: 10, updatedAt: 10 };
    return { ...base, ...signCore('expense', base as never, PRIV) };
  };

  it('mergear 200 registros firmados no llama a `ed25519.verify` ni una vez', () => {
    const espia = ed25519.verify as unknown as jest.Mock;
    espia.mockClear();

    const locales = Array.from({ length: 200 }, (_, i) => ({ ...gastoFirmado(), id: `e${i}` }));
    const entrantes = locales.map(r => ({ ...r, rev: 20, updatedAt: 20 }));

    mergeByIdLevels('expense', locales as never, entrantes as never, NOW);
    expect(espia).not.toHaveBeenCalled();

    // Y el espía SÍ ve la curva cuando alguien la usa de verdad: sin esto, el
    // cero de arriba también valdría con el espía mal puesto.
    expect(verifyCore('expense', gastoFirmado() as never, [PUB])).toBe('valida');
    expect(espia).toHaveBeenCalled();
  });

  /**
   * El espía cubre este camino; el grafo de imports cubre el de mañana. A 37
   * ms/op medidos en el teléfono del PO, un `verifyCore` que se cuele acá son
   * ~19 s de hilo bloqueado por sobre de 500 registros, cada 20 segundos.
   */
  it('el módulo del merge no importa, ni de rebote, nada que verifique', () => {
    const raiz = resolve(__dirname, '../mergeLevels.ts');
    const vistos = new Set<string>();
    const prohibidos: string[] = [];

    const recorrer = (archivo: string) => {
      if (vistos.has(archivo)) return;
      vistos.add(archivo);
      const texto = readFileSync(archivo, 'utf8');

      for (const m of texto.matchAll(/from '([^']+)'/g)) {
        const spec = m[1]!;
        if (/@noble|recordSign|verdictCache/.test(spec)) prohibidos.push(`${archivo} → ${spec}`);
        if (!spec.startsWith('.') && !spec.startsWith('@/')) continue;

        const destino = spec.startsWith('@/')
          ? resolve(__dirname, '../../..', spec.slice(2))
          : join(dirname(archivo), spec);
        const real = [`${destino}.ts`, `${destino}.tsx`, join(destino, 'index.ts')]
          .find(existsSync);
        if (real) recorrer(real);
      }
    };
    recorrer(raiz);

    expect(vistos.size).toBeGreaterThan(3); // el recorrido caminó de verdad
    expect(prohibidos).toEqual([]);
  });
});

/**
 * El guard que evita que esto se olvide: una entidad con núcleo firmable cuyo
 * store siga en el LWW liso pierde la protección de `rev` EN SILENCIO — no hay
 * error, no hay test roto, sólo un merge que vuelve a dejar ganar al que
 * re-estampa `updatedAt`.
 *
 * Se enumera desde `models.ts`, no desde una lista escrita a mano: una entidad
 * nueva entra sola.
 */
describe('guard: quién usa qué merge', () => {
  const modelos = readFileSync(resolve(__dirname, '../../types/models.ts'), 'utf8');
  const conNucleo = [...modelos.matchAll(/export interface (\w+) extends [^{]*CoreSigned/g)]
    .map(m => m[1]!);

  // T-149: `Expense` y `Group` extrajeron su merge puro a un módulo propio
  // (`mergeExpensesPure.ts`/`mergeGroupsPure.ts`) para que `accountLink`
  // pueda reutilizarlo sin arrastrar `relayEngine` (ver el docblock de esos
  // archivos). El store sigue llamando a esa MISMA función — el guard mira el
  // módulo donde vive la llamada real, no el store en sí.
  const STORE_DE: Record<string, string> = {
    Expense: 'mergeExpensesPure.ts',
    Payment: 'paymentStore.ts',
    ExpenseComment: 'commentStore.ts',
    RecurringExpense: 'recurringStore.ts',
    Group: 'mergeGroupsPure.ts',
  };

  it('las entidades firmables son las cinco que el plan enumera', () => {
    expect(conNucleo.sort()).toEqual(CORE_KINDS.length === 5
      ? ['Expense', 'ExpenseComment', 'Group', 'Payment', 'RecurringExpense']
      : []);
  });

  it.each(conNucleo)('el store de %s mergea por niveles', (entidad) => {
    const archivo = STORE_DE[entidad];
    expect(archivo).toBeDefined(); // entidad firmable nueva sin store mapeado
    const texto = readFileSync(resolve(__dirname, '..', archivo!), 'utf8');

    expect(texto).toContain('mergeByIdLevels');
    expect(texto).not.toContain('mergeByIdLWW');
  });

  it('los que NO tienen núcleo siguen con el LWW liso', () => {
    // T-149: la llamada vive en `mergePersonalPure.ts`, que `personalStore.ts`
    // importa — misma razón que Expense/Group arriba.
    const personal = readFileSync(resolve(__dirname, '..', 'mergePersonalPure.ts'), 'utf8');
    expect(personal).toContain('mergeByIdLWW');

    // userStore.ts (T-137, ADR-012): sigue en la familia LWW lisa — nunca pasa
    // a `mergeByIdLevels` — pero ya no llama al genérico `mergeByIdLWW`
    // directo: usa `mergeUsersLWW`, que le agrega el tope de reloj
    // (`TOLERANCIA_RELOJ_MS`) y por abajo sigue desempatando con
    // `incomingWins` de `lww.ts`. T-149 movió la llamada a `mergeUsersPure.ts`,
    // que `userStore.ts` importa — misma razón que arriba.
    const user = readFileSync(resolve(__dirname, '..', 'mergeUsersPure.ts'), 'utf8');
    expect(user).toContain('mergeUsersLWW');
    expect(user).not.toContain('mergeByIdLevels');
  });
});

describe('mergeRecord no muta lo que recibe', () => {
  it('el registro local queda como estaba', () => {
    const local = { ...FIXTURES[0]!.record as Registro, rev: 1, updatedAt: 1 };
    const antes = canonical(local);
    mergeRecord('expense', local as never, { ...local, rev: 9, updatedAt: 9 } as never, NOW);
    expect(canonical(local)).toBe(antes);
  });
});
