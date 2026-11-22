import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { useGuardarSaldo } from '@/src/screens/settle/hooks/useGuardarSaldo';
import { useSaldoConAmigo } from '@/src/screens/settle/hooks/useSaldoConAmigo';
import { useAuthStore } from '@/src/store/authStore';
import { hapticExito } from '@/src/utils/haptics';
import { motivoDeExceso } from '@/src/services/topeDeRegistro';
import { pagosParaSaldarConAmigo } from '@/src/algorithms/saldoSinCompensar';
import type { User } from '@/src/types/models';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('@/src/utils/haptics', () => ({
  hapticExito: jest.fn(), hapticAdvertencia: jest.fn(), hapticSeleccionar: jest.fn(),
}));
jest.mock('@/src/services/topeDeRegistro', () => ({ motivoDeExceso: jest.fn(() => null) }));
jest.mock('@/src/algorithms/saldoSinCompensar', () => ({
  ...jest.requireActual('@/src/algorithms/saldoSinCompensar'),
  pagosParaSaldarConAmigo: jest.fn(),
}));

const yo = { id: 'yo' } as User;
const mockExceso = motivoDeExceso as jest.Mock;
const mockPagos = pagosParaSaldarConAmigo as jest.Mock;

function guardarEnGrupo(over: Partial<Parameters<typeof useGuardarSaldo>[0]> = {}) {
  const addPayment = jest.fn();
  const hook = renderHook(() => useGuardarSaldo({
    canSave: true, exceedsMax: false, currentUser: yo, modoTodo: false, acreedores: [],
    amount: 4200, groupId: 'g1', fromId: 'yo', toId: 'ana', currency: 'ARS',
    date: new Date(), addPayment, ...over,
  }));
  return { hook, addPayment };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExceso.mockReturnValue(null);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  useAuthStore.setState({ currentUser: yo } as never);
});

describe('momento de cierre — saldo en grupo (T-290)', () => {
  it('éxito: guarda, vibra, abre el momento con el monto final y NO navega todavía', () => {
    const { hook, addPayment } = guardarEnGrupo();
    expect(hook.result.current.momento).toBeNull();
    act(() => { hook.result.current.handleSave(); });
    expect(addPayment).toHaveBeenCalledTimes(1);
    expect(hapticExito).toHaveBeenCalledTimes(1);
    expect(hook.result.current.momento?.montos).toEqual([{ minor: 4200, code: 'ARS' }]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(require('expo-router').router.back).not.toHaveBeenCalled();
  });

  it('modo «todo»: el momento suma lo repartido', () => {
    const { hook, addPayment } = guardarEnGrupo({
      modoTodo: true, amount: 300,
      acreedores: [{ userId: 'ana', amount: 200 }, { userId: 'beto', amount: 100 }],
    });
    act(() => { hook.result.current.handleSave(); });
    expect(addPayment).toHaveBeenCalledTimes(2);
    expect(hook.result.current.momento?.montos).toEqual([{ minor: 300, code: 'ARS' }]);
  });

  it('error (excede el tope del sobre): alerta de siempre, sin guardar y sin momento', () => {
    mockExceso.mockReturnValue('sync.record_too_big_expense');
    const { hook, addPayment } = guardarEnGrupo();
    act(() => { hook.result.current.handleSave(); });
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(addPayment).not.toHaveBeenCalled();
    expect(hapticExito).not.toHaveBeenCalled();
    expect(hook.result.current.momento).toBeNull();
  });

  it('no se puede guardar: nada pasa', () => {
    const { hook, addPayment } = guardarEnGrupo({ canSave: false });
    act(() => { hook.result.current.handleSave(); });
    expect(addPayment).not.toHaveBeenCalled();
    expect(hook.result.current.momento).toBeNull();
  });
});

describe('momento de cierre — saldo con un amigo (T-290)', () => {
  const pagos = [
    { groupId: 'g1', groupName: 'Casa', toUserId: 'ana', amount: 1000, currency: 'ARS' },
    { groupId: 'g2', groupName: 'Viaje', toUserId: 'ana', amount: 500, currency: 'ARS' },
    { groupId: 'g3', groupName: 'Cena', toUserId: 'ana', amount: 7, currency: 'USD' },
  ];

  function confirmarYAceptar(hook: ReturnType<typeof renderHook<ReturnType<typeof useSaldoConAmigo>, unknown>>) {
    act(() => { hook.result.current.confirmar(); });
    const botones = (Alert.alert as jest.Mock).mock.calls[0][2] as { onPress?: () => void }[];
    act(() => { botones[1].onPress?.(); });
  }

  it('éxito: abre el momento con un monto por moneda y no navega todavía', () => {
    mockPagos.mockReturnValue(pagos);
    const hook = renderHook(() => useSaldoConAmigo('ana'));
    confirmarYAceptar(hook);
    expect(hapticExito).toHaveBeenCalledTimes(1);
    expect(hook.result.current.momento?.montos).toEqual([
      { minor: 1500, code: 'ARS' }, { minor: 7, code: 'USD' },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(require('expo-router').router.back).not.toHaveBeenCalled();
  });

  it('error (excede el tope): alerta, sin momento y sin vibración de éxito', () => {
    mockPagos.mockReturnValue(pagos);
    mockExceso.mockReturnValue('sync.record_too_big_expense');
    const hook = renderHook(() => useSaldoConAmigo('ana'));
    confirmarYAceptar(hook);
    expect(Alert.alert).toHaveBeenCalledTimes(2);
    expect(hapticExito).not.toHaveBeenCalled();
    expect(hook.result.current.momento).toBeNull();
  });
});
