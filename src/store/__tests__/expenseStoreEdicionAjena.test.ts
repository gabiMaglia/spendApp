import { useAuthStore } from '../authStore';
import { ensureIdentity } from '../identityStore';
import { useExpenseStore } from '../expenseStore';
import { useGroupStore } from '../groupStore';
import { checkRecord } from '@/src/sync/trustCheck';
import { enDisputa } from '@/src/sync/autoriaTrust';
import { rememberAuthorKey, forgetAuthorKeys } from '@/src/sync/authorKeys';
import type { Expense, Group, User } from '@/src/types/models';

/**
 * T-185 · Task 1, tabla del plan (E1, E3, E4): edición desde alguien que no
 * es el autor. Decisión del PO 2026-09-27: se cae el modo `consensus` de este
 * ticket (vuelve en T-186) — `updateExpense` deja editar a CUALQUIER miembro
 * del grupo, sin gate; sólo decide `editedById`. La verificación
 * (`checkRecord`/`autoriaTrust`) usa el firmante EFECTIVO
 * (`editedById ?? createdById`).
 *
 * Identidades REALES: `ensureIdentity()` genera y persiste la clave del
 * dispositivo (Ed25519 de verdad, no hex de adorno) — la app soporta más de
 * una cuenta en el mismo dispositivo (`userScope.ts`), así que Ana y Beto acá
 * son dos SESIONES sobre esa misma clave, igual que `firmaAlEscribir.test.ts`.
 * Para el check «en el teléfono de A» (E1), esa clave se registra en el
 * directorio de autoría BAJO EL NOMBRE DE BETO (`rememberAuthorKey('beto', …)`)
 * — es la clave real que firmó como Beto, aprendida por A.
 */

jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(),
  deviceId: () => 'dev-test',
}));

const ANA = 'ana';
const BETO = 'beto';

const comoUsuario = (id: string) => useAuthStore.setState({ currentUser: { id } as User });

const gastoDeAna = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 12_345, currency: 'ARS',
  paidById: ANA, splits: [{ userId: ANA, amount: 12_345, isPaid: false }],
  splitMode: 'equal', category: 'food', date: 1_700_000_000_000,
  createdAt: 1_700_000_000_000, createdById: ANA,
  updatedAt: 0, isDeleted: false, ...over,
});

const grupo = (over: Partial<Group> = {}): Group => {
  const memberIds = over.memberIds ?? [ANA, BETO];
  return {
    id: 'g1', name: 'Asado', memberIds, currency: 'ARS',
    // T-182: `miembros` es la fuente de verdad de `memberIds` (derivado).
    miembros: Object.fromEntries(memberIds.map((uid, i) => [uid, { estado: 'in' as const, at: i }])),
    createdAt: 1_700_000_000_000, createdById: ANA,
    updatedAt: 0, isDeleted: false, ...over,
  };
};

const elGasto = () => useExpenseStore.getState().expenses[0]!;

let MI_CLAVE = '';

beforeEach(() => {
  comoUsuario(ANA);
  MI_CLAVE = ensureIdentity().publicKey;
  useExpenseStore.setState({ expenses: [] });
  useGroupStore.setState({ groups: [] });
  forgetAuthorKeys();
});

describe('E1 · open: B edita el gasto de A', () => {
  it('se guarda con editedById=B, createdById=A, firmado por B; en el teléfono de A verifica y no hay disputa', () => {
    useGroupStore.setState({ groups: [grupo()] });
    comoUsuario(ANA);
    useExpenseStore.getState().addExpense(gastoDeAna());

    comoUsuario(BETO);
    const ok = useExpenseStore.getState().updateExpense('e1', { amount: 999 });
    expect(ok).toBe(true);

    const editado = elGasto();
    expect(editado.editedById).toBe(BETO);
    expect(editado.createdById).toBe(ANA);
    expect(editado.amount).toBe(999);

    // «En el teléfono de A»: aprende la clave real de Beto desde el directorio.
    rememberAuthorKey(BETO, MI_CLAVE);
    expect(checkRecord('expense', editado)).toBe('valida');
    expect(enDisputa(editado)).toBe(false);
  });
});

describe('E3 · open: B edita y después A vuelve a editar', () => {
  it('editedById vuelve a ausente, rev sube de nuevo, y verifica', () => {
    useGroupStore.setState({ groups: [grupo()] });
    comoUsuario(ANA);
    useExpenseStore.getState().addExpense(gastoDeAna());

    comoUsuario(BETO);
    useExpenseStore.getState().updateExpense('e1', { amount: 999 });
    const trasBeto = elGasto();
    expect(trasBeto.editedById).toBe(BETO);

    comoUsuario(ANA);
    const ok = useExpenseStore.getState().updateExpense('e1', { amount: 1_500 });
    expect(ok).toBe(true);

    const trasAna = elGasto();
    expect(trasAna.editedById).toBeUndefined();
    expect(trasAna.createdById).toBe(ANA);
    expect(trasAna.rev!).toBeGreaterThan(trasBeto.rev!);

    rememberAuthorKey(ANA, MI_CLAVE);
    expect(checkRecord('expense', trasAna)).toBe('valida');
  });
});

describe('E4 · open: edición de alguien que NO es miembro del grupo (llega por sync)', () => {
  it('sin la clave del editor en el directorio: no_verificable, no rompe nada', () => {
    useGroupStore.setState({ groups: [grupo({ memberIds: [ANA] })] });
    comoUsuario(ANA);
    useExpenseStore.getState().addExpense(gastoDeAna());

    // Llega por sync un núcleo editado por alguien cuya clave A nunca aprendió.
    const ajeno = { ...elGasto(), editedById: 'forastero' } as Expense;

    expect(checkRecord('expense', ajeno)).toBe('no_verificable');
    expect(enDisputa(ajeno)).toBe(false);
  });
});
