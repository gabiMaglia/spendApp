import { useAuthStore } from '../authStore';
import { mergeAccounts, purgeMergedScopes, MERGE_GRACE_DAYS, RANURAS_FUSION } from '../accountLink';
import {
  esYo, idCanonico, mismaPersona, misIdentidades, rosterCanonico,
  recargarAlias, sembrarAliasDesdeIndice,
} from '../identityAlias';
import { calculateBalances } from '@/src/algorithms/calculateBalances';
import { simplifyDebts } from '@/src/algorithms/simplifyDebts';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Expense, User } from '@/src/types/models';

/**
 * **T-048 · La misma persona con dos ids.**
 *
 * Al enlazar dos cuentas, `mergeAccounts` trae los datos y **no toca un solo
 * registro**: los gastos de la cuenta absorbida siguen diciendo
 * `createdById: 'apple:…'` y el roster de sus grupos sigue nombrando al dueño
 * por ese id, para siempre (D-6 — reescribirlos invalidaría la firma de T-041 y
 * propagaría el id nuevo a peers que nunca supieron del enlace).
 *
 * Lo que se rompía sin alias, y lo que estos tests fijan:
 *  - los grupos heredados **desaparecían** del dashboard (`memberIds` no
 *    contenía el id activo);
 *  - los saldos aparecían **partidos en dos personas**, y `simplifyDebts` podía
 *    emitirle a alguien una transferencia hacia sí mismo.
 *
 * Los tests 3, 4 y 5 tocan plata y son los que se verificaron en rojo: con la
 * canonicalización revertida, los tres caen.
 */
const VIEJA  = 'apple:000123.abc';
const NUEVA  = 'google:11887766';
const TERCERA = 'apple:999.zzz';
const AJENO  = 'google:beto';

const BUCKETS = ['auth', 'groups', 'expenses', 'payments', 'users', 'recurring', 'comments', 'personal', 'groupkeys', 'notices'] as const;

function entraComo(id: string): void {
  useAuthStore.setState({ currentUser: { id, name: id } as User });
  recargarAlias();
}

function gasto(o: Partial<Expense> & Pick<Expense, 'paidById' | 'amount' | 'splits'>): Expense {
  return {
    id: 'e1', groupId: 'g1', description: 'Asado', currency: 'ARS',
    splitMode: 'equal', category: 'other', date: 0, createdAt: 0,
    createdById: o.paidById, deletionVotes: [], updatedAt: 0, isDeleted: false,
    ...o,
  } as Expense;
}

beforeEach(() => {
  BUCKETS.forEach(b => createSecureStorage(b).clearAll());
  useAuthStore.setState({ currentUser: null });
  recargarAlias();
});

describe('quién soy', () => {
  it('sin alias, sólo el id activo es mío', () => {
    entraComo(NUEVA);
    expect(esYo(NUEVA)).toBe(true);
    expect(esYo(VIEJA)).toBe(false);
    expect(misIdentidades()).toEqual([NUEVA]);
  });

  it('enlazada la cuenta vieja, sus registros pasan a ser míos', () => {
    mergeAccounts(VIEJA, NUEVA);
    entraComo(NUEVA);

    expect(esYo(NUEVA)).toBe(true);
    expect(esYo(VIEJA)).toBe(true);
    expect(esYo(AJENO)).toBe(false);
    expect(misIdentidades().sort()).toEqual([VIEJA, NUEVA].sort());
  });

  it('sin sesión nada es mío: no se adivina de quién son los datos', () => {
    mergeAccounts(VIEJA, NUEVA);
    expect(esYo(VIEJA)).toBe(false);
    expect(misIdentidades()).toEqual([]);
  });

  it('el alias es de ESA cuenta y no se hereda al cambiar de cuenta', () => {
    // La filtración de T-055, en su versión más cara: la segunda cuenta del
    // mismo arranque adueñándose de los registros de la primera.
    mergeAccounts(VIEJA, NUEVA);
    entraComo(NUEVA);
    expect(esYo(VIEJA)).toBe(true);

    entraComo(AJENO);
    expect(esYo(VIEJA)).toBe(false);
  });

  it('es TRANSITIVO: A→B y después B→C deja A visible bajo C', () => {
    mergeAccounts(VIEJA, NUEVA);
    mergeAccounts(NUEVA, TERCERA);
    entraComo(TERCERA);

    expect(esYo(VIEJA)).toBe(true);   // sin heredar los alias del origen, esto es false
    expect(esYo(NUEVA)).toBe(true);
    expect(misIdentidades().sort()).toEqual([VIEJA, NUEVA, TERCERA].sort());
  });

  it('`mismaPersona` no traduce ids ajenos entre sí', () => {
    mergeAccounts(VIEJA, NUEVA);
    entraComo(NUEVA);

    expect(mismaPersona(VIEJA, NUEVA)).toBe(true);
    expect(mismaPersona(AJENO, TERCERA)).toBe(false);   // de los enlaces de otro no sabemos nada
    expect(mismaPersona(AJENO, AJENO)).toBe(true);
  });
});

