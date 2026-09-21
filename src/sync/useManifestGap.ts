import { useLiveValue } from '@/src/hooks/useLiveValue';
import { manifestGapFor } from './manifestHealth';

/**
 * ¿A este grupo le falta alguna rebanada que su propio manifiesto declara?
 *
 * `manifestHealth` vive en una variable de módulo que `drainGroup` actualiza
 * por detrás de React (mismo patrón que `publishHealth`/`useGroupSyncFailure`),
 * así que se sondea con `useLiveValue` en vez de suscribirse.
 *
 * Un gap acá NUNCA bloquea nada — ver el docblock de `manifestHealth.ts` — sólo
 * es la señal para avisar en la UI que los balances de este grupo pueden estar
 * incompletos hasta la próxima sincronización.
 */
export function useManifestGap(groupId: string): boolean {
  const gap = useLiveValue(() => manifestGapFor(groupId), 3_000);
  return gap != null;
}
