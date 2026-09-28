import { ed25519 } from '@noble/curves/ed25519.js';
import { signCore, verifyCore } from '@/src/sync/confianza/recordSign';
import { toHex } from '@/src/sync/nucleo/hexBytes';
import { useExpenseStore } from '../expenseStore';
import { usePaymentStore } from '../paymentStore';
import { useCommentStore } from '../commentStore';
import { useRecurringStore } from '../recurringStore';
import { useGroupStore } from '../groupStore';
import { useUserStore } from '../userStore';
import type { Expense, Payment, User } from '@/src/types/models';

/**
 * **El merge por niveles, visto desde donde entra el dato** (T-041 · S7).
 *
 * Estos casos no llaman a la función del merge: llaman al `mergeX` de cada
 * store, que es por donde pasa TODO lo que llega del relay, del QR y del
 * pairing (`applyDelta`). Un test contra la función suelta puede quedar verde
 * mientras el store llama a otra cosa.
 *
 * El agujero que cierra S7, en una línea: hoy `updatedAt` decide QUIÉN escribió
 * el núcleo, y `updatedAt` lo escribe cualquiera. Un tercero toma un núcleo
 * firmado válido, le pone `updatedAt: Date.now()` y le gana al merge con datos
 * viejos — sin falsificar ninguna firma, así que ninguna verificación lo ve.
 */

jest.mock('@/src/sync/motor/relayEngine', () => ({
  schedulePublish: jest.fn(),
  deviceId: () => 'dev',
}));

const PRIV = toHex(new Uint8Array(32).fill(9));
const PUB  = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(9)));

function firmado<T extends object>(kind: 'expense' | 'payment', record: T): T {
  return { ...record, ...signCore(kind, record as never, PRIV) };
}

function gasto(over: Partial<Expense> = {}): Expense {
  return {
    id: 'e1', groupId: 'g1', description: 'Cena', amount: 20_000, currency: 'ARS',
    paidById: 'ana', splits: [
      { userId: 'ana', amount: 10_000, isPaid: false },
      { userId: 'beto', amount: 10_000, isPaid: false },
    ],
    splitMode: 'equal', category: 'food', date: 1_000, createdAt: 1_000,
    createdById: 'ana', updatedAt: 1_000, isDeleted: false,
    ...over,
  } as Expense;
}

const soloGasto = () => useExpenseStore.getState().expenses[0]!;

beforeEach(() => {
  useExpenseStore.setState({ expenses: [], isLoading: false });
  usePaymentStore.setState({ payments: [], isLoading: false });
  useCommentStore.setState({ comments: [], isLoading: false });
  useRecurringStore.setState({ recurring: [], isLoading: false });
  useGroupStore.setState({ groups: [], isLoading: false });
  useUserStore.setState({ users: [] });
});

describe('el ataque que motiva `rev`: re-estampar un núcleo viejo', () => {
  // La versión vieja del autor, firmada por él. Es legítima: la firma es de
  // verdad, por eso verificarla no detecta nada.
  const vieja = firmado('expense', gasto({
    description: 'Cena', amount: 12_000, rev: 2_000, updatedAt: 2_000,
  }));
  // La versión nueva, firmada por el mismo autor.
  const nueva = firmado('expense', gasto({
    description: 'Cena y postre', amount: 20_000, rev: 3_000, updatedAt: 3_000,
  }));

  it('el re-estampado NO gana: el núcleo que queda es el de `rev` mayor', () => {
    useExpenseStore.setState({ expenses: [nueva] });
    // El atacante no toca el núcleo (no puede: rompería la firma). Toca lo que
    // está afuera y es libre para cualquiera.
    useExpenseStore.getState().mergeExpenses([{ ...vieja, updatedAt: 9_999_999 }]);

    expect(soloGasto().amount).toBe(20_000);
    expect(soloGasto().description).toBe('Cena y postre');
    expect(soloGasto().rev).toBe(3_000);
  });

  it('la firma que queda es la del núcleo que ganó, y sigue verificando', () => {
    useExpenseStore.setState({ expenses: [nueva] });
    useExpenseStore.getState().mergeExpenses([{ ...vieja, updatedAt: 9_999_999 }]);

    expect(verifyCore('expense', soloGasto(), [PUB])).toBe('valida');
  });

  it('`updatedAt` NO pierde su trabajo: sigue siendo el mayor de los dos', () => {
    useExpenseStore.setState({ expenses: [nueva] });
    useExpenseStore.getState().mergeExpenses([{ ...vieja, updatedAt: 9_999_999 }]);

    // S7 le saca a `updatedAt` decidir la autoría del núcleo, NO su otro
    // trabajo: orden de escritura y delta (reglas #4 y #8).
    expect(soloGasto().updatedAt).toBe(9_999_999);
  });

  it('en el sentido contrario tampoco: la versión nueva entra aunque llegue con `updatedAt` menor', () => {
    useExpenseStore.setState({ expenses: [{ ...vieja, updatedAt: 9_999_999 }] });
    useExpenseStore.getState().mergeExpenses([nueva]);

    expect(soloGasto().amount).toBe(20_000);
    expect(soloGasto().updatedAt).toBe(9_999_999);
  });
});

