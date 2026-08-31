import { useAuthStore } from '../authStore';
import { ensureIdentity } from '../identityStore';
import { useExpenseStore } from '../expenseStore';
import { usePaymentStore } from '../paymentStore';
import { useCommentStore } from '../commentStore';
import { useRecurringStore } from '../recurringStore';
import { useGroupStore } from '../groupStore';
import { verifyCore } from '@/src/sync/recordSign';
import { applyDelta, type SyncDelta } from '@/src/sync/useSyncQR';
import type {
  Expense, Payment, ExpenseComment, RecurringExpense, Group, User,
} from '@/src/types/models';

/**
 * **T-041 · S5 — firmar al escribir.**
 *
 * Esto es lo primero del ticket que escribe en los datos REALES del usuario y
 * los propaga por sync. Un error acá no se queda en el repo: viaja a los otros
 * teléfonos y queda en registros que no se re-firman nunca (§6 del plan).
 *
 * Las cinco garantías que este archivo tiene que sostener, y por qué:
 *
 *  1. **Lo que creo yo sale firmado y verifica.** Es la entrega de S5.
 *  2. **Editar como autor re-firma con `rev` mayor.** Sin eso, la edición
 *     quedaría con la firma del núcleo VIEJO y se leería como suplantación.
 *  3. **Que un tercero toque lo colaborativo NO invalida la firma del autor.**
 *     Si esto se cae, el borrado consensuado se rompe el primer día: cada voto
 *     de un tercero bumpea `updatedAt` y marcaría el gasto de otro como falso.
 *  4. **Lo ajeno NO se firma jamás.** Firmar un registro cuyo `createdById` no
 *     soy yo es declarar autoría ajena — exactamente lo que el ticket combate.
 *  5. **La firma no puede romper la creación.** Sin identidad el gasto se carga
 *     igual, sin firma. Nunca se le bloquea al usuario cargar plata por un
 *     problema de criptografía.
 *
 * Y la sexta, que no es del ticket sino del ecosistema: **un peer viejo tiene
 * que seguir funcionando.** `k`/`s`/`rev` son campos nuevos y opcionales.
 */

jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(),
  deviceId: () => 'dev-test',
}));

// `let mock…` y no `let …`: jest sólo deja que una factory hoisteada toque
// variables con ese prefijo. Es el camino que SÍ pisa al módulo real — un
// `jest.doMock` dentro de `isolateModules` no lo hace (lección de S4).
let mockSinIdentidad = false;
let mockClaveCorrupta = false;
jest.mock('@/src/store/identityStore', () => {
  const real = jest.requireActual('@/src/store/identityStore');
  return {
    ...real,
    ensureIdentity: () => {
      if (mockSinIdentidad) throw new Error('build sin el módulo de identidad');
      // Storage cifrado que devuelve basura: la identidad "existe" y la privada
      // no sirve. Es un camino de falla distinto al de arriba — ahí falla el
      // módulo, acá falla la curva — y hay que probar los dos.
      if (mockClaveCorrupta) return { privateKey: 'abcd', publicKey: 'abcd' };
      return real.ensureIdentity();
    },
  };
});

const YO = 'ana';
const OTRO = 'beto';

const comoUsuario = (id: string) =>
  useAuthStore.setState({ currentUser: { id } as User });

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 12_345, currency: 'ARS',
  paidById: YO, splits: [{ userId: YO, amount: 12_345, isPaid: false }],
  splitMode: 'equal', category: 'food', date: 1_700_000_000_000,
  createdAt: 1_700_000_000_000, createdById: YO, deletionVotes: [],
  updatedAt: 0, isDeleted: false, ...over,
});

const pago = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: OTRO, toUserId: YO, amount: 6_000,
  currency: 'ARS', date: 1_700_000_000_000, createdAt: 1_700_000_000_000,
  createdById: YO, updatedAt: 0, isDeleted: false, ...over,
});

const comentario = (over: Partial<ExpenseComment> = {}): ExpenseComment => ({
  id: 'c1', expenseId: 'e1', authorId: YO, text: 'faltó la propina',
  createdAt: 1_700_000_000_000, updatedAt: 0, isDeleted: false, ...over,
});

const plantilla = (over: Partial<RecurringExpense> = {}): RecurringExpense => ({
  id: 'r1', groupId: 'g1', description: 'Alquiler', amount: 500_000,
  currency: 'ARS', paidById: YO, splitMode: 'equal', memberIds: [YO, OTRO],
  category: 'accommodation',
  rule: { frequency: 'monthly', startDate: 1_700_000_000_000 },
  lastMaterializedAt: null, isActive: true, createdAt: 1_700_000_000_000,
  createdById: YO, updatedAt: 0, isDeleted: false, ...over,
});

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Asado', memberIds: [YO, OTRO], currency: 'ARS',
  createdAt: 1_700_000_000_000, createdById: YO, deletionVotes: [],
  updatedAt: 0, isDeleted: false, ...over,
});