describe('el roster', () => {
  beforeEach(() => {
    mergeAccounts(VIEJA, NUEVA);
    entraComo(NUEVA);
  });

  it('colapsa mis dos ids en UN miembro', () => {
    // Sin la de-duplicación, `buildSplits` reparte entre dos nodos que son la
    // misma persona, y el quórum para salir de un grupo cuenta un miembro de
    // más: es la forma exacta en que la clase B rompe plata.
    expect(rosterCanonico([VIEJA, NUEVA, AJENO])).toEqual([NUEVA, AJENO]);
  });

  it('no toca a los demás ni cambia el orden de aparición', () => {
    expect(rosterCanonico([AJENO, VIEJA])).toEqual([AJENO, NUEVA]);
  });

  it('`idCanonico` deja intacto todo lo que no es mío', () => {
    expect(idCanonico(VIEJA)).toBe(NUEVA);
    expect(idCanonico(AJENO)).toBe(AJENO);
    expect(idCanonico(TERCERA)).toBe(TERCERA);
  });
});

describe('la plata', () => {
  const roster = [VIEJA, AJENO];

  /** Un asado de $200 que pagué con la identidad vieja, a medias con Beto. */
  const asado = gasto({
    paidById: VIEJA, amount: 20_000,
    splits: [
      { userId: VIEJA, amount: 10_000, isPaid: true },
      { userId: AJENO, amount: 10_000, isPaid: false },
    ],
  });

  it('el saldo del grupo heredado queda a nombre de la identidad ACTIVA', () => {
    mergeAccounts(VIEJA, NUEVA);
    entraComo(NUEVA);

    const balances = calculateBalances([asado], roster);

    expect(balances).toEqual([
      { userId: NUEVA, amount: 10_000 },   // sin alias, esto sale bajo VIEJA y el dashboard no lo encuentra
      { userId: AJENO, amount: -10_000 },
    ]);
  });

  it('un pago hecho con la identidad vieja cancela la deuda de la nueva', () => {
    mergeAccounts(VIEJA, NUEVA);
    entraComo(NUEVA);

    // El mismo gasto, más un gasto propio cargado YA con la identidad nueva.
    const propio = gasto({
      id: 'e2', paidById: AJENO, amount: 4_000,
      splits: [
        { userId: NUEVA, amount: 2_000, isPaid: false },
        { userId: AJENO, amount: 2_000, isPaid: true },
      ],
    });

    const balances = calculateBalances([asado, propio], [VIEJA, NUEVA, AJENO]);
    const mio = balances.filter(b => b.userId === NUEVA);

    // Una sola fila, con los dos gastos sumados: 10.000 − 2.000.
    expect(mio).toEqual([{ userId: NUEVA, amount: 8_000 }]);
  });

  it('NUNCA emite una transferencia de una mitad de la persona a la otra', () => {
    // El fixture es el caso peligroso a propósito: una identidad queda en
    // POSITIVO (puse el asado con la vieja) y la otra en NEGATIVO (debo un
    // gasto cargado con la nueva). Sin canonicalizar, la simplificación ve dos
    // personas con signos opuestos y le manda plata de una a la otra — o sea,
    // la app le pide a alguien que se pague a sí mismo.
    const debo = gasto({
      id: 'e2', paidById: AJENO, amount: 4_000,
      splits: [
        { userId: NUEVA, amount: 2_000, isPaid: false },
        { userId: AJENO, amount: 2_000, isPaid: true },
      ],
    });

    mergeAccounts(VIEJA, NUEVA);
    entraComo(NUEVA);

    const balances = calculateBalances([asado, debo], [VIEJA, NUEVA, AJENO]);
    const txs = simplifyDebts(balances, 'ARS');

    expect(txs.length).toBeGreaterThan(0);
    for (const tx of txs) {
      expect(mismaPersona(tx.fromUserId, tx.toUserId)).toBe(false);
    }
  });
});

