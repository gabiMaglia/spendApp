import { traspasarGrupo, siguienteNombreDisponible } from '../groupTraspaso';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { announceGroupToContacts } from '@/src/sync/relayEngine';
import type { Group, Expense, Payment, SettlementConfirmation } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));

function grupo(over: Partial<Group> = {}): Group {
  return {
    id: 'g-viejo', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
    createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
    createdById: 'ana', deletionVotes: [],
    ...over,
  };
}

function gasto(over: Partial<Expense> = {}): Expense {
  return {
    id: `e-${Math.random()}`, groupId: 'g-viejo', description: 'x', amount: 20_000, currency: 'ARS',
    paidById: 'ana', splits: [{ userId: 'beto', amount: 10_000, isPaid: false }, { userId: 'ana', amount: 10_000, isPaid: false }],
    splitMode: 'equal', category: 'other', date: 1_000, createdAt: 1_000, updatedAt: 1_000,
    createdById: 'ana', isDeleted: false, deletionVotes: [],
    ...over,
  } as Expense;
}

function pago(over: Partial<Payment> = {}): Payment {
  return {
    id: `p-${Math.random()}`, groupId: 'g-viejo', fromUserId: 'beto', toUserId: 'ana',
    amount: 10_000, currency: 'ARS', date: 1_000, createdAt: 1_000,
    createdById: 'beto', updatedAt: 1_000, isDeleted: false,
    ...over,
  } as Payment;
}

const acuse = (o: Partial<SettlementConfirmation> = {}): SettlementConfirmation => ({
  userId: 'ana', confirmedAt: 2_000, action: 'confirm', ...o,
});

