import React, { Profiler, type ProfilerOnRenderCallback } from 'react';
import { act, render, fireEvent } from '@testing-library/react-native';

import NewExpenseScreen from '@/app/expense/new';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import type { Group, User } from '@/src/types/models';

/**
 * T-204/T-198 — Nuevo gasto. Ver `perfGamaBajaInicio.test.tsx` para el
 * porqué de un archivo por pantalla.
 *
 * **La medición que motivó T-198.** Grupo de 8 miembros ⇒ el preview de
 * splits dibuja 8 filas con `formatMoney` por tecla (`app/expense/new.tsx:761`
 * y `:772`). ANTES del cache de `getCachedNumberFormat` (T-198), cada tecla
 * podía construir hasta 8 `Intl.NumberFormat` nuevos (uno por fila) — caro en
 * Hermes/Moto E40. Con el cache, el espacio de claves es fijo: no debería
 * crecer con la cantidad de teclas ni de miembros.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
let mockSearchParams: Record<string, string | undefined> = { groupId: 'g0' };
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
  let numberFormats = 0;
  class SpyNumberFormat extends OriginalNumberFormat {
    constructor(...args: ConstructorParameters<typeof Intl.NumberFormat>) { super(...args); numberFormats += 1; }
  }
  // @ts-expect-error — reemplazo global sólo durante la medición
  global.Intl.NumberFormat = SpyNumberFormat;
  try { fn(); } finally {
    global.Intl.NumberFormat = OriginalNumberFormat;
  }
  return { numberFormats };
}

beforeEach(() => {
  mockSearchParams = { groupId: 'g0' };
  const memberUsers = MEMBER_IDS.map(usuario);
  const grupo: Group = {
    id: 'g0', name: 'Grupo grande', memberIds: MEMBER_IDS, currency: 'ARS',
    miembros: {}, createdAt: 0, createdById: MEMBER_IDS[0], updatedAt: 0, isDeleted: false,
  } as Group;

  useAuthStore.setState({ currentUser: memberUsers[0], isPro: false });
  useUserStore.setState({ users: memberUsers });
  useGroupStore.setState({ groups: [grupo] });
  useExpenseStore.setState({ expenses: [] });
});

describe('T-204 — Nuevo gasto: montaje', () => {
  it('renders y Intl.* construidos al montar (grupo de 8 miembros)', () => {
    const estado = { renders: 0 };
    const onRender: ProfilerOnRenderCallback = () => { estado.renders += 1; };

    const intlEnMontaje = medirConstruccionesIntl(() => {
      render(
        <Profiler id="nuevoGasto" onRender={onRender}>
          <NewExpenseScreen />
        </Profiler>,
      );
    });

    console.log('[T-204][NuevoGasto][montaje] renders=%s numberFormats=%s',
      estado.renders, intlEnMontaje.numberFormats);

    expect(estado.renders).toBeLessThanOrEqual(8);
    expect(intlEnMontaje.numberFormats).toBeLessThanOrEqual(4);
  });
});

describe('T-198 — Nuevo gasto: tipeo del monto', () => {
  it('10 teclas (grupo de 8 miembros): a lo sumo 1 instancia nueva de Intl.NumberFormat en total', () => {
    const r = render(<NewExpenseScreen />);
    const montoInput = r.getByPlaceholderText('0');

    const digitos = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    let textoActual = '';

    const { numberFormats } = medirConstruccionesIntl(() => {
      for (const d of digitos) {
        textoActual += d;
        act(() => {
          fireEvent.changeText(montoInput, textoActual);
        });
      }
    });

    console.log('[T-198][NuevoGasto] teclas=%s numberFormatsDurantePersecucion=%s', digitos.length, numberFormats);

    // Umbral por CONTEO (P-15/systematic-debugging), no por ms: con el cache
    // de módulo de T-198, ninguna tecla debería construir un formatter
    // nuevo — a lo sumo el primero de la corrida, si el cache no lo tenía
    // todavía para este locale/decimales.
    expect(numberFormats).toBeLessThanOrEqual(1);
  });
});
