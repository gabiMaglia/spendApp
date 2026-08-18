import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useGlobalPersonBalances, useGroupsTotalBalance, useActivityFeed } from '../selectors';
import { useGroupStore } from '../groupStore';
import { useExpenseStore } from '../expenseStore';
import { usePaymentStore } from '../paymentStore';
import { useUserStore } from '../userStore';
import type { Expense, Group, User } from '@/src/types/models';

/**
 * Un grupo BORRADO no puede seguir generando deuda.
 *
 * Esa plata ya no se puede saldar —el grupo no existe, no hay pantalla donde
 * hacerlo— pero seguía figurando para siempre en Amigos y en el resumen. El
 * usuario veía que le debían algo que era imposible de cobrar.
 */

jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

const YO = 'ana';

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Group);

/** Ana puso 10.000 a medias ⇒ Beto le debe 5.000. */
const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Nafta', amount: 1_000_000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal',
  splits: [{ userId: 'ana', amount: 500_000 }, { userId: 'beto', amount: 500_000 }],
  memberIds: ['ana', 'beto'], category: 'transport', date: 0, createdAt: 0,
  createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Expense);

/** Renderiza un hook y devuelve su resultado. */
function usar<T>(hook: () => T): T {
  let salida!: T;
  function Probe() { salida = hook(); return <Text>x</Text>; }
  render(<Probe />);
  return salida;
}

beforeEach(() => {
  useUserStore.setState({ users: [
    { id: 'ana', name: 'Ana' } as User, { id: 'beto', name: 'Beto' } as User,
  ]});
  usePaymentStore.setState({ payments: [] });
  useExpenseStore.setState({ expenses: [gasto()] });
});

describe('un grupo borrado deja de contar', () => {
  it('con el grupo vivo, Beto me debe', () => {
    useGroupStore.setState({ groups: [grupo()] });

    const saldos = usar(() => useGlobalPersonBalances(YO));

    expect(saldos.find(s => s.userId === 'beto')?.amount).toBe(500_000);
  });

  it('borrado el grupo, ese saldo desaparece', () => {
    useGroupStore.setState({ groups: [grupo({ isDeleted: true })] });

    expect(usar(() => useGlobalPersonBalances(YO))).toEqual([]);
  });

  it('tampoco suma al resumen de arriba', () => {
    useGroupStore.setState({ groups: [grupo({ isDeleted: true })] });

    const totales = usar(() => useGroupsTotalBalance(YO));

    expect(totales.find(t => t.currency === 'ARS')?.owedToYou ?? 0).toBe(0);
  });

  // La actividad es un REGISTRO de lo que pasó, no una afirmación sobre el
  // presente. Borrar un grupo saca sus deudas (ya no se pueden saldar) pero no
  // puede borrarte la historia de lo que hiciste.
  it('PERO la actividad se conserva: es historial, no saldo', () => {
    useGroupStore.setState({ groups: [grupo({ isDeleted: true })] });

    expect(usar(() => useActivityFeed(YO))).toHaveLength(1);
  });

  /**
   * Los saldos de un grupo ajeno entran al pozo global y cambian CON QUIÉN me
   * empareja la simplificación de deudas.
   *
   * Acá: Beto me debe 5.000 en mi grupo, y en OTRO grupo donde yo no estoy,
   * Caro le debe 3.000 a Beto. Si ese grupo contara, la simplificación diría
   * que Caro me paga a mí 3.000 — alguien con quien nunca compartí un gasto y
   * a quien no le puedo reclamar nada.
   */
  it('un grupo del que no soy parte no me inventa deudores', () => {
    useGroupStore.setState({ groups: [
      grupo(),
      grupo({ id: 'g2', memberIds: ['beto', 'caro'] }),
    ]});
    useExpenseStore.setState({ expenses: [
      gasto(),
      gasto({
        id: 'e2', groupId: 'g2', amount: 600_000, paidById: 'beto',
        splits: [{ userId: 'beto', amount: 300_000, isPaid: false }, { userId: 'caro', amount: 300_000, isPaid: false }],
      }),
    ]});

    const saldos = usar(() => useGlobalPersonBalances(YO));

    expect(saldos.map(s => s.userId)).toEqual(['beto']);
    expect(saldos[0]!.amount).toBe(500_000);
  });
});
