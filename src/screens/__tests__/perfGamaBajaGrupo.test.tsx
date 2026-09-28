import React, { Profiler, type ProfilerOnRenderCallback } from 'react';
import { act, render } from '@testing-library/react-native';

import GroupDetailScreen from '@/app/groups/[id]';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Expense, Group, Payment, User } from '@/src/types/models';

/** T-204 — Detalle de grupo. Ver `perfGamaBajaInicio.test.tsx` para el
 *  porqué de un archivo por pantalla y el dataset chico. */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
let mockSearchParams: Record<string, string | undefined> = { id: 'g0' };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => mockSearchParams,
}));

const MEMBER_IDS = Array.from({ length: 8 }, (_, i) => `user${i}`); // grupo grande: 8 miembros

const usuario = (id: string): User => ({
  id, name: `Nombre ${id}`, email: `${id}@test.com`, authProvider: 'guest',
  createdAt: 0, updatedAt: 0, isDeleted: false,
} as User);

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

let expensesDelGrupo: number;

beforeEach(() => {
  createSecureStorage('groups').clearAll();
  mockSearchParams = { id: 'g0' };

  const memberUsers = MEMBER_IDS.map(usuario);
  const grupoGrande: Group = {
    id: 'g0', name: 'Grupo grande', memberIds: MEMBER_IDS, currency: 'ARS',
    miembros: {}, createdAt: 0, createdById: MEMBER_IDS[0], updatedAt: 0, isDeleted: false,
  } as Group;

  const expenses: Expense[] = [];
  for (let i = 0; i < 40; i++) {
    expenses.push(gasto(`e${i}`, 'g0', MEMBER_IDS, MEMBER_IDS[i % MEMBER_IDS.length]));
  }
  expensesDelGrupo = expenses.length;

  const payments: Payment[] = [];
  for (let i = 0; i < 10; i++) {
    payments.push(pago(`p${i}`, 'g0', MEMBER_IDS[0], MEMBER_IDS[1]));
  }

  useAuthStore.setState({ currentUser: memberUsers[0], isPro: false });
  useUserStore.setState({ users: memberUsers });
  useGroupStore.setState({ groups: [grupoGrande] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
  useExpenseStore.setState({ expenses });
  usePaymentStore.setState({ payments });
});

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

describe('T-204 — Detalle de grupo', () => {
  it('montaje: renders, Intl.* construidos, timeline sin virtualizar (medido)', () => {
    const estado = { renders: 0 };
    const onRender: ProfilerOnRenderCallback = () => { estado.renders += 1; };

    const intlEnMontaje = medirConstruccionesIntl(() => {
      render(
        <Profiler id="grupo" onRender={onRender}>
          <GroupDetailScreen />
        </Profiler>,
      );
    });

    console.log('[T-204][Grupo] renders=%s numberFormats=%s dateTimeFormats=%s gastosDelGrupo(sinVirtualizar)=%s',
      estado.renders, intlEnMontaje.numberFormats, intlEnMontaje.dateTimeFormats, expensesDelGrupo);

    expect(estado.renders).toBeLessThanOrEqual(8);
    expect(intlEnMontaje.numberFormats).toBeLessThanOrEqual(4);
  });

  /**
   * **Hallazgo (no arreglado, va como recomendación en el reporte).**
   * `app/groups/[id].tsx:90` — `const allUsers = useUserStore(s => s.users);`
   * — sin selector angosto. Sólo lo usa `contactosDisponibles` (línea 96-104,
   * la lista del modal "invitar por username"), pero la suscripción es a
   * TODO `users`: cualquier alta/edición de un contacto EN CUALQUIER PARTE
   * de la app (no sólo en este grupo) re-renderiza la pantalla completa —
   * balances, timeline, todo. No es el mismo bug que T-202 (acá no se arma
   * un array NUEVO en cada render; el array de verdad cambió), así que no
   * hay memoización que lo arregle sin cambiar arquitectura: la lista de
   * contactos disponibles NECESITA saber de altas ajenas para estar
   * completa. El fix real es aislar `allUsers`/`contactosDisponibles` en un
   * componente hijo que sólo se monte con el modal de invitar abierto — es
   * un cambio de estructura, no un `useMemo`, así que queda para un ticket
   * aparte en vez de tocarlo acá sin OK del PO.
   */
  it('(hallazgo) un contacto nuevo en cualquier parte de la app SÍ re-renderiza esta pantalla — medido, no arreglado', () => {
    const estado = { renders: 0 };
    const onRender: ProfilerOnRenderCallback = () => { estado.renders += 1; };

    render(
      <Profiler id="grupo-ajeno" onRender={onRender}>
        <GroupDetailScreen />
      </Profiler>,
    );
    const rendersTrasMontaje = estado.renders;

    act(() => {
      useUserStore.setState(s => ({ users: [...s.users, usuario('contactoNuevo')] }));
    });

    console.log('[T-204][Grupo][hallazgo] rendersTrasMontaje=%s rendersTrasContactoAjeno=%s (groups/[id].tsx:90)',
      rendersTrasMontaje, estado.renders);

    // Documenta el comportamiento ACTUAL (re-renderiza) — no es un gate de
    // regresión, es la evidencia del hallazgo de arriba.
    expect(estado.renders).toBeGreaterThan(rendersTrasMontaje);
  });
});
