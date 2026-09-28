import React, { Profiler, type ProfilerOnRenderCallback } from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import Animated from 'react-native-reanimated';

import FriendsScreen from '@/app/(tabs)/friends';
import GroupsScreen from '@/app/(tabs)/groups';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Expense, Group, Payment, User } from '@/src/types/models';
import * as calc from '@/src/algorithms/calculateBalances';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

/**
 * T-202: arnés de MEDICIÓN, no de arreglo. Puebla los stores con un dataset
 * "de gama alta de uso real" (20 grupos, 8 miembros, 400 gastos, 60 pagos, 30
 * contactos) y mide, sin tocar la UI: tiempo de primer render, cantidad de
 * renders de la pantalla, y cuántas veces se llama a
 * `calculateBalancesByCurrency` en el montaje. Una moneda sola (ARS) para no
 * disparar `ensureRates` (red) durante el test — no es lo que se mide acá.
 *
 * Umbrales HOLGADOS a propósito: esto es Jest/jsdom, no el Moto E40 real — el
 * objetivo es agarrar una regresión de ORDEN DE MAGNITUD (p. ej. N² en vez de
 * N pasadas sobre los gastos), no imitar el frame budget del dispositivo.
 */

const MEMBER_IDS = Array.from({ length: 8 }, (_, i) => `user${i}`);
const [ANA_ID] = MEMBER_IDS;

const usuario = (id: string): User => ({
  id, name: `Nombre ${id}`, email: `${id}@test.com`, authProvider: 'guest',
  createdAt: 0, updatedAt: 0, isDeleted: false,
} as User);

const grupo = (id: string, members: string[]): Group => ({
  id, name: `Grupo ${id}`, memberIds: members, currency: 'ARS',
  miembros: {},
  createdAt: 0, createdById: ANA_ID, updatedAt: 0, isDeleted: false,
} as Group);

const gasto = (id: string, groupId: string, members: string[], paidById: string): Expense => {
  const share = Math.floor(300_000 / members.length);
  return {
    id, groupId, description: `Gasto ${id}`, amount: share * members.length,
    currency: 'ARS', paidById, splitMode: 'equal',
    splits: members.map(userId => ({ userId, amount: share, isPaid: userId === paidById })),
    memberIds: members, category: 'other', date: 0, createdAt: 0,
    createdById: paidById, updatedAt: 0, isDeleted: false,
  } as Expense;
};

const pago = (id: string, groupId: string, from: string, to: string): Payment => ({
  id, groupId, fromUserId: from, toUserId: to, amount: 50_000, currency: 'ARS',
  date: 0, createdAt: 0, createdById: from,
  updatedAt: 0, isDeleted: false,
} as Payment);

function seedDataset() {
  const contactUsers = Array.from({ length: 30 }, (_, i) => usuario(`contact${i}`));
  const memberUsers = MEMBER_IDS.map(usuario);

  const groups: Group[] = Array.from({ length: 20 }, (_, i) => {
    // Cada grupo con un subconjunto rotado de miembros (3 a 8), no siempre los mismos.
    const size = 3 + (i % 6);
    const members = MEMBER_IDS.slice(0, size);
    return grupo(`g${i}`, members);
  });

  const expenses: Expense[] = [];
  for (let i = 0; i < 400; i++) {
    const group = groups[i % groups.length];
    const paidBy = group.memberIds[i % group.memberIds.length];
    expenses.push(gasto(`e${i}`, group.id, group.memberIds, paidBy));
  }

  const payments: Payment[] = [];
  for (let i = 0; i < 60; i++) {
    const group = groups[i % groups.length];
    const from = group.memberIds[i % group.memberIds.length];
    const to = group.memberIds[(i + 1) % group.memberIds.length];
    payments.push(pago(`p${i}`, group.id, from, to));
  }

  useAuthStore.setState({ currentUser: memberUsers[0] });
  useUserStore.setState({ users: [...memberUsers, ...contactUsers] });
  useGroupStore.setState({ groups });
  useArchiveStore.setState({ archivedIds: [] });
  useExpenseStore.setState({ expenses });
  usePaymentStore.setState({ payments });
}

beforeEach(() => {
  createSecureStorage('groups').clearAll();
  seedDataset();
});

/** Cuenta renders + tiempo acumulado de `actualDuration` reportado por React. */
function contadorDeRenders() {
  const estado = { renders: 0, actualDurationTotal: 0 };
  const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
    estado.renders += 1;
    estado.actualDurationTotal += actualDuration;
  };
  return { estado, onRender };
}

