import React, { Profiler, type ProfilerOnRenderCallback } from 'react';
import { render } from '@testing-library/react-native';

import ExpenseDetailScreen from '@/app/expense/[id]';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useUserStore } from '@/src/store/userStore';
import { useCommentStore } from '@/src/store/commentStore';
import type { Expense, Group, User } from '@/src/types/models';

/** T-204 — Detalle de gasto. Ver `perfGamaBajaInicio.test.tsx` para el
 *  porqué de un archivo por pantalla y el dataset chico. */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
let mockSearchParams: Record<string, string | undefined> = { id: 'e0' };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => mockSearchParams,
}));

const MEMBER_IDS = Array.from({ length: 8 }, (_, i) => `user${i}`);

const usuario = (id: string): User => ({
  id, name: `Nombre ${id}`, email: `${id}@test.com`, authProvider: 'guest',
  createdAt: 0, updatedAt: 0, isDeleted: false,
} as User);

function medirConstruccionesIntl(fn: () => void) {
  const OriginalNumberFormat = Intl.NumberFormat;
  const OriginalDateTimeFormat = Intl.DateTimeFormat;
  let numberFormats = 0;
  let dateTimeFormats = 0;
  class SpyNumberFormat extends OriginalNumberFormat {
    constructor(...args: ConstructorParameters<typeof Intl.NumberFormat>) { super(...args); numberFormats += 1; }
  }
  class SpyDateTimeFormat extends OriginalDateTimeFormat {
    constructor(...args: ConstructorParameters<typeof Intl.DateTimeFormat>) { super(...args); dateTimeFormats += 1; }
  }
  // @ts-expect-error — reemplazo global sólo durante la medición
  global.Intl.NumberFormat = SpyNumberFormat;
  // @ts-expect-error — reemplazo global sólo durante la medición
  global.Intl.DateTimeFormat = SpyDateTimeFormat;
  try { fn(); } finally {
    global.Intl.NumberFormat = OriginalNumberFormat;
    global.Intl.DateTimeFormat = OriginalDateTimeFormat;
  }
  return { numberFormats, dateTimeFormats };
}

beforeEach(() => {
  mockSearchParams = { id: 'e0' };
  const memberUsers = MEMBER_IDS.map(usuario);
  const share = Math.floor(300_050 / MEMBER_IDS.length);
  const gasto: Expense = {
    id: 'e0', groupId: 'g0', description: 'Gasto grande', amount: share * MEMBER_IDS.length,
    currency: 'ARS', paidById: MEMBER_IDS[0], splitMode: 'equal',
    splits: MEMBER_IDS.map(userId => ({ userId, amount: share, isPaid: userId === MEMBER_IDS[0] })),
    memberIds: MEMBER_IDS, category: 'other', date: 0, createdAt: 0,
    createdById: MEMBER_IDS[0], updatedAt: 0, isDeleted: false,
  } as Expense;
  const grupo: Group = {
    id: 'g0', name: 'Grupo grande', memberIds: MEMBER_IDS, currency: 'ARS',
    miembros: {}, createdAt: 0, createdById: MEMBER_IDS[0], updatedAt: 0, isDeleted: false,
  } as Group;

  useAuthStore.setState({ currentUser: memberUsers[0] });
  useUserStore.setState({ users: memberUsers });
  useGroupStore.setState({ groups: [grupo] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
  useExpenseStore.setState({ expenses: [gasto] });
  useCommentStore.setState({ comments: [] });
});

describe('T-204 — Detalle de gasto', () => {
  it('montaje: renders y Intl.* construidos (gasto de 8 splits)', () => {
    const estado = { renders: 0 };
    const onRender: ProfilerOnRenderCallback = () => { estado.renders += 1; };

    const intlEnMontaje = medirConstruccionesIntl(() => {
      render(
        <Profiler id="gasto" onRender={onRender}>
          <ExpenseDetailScreen />
        </Profiler>,
      );
    });

    console.log('[T-204][Gasto] renders=%s numberFormats=%s dateTimeFormats=%s',
      estado.renders, intlEnMontaje.numberFormats, intlEnMontaje.dateTimeFormats);

    expect(estado.renders).toBeLessThanOrEqual(8);
    expect(intlEnMontaje.numberFormats).toBeLessThanOrEqual(4);
  });
});
