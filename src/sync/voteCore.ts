import { canonical } from '@/src/store/lww';
import type { DeletionVote } from '@/src/types/models';

/**
 * **El enunciado de un voto de borrado, y cómo se lee** (T-041 · S8).
 *
 * El §5 del plan es explícito en por qué acá no se firma el array: los votos
 * son una UNIÓN de aportes de gente distinta, y una firma sobre un conjunto que
 * crece se invalida cada vez que crece. Se firma **cada enunciado por
 * separado**, y por eso romper un voto no puede invalidar los demás.
 *
 * **Este archivo no toca criptografía a propósito.** `SyncEngine` lo importa
 * para colapsar votos, y `SyncEngine` está en el grafo del merge: un `@noble`
 * acá se pagaría ~37 ms por registro en el camino más caliente de la app (D9).
 * Firmar y verificar viven en `voteSign.ts`, que el merge no importa.
 */

/**
 * Versión del algoritmo del enunciado. Congela qué campos entran y cómo se
 * serializan; si cambia, esto sube y las firmas viejas se siguen verificando
 * con lo viejo. Mismo criterio que `CORE_VERSION`.
 */
export const VOTE_VERSION = 1;

/** Lo que la persona hizo, que no es lo mismo que lo que viaja en `action`. */
export type DeletionAction = 'delete' | 'object' | 'withdraw' | 'restore';

/**
 * La acción semántica de un voto.
 *
 * Es el único lugar donde se traduce el token de compatibilidad. Un voto de un
 * peer viejo —`cancel` pelado, sin `intent`— es una objeción, que es lo que
 * significaba antes de S8: el comportamiento de lo que ya existe se preserva
 * sin migrar nada.
 */
export function accionDe(vote: DeletionVote): DeletionAction {
  if (vote.action === 'delete')   return 'delete';
  if (vote.action === 'withdraw') return 'withdraw';
  return vote.intent === 'restore' ? 'restore' : 'object';
}

/**
 * Cuánto puede adelantarse un `votedAt` antes de dejar de ser creíble (T-059).
 *
 * Entre dos relojes ya corregidos contra el relay (ADR-005) el desfase es de
 * milisegundos, así que este margen existe para el ruido de red y para el peer
 * que todavía no habló con el relay — no para tapar un reloj mal puesto.
 *
 * Cinco minutos es el mismo orden de magnitud con el que `syncedClock` decide
 * avisarle al usuario que su hora está mal, pero el número se escribe acá y no
 * se importa de allá: `syncedClock` abre MMKV, y meter un módulo nativo en el
 * grafo del merge es justo lo que D9 no permite.
 */
export const TOLERANCIA_RELOJ_MS = 5 * 60 * 1000;

/**
 * ¿Este voto dice haberse emitido después de *ahora*?
 *
 * Lo que ADR-005 garantiza es que nuestro reloj corregido se parece a la hora
 * real; no garantiza causalidad. Alcanza para esto: una fecha posterior a la
 * nuestra por más que la tolerancia **no pudo haber ocurrido todavía**, así que
 * no puede ser "más nueva" que un enunciado del presente. El voto no se
 * descarta —nada deja de aplicarse— sólo deja de ganar por fecha.
 */
export function enElFuturo(vote: DeletionVote, now: number): boolean {
  return vote.votedAt > now + TOLERANCIA_RELOJ_MS;
}

/** ¿Este enunciado frena la ronda de TODOS? Ver la regla en `deletionRound`. */
export function frenaLaRonda(vote: DeletionVote): boolean {
  const accion = accionDe(vote);
  return accion === 'object' || accion === 'restore';
}

/**
 * La ronda a la que pertenece un voto. `''` es la ronda sintética de todo lo
 * que existe desde antes de S8 y de todo lo que manda un peer sin actualizar.
 */
export function rondaDe(vote: DeletionVote): string {
  return vote.roundId ?? '';
}

