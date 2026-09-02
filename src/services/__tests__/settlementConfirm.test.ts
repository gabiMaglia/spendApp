import { puedeAcusar, emitirAcuse, acusarRecibo } from '../settlementConfirm';
import { estadoDelSaldado } from '@/src/algorithms/settlementStatus';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useGroupStore } from '@/src/store/groupStore';
import type { Group, Payment } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

/** Ana declara que le pagó a Beto. El que tiene que acusar recibo es Beto. */
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

describe('quién puede acusar recibo', () => {
  it('el que cobra, sí', () => {
    expect(puedeAcusar(pago(), grupo(), 'beto')).toBe(true);
  });

  it('el que paga, no: sería cerrar su propia deuda', () => {
    expect(puedeAcusar(pago(), grupo(), 'ana')).toBe(false);
  });

  it('un tercero del grupo tampoco', () => {
    expect(puedeAcusar(pago(), grupo(), 'caro')).toBe(false);
  });

  it('en un grupo abierto no hay nada que acusar', () => {
    expect(puedeAcusar(pago(), grupo('open'), 'beto')).toBe(false);
  });

  it('un pago borrado no se acusa', () => {
    expect(puedeAcusar(pago({ isDeleted: true }), grupo(), 'beto')).toBe(false);
  });
});

describe('el acuse que se emite', () => {
  it('confirmar deja el saldado efectivo', () => {
    const p = { ...pago(), confirmations: emitirAcuse(pago(), 'beto', 'confirm', 1_000) };
    expect(estadoDelSaldado(p, grupo())).toBe('efectivo');
  });

  it('rechazar devuelve la deuda a la vida', () => {
    const p = { ...pago(), confirmations: emitirAcuse(pago(), 'beto', 'reject', 1_000) };
    expect(estadoDelSaldado(p, grupo())).toBe('rechazado');
  });

  /**
   * **La invariante que no se negocia.** El array se UNE en el merge: si al
   * acusar se borraran los acuses ajenos, el de otro volvería del primer peer
   * que sincronice y nadie sabría por qué reapareció.
   */
  it('no se lleva puesto el acuse de otro', () => {
    const previo = pago({ confirmations: [
      { userId: 'caro', confirmedAt: 500, action: 'confirm' },
    ] });
    const cs = emitirAcuse(previo, 'beto', 'confirm', 1_000);
    expect(cs.map(c => c.userId).sort()).toEqual(['beto', 'caro']);
  });

  // El derivador ya lo daba por reemplazado; dejarlo sólo haría crecer el array
  // que viaja en cada sobre (T-058).
  it('reemplaza MI acuse anterior en vez de acumularlo', () => {
    const previo = pago({ confirmations: [
      { userId: 'beto', confirmedAt: 500, action: 'confirm' },
    ] });
    const cs = emitirAcuse(previo, 'beto', 'reject', 1_000);
    expect(cs).toHaveLength(1);
    expect(cs[0].action).toBe('reject');
  });
});

describe('acusarRecibo escribe en el store', () => {
  it('el cobrador confirma y el pago queda efectivo', () => {
    expect(acusarRecibo('p1', 'beto', 'confirm', 1_000)).toBe(true);
    const p = usePaymentStore.getState().payments[0];
    expect(estadoDelSaldado(p, grupo())).toBe('efectivo');
  });

  it('el que paga no puede confirmarse a sí mismo', () => {
    expect(acusarRecibo('p1', 'ana', 'confirm', 1_000)).toBe(false);
    expect(usePaymentStore.getState().payments[0].confirmations).toBeUndefined();
  });

  it('un pago que no existe no rompe nada', () => {
    expect(acusarRecibo('nope', 'beto', 'confirm', 1_000)).toBe(false);
  });

  /**
   * Escribir el acuse NO puede re-firmar el pago con la clave del que cobra:
   * eso le robaría la autoría al que pagó y lo dejaría marcado como
   * suplantación en la pantalla del otro. Lo garantiza `signOnEdit` —sólo
   * re-firma si soy el autor Y cambió el núcleo—, y `confirmations` está
   * clasificado fuera del núcleo. Esto lo ata.
   */
  it('acusar no toca la autoría del pago', () => {
    const antes = usePaymentStore.getState().payments[0];
    acusarRecibo('p1', 'beto', 'confirm', 1_000);
    const despues = usePaymentStore.getState().payments[0];
    expect(despues.createdById).toBe(antes.createdById);
    expect(despues.k).toBe(antes.k);
    expect(despues.rev).toBe(antes.rev);
  });
});
