/**
 * T-157a: `buildGroupPayload` armaba el sobre llamando a `buildDelta` —que
 * corre `sinCamposLocales`/`sinAvatarUrl` sobre el DISPOSITIVO ENTERO— y
 * recién DESPUÉS filtraba por `groupId`. Con 1000 gastos en 10 grupos, cada
 * publicación de UN grupo (100 gastos) hacía trabajo de JS sobre los otros
 * 900 para nada: se transformaban y se tiraban.
 *
 * El orden correcto es filtrar PRIMERO (qué pertenece a este grupo) y recién
 * aplicar `sinCamposLocales`/`sinAvatarUrl` sobre esa porción ya achicada.
 * Este archivo prueba dos cosas:
 *
 *  1. `sinCamposLocales` recibe sólo los gastos DEL GRUPO, nunca los 1000.
 *  2. El nuevo `buildGroupPayload` produce EXACTAMENTE el mismo JSON que la
 *     implementación vieja (copiada acá tal cual, como fixture) — cambiar el
 *     ORDEN de las operaciones no puede cambiar el CONTENIDO del sobre.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

jest.mock('../soloLocal', () => {
  const actual = jest.requireActual('../soloLocal') as typeof import('../soloLocal');
  return {
    ...actual,
    sinCamposLocales: jest.fn(actual.sinCamposLocales),
  };
});

import { buildGroupPayload } from '../relaySync';
import { buildDelta, type SyncDelta } from '../applyDelta';
import { sinCamposLocales } from '../soloLocal';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Expense, Group, User } from '@/src/types/models';

const mockSinCamposLocales = sinCamposLocales as jest.Mock;

/** Implementación VIEJA de `buildGroupPayload`, copiada tal cual (pre-T-157a)
 *  como fixture: si el contenido del sobre cambia, esto lo detecta. */
function buildGroupPayloadViejo(groupId: string, currentUserId: string): SyncDelta {
  const completo = buildDelta(currentUserId);

  const delGrupo = completo.groups.filter(g => g.id === groupId);
  const miembros = new Set(delGrupo[0]?.memberIds ?? []);

  const expenses = completo.expenses.filter(e => e.groupId === groupId);
  const idsDeGastos = new Set(expenses.map(e => e.id));

  return {
    version: completo.version,
    featureVersion: completo.featureVersion,
    fromUserId: completo.fromUserId,
    timestamp: completo.timestamp,

    groups: delGrupo,
    expenses,
    payments: completo.payments.filter(p => p.groupId === groupId),
    users: completo.users.filter(u => miembros.has(u.id)).map(u => ({ ...u, email: '' })),
    recurring: (completo.recurring ?? []).filter(r => r.groupId === groupId),
    comments: (completo.comments ?? []).filter(c => idsDeGastos.has(c.expenseId)),
  };
}

const YO = 'yo';
const N_GRUPOS = 10;
const GASTOS_POR_GRUPO = 100;
const meta = { updatedAt: 1_000, isDeleted: false };

function sembrar(): void {
  useAuthStore.setState({ currentUser: { id: YO, name: 'Yo' } as User });

  const groups: Group[] = [];
  const expenses: Expense[] = [];
  for (let g = 0; g < N_GRUPOS; g++) {
    const groupId = `g${g}`;
    groups.push({
      id: groupId, name: `Grupo ${g}`, memberIds: [YO], currency: 'ARS',
      miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
      createdAt: 0, createdById: YO, ...meta,
    } as Group);
    for (let i = 0; i < GASTOS_POR_GRUPO; i++) {
      expenses.push({
        id: `e${g}_${i}`, groupId, description: `Gasto ${g}-${i}`, amount: 100,
        currency: 'ARS', paidById: YO, splitMode: 'equal', splits: [], category: 'food',
        date: 0, createdAt: 0, createdById: YO, receiptImageUri: 'file:///r.jpg',
        ...meta,
      } as unknown as Expense);
    }
  }

  useGroupStore.setState({ groups });
  useExpenseStore.setState({ expenses });
  usePaymentStore.setState({ payments: [] });
  useCommentStore.setState({ comments: [] });
  useRecurringStore.setState({ recurring: [] });
  usePersonalStore.setState({ entries: [] });
  useUserStore.setState({ users: [{ id: YO, name: 'Yo', email: 'yo@example.com' } as User] });
}

beforeEach(() => {
  createSecureStorage('groupkeys').clearAll();
  useGroupKeyStore.setState({ keys: [] });
  mockSinCamposLocales.mockClear();
  sembrar();
});

it('sinCamposLocales recibe SÓLO los gastos del grupo (100), nunca el dispositivo entero (1000)', () => {
  buildGroupPayload('g3', YO);

  expect(mockSinCamposLocales).toHaveBeenCalledTimes(1);
  const recibidos = mockSinCamposLocales.mock.calls[0]![0] as Expense[];
  expect(recibidos).toHaveLength(GASTOS_POR_GRUPO);
  expect(recibidos.every(e => e.groupId === 'g3')).toBe(true);
});

it('produce EXACTAMENTE el mismo sobre que la implementación vieja (salida byte a byte idéntica)', () => {
  jest.spyOn(Date, 'now').mockReturnValue(123_456_789);

  const nuevo = buildGroupPayload('g5', YO);
  const viejo = buildGroupPayloadViejo('g5', YO);

  expect(JSON.stringify(nuevo)).toBe(JSON.stringify(viejo));

  jest.restoreAllMocks();
});
