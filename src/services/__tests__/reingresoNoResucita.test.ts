import { createSecureStorage } from '@/src/utils/secureStorage';
import { useAuthStore } from '@/src/store/authStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { marcarPendienteDeDrenaje, estaPendienteDeDrenaje } from '@/src/sync/pendingDrain';
import { applyDelta, buildDelta } from '@/src/sync/useSyncQR';
import type { Expense, Group, User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(),
  deviceId: () => 'dev',
  olvidarCursor: jest.fn(),
  publishNow: jest.fn(async () => {}),
}));

/**
 * **T-089 · Volver a un grupo no puede resucitar lo que el grupo borró.**
 *
 * El defecto, en una línea: `mergeByIdLWW` es **una unión, nunca una resta**. El
 * que reingresa conserva su copia entera; si publica antes de drenar, manda el
 * estado completo que él recuerda —el sobre lleva estado, regla #8— y el gasto
 * que el grupo borró mientras estuvo afuera **vuelve a la vida en el teléfono de
 * todos**, con un `updatedAt` nuevo que le gana al tombstone.
 *
 * El primer test **reproduce el defecto** y tiene que quedar en verde
 * describiéndolo: es la prueba de que el problema existe, y de que el segundo
 * test mide algo. El segundo es el arreglo.
 */
const YO: User = { id: 'yo', name: 'Yo' } as User;
const meta = { updatedAt: 1_000, isDeleted: false };

function grupo(): Group {
  return {
    id: 'G', name: 'Asado', memberIds: ['yo', 'beto'], currency: 'ARS',
    createdAt: 0, createdById: 'beto', deletionVotes: [], ...meta,
  } as unknown as Group;
}

function gasto(over: Partial<Expense> = {}): Expense {
  return {
    id: 'e1', groupId: 'G', description: 'Carne', amount: 20_000, currency: 'ARS',
    paidById: 'beto', splitMode: 'equal', splits: [], category: 'food', date: 0,
    createdAt: 0, createdById: 'beto', deletionVotes: [], ...meta, ...over,
  } as unknown as Expense;
}

/** El estado que el GRUPO tiene hoy: el gasto borrado mientras yo no estaba. */
const BORRADO_POR_EL_GRUPO = gasto({ isDeleted: true, updatedAt: 5_000 });

beforeEach(() => {
  ['groups', 'expenses', 'payments', 'users', 'recurring', 'comments', 'groupkeys'].forEach(
    b => createSecureStorage(b as never).clearAll(),
  );
  useAuthStore.setState({ currentUser: YO });
  useGroupKeyStore.setState({ keys: [] });
  useGroupStore.setState({ groups: [grupo()] });
});

describe('el defecto que esto cierra (queda documentado, no arreglado acá)', () => {
  it('con mi `updatedAt` menor, el tombstone del grupo todavía aguanta', () => {
    // Mi copia: el gasto vivo, como estaba cuando me fui.
    useExpenseStore.setState({ expenses: [gasto()] });

    // Lo que yo publicaría ahora mismo.
    const miSobre = buildDelta('yo');

    // El otro teléfono, que SÍ tiene el borrado.
    useExpenseStore.setState({ expenses: [BORRADO_POR_EL_GRUPO] });
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(true);

    applyDelta(miSobre, 'yo');

    // Mi `updatedAt` es menor, así que acá NO revive… todavía.
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(true);
  });

  it('y revive de verdad en cuanto mi copia se toca y sube su `updatedAt`', () => {
    // Es el caso real: vuelvo, edito o cargo algo, mi registro sube de
    // `updatedAt`, y el sobre que publico le gana al tombstone del grupo.
    useExpenseStore.setState({ expenses: [gasto({ updatedAt: 9_000 })] });
    const miSobre = buildDelta('yo');

    useExpenseStore.setState({ expenses: [BORRADO_POR_EL_GRUPO] });
    applyDelta(miSobre, 'yo');

    // 🔴 El gasto que el grupo había borrado está vivo otra vez.
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(false);
  });
});

describe('la guarda', () => {
  it('un grupo marcado queda pendiente hasta drenar', () => {
    marcarPendienteDeDrenaje('G');
    expect(estaPendienteDeDrenaje('G')).toBe(true);
  });

  /**
   * **Acá está la cadena causal real, y no es la que uno supone.**
   *
   * Drenar no gana por LWW: mi copia vieja tiene `updatedAt` MENOR que el
   * tombstone, así que si publicara tal cual, el borrado del grupo ganaría igual.
   * Lo que hace daño es lo que pasa **antes** de publicar: como nunca drené, la
   * app me muestra un gasto que el grupo ya borró, **lo toco** —lo edito, lo
   * pago, voto en él— y ahí mi registro sube de `updatedAt` y **le gana al
   * tombstone**. La resurrección la fabrica el usuario de buena fe sobre datos
   * que no debería estar viendo.
   *
   * ⇒ Lo que compra la guarda es que **el tombstone llegue antes que el toque**.
   */
  it('drenar primero borra el gasto de MI teléfono, así que ya no hay qué revivir', () => {
    useExpenseStore.setState({ expenses: [gasto()] });   // mi copia vieja, viva
    marcarPendienteDeDrenaje('G');

    // Dreno: llega el estado del grupo con el tombstone (updatedAt mayor).
    applyDelta({ ...buildDelta('beto'), expenses: [BORRADO_POR_EL_GRUPO] }, 'beto');

    // El gasto ya está borrado acá: la pantalla no me lo va a ofrecer para tocar.
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(true);

    // Y lo que publico a partir de ahora lleva el borrado, no la resurrección.
    const eG = buildDelta('yo').expenses.find(e => e.id === 'e1')!;
    expect(eG.isDeleted).toBe(true);
  });

  it('sin drenar, ese mismo gasto sigue visible y editable — que es el problema', () => {
    // El contraste exacto del test de arriba, sobre el mismo fixture.
    useExpenseStore.setState({ expenses: [gasto()] });

    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(false);
  });
});
