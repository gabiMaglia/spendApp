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
import { truncar, MAX_TEXTO_CORTO } from '@/src/sync/topes';

/**
 * Siguiente nombre disponible para un traspaso repetido (Important #5a,
 * revisión final). `traspasarGrupo` nombraba siempre `"${nombre} (2)"`, así
 * que traspasar un grupo YA traspasado una vez (p.ej. "Viaje (2)") chocaba
 * con el nombre existente en vez de avanzar a "(3)".
 *
 * Se despoja un sufijo `" (N)"` final del nombre base ANTES de buscar, para
 * no componer sufijos ("Viaje (2) (2)"), y se busca el N más chico (≥ 2) que
 * no choque con ningún nombre ya existente.
 *
 * T-150 ronda 2 (D3, verifier): el resultado se trunca a `MAX_TEXTO_CORTO`.
 * El predicado de recibir/publicar ya no descarta por caracteres (T-150,
 * enmienda), pero un nombre de grupo sigue siendo un texto que la app misma
 * genera — sin este truncado, traspasos repetidos con un nombre base ya
 * cerca del tope podían crecer sin límite con cada sufijo " (N)".
 *
 * T-150 ronda 2/5 — defecto 2 del handoff (regresión de la ronda anterior):
 * truncar el string YA ARMADO (`base + sufijo`) cortaba el sufijo, no la
 * base — con una base de 200 el sufijo entero desaparecía (el nombre nuevo
 * quedaba igual al viejo) y con una base un poco más corta el corte caía a
 * mitad del sufijo ("... (2" sin cerrar), que el regex de la línea 33 ya no
 * reconoce, así que el siguiente traspaso repetía el mismo nombre. Ahora se
 * trunca la BASE, reservando el lugar exacto que ocupa el sufijo elegido —
 * el sufijo nunca se corta, y la búsqueda de colisión corre sobre el
 * candidato YA truncado (que es el que de verdad se va a guardar).
 */
export function siguienteNombreDisponible(nombreBase: string, nombresExistentes: string[]): string {
  const base = nombreBase.replace(/ \(\d+\)$/, '');
  const existentes = new Set(nombresExistentes);
  let n = 2;
  let candidato = candidatoTruncado(base, n);
  while (existentes.has(candidato)) {
    n += 1;
    candidato = candidatoTruncado(base, n);
  }
  return candidato;
}

/** `base` truncada para que `base + " (n)"` quepa entero en `MAX_TEXTO_CORTO`. */
function candidatoTruncado(base: string, n: number): string {
  const sufijo = ` (${n})`;
  const baseAcotada = truncar(base, MAX_TEXTO_CORTO - sufijo.length);
  return `${baseAcotada}${sufijo}`;
}

/**
 * Traspasa un grupo a uno nuevo (T-058, PO 2026-09-20): no copia los gastos
 * viejos — cierra el balance del grupo viejo en uno o más `Expense` de
 * traspaso (uno por moneda, `buildCarryOverExpenses`) dentro del grupo
 * nuevo, y archiva el viejo de forma irrevocable (`reason: 'limit'`).
 *
 * `description` ya viene resuelta (con `t()`) desde la UI — este servicio no
 * depende de i18n, sigue el mismo criterio de pureza que el resto de
 * `src/algorithms`. Se trunca a `MAX_TEXTO_CORTO` acá (T-150 ronda 2, D3):
 * es interpolada con el nombre del grupo viejo (`carryover_description`,
 * `app/groups/[id].tsx`), así que un nombre largo la hacía crecer sin tope.
 */
export function traspasarGrupo(grupoViejo: Group, description: string, createdById: string): Group {
  const descripcionAcotada = truncar(description, MAX_TEXTO_CORTO);
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

  const carryOvers = buildCarryOverExpenses(balances, grupoNuevo.id, descripcionAcotada, createdById);

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
