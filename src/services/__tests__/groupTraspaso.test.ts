import { traspasarGrupo, siguienteNombreDisponible } from '../groupTraspaso';
import { MAX_TEXTO_CORTO } from '@/src/sync/topes';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { announceGroupToContacts } from '@/src/sync/relayEngine';
import type { Group, Expense, Payment, RecurringExpense } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));

const mockAnnounceRecurringTraspasoBlocked = jest.fn().mockResolvedValue(1);
jest.mock('@/src/services/notifications', () => ({
  announceRecurringTraspasoBlocked: (...args: unknown[]) => mockAnnounceRecurringTraspasoBlocked(...args),
}));

function grupo(over: Partial<Group> = {}): Group {
  const memberIds = over.memberIds ?? ['ana', 'beto'];
  return {
    id: 'g-viejo', name: 'Viaje', memberIds, currency: 'ARS',
    // T-182: `miembros` es la fuente de verdad de `memberIds` (derivado).
    miembros: Object.fromEntries(memberIds.map((uid, i) => [uid, { estado: 'in' as const, at: i }])),
    createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
    createdById: 'ana',
    ...over,
  };
}

function gasto(over: Partial<Expense> = {}): Expense {
  return {
    id: `e-${Math.random()}`, groupId: 'g-viejo', description: 'x', amount: 20_000, currency: 'ARS',
    paidById: 'ana', splits: [{ userId: 'beto', amount: 10_000, isPaid: false }, { userId: 'ana', amount: 10_000, isPaid: false }],
    splitMode: 'equal', category: 'other', date: 1_000, createdAt: 1_000, updatedAt: 1_000,
    createdById: 'ana', isDeleted: false,
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

function recurrente(over: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: `r-${Math.random()}`, groupId: 'g-viejo', description: 'Alquiler', amount: 50_000,
    currency: 'ARS', paidById: 'ana', splitMode: 'equal', memberIds: ['ana', 'beto'],
    category: 'other', rule: { frequency: 'monthly', startDate: 1_000 },
    lastMaterializedAt: null, isActive: true,
    createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
    ...over,
  } as RecurringExpense;
}

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
  useRecurringStore.setState({ recurring: [] });
  jest.clearAllMocks();
  mockAnnounceRecurringTraspasoBlocked.mockClear().mockResolvedValue(1);
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

  it('re-apunta los recurrentes del grupo viejo al grupo nuevo, para que sigan generando gastos ahí', () => {
    useRecurringStore.setState({ recurring: [recurrente(), recurrente({ id: 'r-otro', description: 'Internet' })] });
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    const recurrentes = useRecurringStore.getState().recurring;
    expect(recurrentes.every(r => r.groupId === nuevo.id)).toBe(true);
    expect(recurrentes).toHaveLength(2);
  });

  it('no toca recurrentes personales ni los de otro grupo', () => {
    useRecurringStore.setState({
      recurring: [
        recurrente({ id: 'r-personal', groupId: '' }),
        recurrente({ id: 'r-otro-grupo', groupId: 'g-ajeno' }),
      ],
    });
    const viejo = useGroupStore.getState().groups[0];
    traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    const recurrentes = useRecurringStore.getState().recurring;
    expect(recurrentes.find(r => r.id === 'r-personal')?.groupId).toBe('');
    expect(recurrentes.find(r => r.id === 'r-otro-grupo')?.groupId).toBe('g-ajeno');
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

  // T-150 ronda 2 (D3, verifier): un grupo con nombre en el tope, traspasado,
  // no debe producir un nombre ni una descripción de arrastre que superen
  // MAX_TEXTO_CORTO — aunque el predicado de recibir/publicar ya no los mida
  // por caracteres, la app sigue acotando lo que ella misma genera.
  describe('T-150 ronda 2 (D3): textos generados por el traspaso se truncan al tope', () => {
    it('siguienteNombreDisponible nunca devuelve más de MAX_TEXTO_CORTO caracteres', () => {
      const base = 'x'.repeat(MAX_TEXTO_CORTO);
      const resultado = siguienteNombreDisponible(base, []);
      expect(resultado.length).toBeLessThanOrEqual(MAX_TEXTO_CORTO);
    });

    it('traspasarGrupo con un nombre de 200 caracteres produce un grupo nuevo cuyo name no excede el tope', () => {
      useGroupStore.setState({ groups: [grupo({ name: 'x'.repeat(MAX_TEXTO_CORTO) })] });
      const viejo = useGroupStore.getState().groups[0];
      const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de ' + 'x'.repeat(MAX_TEXTO_CORTO), 'ana');

      expect(nuevo.name.length).toBeLessThanOrEqual(MAX_TEXTO_CORTO);
    });

    it('el gasto de arrastre generado con una descripción larga se trunca al tope', () => {
      const viejo = useGroupStore.getState().groups[0];
      const descripcionLarga = 'Saldo trasladado de ' + 'x'.repeat(MAX_TEXTO_CORTO);
      const nuevo = traspasarGrupo(viejo, descripcionLarga, 'ana');

      const delNuevo = useExpenseStore.getState().expenses.filter(e => e.groupId === nuevo.id);
      expect(delNuevo.length).toBeGreaterThan(0);
      for (const gastoDeArrastre of delNuevo) {
        expect(gastoDeArrastre.description.length).toBeLessThanOrEqual(MAX_TEXTO_CORTO);
      }
    });

    // La descripción tiene la parte fija ("Saldo trasladado de ") PRIMERO y el
    // nombre interpolado al final: truncar el string entero desde la derecha ya
    // corta sólo la parte variable, sin tocar el prefijo fijo. Se deja como
    // test de regresión explícito, pedido por el handoff de la ronda 2.
    it('la descripción larga se trunca preservando el prefijo fijo, no lo pisa', () => {
      const viejo = useGroupStore.getState().groups[0];
      const descripcionLarga = 'Saldo trasladado de ' + 'x'.repeat(MAX_TEXTO_CORTO);
      const nuevo = traspasarGrupo(viejo, descripcionLarga, 'ana');

      const delNuevo = useExpenseStore.getState().expenses.filter(e => e.groupId === nuevo.id);
      for (const gastoDeArrastre of delNuevo) {
        expect(gastoDeArrastre.description.startsWith('Saldo trasladado de ')).toBe(true);
      }
    });
  });

  // T-150 ronda 2, defecto 2 del handoff (regresión de la ronda 2 anterior):
  // `siguienteNombreDisponible` truncaba DESPUÉS de agregar el sufijo " (n)".
  // Con una base ya en el tope, el sufijo entero se perdía y el nombre nuevo
  // quedaba IGUAL al viejo — o, con una base un poco más corta, el sufijo
  // quedaba cortado a la mitad ("... (2") y el regex de la línea 33 ya no lo
  // reconocía, así que los traspasos siguientes repetían el mismo nombre.
  // Contrato (`:18-25`): el N más chico que no choque con NINGÚN nombre
  // existente, sin componer sufijos.
  describe('T-150 ronda 2 (defecto 2): el truncado no puede comerse el sufijo', () => {
    it('base de 200 (== MAX_TEXTO_CORTO): el nombre nuevo NO queda igual al viejo', () => {
      const base = 'x'.repeat(MAX_TEXTO_CORTO);
      const resultado = siguienteNombreDisponible(base, []);

      expect(resultado).not.toBe(base);
      expect(resultado.length).toBeLessThanOrEqual(MAX_TEXTO_CORTO);
      expect(resultado).toMatch(/ \(\d+\)$/);
    });

    it('base de 199: el sufijo sigue completo y reconocible por el regex', () => {
      const base = 'x'.repeat(199);
      const resultado = siguienteNombreDisponible(base, []);

      expect(resultado.length).toBeLessThanOrEqual(MAX_TEXTO_CORTO);
      expect(resultado).toMatch(/ \(\d+\)$/);
    });

    it('base de 197: el paréntesis de cierre no se pierde', () => {
      const base = 'x'.repeat(197);
      const resultado = siguienteNombreDisponible(base, []);

      expect(resultado.endsWith(')')).toBe(true);
      expect(resultado).toMatch(/ \(\d+\)$/);
    });

    it('base de 196 (justo entra con el sufijo " (2)"): no se trunca de más', () => {
      const base = 'x'.repeat(196);
      const resultado = siguienteNombreDisponible(base, []);

      expect(resultado).toBe(`${base} (2)`);
    });

    it('traspasos encadenados (2→3→4) con base larga mantienen unicidad y el regex sigue reconociendo el sufijo', () => {
      const base = 'x'.repeat(197);
      const n1 = siguienteNombreDisponible(base, []);
      const n2 = siguienteNombreDisponible(base, [n1]);
      const n3 = siguienteNombreDisponible(base, [n1, n2]);

      expect(new Set([n1, n2, n3]).size).toBe(3);
      for (const n of [n1, n2, n3]) expect(n).toMatch(/ \(\d+\)$/);
    });

    it('traspasarGrupo real, encadenado, con nombre en el tope: cada traspaso produce un nombre distinto', () => {
      useGroupStore.setState({ groups: [grupo({ name: 'x'.repeat(MAX_TEXTO_CORTO) })] });
      const viejo1 = useGroupStore.getState().groups[0];
      const nuevo1 = traspasarGrupo(viejo1, 'Saldo trasladado de x', 'ana');

      const viejo2 = useGroupStore.getState().groups.find(g => g.id === nuevo1.id)!;
      const nuevo2 = traspasarGrupo(viejo2, 'Saldo trasladado de x', 'ana');

      expect(nuevo2.name).not.toBe(nuevo1.name);
      expect(nuevo2.name).toMatch(/ \(\d+\)$/);
    });
  });

  // T-064 se sacó en T-186 junto con el modo «con acuerdo»: ya no existe el
  // acuse de recibo, así que un pago declarado por el deudor cuenta al
  // instante — no hay «rechazado» que probar acá. Ver docs/CONSENSO-PENDIENTE.md.

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

  // T-172 (ítem 3, residual de T-152 ronda 2): `updateRecurring` bloquea la
  // recurrente que no se pudo re-firmar (falta de clave privada) y devuelve
  // `false` — antes eso sólo dejaba rastro en `errorLog`, invisible para quien
  // hizo el traspaso. La plantilla quedaba congelada en el grupo archivado sin
  // que nadie se enterara.
  describe('T-172 (ítem 3): aviso cuando una recurrente queda bloqueada en el traspaso', () => {
    it('si updateRecurring bloquea, avisa UNA vez con el grupo viejo y el nuevo', () => {
      useRecurringStore.setState({
        recurring: [recurrente()],
        updateRecurring: jest.fn(() => false),
      });
      const viejo = useGroupStore.getState().groups[0];
      const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

      expect(mockAnnounceRecurringTraspasoBlocked).toHaveBeenCalledTimes(1);
      expect(mockAnnounceRecurringTraspasoBlocked).toHaveBeenCalledWith(viejo.id, viejo.name, nuevo.id);
    });

    it('con dos recurrentes bloqueadas, avisa UNA sola vez (no una por plantilla)', () => {
      useRecurringStore.setState({
        recurring: [recurrente(), recurrente({ id: 'r-otro', description: 'Internet' })],
        updateRecurring: jest.fn(() => false),
      });
      const viejo = useGroupStore.getState().groups[0];
      traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

      expect(mockAnnounceRecurringTraspasoBlocked).toHaveBeenCalledTimes(1);
    });

    it('si updateRecurring guarda bien, no avisa nada', () => {
      useRecurringStore.setState({
        recurring: [recurrente()],
        updateRecurring: jest.fn(() => true),
      });
      const viejo = useGroupStore.getState().groups[0];
      traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

      expect(mockAnnounceRecurringTraspasoBlocked).not.toHaveBeenCalled();
    });
  });
});
