import { v4 as uuidv4 } from 'uuid';
import type { Group } from '@/src/types/models';
import { calculateBalancesByCurrency } from '@/src/algorithms/calculateBalances';
import { buildCarryOverExpenses } from '@/src/algorithms/groupCarryOver';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { announceGroupToContacts } from '@/src/sync/relayEngine';
import { syncedNow } from '@/src/utils/syncedClock';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';

/**
 * Siguiente nombre disponible para un traspaso repetido (Important #5a,
 * revisión final). `traspasarGrupo` nombraba siempre `"${nombre} (2)"`, así
 * que traspasar un grupo YA traspasado una vez (p.ej. "Viaje (2)") chocaba
 * con el nombre existente en vez de avanzar a "(3)".
 *
 * Se despoja un sufijo `" (N)"` final del nombre base ANTES de buscar, para
 * no componer sufijos ("Viaje (2) (2)"), y se busca el N más chico (≥ 2) que
 * no choque con ningún nombre ya existente.
 */
export function siguienteNombreDisponible(nombreBase: string, nombresExistentes: string[]): string {
  const base = nombreBase.replace(/ \(\d+\)$/, '');
  const existentes = new Set(nombresExistentes);
  let n = 2;
  while (existentes.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

/**
 * Traspasa un grupo a uno nuevo (T-058, PO 2026-09-20): no copia los gastos
 * viejos — cierra el balance del grupo viejo en uno o más `Expense` de
 * traspaso (uno por moneda, `buildCarryOverExpenses`) dentro del grupo
 * nuevo, y archiva el viejo de forma irrevocable (`reason: 'limit'`).
 *
 * `description` ya viene resuelta (con `t()`) desde la UI — este servicio no
 * depende de i18n, sigue el mismo criterio de pureza que el resto de
 * `src/algorithms`.
 */
export function traspasarGrupo(grupoViejo: Group, description: string, createdById: string): Group {
  const { expenses } = useExpenseStore.getState();
  const { payments } = usePaymentStore.getState();
  const gastosDelGrupo = expenses.filter(e => e.groupId === grupoViejo.id);
  const pagosDelGrupo = pagosQueCuentan(payments, grupoViejo);

  const balances = calculateBalancesByCurrency(gastosDelGrupo, pagosDelGrupo, grupoViejo.memberIds);

  const ahora = syncedNow();
  const nombresExistentes = useGroupStore.getState().groups
    .filter(g => !g.isDeleted)
    .map(g => g.name);
  const grupoNuevo: Group = {
    id: uuidv4(),
    name: siguienteNombreDisponible(grupoViejo.name, nombresExistentes),
    // Copia, no referencia: el array del grupo viejo no puede seguir mutando
    // por debajo del nuevo (o viceversa) sólo porque comparten `memberIds`.
    memberIds: [...grupoViejo.memberIds],
    currency: grupoViejo.currency,
    createdAt: ahora,
    updatedAt: ahora,
    isDeleted: false,
    createdById,
    deletionVotes: [],
    deletionMode: grupoViejo.deletionMode,
    defaultSplitMode: grupoViejo.defaultSplitMode,
  };

  const carryOvers = buildCarryOverExpenses(balances, grupoNuevo.id, description, createdById);

  useGroupStore.getState().addGroup(grupoNuevo);
  for (const gasto of carryOvers) {
    useExpenseStore.getState().addExpense(gasto);
  }

  // Sin esto el grupo nuevo es invisible para todos menos quien traspasó: sin
  // clave no entra en `syncableGroupIds()` (no sincroniza) y sin anuncio nadie
  // más recibe esa clave ni se entera de que el grupo existe.
  useGroupKeyStore.getState().ensureKey(grupoNuevo.id);
  void announceGroupToContacts(grupoNuevo.id);

  useGroupStore.getState().updateGroup(grupoViejo.id, { supersededByGroupId: grupoNuevo.id });
  useArchiveStore.getState().setArchived(grupoViejo.id, true, 'limit');

  // El grupo viejo queda archivado por límite (irrevocable) y sus recurrentes
  // dejan de materializar ahí (guard de `session.ts`). Sin esto, "alquiler",
  // "internet", etc. se congelarían para siempre en vez de seguir generando
  // gastos en el grupo nuevo — que es adonde el usuario se mudó.
  for (const r of useRecurringStore.getState().recurring) {
    if (r.groupId === grupoViejo.id) {
      useRecurringStore.getState().updateRecurring(r.id, { groupId: grupoNuevo.id });
    }
  }

  return grupoNuevo;
}