/**
 * ¿Este voto cuenta para la ronda `roundId`?
 *
 * Los de otra ronda no entran. La excepción es la ronda sintética `''` —lo
 * anterior a S8 y lo que manda un peer sin actualizar—: ésos entran siempre,
 * porque el otro lado no tenía cómo nombrar la ronda y perderlos sería dejar de
 * honrar una objeción legítima. Errar hacia NO borrar es el lado seguro.
 *
 * Vive acá porque la usan los tres lados de la misma decisión: qué frena la
 * ronda (`rondaVigente`), quién ya pidió u objetó EN ella (`deletionRound.ts`)
 * y a qué voto le corresponde la marca (`recordTrust.ts`). Con una copia por
 * lugar, la app diría una cosa y haría otra en cuanto una se moviera.
 */
export function esDeLaRonda(vote: DeletionVote, roundId: string): boolean {
  const suya = rondaDe(vote);
  return suya === roundId || suya === '';
}

/**
 * FNV-1a de 32 bits, dos veces con semillas distintas para llegar a 64.
 *
 * Sin `BigInt` (no está garantizado en Hermes) y sin importar un hash: el
 * `roundId` es un IDENTIFICADOR, no un compromiso. Lo que ata un voto a su
 * ronda no es la resistencia del hash sino la firma que lo cubre — sacar un
 * voto de su ronda cambia el enunciado y rompe su firma, igual que cambiarle
 * el monto a un gasto.
 */
