import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { mergeByIdLevels, mergeRecord, coreWins } from '../mergeLevels';
import { canonical } from '../lww';
import { verifyCore, signCore } from '@/src/sync/recordSign';
import { toHex } from '@/src/sync/hexBytes';
import { CORE_KINDS, coreFieldsOf, type CoreKind } from '@/src/sync/recordCore';
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

type Registro = Record<string, unknown>;

const sinFirma = (r: Registro): Registro => {
  const copia = { ...r };
  delete copia.k;
  delete copia.s;
  return copia;
};

/** Tres versiones del mismo id que compiten en los tres niveles a la vez. */
function versiones(kind: CoreKind, base: Registro): Registro[] {
  const votos = (t: number) => ({
    deletionVotes: [{ userId: `u${t}`, votedAt: t, action: 'delete' as const }],
  });
  const tieneVotos = 'deletionVotes' in base;

  return [
    { ...sinFirma(base), rev: 100, updatedAt: 10, isDeleted: false,
      ...(tieneVotos ? votos(100) : {}) },
    // Núcleo más nuevo, `updatedAt` más viejo: los dos niveles tiran para
    // lados distintos, que es donde un merge de un solo nivel se equivoca.
    { ...sinFirma(base), rev: 300, updatedAt: 5, isDeleted: false, createdAt: 7,
      ...(tieneVotos ? votos(300) : {}) },
    // Sin `rev`: un peer que no actualizó, compitiendo contra los dos.
    { ...sinFirma(base), updatedAt: 30, isDeleted: true, createdAt: 9,
      ...(tieneVotos ? votos(50) : {}) },
  ];
}

function aplicar(kind: CoreKind, orden: Registro[]): Registro {
  let estado: Registro[] = [];
  for (const v of orden) estado = mergeByIdLevels(kind, estado as never, [v] as never) as never;
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
    const uno = mergeByIdLevels(kind, [] as never, vs as never);
    const dos = mergeByIdLevels(kind, uno, vs as never);
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

      const [out] = mergeByIdLevels(kind, [perdedor] as never, [ganador] as never);
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

    const [out] = mergeByIdLevels(kind, [otro] as never, [conFirma] as never);
    expect(verifyCore(kind, out as never, [PUB])).toBe('valida');
  });
});

describe('coreWins', () => {
  const base = FIXTURES[0]!.record as Registro;

  it('gana el `rev` mayor, aunque llegue con `updatedAt` menor', () => {
    expect(coreWins('expense',
      { ...base, rev: 2, updatedAt: 1 } as never,
      { ...base, rev: 1, updatedAt: 9 } as never)).toBe(true);
  });

  it('`rev` ausente cuenta como 0', () => {
    const sinRev = { ...base };
    delete sinRev.rev;
    expect(coreWins('expense', sinRev as never, { ...base, rev: 1 } as never)).toBe(false);
    expect(coreWins('expense', { ...base, rev: 1 } as never, sinRev as never)).toBe(true);
  });

  it('sin `rev` de los dos lados manda `updatedAt`, como siempre', () => {
    const a: Registro = { ...base, updatedAt: 1 }; delete a.rev;
    const b: Registro = { ...base, updatedAt: 2 }; delete b.rev;
    expect(coreWins('expense', b as never, a as never)).toBe(true);
    expect(coreWins('expense', a as never, b as never)).toBe(false);
  });

  it('empate de `rev`: exactamente uno de los dos sentidos gana', () => {
    const a = { ...base, rev: 7, description: 'aaa' };
    const b = { ...base, rev: 7, description: 'zzz' };
    expect(coreWins('expense', a as never, b as never))
      .not.toBe(coreWins('expense', b as never, a as never));
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

    mergeByIdLevels('expense', locales as never, entrantes as never);
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

  const STORE_DE: Record<string, string> = {
    Expense: 'expenseStore.ts',
    Payment: 'paymentStore.ts',
    ExpenseComment: 'commentStore.ts',
    RecurringExpense: 'recurringStore.ts',
    Group: 'groupStore.ts',
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
    for (const archivo of ['userStore.ts', 'personalStore.ts']) {
      const texto = readFileSync(resolve(__dirname, '..', archivo), 'utf8');
      expect(texto).toContain('mergeByIdLWW');
    }
  });
});

describe('mergeRecord no muta lo que recibe', () => {
  it('el registro local queda como estaba', () => {
    const local = { ...FIXTURES[0]!.record as Registro, rev: 1, updatedAt: 1 };
    const antes = canonical(local);
    mergeRecord('expense', local as never, { ...local, rev: 9, updatedAt: 9 } as never);
    expect(canonical(local)).toBe(antes);
  });
});

/**
 * Los acuses de recibo de un saldado (T-064) son colaborativos: dos personas
 * los escriben en teléfonos distintos y el merge no puede elegir uno.
 */
describe('los acuses de un saldado se unen', () => {
  const pago = (confirmations: unknown[], updatedAt = 1_000) => ({
    id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto',
    amount: 500_000, currency: 'ARS', date: 0, createdAt: 0,
    createdById: 'ana', rev: 1, updatedAt, isDeleted: false,
    confirmations,
  });

  const merge = (a: ReturnType<typeof pago>, b: ReturnType<typeof pago>) =>
    mergeRecord('payment', a as never, b as never) as unknown as
      { confirmations: { userId: string }[] };

  const acuse = (userId: string, confirmedAt: number, action = 'confirm') =>
    ({ userId, confirmedAt, action });

  it('no se pierde el aporte del otro teléfono', () => {
    const unido = merge(pago([acuse('beto', 1_000)]), pago([acuse('caro', 2_000)]));
    expect(unido.confirmations.map(c => c.userId).sort()).toEqual(['beto', 'caro']);
  });

  // El mismo acuse llega por dos caminos: el sobre lo republica cualquiera.
  it('el mismo acuse repetido no se duplica', () => {
    const unido = merge(pago([acuse('beto', 1_000)]), pago([acuse('beto', 1_000)]));
    expect(unido.confirmations).toHaveLength(1);
  });

  // Un `updatedAt` mayor NO puede borrar un acuse: si pudiera, el que paga
  // republica el pago y le vuela el rechazo al que cobra. Es T-053 otra vez.
  it('un registro más nuevo sin acuses no borra los que ya había', () => {
    const local  = pago([acuse('beto', 1_000, 'reject')]);
    const unido  = merge(local, pago([], 9_999));
    expect(unido.confirmations).toHaveLength(1);
  });

  // Sin esto, cada drenado del relay produce un array nuevo por cada pago y con
  // él un re-render y una escritura a disco, cada 20 segundos.
  it('sin cambios devuelve la MISMA referencia', () => {
    const local = pago([acuse('beto', 1_000)]);
    const unido = merge(local, pago([acuse('beto', 1_000)]));
    expect(unido.confirmations).toBe(local.confirmations);
  });
});