/**
 * **La invariante, como propiedad y no como dos ejemplos.**
 *
 * Para todo conjunto de gastos y todo particionamiento de un miembro en dos
 * alias: Σ de los balances se conserva, y no existe transferencia entre dos
 * identidades de la misma persona. Un test de dos casos elegidos a mano no
 * probaría nada acá — es lo que dice el ADR y es plata.
 */
describe('propiedad: partir a una persona en dos ids no crea ni destruye plata', () => {
  /** Generador determinista: un test de plata no puede fallar sólo a veces. */
  function rng(semilla: number): () => number {
    let s = semilla;
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  }

  const GENTE = [AJENO, 'google:caro', 'apple:dani'];

  for (const semilla of [1, 7, 42, 1234, 99991]) {
    it(`se conserva con la semilla ${semilla}`, () => {
      const r = rng(semilla);
      const gastos: Expense[] = [];

      // 12 gastos: cada uno pagado por alguien, repartido entre todos. Los míos
      // salen unas veces con la identidad vieja y otras con la nueva, que es
      // exactamente el estado de quien enlazó cuentas.
      for (let i = 0; i < 12; i++) {
        const yo = r() < 0.5 ? VIEJA : NUEVA;
        const participantes = [yo, ...GENTE];
        const total = 1_000 * (1 + Math.floor(r() * 40)) * participantes.length;
        const parte = total / participantes.length;
        gastos.push(gasto({
          id: `e${i}`,
          paidById: participantes[Math.floor(r() * participantes.length)]!,
          amount: total,
          splits: participantes.map(u => ({ userId: u, amount: parte, isPaid: false })),
        }));
      }

      const conAlias = () => calculateBalances(gastos, [VIEJA, NUEVA, ...GENTE]);

      // (1) Sin enlace: la persona figura como dos, y la suma cierra igual.
      entraComo(NUEVA);
      const partido = conAlias();
      expect(partido.reduce((t, b) => t + b.amount, 0)).toBe(0);

      // (2) Con enlace: un solo nodo, misma suma, mismo total para la persona.
      mergeAccounts(VIEJA, NUEVA);
      entraComo(NUEVA);
      const unido = conAlias();

      expect(unido.reduce((t, b) => t + b.amount, 0)).toBe(0);
      expect(unido.filter(b => b.userId === NUEVA)).toHaveLength(1);
      expect(unido.filter(b => b.userId === VIEJA)).toHaveLength(0);

      // Lo que la persona tiene unida es la suma de sus dos mitades.
      const mitades = partido
        .filter(b => b.userId === VIEJA || b.userId === NUEVA)
        .reduce((t, b) => t + b.amount, 0);
      expect(unido.find(b => b.userId === NUEVA)!.amount).toBe(mitades);

      // Y ninguna transferencia va de la persona hacia sí misma.
      for (const tx of simplifyDebts(unido, 'ARS')) {
        expect(mismaPersona(tx.fromUserId, tx.toUserId)).toBe(false);
      }
    });
  }
});

