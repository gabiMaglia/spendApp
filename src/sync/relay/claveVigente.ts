import { useGroupKeyStore } from '@/src/store/groupKeyStore';

/**
 * ¿La clave del grupo sigue siendo la de la foto? Compara material Y época.
 *
 * T-136 · D-1: un drenaje captura la clave al empezar y espera la red. Si en
 * ese `await` el usuario eligió otra clave (`elegirClaveDeGrupo`), lo que vuelve
 * es del topic VIEJO —en disputa, posiblemente del atacante— y no puede
 * tocar el grupo recién purgado ni dar por drenado el topic real.
 *
 * Vive en su propio módulo (T-192, Task 3) porque tanto `relectura.ts` como
 * `drenar.ts` lo necesitan y se importan entre sí — separarlo evita el ciclo.
 */
export function sigueSiendoLaClave(groupId: string, foto: { key: string; epoch: number }): boolean {
  const actual = useGroupKeyStore.getState().getKey(groupId);
  return !!actual && actual.key.toLowerCase() === foto.key.toLowerCase() && actual.epoch === foto.epoch;
}
