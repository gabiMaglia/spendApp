import React, { Profiler, type ProfilerOnRenderCallback } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

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
   * **T-209 — fix del hallazgo de arriba.**
   * `contactosDisponibles`/`allUsers` (antes en `app/groups/[id].tsx:90-104`)
   * vivían suscriptos en la pantalla aunque sólo los usa el modal "invitar
   * por username". Un alta/edición de contacto ajeno al grupo re-renderizaba
   * la pantalla ENTERA (medido 1→3 acá antes del fix). Ahora esa suscripción
   * vive dentro de `InvitarPorUsernameSheet`
   * (`src/screens/groups/components/InvitarPorUsernameSheet.tsx`), montado
   * sólo con el modal abierto — la pantalla, cerrada, no se entera.
   */
  it('un contacto nuevo ajeno al grupo NO re-renderiza la pantalla (T-209)', () => {
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

    console.log('[T-209][Grupo] rendersTrasMontaje=%s rendersTrasContactoAjeno=%s',
      rendersTrasMontaje, estado.renders);

    expect(estado.renders).toBe(rendersTrasMontaje);
  });

  // T-209: el modal sigue mostrando altas ajenas mientras está ABIERTO — el
  // fix es de suscripción (quién escucha y cuándo), no de que el dato deje
  // de llegar.
  it('con el modal de invitar abierto, el contacto nuevo SÍ aparece en la lista (T-209)', () => {
    const r = render(<GroupDetailScreen />);

    fireEvent.press(r.getByTestId('group-options'));
    fireEvent.press(r.getByText('group_detail.add_person'));

    act(() => {
      useUserStore.setState(s => ({ users: [...s.users, usuario('contactoNuevo')] }));
    });

    expect(r.getByText('Nombre contactoNuevo')).toBeTruthy();
  });
});