describe('el alias dura para siempre', () => {
  it('sobrevive a la purga del scope absorbido (31 días)', () => {
    // `acct::merged_scopes` se vacía pasada la gracia. Si el alias se derivara
    // de ahí —como proponía el plan— los grupos heredados volverían a
    // desaparecer un mes después del enlace, sin que nadie tocara nada.
    mergeAccounts(VIEJA, NUEVA);
    createSecureStorage('auth').set('current_user', JSON.stringify({ id: NUEVA }));

    const DIA = 24 * 60 * 60 * 1000;
    purgeMergedScopes(Date.now() + (MERGE_GRACE_DAYS + 1) * DIA);

    entraComo(NUEVA);
    expect(esYo(VIEJA)).toBe(true);
  });

  it('está declarado con `ranura()`, así que la purga de cuenta lo alcanza sola', () => {
    // Criterio 4: sin la ranura habría que acordarse de agregarlo a una lista, y
    // es exactamente así como este proyecto perdió datos tres veces.
    expect(RANURAS_FUSION.map(r => `${r.bucket}/${r.base}`)).toContain('auth/alias_v1');
  });
});

describe('D-6 · ningún registro cambia de bytes', () => {
  it('los ids de los registros heredados son idénticos, campo por campo', () => {
    /**
     * Es la mitad más importante del diseño y la que no se puede deshacer: si
     * la fusión reescribiera `createdById` o `memberIds`, el registro nuevo se
     * propagaría por LWW a teléfonos que nunca supieron del enlace y además
     * invalidaría la firma de T-041 —`createdById` está adentro del núcleo
     * firmado—. La traducción es local y sólo al leer.
     */
    const grupos = [{ id: 'g1', name: 'Asado', memberIds: [VIEJA, AJENO], createdById: VIEJA, updatedAt: 1 }];
    const gastos = [{
      id: 'e1', groupId: 'g1', paidById: VIEJA, createdById: VIEJA, updatedAt: 1,
      splits: [{ userId: VIEJA, amount: 10_000 }, { userId: AJENO, amount: 10_000 }],
    }];
    createSecureStorage('groups').set(`data_v1::u:${VIEJA}`, JSON.stringify(grupos));
    createSecureStorage('expenses').set(`data_v1::u:${VIEJA}`, JSON.stringify(gastos));

    mergeAccounts(VIEJA, NUEVA);
    entraComo(NUEVA);

    const gruposDespues = JSON.parse(createSecureStorage('groups').getString(`data_v1::u:${NUEVA}`)!);
    const gastosDespues = JSON.parse(createSecureStorage('expenses').getString(`data_v1::u:${NUEVA}`)!);

    expect(gruposDespues[0].memberIds).toEqual([VIEJA, AJENO]);
    expect(gruposDespues[0].createdById).toBe(VIEJA);
    expect(gastosDespues[0].paidById).toBe(VIEJA);
    expect(gastosDespues[0].createdById).toBe(VIEJA);
    expect(gastosDespues[0].splits.map((s: { userId: string }) => s.userId)).toEqual([VIEJA, AJENO]);

    // Y byte por byte, que es lo que el criterio pide de verdad.
    expect(createSecureStorage('expenses').getString(`data_v1::u:${NUEVA}`)).toBe(JSON.stringify(gastos));
  });
});

describe('quien enlazó ANTES de que esto existiera', () => {
  it('recupera el alias del índice de identidad', () => {
    // No hay `mergeAccounts` que vaya a correr para esa persona: su fusión ya
    // pasó. El índice sí guarda `acct::p:<vieja> → <nueva>`, y no se purga.
    createSecureStorage('auth').set(`acct::p:${VIEJA}`, NUEVA);
    entraComo(NUEVA);
    expect(esYo(VIEJA)).toBe(false);   // todavía no se sembró

    sembrarAliasDesdeIndice();
    expect(esYo(VIEJA)).toBe(true);
  });

  it('no se adueña de proveedores que apuntan a OTRA cuenta', () => {
    createSecureStorage('auth').set(`acct::p:${VIEJA}`, AJENO);
    entraComo(NUEVA);

    sembrarAliasDesdeIndice();

    expect(esYo(VIEJA)).toBe(false);
  });

  it('no se toma a sí misma como alias', () => {
    createSecureStorage('auth').set(`acct::p:${NUEVA}`, NUEVA);
    entraComo(NUEVA);

    sembrarAliasDesdeIndice();

    expect(misIdentidades()).toEqual([NUEVA]);
  });
});
