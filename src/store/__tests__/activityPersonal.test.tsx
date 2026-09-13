import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useActivityFeed, PERSONAL_ACTIVITY_KEY } from '../selectors';
import { useGroupStore } from '../groupStore';
import { useExpenseStore } from '../expenseStore';
import { usePaymentStore } from '../paymentStore';
import { useUserStore } from '../userStore';
import type { Expense, Group } from '@/src/types/models';

/**
 * T-116 (PO 2026-09-13): la pestaña "Personal" de Actividad necesita que el
 * feed en sí incluya los movimientos SIN grupo (`expense.groupId === ''`,
 * la marca ya usada en `app/expense/new.tsx:279` y documentada en
 * `src/types/models.ts:85`). Antes `useActivityFeed` los excluía del todo —
 * `myGroupIds.has('')` nunca da true — así que "Personal" no tenía de dónde
 * sacar datos.
 *
 * `PERSONAL_ACTIVITY_KEY` es el `groupName` sintético que los identifica, la
 * misma idea que ya usa el filtro "Todos" de la pantalla con su propio
 * sentinel local.
 */

jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

const YO = 'ana';
const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Group);

const gastoPersonal = (over: Partial<Expense> = {}): Expense => ({
  id: 'p1', groupId: '', description: 'Café', amount: 5_000, currency: 'ARS',
  paidById: 'ana', splits: [{ userId: 'ana', amount: 5_000 }],
  splitMode: 'equal', category: 'other', date: 5_000, createdAt: 0, createdById: 'ana',
  deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Expense);

const gastoDeGrupo = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Nafta', amount: 1_000_000, currency: 'ARS',
  paidById: 'ana', splits: [{ userId: 'ana', amount: 500_000 }, { userId: 'beto', amount: 500_000 }],
  splitMode: 'equal', category: 'transport', date: 5_000, createdAt: 0, createdById: 'ana',
  deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Expense);

function feed(): ReturnType<typeof useActivityFeed> {
  let out: ReturnType<typeof useActivityFeed> = [];
  function Probe() { out = useActivityFeed(YO); return <Text>x</Text>; }
  render(<Probe />);
  return out;
}

beforeEach(() => {
  useGroupStore.setState({ groups: [grupo()] });
  usePaymentStore.setState({ payments: [] });
  useUserStore.setState({ users: [] });
});

describe('los movimientos personales entran al feed de Actividad', () => {
  it('un gasto sin grupo aparece con groupName === PERSONAL_ACTIVITY_KEY', () => {
    useExpenseStore.setState({ expenses: [gastoPersonal()] });
    const evs = feed();
    const personal = evs.find(e => e.kind === 'expense_added');
    expect(personal).toBeTruthy();
    expect(personal).toMatchObject({ groupName: PERSONAL_ACTIVITY_KEY });
  });

  it('conviven en el mismo feed con los de grupo, cada uno con su groupName', () => {
    useExpenseStore.setState({ expenses: [gastoPersonal(), gastoDeGrupo()] });
    const evs = feed();
    expect(evs).toHaveLength(2);
    const nombres = evs.filter(e => e.kind === 'expense_added').map(e => (e as { groupName: string }).groupName);
    expect(nombres.sort()).toEqual([PERSONAL_ACTIVITY_KEY, 'Viaje'].sort());
  });

  it('un gasto personal borrado aparece como expense_deleted, no expense_added', () => {
    useExpenseStore.setState({ expenses: [gastoPersonal({ isDeleted: true })] });
    const evs = feed();
    expect(evs.find(e => e.kind === 'expense_deleted')).toBeTruthy();
    expect(evs.some(e => e.kind === 'expense_added')).toBe(false);
  });

  it('sin gastos personales, el feed sigue sin ellos (no se inventa nada)', () => {
    useExpenseStore.setState({ expenses: [gastoDeGrupo()] });
    const evs = feed();
    expect(evs.some(e => 'groupName' in e && e.groupName === PERSONAL_ACTIVITY_KEY)).toBe(false);
  });
});