beforeEach(() => {
  (['groups', 'expenses', 'payments'] as const).forEach(b => createSecureStorage(b).clearAll());
  useGroupStore.setState({ groups: [grupo()] });
  useExpenseStore.setState({
    // Ana pagó 20.000, se dividió mitad y mitad → Beto le debe 10.000 a Ana.
    expenses: [gasto({ splits: [{ userId: 'beto', amount: 20_000, isPaid: false }] })],
  });
  usePaymentStore.setState({ payments: [] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
  useGroupKeyStore.setState({ keys: [] });
  jest.clearAllMocks();
});

describe('traspasarGrupo', () => {
  it('crea un grupo nuevo con los mismos miembros y moneda', () => {
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    expect(nuevo.memberIds).toEqual(viejo.memberIds);
    expect(nuevo.currency).toBe(viejo.currency);
    expect(nuevo.id).not.toBe(viejo.id);
    expect(useGroupStore.getState().groups.some(g => g.id === nuevo.id)).toBe(true);
  });

  it('crea exactamente un Expense de traspaso en el grupo nuevo, con el balance correcto', () => {
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    const delNuevo = useExpenseStore.getState().expenses.filter(e => e.groupId === nuevo.id);
    expect(delNuevo).toHaveLength(1);
    expect(delNuevo[0].payers).toEqual([{ userId: 'ana', amount: 20_000 }]);
    expect(delNuevo[0].splits).toEqual([{ userId: 'beto', amount: 20_000, isPaid: false }]);
  });

  it('archiva el grupo viejo con reason "limit" (irrevocable)', () => {
    const viejo = useGroupStore.getState().groups[0];
    traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    expect(useArchiveStore.getState().isArchived(viejo.id)).toBe(true);
    expect(useArchiveStore.getState().canUnarchive(viejo.id)).toBe(false);
  });

  it('marca el grupo viejo con supersededByGroupId apuntando al nuevo', () => {
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    const viejoActualizado = useGroupStore.getState().groups.find(g => g.id === viejo.id);
    expect(viejoActualizado?.supersededByGroupId).toBe(nuevo.id);
  });

  it('un grupo ya saldado (balance cero) traspasa sin crear ningún Expense', () => {
    useExpenseStore.setState({ expenses: [] });
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    expect(useExpenseStore.getState().expenses.filter(e => e.groupId === nuevo.id)).toHaveLength(0);
  });

  // Crítico de la revisión final: sin esto el grupo nuevo es invisible para
  // todos menos quien traspasó (no sincroniza, nadie más recibe la clave).
  it('le da clave de sync al grupo nuevo y lo anuncia a los contactos', () => {
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    expect(useGroupKeyStore.getState().getKey(nuevo.id)).toBeDefined();
    expect(announceGroupToContacts).toHaveBeenCalledWith(nuevo.id);
  });

  it('copia memberIds en un array nuevo (no comparte referencia con el viejo)', () => {
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    expect(nuevo.memberIds).not.toBe(viejo.memberIds);
    expect(nuevo.memberIds).toEqual(viejo.memberIds);
  });

  it('hereda defaultSplitMode del grupo viejo', () => {
    useGroupStore.setState({ groups: [grupo({ defaultSplitMode: 'equal' })] });
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    expect(nuevo.defaultSplitMode).toBe('equal');
  });

  describe('nombre del grupo nuevo — sin choque en traspasos repetidos (Important #5a)', () => {
    it('sin choque, el nuevo se llama "(2)"', () => {
      expect(siguienteNombreDisponible('Viaje', [])).toBe('Viaje (2)');
    });

    it('con "(2)" ya ocupado, salta a "(3)"', () => {
      expect(siguienteNombreDisponible('Viaje', ['Viaje (2)'])).toBe('Viaje (3)');
    });

    it('traspasar un grupo ya sufijado "(2)" da "(3)", no "(2) (2)"', () => {
      expect(siguienteNombreDisponible('Viaje (2)', ['Viaje (2)'])).toBe('Viaje (3)');
    });

    it('traspasarGrupo real: "Viaje" con "Viaje (2)" ya existente produce "Viaje (3)"', () => {
      useGroupStore.setState({
        groups: [grupo(), grupo({ id: 'g-otro', name: 'Viaje (2)' })],
      });
      const viejo = useGroupStore.getState().groups.find(g => g.id === 'g-viejo')!;
      const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

      expect(nuevo.name).toBe('Viaje (3)');
    });
  });

  // T-064: un pago RECHAZADO no cuenta — la deuda tiene que seguir viva en el
  // traspaso, como si el pago nunca hubiera existido.
  it('un pago rechazado (T-064) no se resta del balance trasladado', () => {
    useGroupStore.setState({ groups: [grupo({ deletionMode: 'consensus' })] });
    usePaymentStore.setState({
      payments: [pago({
        fromUserId: 'beto', toUserId: 'ana', createdById: 'beto', amount: 10_000,
        confirmations: [acuse({ userId: 'ana', action: 'reject', confirmedAt: 2_000 })],
      })],
    });

    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    const delNuevo = useExpenseStore.getState().expenses.filter(e => e.groupId === nuevo.id);
    expect(delNuevo).toHaveLength(1);
    // Beto le debe a Ana los 20.000 del gasto ENTEROS: el "pago" rechazado no
    // descontó nada, la deuda nunca se movió.
    expect(delNuevo[0].payers).toEqual([{ userId: 'ana', amount: 20_000 }]);
    expect(delNuevo[0].splits).toEqual([{ userId: 'beto', amount: 20_000, isPaid: false }]);
  });

  // Test de punta a punta explícitamente pedido por el spec: 2 monedas, saldos
  // mixtos entre 3 miembros → exactamente 2 Expense de traspaso, uno por moneda.
  it('grupo con 2 monedas y saldos mixtos traspasa a EXACTAMENTE 2 Expense (uno por moneda)', () => {
    useGroupStore.setState({
      groups: [grupo({ memberIds: ['ana', 'beto', 'caro'] })],
    });
    useExpenseStore.setState({
      expenses: [
        // ARS: Ana paga 30.000, se reparte en 3 partes iguales → Beto y Caro le
        // deben 10.000 cada uno, Ana termina +20.000.
        gasto({
          id: 'e-ars', currency: 'ARS', amount: 30_000, paidById: 'ana',
          splits: [
            { userId: 'ana', amount: 10_000, isPaid: false },
            { userId: 'beto', amount: 10_000, isPaid: false },
            { userId: 'caro', amount: 10_000, isPaid: false },
          ],
        }),
        // USD: Beto paga 300, se reparte entre Beto y Caro → Caro le debe 150 a Beto.
        gasto({
          id: 'e-usd', currency: 'USD', amount: 300, paidById: 'beto',
          splits: [
            { userId: 'beto', amount: 150, isPaid: false },
            { userId: 'caro', amount: 150, isPaid: false },
          ],
        }),
      ],
    });

    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    const delNuevo = useExpenseStore.getState().expenses.filter(e => e.groupId === nuevo.id);
    expect(delNuevo).toHaveLength(2);

    const ars = delNuevo.find(e => e.currency === 'ARS')!;
    expect(ars.payers).toEqual([{ userId: 'ana', amount: 20_000 }]);
    expect(ars.splits).toEqual(expect.arrayContaining([
      { userId: 'beto', amount: 10_000, isPaid: false },
      { userId: 'caro', amount: 10_000, isPaid: false },
    ]));

    const usd = delNuevo.find(e => e.currency === 'USD')!;
    expect(usd.payers).toEqual([{ userId: 'beto', amount: 150 }]);
    expect(usd.splits).toEqual([{ userId: 'caro', amount: 150, isPaid: false }]);
  });
});
