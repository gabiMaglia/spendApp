import { useLiveValue } from '@/src/hooks/useLiveValue';
import { blockingFailures, type BlockingReason, type PublishFailure } from './publishHealth';

/**
 * ¿Este grupo dejó de sincronizar por algo que NO se arregla esperando?
 *
 * Existe porque el síntoma que produce `too_large` es el peor de todos: el
 * grupo deja de viajar **para siempre**, mientras el resto de la app se ve
 * perfecta. `publishHealth` fue construido justamente para hacerlo visible —lo
 * dice su docblock— y hasta hoy sólo se leía desde la pantalla de diagnóstico,
 * que un usuario normal no abre nunca. O sea: se vio venir el problema y el
 * aviso quedó a mitad de camino.
 *
 * Se sondea en vez de suscribirse porque `publishHealth` vive en variables de
 * módulo que el motor de sync actualiza por detrás — el mismo caso, y la misma
 * razón, por la que existe `useLiveValue`.
 *
 * **Sólo reporta fallos bloqueantes.** Un corte de red se reintenta solo en la
 * próxima publicación; avisar de eso entrenaría al usuario a ignorar el aviso,
 * que es exactamente cómo se vuelve inútil.
 */
export function useGroupSyncFailure(
  groupId: string,
): (PublishFailure & { reason: BlockingReason }) | null {
  const fallos = useLiveValue(blockingFailures, 3_000);
  return fallos.find(f => f.groupId === groupId) ?? null;
}

/**
 * La razón, como clave de i18n.
 *
 * `switch` exhaustivo DE VERDAD: el parámetro es la unión `BlockingReason`, no
 * `string`, y no hay `default`. Si mañana aparece una tercera razón bloqueante,
 * esto **deja de compilar** y obliga a decidir qué se le muestra al usuario, en
 * vez de caer a un mensaje genérico que nadie escribió a propósito.
 *
 * La primera versión de esta función prometía exactamente eso en un comentario
 * y no lo cumplía —`reason: string` más un `default` se lo comían todo—, que es
 * el defecto que este proyecto viene persiguiendo: una protección declarada que
 * no protege. Lo levantó el Arquitecto revisando T-058.
 */
export function claveDeFalloDeSync(reason: BlockingReason): string {
  switch (reason) {
    case 'too_large': return 'sync.failure_too_large';
    case 'no_key':    return 'sync.failure_no_key';
  }
}
