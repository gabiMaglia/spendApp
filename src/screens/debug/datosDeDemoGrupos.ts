import { buildSplits } from '@/src/algorithms/buildSplits';
import { conAlta, rosterDe } from '@/src/algorithms/roster';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useUserStore } from '@/src/store/userStore';
import type { CurrencyCode } from '@/src/constants/currencies';
import type { ExpenseCategory, Group } from '@/src/types/models';

/**
 * Grupos de demo que se suman a «Viaje a Bariloche» para que el filtro de
 * Actividad tenga más pestañas de las que entran (T-305) y haya balances en
 * varias monedas. Sólo desarrollo: lo llama `cargarDatosDeDemo`. Ids fijos,
 * así cargarlo dos veces no duplica.
 */
type GastoDemo = { id: string; desc: string; monto: number; paga: string; cat: ExpenseCategory };
type GrupoDemo = { id: string; nombre: string; moneda: CurrencyCode; otros: string[]; gastos: GastoDemo[] };

const PERSONAS: [string, string][] = [
  ['demo-sofi', 'Sofi'], ['demo-martin', 'Martín'], ['demo-caro', 'Caro'],
  ['demo-nico', 'Nico'], ['demo-juli', 'Juli'],
];

/** Montos en unidades menores (centavos, ADR-002). `paga: 'yo'` = la cuenta activa. */
export const GRUPOS_EXTRA: GrupoDemo[] = [
  {
    id: 'demo-depto', nombre: 'Depto Palermo', moneda: 'ARS', otros: ['demo-caro'],
    gastos: [
      { id: 'demo-d-expensas', desc: 'Expensas', monto: 8_500_000, paga: 'yo', cat: 'utilities' },
      { id: 'demo-d-luz', desc: 'Luz', monto: 2_340_000, paga: 'demo-caro', cat: 'utilities' },
      { id: 'demo-d-internet', desc: 'Internet', monto: 1_800_000, paga: 'yo', cat: 'utilities' },
    ],
  },
  {
    id: 'demo-rio', nombre: 'Escapada a Río', moneda: 'BRL', otros: ['demo-sofi', 'demo-nico'],
    gastos: [
      { id: 'demo-r-hotel', desc: 'Hotel en Copacabana', monto: 210_000, paga: 'demo-nico', cat: 'accommodation' },
      { id: 'demo-r-caipi', desc: 'Caipirinhas', monto: 9_000, paga: 'yo', cat: 'food' },
    ],
  },
  {
    id: 'demo-asado', nombre: 'Asado de los viernes', moneda: 'ARS', otros: ['demo-martin', 'demo-nico', 'demo-juli'],
    gastos: [
      { id: 'demo-a-carne', desc: 'Carne', monto: 4_800_000, paga: 'demo-juli', cat: 'food' },
      { id: 'demo-a-bebida', desc: 'Bebidas', monto: 1_600_000, paga: 'yo', cat: 'food' },
      { id: 'demo-a-carbon', desc: 'Carbón', monto: 600_000, paga: 'demo-martin', cat: 'other' },
    ],
  },
  {
    id: 'demo-europa', nombre: 'Mochileando Europa', moneda: 'EUR', otros: ['demo-caro', 'demo-juli'],
    gastos: [
      { id: 'demo-e-tren', desc: 'Tren Madrid–Barcelona', monto: 27_000, paga: 'yo', cat: 'transport' },
      { id: 'demo-e-hostel', desc: 'Hostel', monto: 18_600, paga: 'demo-caro', cat: 'accommodation' },
    ],
  },
];

export function cargarGruposExtra(yoId: string, ahora: number) {
  const users = useUserStore.getState();
  for (const [id, name] of PERSONAS) {
    if (!users.getUserById(id)) {
      users.addOrUpdateUser({ id, name, email: '', authProvider: 'guest', createdAt: ahora, updatedAt: ahora, isDeleted: false });
    }
  }

  GRUPOS_EXTRA.forEach((grupo, gi) => {
    const miembroIds = [yoId, ...grupo.otros];
    const groups = useGroupStore.getState();
    if (!groups.getById(grupo.id)) {
      const miembros = miembroIds.reduce(
        (m, uid) => conAlta({ miembros: m } as Group, uid, ahora).miembros,
        {} as Group['miembros'],
      );
      groups.addGroup({
        id: grupo.id, name: grupo.nombre, miembros, memberIds: rosterDe(miembros),
        currency: grupo.moneda, createdAt: ahora, createdById: yoId, updatedAt: ahora, isDeleted: false,
      });
    }
    useGroupKeyStore.getState().ensureKey(grupo.id);

    grupo.gastos.forEach((g, i) => {
      if (useExpenseStore.getState().expenses.some(e => e.id === g.id)) return;
      // Escalonados en horas para que Actividad los intercale entre grupos.
      const cuando = ahora - ((gi + 1) * 60 + i * 7) * 60_000;
      useExpenseStore.getState().addExpense({
        id: g.id, groupId: grupo.id, description: g.desc, amount: g.monto, currency: grupo.moneda,
        paidById: g.paga === 'yo' ? yoId : g.paga, splits: buildSplits(g.monto, miembroIds, 'equal'),
        splitMode: 'equal', category: g.cat, date: cuando, createdAt: cuando, createdById: yoId,
        updatedAt: cuando, isDeleted: false,
      });
    });
  });
}
