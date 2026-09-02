import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import ActivityScreen from '@/app/(tabs)/activity';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useAuthStore } from '@/src/store/authStore';
import type { Expense, Group, Payment, User } from '@/src/types/models';

/**
 * **Las filas del feed se dibujan, todas.**
 *
 * `View` NO acepta una función como `style`; `Pressable` sí. Las filas
 * compartían un `Container: any` con `style={({pressed}) => [...]}`, así que
 * toda fila SIN `onPress` —pedido de borrado, pago, borrado— se renderizaba
 * con la función ignorada y por lo tanto **sin un solo estilo**: sin
 * `flexDirection: row`, sin padding, sin borde. El ícono arriba y el texto
 * pegado al borde izquierdo. El PO lo reportó con captura.
 *
 * El `any` del Container es lo que impidió que TypeScript lo dijera, así que
 * el tipo no alcanza como red: hace falta este test.
 *
 * No se afirma sobre márgenes ni colores —eso no se testea acá por regla del
 * proyecto—: se afirma que **el estilo llegó**, que es la diferencia entre una
 * fila dibujada y una fila cruda.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

const ANA  = { id: 'ana',  name: 'Ana'  } as User;
const BETO = { id: 'beto', name: 'Beto' } as User;

const AHORA = 1_800_000_000_000;

const grupo: Group = {
  id: 'g1', name: 'Asado', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group;

/** Un gasto normal: la fila TOCABLE (lleva `onPress`). */
const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Carne', amount: 100_000, currency: 'ARS',
  paidById: 'beto', splitMode: 'equal',
  splits: [{ userId: 'ana', amount: 50_000 }, { userId: 'beto', amount: 50_000 }],
  memberIds: ['ana', 'beto'], category: 'food', date: AHORA, createdAt: AHORA,
  createdById: 'beto', deletionVotes: [], updatedAt: AHORA, isDeleted: false, ...over,
} as Expense);

/** Un pago: fila SIN `onPress` — la clase que se rompía. */
const pago: Payment = {
  id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto',
  amount: 30_000, currency: 'ARS', date: AHORA, createdAt: AHORA,
  createdById: 'ana', updatedAt: AHORA, isDeleted: false,
} as Payment;

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA, BETO] });
  useGroupStore.setState({ groups: [grupo] });
  usePaymentStore.setState({ payments: [] });
  useExpenseStore.setState({ expenses: [] });
});

function estilosDeFilas(r: ReturnType<typeof render>) {
  return r.getAllByTestId('activity-row').map(n => n.props.style);
}

describe('ninguna fila del feed queda sin estilo', () => {
  it('la fila de un pago —que no es tocable— recibe su estilo', () => {
    usePaymentStore.setState({ payments: [pago] });

    const estilos = estilosDeFilas(render(<ActivityScreen />));
    expect(estilos.length).toBeGreaterThan(0);
    // Una función acá significa que React Native la ignoró y la fila salió cruda.
    estilos.forEach(e => expect(typeof e).not.toBe('function'));
  });

  it('la fila de un pedido de borrado tampoco', () => {
    useExpenseStore.setState({ expenses: [gasto({
      deletionVotes: [{ userId: 'beto', votedAt: AHORA, action: 'delete' }],
    })] });

    const estilos = estilosDeFilas(render(<ActivityScreen />));
    expect(estilos.length).toBeGreaterThan(0);
    estilos.forEach(e => expect(typeof e).not.toBe('function'));
  });

  it('la de un gasto borrado, que tampoco es tocable', () => {
    useExpenseStore.setState({ expenses: [gasto({ isDeleted: true })] });

    const estilos = estilosDeFilas(render(<ActivityScreen />));
    expect(estilos.length).toBeGreaterThan(0);
    estilos.forEach(e => expect(typeof e).not.toBe('function'));
  });

  // Las tocables nunca estuvieron rotas, pero si mañana alguien "arregla" esto
  // volviendo todo a `View`, el feedback al tocar se pierde en silencio.
  it('la de un gasto sigue abriendo el gasto', () => {
    useExpenseStore.setState({ expenses: [gasto()] });

    const r = render(<ActivityScreen />);
    fireEvent.press(r.getAllByTestId('activity-row')[0]);
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('/expense/e1'));
  });

  it('con gastos y pagos juntos, TODAS quedan dibujadas', () => {
    useExpenseStore.setState({ expenses: [gasto()] });
    usePaymentStore.setState({ payments: [pago] });

    const estilos = estilosDeFilas(render(<ActivityScreen />));
    expect(estilos.length).toBeGreaterThanOrEqual(2);
    estilos.forEach(e => expect(typeof e).not.toBe('function'));
  });
});