const elGasto     = () => useExpenseStore.getState().expenses[0]!;
const elPago      = () => usePaymentStore.getState().payments[0]!;
const elComentario= () => useCommentStore.getState().comments[0]!;
const laPlantilla = () => useRecurringStore.getState().recurring[0]!;
const elGrupo     = () => useGroupStore.getState().groups[0]!;

let MI_CLAVE = '';

beforeEach(() => {
  mockSinIdentidad = false;
  mockClaveCorrupta = false;
  comoUsuario(YO);
  MI_CLAVE = ensureIdentity().publicKey;
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  useCommentStore.setState({ comments: [] });
  useRecurringStore.setState({ recurring: [] });
  useGroupStore.setState({ groups: [] });
});

// ── 1 · lo propio sale firmado, en las CINCO entidades ──────────────────────

describe('un registro recién creado trae firma válida', () => {
  const CASOS = [
    { kind: 'expense'  as const, crear: () => useExpenseStore.getState().addExpense(gasto()),          leer: elGasto },
    { kind: 'payment'  as const, crear: () => usePaymentStore.getState().addPayment(pago()),           leer: elPago },
    { kind: 'comment'  as const, crear: () => useCommentStore.getState().addComment(comentario()),     leer: elComentario },
    { kind: 'recurring'as const, crear: () => useRecurringStore.getState().addRecurring(plantilla()),  leer: laPlantilla },
    { kind: 'group'    as const, crear: () => useGroupStore.getState().addGroup(grupo()),              leer: elGrupo },
  ];

  it.each(CASOS)('$kind sale con k/s/rev y verifica', ({ kind, crear, leer }) => {
    crear();
    const rec = leer();

    expect(rec.k).toBe(MI_CLAVE);
    expect(typeof rec.s).toBe('string');
    expect(rec.s!.length).toBe(128);
    expect(rec.rev).toBeGreaterThan(0);
    expect(verifyCore(kind, rec as never, [MI_CLAVE])).toBe('valida');
  });

  it.each(CASOS)('$kind: la firma es del NÚCLEO, no de otra entidad', ({ kind, crear, leer }) => {
    crear();
    const rec = leer();
    // El payload lleva `t`: la misma firma no puede valer para otra entidad.
    const otra = kind === 'expense' ? 'payment' : 'expense';
    expect(verifyCore(otra as never, rec as never, [MI_CLAVE])).toBe('invalida');
  });
});

// ── 2 · editar como autor re-firma ──────────────────────────────────────────

describe('editar como autor re-firma', () => {
  it('el gasto editado verifica y sube rev', () => {
    useExpenseStore.getState().addExpense(gasto());
    const antes = elGasto();

    useExpenseStore.getState().updateExpense('e1', { amount: 999 });
    const despues = elGasto();

    expect(despues.amount).toBe(999);
    expect(despues.rev!).toBeGreaterThan(antes.rev!);
    expect(despues.s).not.toBe(antes.s);
    expect(verifyCore('expense', despues, [MI_CLAVE])).toBe('valida');
  });

  it('la plantilla recurrente editada también', () => {
    useRecurringStore.getState().addRecurring(plantilla());
    const antes = laPlantilla();

    useRecurringStore.getState().updateRecurring('r1', { amount: 600_000 });
    const despues = laPlantilla();

    expect(despues.rev!).toBeGreaterThan(antes.rev!);
    expect(verifyCore('recurring', despues, [MI_CLAVE])).toBe('valida');
  });

  it('tocar SÓLO lo colaborativo no mueve rev ni la firma', () => {
    useExpenseStore.getState().addExpense(gasto());
    const antes = elGasto();

    // El propio autor pide el borrado de su gasto: `deletionVotes` y
    // `updatedAt` están fuera del núcleo, así que no hay nada que re-firmar.
    useExpenseStore.getState().updateExpense('e1', {
      deletionVotes: [{ userId: YO, votedAt: 1, action: 'delete' }],
    });
    const despues = elGasto();

    expect(despues.rev).toBe(antes.rev);
    expect(despues.s).toBe(antes.s);
    expect(verifyCore('expense', despues, [MI_CLAVE])).toBe('valida');
  });

  it('materializar una recurrente (lo escribe cualquier device) no re-firma', () => {
    useRecurringStore.getState().addRecurring(plantilla());
    const antes = laPlantilla();

    useRecurringStore.getState().updateRecurring('r1', { lastMaterializedAt: 123 });
    const despues = laPlantilla();

    expect(despues.rev).toBe(antes.rev);
    expect(despues.s).toBe(antes.s);
    expect(verifyCore('recurring', despues, [MI_CLAVE])).toBe('valida');
  });
});

