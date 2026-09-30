import { planTombstoneReplicas } from '@/src/algorithms/migrateReplicated';
import { usePersonalStore } from '@/src/store/personalStore';
import { useAuthStore } from '@/src/store/authStore';
import { createStorage } from '@/src/utils/createStorage';
import { readScopedBool, writeScopedBool } from '@/src/store/userScope';

/**
 * Corre la migración v2 de réplicas UNA vez por cuenta (T-229): las réplicas
 * guardadas antes de derivar Personal se tombstonean. Por cuenta y no global:
 * dos cuentas en el mismo teléfono tienen historiales distintos.
 */
const storage = createStorage('migrations');
const CLAVE = 'adr006_replicados_v2';

export function migrarReplicadosUnaVez(): { corrio: boolean; borradas: number } {
  if (!useAuthStore.getState().currentUser) return { corrio: false, borradas: 0 };
  if (readScopedBool(storage, CLAVE, false)) return { corrio: false, borradas: 0 };

  const ids = planTombstoneReplicas(usePersonalStore.getState().entries);
  for (const id of ids) usePersonalStore.getState().removeEntry(id);

  writeScopedBool(storage, CLAVE, true);
  return { corrio: true, borradas: ids.length };
}
