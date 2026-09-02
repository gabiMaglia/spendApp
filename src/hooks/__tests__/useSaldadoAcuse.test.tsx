import { act, renderHook } from '@testing-library/react-native';
import { useSaldadoAcuse } from '../useSaldadoAcuse';
import { useGroupStore } from '@/src/store/groupStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import type { Group, Payment } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

/** Ana declara que le pagó a Beto: el que tiene que acusar recibo es Beto. */
const pago = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto',
  amount: 500_000, currency: 'ARS', date: 0, createdAt: 0,
  createdById: 'ana', updatedAt: 0, isDeleted: false, ...over,
} as Payment);

const grupo = (mode: 'consensus' | 'open' = 'consensus'): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
  deletionMode: mode, createdAt: 0, createdById: 'ana',
  deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group);

beforeEach(() => {
  useGroupStore.setState({ groups: [grupo()] });
  usePaymentStore.setState({ payments: [pago()] });
});

describe('a quién le toca', () => {
  it('a quien cobra, mientras no decidió', () => {
    const { result } = renderHook(() => useSaldadoAcuse(pago(), 'beto'));
    expect(result.current.estado).toBe('pendiente');
    expect(result.current.meToca).toBe(true);
  });

  it('a quien paga no le toca: vería su deuda y la cerraría sola', () => {
    const { result } = renderHook(() => useSaldadoAcuse(pago(), 'ana'));
    expect(result.current.meToca).toBe(false);
  });

  it('en un grupo abierto no hay nada que decidir', () => {
    useGroupStore.setState({ groups: [grupo('open')] });
    const { result } = renderHook(() => useSaldadoAcuse(pago(), 'beto'));
    expect(result.current.estado).toBe('efectivo');
    expect(result.current.meToca).toBe(false);
  });

  /**
   * Después de decidir, la fila deja de pedir una decisión ya tomada. Sin esto,
   * los botones quedan ahí y la persona no sabe si su acuse entró.
   */
  it('una vez que acusó, deja de tocarle', () => {
    const p = pago({ confirmations: [{ userId: 'beto', confirmedAt: 1, action: 'confirm' }] });
    const { result } = renderHook(() => useSaldadoAcuse(p, 'beto'));
    expect(result.current.estado).toBe('efectivo');
    expect(result.current.meToca).toBe(false);
  });
});

describe('las acciones escriben de verdad', () => {
  it('confirmar deja el saldado efectivo en el store', () => {
    const { result } = renderHook(() => useSaldadoAcuse(pago(), 'beto'));
    act(() => result.current.confirmar());

    const guardado = usePaymentStore.getState().payments[0];
    expect(guardado.confirmations).toHaveLength(1);
    expect(guardado.confirmations![0]).toMatchObject({ userId: 'beto', action: 'confirm' });
  });

  it('rechazar queda registrado como rechazo', () => {
    const { result } = renderHook(() => useSaldadoAcuse(pago(), 'beto'));
    act(() => result.current.rechazar());

    expect(usePaymentStore.getState().payments[0].confirmations![0].action).toBe('reject');
  });

  it('el que paga no puede escribir nada aunque llame a la acción', () => {
    const { result } = renderHook(() => useSaldadoAcuse(pago(), 'ana'));
    act(() => result.current.confirmar());

    expect(usePaymentStore.getState().payments[0].confirmations).toBeUndefined();
  });
});
