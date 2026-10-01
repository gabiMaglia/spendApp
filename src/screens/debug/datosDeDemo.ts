import { buildSplits } from '@/src/algorithms/buildSplits';
import { conAlta, rosterDe } from '@/src/algorithms/roster';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useUserStore } from '@/src/store/userStore';
import type { ExpenseCategory, Group, PersonalCategory } from '@/src/types/models';

/**
 * Datos de demo para las capturas de las tiendas (sólo en desarrollo, se
 * cargan con `spendapp://debug/demo`). Entran por los mismos `add*` de los
 * stores que usa la app, así quedan firmados como cualquier alta. Ids fijos:
 * cargarlo dos veces no duplica, y el grupo se abre con
 * `spendapp://groups/demo-bariloche`.
 */
export const GRUPO_DEMO_ID = 'demo-bariloche';
const SOFI = 'demo-sofi';
const MARTIN = 'demo-martin';

/** Montos en pesos enteros; se guardan en centavos (ADR-002). */
const GASTOS: { id: string; desc: string; pesos: number; paga: 'yo' | string; cat: ExpenseCategory }[] = [
  { id: 'demo-g-cabana',    desc: 'Cabaña 3 noches', pesos: 180000, paga: SOFI,   cat: 'accommodation' },
  { id: 'demo-g-super',     desc: 'Súper',           pesos: 42500,  paga: 'yo',   cat: 'food' },
  { id: 'demo-g-nafta',     desc: 'Nafta',           pesos: 35000,  paga: MARTIN, cat: 'transport' },
  { id: 'demo-g-cena',      desc: 'Cena en el centro', pesos: 60000, paga: 'yo',  cat: 'food' },
  { id: 'demo-g-excursion', desc: 'Excursión al Cerro Catedral', pesos: 54000, paga: 'yo', cat: 'entertainment' },
];

const PERSONALES: { id: string; kind: 'expense' | 'income'; desc: string; pesos: number; cat: PersonalCategory }[] = [
  { id: 'demo-p-sueldo',  kind: 'income',  desc: 'Sueldo',       pesos: 950000, cat: 'salary' },
  { id: 'demo-p-alquiler', kind: 'expense', desc: 'Alquiler',    pesos: 320000, cat: 'utilities' },
  { id: 'demo-p-super',   kind: 'expense', desc: 'Supermercado', pesos: 38400,  cat: 'food' },
  { id: 'demo-p-cafe',    kind: 'expense', desc: 'Café',         pesos: 4500,   cat: 'food' },
];

const centavos = (pesos: number) => pesos * 100;

export function cargarDatosDeDemo(yoId: string, ahora: number, isDev: boolean = __DEV__): boolean {
  if (!isDev) return false;
  // Todo unos minutos antes de `ahora`: el mismo mes aunque sea día 1.
  const hace = (i: number) => ahora - (i + 1) * 10 * 60_000;

  const users = useUserStore.getState();
  for (const [id, name] of [[SOFI, 'Sofi'], [MARTIN, 'Martín']]) {
    users.addOrUpdateUser({ id, name, email: '', authProvider: 'guest', createdAt: ahora, updatedAt: ahora, isDeleted: false });
  }

  const miembroIds = [yoId, SOFI, MARTIN];
  const groups = useGroupStore.getState();
  if (!groups.getById(GRUPO_DEMO_ID)) {
    const miembros = miembroIds.reduce(
      (m, uid) => conAlta({ miembros: m } as Group, uid, ahora).miembros,
      {} as Group['miembros'],
    );
    groups.addGroup({
      id: GRUPO_DEMO_ID, name: 'Viaje a Bariloche', miembros, memberIds: rosterDe(miembros),
      currency: 'ARS', createdAt: ahora, createdById: yoId, updatedAt: ahora, isDeleted: false,
    });
  }
  useGroupKeyStore.getState().ensureKey(GRUPO_DEMO_ID);

  const expenses = useExpenseStore.getState();
  GASTOS.forEach((g, i) => {
    if (expenses.expenses.some(e => e.id === g.id)) return;
    const amount = centavos(g.pesos);
    expenses.addExpense({
      id: g.id, groupId: GRUPO_DEMO_ID, description: g.desc, amount, currency: 'ARS',
      paidById: g.paga === 'yo' ? yoId : g.paga,
      splits: buildSplits(amount, miembroIds, 'equal'), splitMode: 'equal', category: g.cat,
      date: hace(i), createdAt: hace(i), createdById: yoId, updatedAt: hace(i), isDeleted: false,
    });
  });

  const payments = usePaymentStore.getState();
  if (!payments.payments.some(p => p.id === 'demo-pago-martin')) {
    payments.addPayment({
      id: 'demo-pago-martin', groupId: GRUPO_DEMO_ID, fromUserId: MARTIN, toUserId: yoId,
      amount: centavos(20000), currency: 'ARS', date: hace(0), createdAt: hace(0),
      createdById: yoId, updatedAt: hace(0), isDeleted: false,
    });
  }

  const personal = usePersonalStore.getState();
  personal.setBudget({ currency: 'ARS', monthlyAmount: centavos(600000), includeOwedToMe: false });
  PERSONALES.forEach((p, i) => {
    if (usePersonalStore.getState().entries.some(e => e.id === p.id)) return;
    personal.addEntry({
      id: p.id, kind: p.kind, description: p.desc, amount: centavos(p.pesos), currency: 'ARS',
      category: p.cat, date: hace(i), createdAt: hace(i), updatedAt: hace(i), isDeleted: false,
    });
  });
  return true;
}
