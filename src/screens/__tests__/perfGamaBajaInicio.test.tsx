import React, { Profiler, type ProfilerOnRenderCallback } from 'react';
import { act, render } from '@testing-library/react-native';

import PersonalScreen from '@/app/(tabs)/index';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Expense, Group, Payment, User } from '@/src/types/models';

/**
 * T-204 — Inicio (Personal). Arnés de MEDICIÓN (superpowers:systematic-debugging),
 * no de arreglo por sí solo. Dataset chico a propósito (5 grupos/100 gastos,
 * no los 20/400 del ticket): el arnés grande en un solo archivo colgó Jest
 * (environment torn down en cascada entre pantallas — orquestador lo mató
 * tras 1h06). Un archivo por pantalla + dataset chico alcanza para agarrar
 * una regresión de ORDEN DE MAGNITUD (instancias de Intl.* que crecen con
 * filas, renders sin memoizar), que es lo que pide el ticket — no para medir
 * ms reales, eso es trabajo del Moto E40 (ver reporte).
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}),
}));

const MEMBER_IDS = Array.from({ length: 5 }, (_, i) => `user${i}`);

const usuario = (id: string): User => ({
  id, name: `Nombre ${id}`, email: `${id}@test.com`, authProvider: 'guest',
  createdAt: 0, updatedAt: 0, isDeleted: false,
} as User);

const grupo = (id: string, members: string[]): Group => ({
  id, name: `Grupo ${id}`, memberIds: members, currency: 'ARS',
  miembros: {}, createdAt: 0, createdById: MEMBER_IDS[0], updatedAt: 0, isDeleted: false,
} as Group);

const gasto = (id: string, groupId: string, members: string[], paidById: string): Expense => {
  const share = Math.floor(300_050 / members.length);
  return {
    id, groupId, description: `Gasto ${id}`, amount: share * members.length,
    currency: 'ARS', paidById, splitMode: 'equal',
    splits: members.map(userId => ({ userId, amount: share, isPaid: userId === paidById })),
    memberIds: members, category: 'other', date: 0, createdAt: 0,
    createdById: paidById, updatedAt: 0, isDeleted: false,
  } as Expense;
};

const pago = (id: string, groupId: string, from: string, to: string): Payment => ({
  id, groupId, fromUserId: from, toUserId: to, amount: 50_025, currency: 'ARS',
  date: 0, createdAt: 0, createdById: from, updatedAt: 0, isDeleted: false,
} as Payment);

beforeEach(() => {
  createSecureStorage('groups').clearAll();

  const contactUsers = Array.from({ length: 10 }, (_, i) => usuario(`contact${i}`));
  const memberUsers = MEMBER_IDS.map(usuario);
  const groups = Array.from({ length: 5 }, (_, i) => grupo(`g${i}`, MEMBER_IDS.slice(0, 3 + (i % 3))));
  const expenses: Expense[] = [];
  for (let i = 0; i < 100; i++) {
    const group = groups[i % groups.length];
    expenses.push(gasto(`e${i}`, group.id, group.memberIds, group.memberIds[i % group.memberIds.length]));
  }
  const payments: Payment[] = [];
  for (let i = 0; i < 15; i++) {
    const group = groups[i % groups.length];
    payments.push(pago(`p${i}`, group.id, group.memberIds[0], group.memberIds[1]));
  }

  useAuthStore.setState({ currentUser: memberUsers[0], isPro: false });
  useUserStore.setState({ users: [...memberUsers, ...contactUsers] });
  useGroupStore.setState({ groups });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
  useExpenseStore.setState({ expenses });
  usePaymentStore.setState({ payments });
  usePersonalStore.setState({ entries: [], budget: usePersonalStore.getState().budget });
});

/** Cuenta construcciones de Intl.NumberFormat/DateTimeFormat durante `fn` (síncrona). */
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
  try {
    fn();
  } finally {
    global.Intl.NumberFormat = OriginalNumberFormat;
    global.Intl.DateTimeFormat = OriginalDateTimeFormat;
  }
  return { numberFormats, dateTimeFormats };
}

describe('T-204 — Inicio (Personal)', () => {
  it('montaje: renders, Intl.* construidos, y un cambio de store AJENO (contacto nuevo) no re-renderiza', () => {
    const estado = { renders: 0 };
    const onRender: ProfilerOnRenderCallback = () => { estado.renders += 1; };

    const intlEnMontaje = medirConstruccionesIntl(() => {
      render(
        <Profiler id="inicio" onRender={onRender}>
          <PersonalScreen />
        </Profiler>,
      );
    });

    console.log('[T-204][Inicio] renders=%s numberFormats=%s dateTimeFormats=%s',
      estado.renders, intlEnMontaje.numberFormats, intlEnMontaje.dateTimeFormats);

    expect(estado.renders).toBeLessThanOrEqual(8);
    // Cache de módulo (T-198): el espacio de claves es fijo, no crece con la
    // cantidad de gastos/grupos del dataset.
    expect(intlEnMontaje.numberFormats).toBeLessThanOrEqual(4);

    const rendersTrasMontaje = estado.renders;
    act(() => {
      useUserStore.setState(s => ({ users: [...s.users, usuario('contactoNuevo')] }));
    });
    expect(estado.renders).toBe(rendersTrasMontaje);
  });
});
