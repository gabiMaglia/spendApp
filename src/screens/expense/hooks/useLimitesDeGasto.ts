import { estaBloqueado } from '@/src/algorithms/groupExpenseLimit';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useTierStore } from '@/src/store/tierStore';
import { useGroupExpenseCount } from '@/src/store/selectors';
import type { User } from '@/src/types/models';

/**
 * Lo que puede impedir o condicionar guardar un gasto (salió de
 * `app/expense/new.tsx` en T-257 para mantenerla bajo el tope de líneas).
 */
export function useLimitesDeGasto(
  { currentUser, isPro, isEditMode, groupId }:
  { currentUser: User | null; isPro: boolean; isEditMode: boolean; groupId: string },
) {
  const requiresRewardedAd = useTierStore(s => s.requiresRewardedAd);
  const superoElTope = useTierStore(s => s.superoElTope);
  const getDailyCount = useTierStore(s => s.getDailyCount);
  const isArchivedFn = useArchiveStore(s => s.isArchived);
  const hasGroup = groupId !== '';
  // T-058 (PO 2026-09-20): grupo que llegó a 450 gastos no acepta uno más.
  const cantidadGastosDelGrupo = useGroupExpenseCount(hasGroup ? groupId : '');

  const dailyCount = currentUser ? getDailyCount(currentUser.id) : 0;
  // Dos cosas distintas, y confundirlas era el bug: `superoElTope` es la REGLA
  // (pasaste los 4 del día) y sirve para contárselo al usuario; `needsAd` es si
  // hay que mostrarle un anuncio ANTES de guardar, que hoy es siempre false
  // porque no existe el sistema de anuncios. Ver `ADS_DISPONIBLES`.
  const pasoElTope = !isEditMode && currentUser ? superoElTope(currentUser.id, isPro) : false;
  const needsAd    = !isEditMode && currentUser ? requiresRewardedAd(currentUser.id, isPro) : false;
  // PO 2026-09-20: un grupo archivado (cualquier razón) es de solo lectura.
  const grupoArchivado = hasGroup && isArchivedFn(groupId);
  // `!isEditMode` importa: editar uno de los 450 no hace crecer el conteo.
  const grupoBloqueadoPorLimite = hasGroup && !isEditMode && estaBloqueado(cantidadGastosDelGrupo);
  return { dailyCount, pasoElTope, needsAd, grupoArchivado, grupoBloqueadoPorLimite };
}