// ── 3 · un tercero no puede tumbar la firma del autor ───────────────────────

describe('un tercero tocando el registro', () => {
  const gastoDeAnaFirmado = () => {
    comoUsuario(YO);
    useExpenseStore.getState().addExpense(gasto());
    const firmado = elGasto();
    comoUsuario(OTRO);              // ahora manda el teléfono de beto
    return firmado;
  };

  it('votar el borrado deja la firma INTACTA y válida', () => {
    const antes = gastoDeAnaFirmado();

    useExpenseStore.getState().updateExpense('e1', {
      deletionVotes: [{ userId: OTRO, votedAt: 7, action: 'delete' }],
    });
    const despues = elGasto();

    expect(despues.k).toBe(antes.k);
    expect(despues.s).toBe(antes.s);
    expect(despues.rev).toBe(antes.rev);
    expect(despues.updatedAt).not.toBe(antes.updatedAt); // sí tocó el registro
    expect(verifyCore('expense', despues, [MI_CLAVE])).toBe('valida');
  });

  it('tombstonear el gasto de otro deja la firma válida', () => {
    const antes = gastoDeAnaFirmado();

    useExpenseStore.getState().updateExpense('e1', { isDeleted: true });
    const despues = elGasto();

    expect(despues.s).toBe(antes.s);
    expect(verifyCore('expense', despues, [MI_CLAVE])).toBe('valida');
  });

  it('tocar el NÚCLEO ajeno NO re-firma: queda la firma de ana e invalida', () => {
    const antes = gastoDeAnaFirmado();

    useExpenseStore.getState().updateExpense('e1', { amount: 1 });
    const despues = elGasto();

    // Beto no puede convertirse en autor por editar: la firma sigue siendo la
    // de ana, y por eso el cambio queda detectable. Es la razón del ticket.
    expect(despues.k).toBe(antes.k);
    expect(despues.s).toBe(antes.s);
    expect(despues.rev).toBe(antes.rev);
    expect(verifyCore('expense', despues, [MI_CLAVE])).toBe('invalida');
  });
});

// ── 4 · lo ajeno no se firma jamás ──────────────────────────────────────────

describe('sólo se firma lo propio', () => {
  it('un gasto cuyo createdById no soy yo entra sin firma', () => {
    comoUsuario(OTRO);
    useExpenseStore.getState().addExpense(gasto({ createdById: YO }));

    const rec = elGasto();
    expect(rec.k).toBeUndefined();
    expect(rec.s).toBeUndefined();
    expect(rec.rev).toBeUndefined();
  });

  it('un comentario ajeno tampoco (el autor es `authorId`, no `createdById`)', () => {
    comoUsuario(OTRO);
    useCommentStore.getState().addComment(comentario({ authorId: YO }));

    const rec = elComentario();
    expect(rec.k).toBeUndefined();
    expect(rec.s).toBeUndefined();
  });

  it('sin sesión activa no se firma nada', () => {
    useAuthStore.setState({ currentUser: null });
    useExpenseStore.getState().addExpense(gasto());

    expect(elGasto().k).toBeUndefined();
  });

  /**
   * `applyApprovedLeaves` crea pagos con `createdById` del que SE VA, en el
   * device de cualquiera que corra la resolución. Cuando el que resuelve es el
   * propio saliente, `createdById` coincide con la sesión y la regla de arriba
   * no alcanza: hay que declararlos derivados explícitamente. Firmarlos haría
   * que el mismo id circule firmado desde un teléfono y sin firma desde los
   * otros. El modelo de estos pagos es `derivedFrom` y es S9.
   */
  it('los pagos derivados de una salida no se firman, aunque el autor sea yo', () => {
    usePaymentStore.getState().addPayment(
      pago({ id: 'leave:g1:ana:1:0', createdById: YO }), { derived: true },
    );

    const rec = elPago();
    expect(rec.k).toBeUndefined();
    expect(rec.s).toBeUndefined();
    expect(rec.rev).toBeUndefined();
  });
});

// ── 5 · la firma no puede romper la creación ────────────────────────────────