describe('T-202 — medición de perf de Amigos y Grupos (antes de arreglar)', () => {
  it('Grupos: primer render, cantidad de renders y llamadas a calculateBalancesByCurrency', () => {
    const spy = jest.spyOn(calc, 'calculateBalancesByCurrency');
    const { estado, onRender } = contadorDeRenders();

    const t0 = performance.now();
    render(
      <Profiler id="groups" onRender={onRender}>
        <GroupsScreen />
      </Profiler>,
    );
    const t1 = performance.now();
    const primerRenderMs = t1 - t0;

    console.log('[T-202][Grupos] primerRenderMs=%s renders=%s actualDurationTotal=%s calcCalls=%s',
      primerRenderMs.toFixed(1), estado.renders, estado.actualDurationTotal.toFixed(1), spy.mock.calls.length);

    // Umbrales holgados — regresión de orden de magnitud, no frame budget real.
    expect(primerRenderMs).toBeLessThan(3000);
    expect(estado.renders).toBeLessThanOrEqual(6);
    // 20 filas visibles (todas "activos") ⇒ como mínimo 20 llamadas de fila +
    // las de los totales (`useGroupsTotalBalance`/`useGroupsNetBalanceFor`,
    // 20 grupos cada una). Umbral holgado: falla si el orden de magnitud se
    // dispara (p. ej. una pasada extra por render de la pantalla completa).
    expect(spy.mock.calls.length).toBeLessThanOrEqual(150);

    spy.mockRestore();
  });

  /**
   * **Root cause real detrás del sospechoso #2/#6.** `visibles.map(g => g.id)`
   * en `groups.tsx` se pasa SIN memoizar a `useGroupsNetTotal`; ese hook arma
   * un `Set` nuevo (`useMemo(..., [visibleGroupIds])`) que ve una referencia
   * "nueva" en CADA render de la pantalla — así el render venga de datos
   * reales o de un layout event sin relación — y vuelve a correr
   * `calculateBalancesByCurrency` para TODOS los grupos visibles otra vez.
   * El segundo `onLayout` real del `ScrollView` (semilla `useWindowDimensions`
   * → alto medido, `useHeaderColapsable.ts`) es el disparador más fácil de
   * reproducir en Jest, pero el bug es "cualquier re-render", no ese layout
   * puntual — por eso el fix es memoizar el array, no tocar el layout.
   */
  it('Grupos: un re-render SIN cambios de datos no debe volver a calcular los balances', () => {
    const spy = jest.spyOn(calc, 'calculateBalancesByCurrency');

    const r = render(<GroupsScreen />);
    const callsTrasMontaje = spy.mock.calls.length;

    // Evento de layout real y distinto al alto semilla (useWindowDimensions) —
    // dispara `setAltoVisible` en `useHeaderColapsable`, un re-render de
    // `GroupsScreen` sin que cambie ningún dato de negocio.
    const scroll = r.UNSAFE_getAllByType(Animated.ScrollView)[0];
    fireEvent(scroll, 'layout', { nativeEvent: { layout: { height: 555, width: 400, x: 0, y: 0 } } });

    expect(spy.mock.calls.length).toBe(callsTrasMontaje);

    spy.mockRestore();
  });

  it('Amigos: primer render, cantidad de renders y llamadas a calculateBalancesByCurrency', () => {
    const spy = jest.spyOn(calc, 'calculateBalancesByCurrency');
    const { estado, onRender } = contadorDeRenders();

    const t0 = performance.now();
    render(
      <Profiler id="friends" onRender={onRender}>
        <FriendsScreen />
      </Profiler>,
    );
    const t1 = performance.now();
    const primerRenderMs = t1 - t0;

    console.log('[T-202][Amigos] primerRenderMs=%s renders=%s actualDurationTotal=%s calcCalls=%s',
      primerRenderMs.toFixed(1), estado.renders, estado.actualDurationTotal.toFixed(1), spy.mock.calls.length);

    expect(primerRenderMs).toBeLessThan(3000);
    expect(estado.renders).toBeLessThanOrEqual(6);
    // Acá el cálculo es UNA pasada por grupo (useGlobalPersonBalances +
    // useContactosConHistorial), no por fila — 20 grupos ⇒ ~40 llamadas.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(80);

    spy.mockRestore();
  });
});