describe('una disputa de autoría de un tercero no pisa el núcleo del autor', () => {
  // `autoriaDisputada` (T-170) es el campo colaborativo que le queda a
  // `Expense`: un aporte de un tercero que la unión no puede perder aunque su
  // lado no gane el núcleo por `rev`.
  const nucleoCompetidor = {
    id: 'e1', groupId: 'g1', description: 'Cena', amount: 1, currency: 'ARS' as const,
    paidById: 'beto', payers: [], splits: [], splitMode: 'equal' as const, category: 'food' as const,
    date: 0, createdAt: 0, createdById: 'beto', note: '', rev: 1, k: 'aa'.repeat(32), s: 'bb'.repeat(64),
  };

  it('la disputa entra y el núcleo nuevo del autor se queda', () => {
    const nueva = firmado('expense', gasto({ amount: 20_000, rev: 3_000, updatedAt: 3_000 }));
    // Beto tiene la versión VIEJA y trae una disputa: `mergeExpenses` le
    // bumpea el `updatedAt` a su copia, que arrastra el núcleo viejo.
    const votadaPorBeto = firmado('expense', gasto({ amount: 12_000, rev: 2_000, updatedAt: 2_000 }));

    useExpenseStore.setState({ expenses: [nueva] });
    useExpenseStore.getState().mergeExpenses([{
      ...votadaPorBeto,
      updatedAt: 8_000,
      autoriaDisputada: [nucleoCompetidor],
    }]);

    expect(soloGasto().amount).toBe(20_000);
    expect(soloGasto().autoriaDisputada).toHaveLength(1);
  });

  it('la disputa del tercero NO desaparece porque el autor editó su núcleo', () => {
    // Ana edita en su teléfono SIN haber visto la disputa: su copia no la
    // tiene y su `updatedAt` es mayor. Con LWW de registro entero, la disputa
    // se perdía y nadie se enteraba.
    const conDisputa = gasto({
      rev: 2_000, updatedAt: 2_000,
      autoriaDisputada: [nucleoCompetidor],
    });
    const editadaPorAna = firmado('expense', gasto({
      amount: 25_000, rev: 5_000, updatedAt: 5_000,
    }));

    useExpenseStore.setState({ expenses: [conDisputa] });
    useExpenseStore.getState().mergeExpenses([editadaPorAna]);

    expect(soloGasto().amount).toBe(25_000);
    expect(soloGasto().autoriaDisputada).toHaveLength(1);
  });
});

describe('tombstones (regla #1): no se resucita con un núcleo viejo', () => {
  it('un núcleo con `rev` mayor NO levanta un borrado más nuevo', () => {
    useExpenseStore.setState({ expenses: [gasto({ isDeleted: true, updatedAt: 9_000, rev: 1_000 })] });
    useExpenseStore.getState().mergeExpenses([gasto({ isDeleted: false, updatedAt: 2_000, rev: 7_000 })]);

    // `isDeleted` es colaborativo: lo escriben terceros y lo sigue ordenando
    // `updatedAt`. Que el núcleo gane por `rev` no le da poder sobre el borrado.
    expect(soloGasto().isDeleted).toBe(true);
  });
});

describe('un peer viejo (sin `rev`) mergea bien en las dos direcciones', () => {
  it('recibimos de él: su edición más nueva entra igual', () => {
    useExpenseStore.setState({ expenses: [gasto({ amount: 10_000, updatedAt: 1_000 })] });
    useExpenseStore.getState().mergeExpenses([gasto({ amount: 30_000, updatedAt: 5_000 })]);

    expect(soloGasto().amount).toBe(30_000);
  });

  it('recibimos de él lo VIEJO: no pisa lo nuestro', () => {
    useExpenseStore.setState({ expenses: [gasto({ amount: 30_000, updatedAt: 5_000 })] });
    useExpenseStore.getState().mergeExpenses([gasto({ amount: 10_000, updatedAt: 1_000 })]);

    expect(soloGasto().amount).toBe(30_000);
  });

  it('lo suyo sin `rev` pierde contra una revisión firmada del mismo id', () => {
    useExpenseStore.setState({
      expenses: [firmado('expense', gasto({ amount: 20_000, rev: 3_000, updatedAt: 3_000 }))],
    });
    useExpenseStore.getState().mergeExpenses([gasto({ amount: 1, updatedAt: 9_000 })]);

    expect(soloGasto().amount).toBe(20_000);
  });
});

