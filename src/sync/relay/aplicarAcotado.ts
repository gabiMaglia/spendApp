import type { SyncDelta } from '../applyDelta';
import { useUserStore } from '@/src/store/userStore';
import { fetchAvatarIfMissing } from '../avatarTopic';
import { recordError } from '@/src/services/errorLog';
import * as adaptador from './adaptadorHushSplit';

/**
 * Acota un delta recibido a `groupId` y lo aplica — compartido entre el
 * primer intento (dentro del loop de páginas de `drenar.ts`) y la
 * reaplicación al final del drenaje y la relectura acotada (`relectura.ts`)
 * (T-191, Task 3, spec §8 C2): mismo camino, para que un descarte por tope o
 * la búsqueda de fotos por referencia se comporten IGUAL las tres veces.
 * Devuelve los descartes de `adaptador.acotar` — quien llama decide qué
 * hacer con `porDependencia` (retener y reintentar, o dar por aplicado).
 */
export async function aplicarDeltaAcotado(
  groupId: string,
  currentUserId: string,
  delta: SyncDelta,
): Promise<{ porTope: number; porDependencia: number; motivos: string[] }> {
  const { delta: acotado, descartes } = adaptador.acotar(delta, groupId);
  if (descartes.porTope > 0) {
    // Rastro, no aviso al usuario (T-150, SEC-07): no hay nada que la víctima
    // pueda hacer con «un miembro mandó un registro demasiado grande», y sí
    // sirve en el diagnóstico exportado cuando alguien pregunta «¿y mi gasto?».
    recordError({
      message: `sync.registro_descartado n=${descartes.porTope} ${descartes.motivos.slice(0, 5).join(',')}`,
      fatal: false, screen: 'sync',
    });
  }
  adaptador.aplicar(acotado, currentUserId);

  // Fotos por referencia (Task 9): se itera `acotado.users` (YA filtrado),
  // nunca `delta.users` crudo, y el digest a pedir se lee del STORE YA
  // MERGEADO — si esta rebanada perdió el LWW, `acotado` trae el viejo.
  await Promise.all(
    (acotado.users ?? [])
      .filter(u => u.avatarDigest && u.id !== currentUserId)
      .map((u) => {
        const digest = useUserStore.getState().getUserById(u.id)?.avatarDigest;
        return digest ? fetchAvatarIfMissing(groupId, u.id, digest) : Promise.resolve();
      }),
  );

  return descartes;
}