function fnv32(texto: string, semilla: number): number {
  let h = semilla >>> 0;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const hex8 = (n: number) => n.toString(16).padStart(8, '0');

/**
 * El id de la ronda que abre este pedido: `hash(expenseId + userId + votedAt)`.
 *
 * Determinista y sin coordinación —los dos dispositivos lo calculan igual sin
 * hablarse— y no colisiona entre dos personas que piden a la vez, que es lo que
 * el §C.4 pedía.
 */
export function roundIdFor(expenseId: string, userId: string, votedAt: number): string {
  const msg = canonical({ expenseId, userId, votedAt });
  return hex8(fnv32(msg, 0x811c9dc5)) + hex8(fnv32(msg, 0x9dc5811c));
}

/**
 * El mensaje exacto que firma quien vota y verifica quien lee.
 *
 * Lleva `expenseId` —que no está en el voto— porque sin él una objeción valdría
 * para cualquier gasto, y `t` para que el enunciado de un voto no pueda leerse
 * como el núcleo de otra cosa. Es la misma razón por la que `coreOf()` lleva su
 * propio `t`.
 *
 * Un campo ausente no se inventa: `canonical()` descarta `undefined`, así que
 * un voto sin `forced` firma sin la clave `forced` y no con `forced: false`.
 */
export function voteStatement(expenseId: string, vote: DeletionVote): Record<string, unknown> {
  return {
    v: VOTE_VERSION,
    t: 'vote',
    expenseId,
    roundId: vote.roundId,
    userId:  vote.userId,
    votedAt: vote.votedAt,
    action:  vote.action,
    intent:  vote.intent,
    forced:  vote.forced,
  };
}

export function canonicalVote(expenseId: string, vote: DeletionVote): string {
  return canonical(voteStatement(expenseId, vote));
}

/**
 * La ronda que está viva en un conjunto de votos YA COLAPSADO
 * (`mergeDeletionVotes`), o `null` si nadie pidió nada.
 *
 * Vive acá y no en `deletionRound()` porque la usan los dos lados de la misma
 * decisión —`resolveDeletionVotes()` para borrar y `deletionRound()` para
 * contarlo— y si cada uno la calculara a su manera, la app diría una cosa y
 * haría otra.
 *
 * Dos reglas, y las dos son del §5 del plan:
 *
 * 1. **Entre rondas gana la que abrió más tarde.** Una ronda vieja no puede
 *    revivir cuando alguien pide de nuevo.
 * 2. **Un voto habla de la ronda contra la que se firmó.** Los de otra ronda no
 *    entran. La excepción son los de la ronda sintética `''` —lo que existe
 *    desde antes de S8 y lo que manda un peer sin actualizar—: ésos entran
 *    siempre, porque el otro lado no tenía cómo nombrar la ronda y perderlos
 *    sería dejar de honrar una objeción legítima. Errar hacia NO borrar es el
 *    lado seguro, y la poda por tiempo de `mergeDeletionVoteSets` ya saca del
 *    conjunto lo anterior a la apertura.
 */
export type RondaVigente = {
  roundId: string;
  /** El pedido más viejo de la ronda: desde cuándo la gente tuvo aviso. */
  apertura: DeletionVote;
  /** El `object` o el `restore` que la frenó. El último que llegó. */
  freno?: DeletionVote;
};

/**
 * Orden total y estable entre dos votos POR FECHA: `votedAt`, y el contenido
 * desempata.
 *
 * No juzga si la fecha es creíble, y hay dos lugares donde eso es justo lo que
 * hace falta: elegir el pedido MÁS VIEJO de una ronda —una fecha del futuro
 * nunca es la más vieja salvo que sea la única— y podar en el merge, que es
 * puro y no tiene un "ahora" que ofrecer.
 */
export function masNuevoPorFecha(a: DeletionVote, b: DeletionVote): boolean {
  if (a.votedAt !== b.votedAt) return a.votedAt > b.votedAt;
  return canonical(a) > canonical(b);
}

/**
 * Orden total entre dos votos para decidir cuál es el ENUNCIADO VIGENTE, que no
 * es lo mismo que cuál dice una fecha mayor (T-059).
 *
 * **Un voto del futuro pierde contra cualquier voto creíble.** Sin esto, un
 * teléfono con el reloj adelantado abre una ronda con fecha de 2027 y esa ronda
 * le gana a todas las reales hasta que el tiempo la alcance: nadie puede
 * objetarla —su objeción es "más vieja"—, nadie puede pedir el borrado de
 * nuevo, y ni siquiera su autor puede retirarla.
 *
 * Entre dos votos igual de creíbles —o igual de increíbles— manda la fecha,
 * como siempre.
 */
function masNuevo(a: DeletionVote, b: DeletionVote, now: number): boolean {
  const futuroA = enElFuturo(a, now);
  const futuroB = enElFuturo(b, now);
  if (futuroA !== futuroB) return futuroB;
  return masNuevoPorFecha(a, b);
}

export function rondaVigente(
  vigentes: readonly DeletionVote[], now: number,
): RondaVigente | null {
  const pedidos = vigentes.filter(v => accionDe(v) === 'delete');
  if (pedidos.length === 0) return null;

  // La apertura de cada ronda es su pedido más viejo — por fecha pelada: es
  // desde cuándo la gente tuvo aviso, y ahí una fecha del futuro no compite
  // (nunca es la más vieja, salvo que sea la única de su ronda).
  const aperturas = new Map<string, DeletionVote>();
  for (const v of pedidos) {
    const previa = aperturas.get(rondaDe(v));
    if (!previa || masNuevoPorFecha(previa, v)) aperturas.set(rondaDe(v), v);
  }

  // …y entre rondas gana la que abrió más tarde, con la fecha del futuro
  // perdiendo contra cualquier apertura creíble (T-059).
  let apertura: DeletionVote | undefined;
  for (const v of aperturas.values()) {
    if (!apertura || masNuevo(v, apertura, now)) apertura = v;
  }

  const roundId = rondaDe(apertura!);

  let freno: DeletionVote | undefined;
  for (const v of vigentes) {
    if (!frenaLaRonda(v) || !esDeLaRonda(v, roundId)) continue;
    if (!freno || masNuevo(v, freno, now)) freno = v;
  }

  return { roundId, apertura: apertura!, freno };
}
