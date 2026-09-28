import type { PublishResult } from './relaySync';

/**
 * Última vez que publicar un grupo falló, y por qué.
 *
 * Existe porque `publishNow` se traga los errores — tiene que hacerlo, es una
 * app offline-first y un corte de red no puede romper nada. Pero tragárselos
 * SIN DEJAR RASTRO produjo dos veces el mismo síntoma: "no me llega nada", sin
 * error, sin aviso, sin nada que mirar.
 *
 * El caso que más importa es `too_large`: el sobre pasó los 256KB y ese grupo
 * deja de viajar para siempre, en silencio, mientras el resto de la app se ve
 * perfecta. La memoria de acá es lo que lo convierte en algo que se puede ver.
 *
 * Vive en memoria a propósito: es un diagnóstico del momento, no un dato del
 * usuario. Persistirlo obligaría a decidir cuándo limpiarlo y no aporta nada.
 */

/**
 * Las razones que NO se arreglan solas. Es un tipo y no un comentario porque
 * `claveDeFalloDeSync` hace un `switch` exhaustivo sobre esto: si aparece una
 * tercera razón bloqueante, el switch deja de compilar de verdad.
 */
export type BlockingReason = 'too_large' | 'no_key';

/**
 * ¿Esta razón es de las que no se arreglan esperando?
 *
 * Única definición: la usan `blockingFailures` (qué mostrar en pantalla) y
 * `syncDownNotices` (qué mandar a la bandeja). Escrita dos veces se
 * desincroniza, y el modo de falla sería el peor posible — el banner diciendo
 * que el grupo está caído y la bandeja callada, o al revés.
 */
export function esBloqueante(reason: string): reason is BlockingReason {
  return reason === 'too_large' || reason === 'no_key';
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
 *
 * Vive acá, junto al tipo, y no en el hook: el aviso de la bandeja necesita el
 * mismo texto que el banner y no puede arrastrar React para conseguirlo.
 */
export function claveDeFalloDeSync(reason: BlockingReason): string {
  switch (reason) {
    case 'too_large': return 'sync.failure_too_large';
    case 'no_key':    return 'sync.failure_no_key';
  }
}

export type PublishFailure = {
  groupId: string;
  reason: string;
  detail?: string;
  at: number;
};

const fallos = new Map<string, PublishFailure>();

/** Registra el resultado de una publicación. Un éxito borra el fallo anterior. */
export function recordPublish(groupId: string, result: PublishResult): void {
  if (result.ok) {
    fallos.delete(groupId);
    return;
  }
  fallos.set(groupId, {
    groupId,
    reason: result.reason,
    detail: result.detail,
    at: Date.now(),
  });
}

export function publishFailures(): PublishFailure[] {
  return [...fallos.values()];
}

/**
 * Fallos que NO se arreglan solos esperando.
 *
 * `network` se reintenta en la próxima publicación y no hay nada que hacer.
 * `too_large` y `no_key` no van a mejorar por sí solos: hace falta que alguien
 * intervenga, así que son los que valen la pena mostrar.
 */
export function blockingFailures(): (PublishFailure & { reason: BlockingReason })[] {
  return publishFailures().filter(
    (f): f is PublishFailure & { reason: BlockingReason } => esBloqueante(f.reason),
  );
}

export function clearPublishFailures(): void {
  fallos.clear();
}
