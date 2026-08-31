import { planMigracionReplicados, planTieneCambios } from '@/src/algorithms/migrateReplicated';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useAuthStore } from '@/src/store/authStore';
import { createStorage } from '@/src/utils/createStorage';
import { readScopedBool, writeScopedBool } from '@/src/store/userScope';

/**
 * Corre la migración de réplicas UNA sola vez por cuenta (ADR-006, decisión 3).
 *
 * Es one-shot y con marca persistida: volver a correrla no rompería nada
 * —el plan es idempotente: lo ya corregido no vuelve a aparecer— pero la marca
 * evita recalcularlo en cada arranque sobre todo el historial.
 *
 * Va por cuenta y no global: los movimientos son de cada cuenta, y dos cuentas
 * en el mismo teléfono tienen historiales distintos.
 */
const storage = createStorage('migrations');
const CLAVE = 'adr006_replicados_v1';

export type ResultadoMigracion = {
  corrio: boolean;
  actualizadas: number;
  borradas: number;
  huerfanas: number;
};

export function migrarReplicadosUnaVez(): ResultadoMigracion {
  const vacio = { corrio: false, actualizadas: 0, borradas: 0, huerfanas: 0 };

  const me = useAuthStore.getState().currentUser?.id;
  if (!me) return vacio;                                  // sin cuenta activa no hay nada que migrar
  if (readScopedBool(storage, CLAVE, false)) return vacio; // ya corrió para esta cuenta

  const plan = planMigracionReplicados(
    usePersonalStore.getState().entries,
    useExpenseStore.getState().expenses,
    me,
  );

  if (planTieneCambios(plan)) {
    const personal = usePersonalStore.getState();
    const porId = new Map(personal.entries.map(e => [e.id, e]));
    // `updateReplicatedEntry` indexa por el gasto de origen, que es justo lo
    // que estas réplicas tienen: se reusa en vez de agregar un setter nuevo.
    for (const { id, amount } of plan.actualizar) {
      const origen = porId.get(id)?.sourceGroupExpenseId;
      if (origen) personal.updateReplicatedEntry(origen, { amount });
    }
    // Tombstone, no borrado físico: es la regla del proyecto y además deja
    // recuperable un movimiento si la migración resultó estar equivocada.
    for (const id of plan.borrar) personal.removeEntry(id);
  }

  writeScopedBool(storage, CLAVE, true);
  return {
    corrio: true,
    actualizadas: plan.actualizar.length,
    borradas: plan.borrar.length,
    huerfanas: plan.huerfanas,
  };
}