describe('los siete stores siguen mergeando', () => {
  it('payments: LWW por `updatedAt` cuando no hay `rev`', () => {
    const pago = (over: Partial<Payment> = {}): Payment => ({
      id: 'p1', groupId: 'g1', fromUserId: 'beto', toUserId: 'ana', amount: 100,
      currency: 'ARS', date: 0, createdAt: 0, createdById: 'beto',
      updatedAt: 1_000, isDeleted: false, ...over,
    } as Payment);

    usePaymentStore.setState({ payments: [pago()] });
    usePaymentStore.getState().mergePayments([pago({ amount: 500, updatedAt: 2_000 })]);
    expect(usePaymentStore.getState().payments[0]!.amount).toBe(500);
  });

  it('comments: los de dos personas no se pisan', () => {
    useCommentStore.setState({ comments: [
      { id: 'c1', expenseId: 'e1', authorId: 'ana', text: 'a', createdAt: 1, updatedAt: 1, isDeleted: false },
    ] });
    useCommentStore.getState().mergeComments([
      { id: 'c2', expenseId: 'e1', authorId: 'beto', text: 'b', createdAt: 2, updatedAt: 2, isDeleted: false },
    ]);
    expect(useCommentStore.getState().comments).toHaveLength(2);
  });

  it('recurring: el `lastMaterializedAt` de un tercero entra por `updatedAt`', () => {
    const plantilla = (over = {}) => ({
      id: 'r1', groupId: 'g1', description: 'Alquiler', amount: 1, currency: 'ARS',
      paidById: 'ana', splitMode: 'equal', memberIds: ['ana'], category: 'other',
      rule: { frequency: 'monthly', startDate: 0 }, lastMaterializedAt: null,
      isActive: true, createdAt: 0, createdById: 'ana', updatedAt: 1_000, isDeleted: false,
      ...over,
    });
    useRecurringStore.setState({ recurring: [plantilla() as never] });
    useRecurringStore.getState().mergeRecurring([
      plantilla({ lastMaterializedAt: 7_000, updatedAt: 2_000 }) as never,
    ]);
    expect(useRecurringStore.getState().recurring[0]!.lastMaterializedAt).toBe(7_000);
  });

  it('groups: las aprobaciones de salida se siguen uniendo', () => {
    const pedido = { userId: 'caro', plan: [], requestedAt: 500 };
    useGroupStore.setState({ groups: [{
      id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto', 'caro'], currency: 'ARS',
      createdAt: 0, createdById: 'ana', updatedAt: 1_000, isDeleted: false,
      leaveRequest: { ...pedido, approvedBy: ['ana'] },
    } as never] });
    useGroupStore.getState().mergeGroups([{
      id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto', 'caro'], currency: 'ARS',
      createdAt: 0, createdById: 'ana', updatedAt: 2_000, isDeleted: false,
      leaveRequest: { ...pedido, approvedBy: ['beto'] },
    } as never]);

    expect(useGroupStore.getState().groups[0]!.leaveRequest?.approvedBy.sort())
      .toEqual(['ana', 'beto']);
  });

  it('users: sin núcleo económico, LWW como siempre', () => {
    const u = (over: Partial<User> = {}): User => ({
      id: 'u1', name: 'Ana', email: 'a@a', authProvider: 'google', createdAt: 0,
      updatedAt: 1_000, isDeleted: false, ...over,
    } as User);
    useUserStore.setState({ users: [u()] });
    useUserStore.getState().mergeUsers([u({ name: 'Ana M', updatedAt: 2_000 })]);
    expect(useUserStore.getState().users[0]!.name).toBe('Ana M');
  });
});

describe('restaurar sobrevive a un sync que trae el borrado de vuelta (T-186)', () => {
  /**
   * T-186: sin ronda ni voto, `isDeleted`/`deletedById`/`restoredById` son
   * campos del «resto», simple LWW por `updatedAt` — el mismo mecanismo que
   * ya protege cualquier tombstone (regla #1). Restaurar con un `updatedAt`
   * más nuevo le gana a una copia vieja que todavía trae el borrado.
   */
  const borrado = (over: Partial<Expense> = {}) => gasto({
    isDeleted: true, deletedById: 'ana', updatedAt: 1_000, ...over,
  });

  it('el gasto restaurado no se vuelve a borrar cuando vuelve una copia vieja del borrado', () => {
    useExpenseStore.setState({ expenses: [borrado()] });

    // Beto restaura desde Actividad.
    useExpenseStore.getState().updateExpense('e1', {
      isDeleted: false, restoredById: 'beto',
    });

    // Y el teléfono de Ana republica su copia vieja, que todavía tiene el borrado.
    useExpenseStore.getState().mergeExpenses([borrado()]);

    expect(soloGasto().isDeleted).toBe(false);
    expect(soloGasto().restoredById).toBe('beto');
  });
});