describe('sin identidad disponible', () => {
  it('el gasto se crea igual, sin firma', () => {
    mockSinIdentidad = true;
    expect(() => useExpenseStore.getState().addExpense(gasto())).not.toThrow();

    const rec = elGasto();
    expect(rec.id).toBe('e1');
    expect(rec.amount).toBe(12_345);
    expect(rec.k).toBeUndefined();
    expect(rec.s).toBeUndefined();
    expect(verifyCore('expense', rec, [MI_CLAVE])).toBe('no_verificable');
  });

  it('una privada corrupta no rompe la creación y no deja firma a medias', () => {
    mockClaveCorrupta = true;
    expect(() => useExpenseStore.getState().addExpense(gasto())).not.toThrow();

    const rec = elGasto();
    expect(rec.amount).toBe(12_345);
    expect(rec.k).toBeUndefined();
    expect(rec.s).toBeUndefined();
  });

  it('una privada corrupta al editar tampoco deja la firma vieja pegada', () => {
    useExpenseStore.getState().addExpense(gasto());
    mockClaveCorrupta = true;

    useExpenseStore.getState().updateExpense('e1', { amount: 555 });
    const rec = elGasto();

    expect(rec.amount).toBe(555);
    expect(rec.k).toBeUndefined();
    expect(rec.s).toBeUndefined();
    expect(verifyCore('expense', rec, [MI_CLAVE])).toBe('no_verificable');
  });

  it('una edición que no se puede firmar NO deja la firma vieja pegada', () => {
    useExpenseStore.getState().addExpense(gasto());
    mockSinIdentidad = true;

    useExpenseStore.getState().updateExpense('e1', { amount: 777 });
    const rec = elGasto();

    // Dejar la firma del núcleo viejo sobre un núcleo nuevo acusaría al AUTOR
    // —yo mismo— de suplantarse. Sin firma es `no_verificable`, que es la
    // verdad: no se pudo saber.
    expect(rec.amount).toBe(777);
    expect(rec.k).toBeUndefined();
    expect(rec.s).toBeUndefined();
    expect(verifyCore('expense', rec, [MI_CLAVE])).toBe('no_verificable');
  });
});

// ── 6 · un peer viejo tiene que seguir funcionando ──────────────────────────

describe('compatibilidad con un peer que no actualizó', () => {
  const delta = (over: Partial<SyncDelta>): SyncDelta => ({
    version: 1, fromUserId: OTRO, timestamp: 1,
    groups: [], expenses: [], payments: [], users: [], ...over,
  });

  it('un delta sin k/s/rev mergea como siempre contra un árbol que ya firma', () => {
    useExpenseStore.getState().addExpense(gasto());
    const mio = elGasto();
    expect(mio.s).toBeTruthy(); // el árbol de hoy firma: si no, esto no prueba nada

    const viejo = gasto({ id: 'e2', description: 'De un peer viejo', updatedAt: 9_000 });
    delete (viejo as Partial<Expense>).k;
    delete (viejo as Partial<Expense>).s;
    delete (viejo as Partial<Expense>).rev;

    // Y el mismo id que el mío, con updatedAt mayor. Desde S7 el núcleo lo
    // ordena `rev`, no `updatedAt`: un núcleo sin `rev` cuenta como 0 y pierde
    // contra cualquier revisión firmada del mismo id. Es exactamente el ataque
    // del re-estampado, y no hay forma de distinguirlo de un peer viejo que
    // edita — el precio está en el §C.3 del plan y se paga acá.
    const pisa = gasto({ description: 'Editado en el peer viejo', updatedAt: mio.updatedAt + 1 });

    applyDelta(delta({ expenses: [viejo, pisa] }), YO);

    const ids = useExpenseStore.getState().expenses.map(e => e.id).sort();
    expect(ids).toEqual(['e1', 'e2']);

    // Lo que el peer viejo trae y no tenemos entra tal cual: sin firma, sin
    // `rev`, y sin que nadie lo rechace. Es la compatibilidad que importa.
    const e2 = useExpenseStore.getState().expenses.find(e => e.id === 'e2')!;
    expect(e2.description).toBe('De un peer viejo');
    expect(e2.k).toBeUndefined();

    const e1 = useExpenseStore.getState().expenses.find(e => e.id === 'e1')!;
    expect(e1.description).toBe('Cena');          // mi núcleo firmado se queda
    expect(e1.updatedAt).toBe(mio.updatedAt + 1); // y su `updatedAt` entra igual
  });

  it('mergear NO firma nada: los registros ajenos entran tal cual llegaron', () => {
    const ajeno = gasto({ id: 'e3', createdById: OTRO, updatedAt: 9_000 });
    applyDelta(delta({ expenses: [ajeno] }), YO);

    const e3 = useExpenseStore.getState().expenses.find(e => e.id === 'e3')!;
    expect(e3.k).toBeUndefined();
    expect(e3.s).toBeUndefined();
  });
});
