import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';
import { esBloqueante, type BlockingReason } from './publishHealth';
import type { Notice } from '@/src/services/syncNotices';
import type { PublishResult } from './relaySync';

/**
 * **Avisar UNA vez que un grupo dejó de sincronizar, no una por intento.**
 *
 * El banner de T-058 ya lo dice, pero es contextual: sólo se ve entrando a ese
 * grupo. Si no entrás, nunca te enterás de que tus gastos no le están llegando
 * a nadie — el caso donde no saber sale más caro.
 *
 * Llevarlo a la bandeja tiene un problema de forma: `publishHealth` vive en
 * memoria y se re-evalúa en CADA publicación, o sea cada pocos segundos. Un
 * aviso por intento fallido no es informar, es entrenar al usuario a ignorar
 * los avisos — y el que ignora después es el que importa. Así que hace falta
 * memoria de "esto ya lo dije", igual que `cardYaEnviada` en `contactChannel`.
 *
 * Dos decisiones que valen la pena mirar dos veces:
 *
 *  1. **La marca se persiste, aunque el fallo no.** Si viviera en memoria como
 *     `publishHealth`, cada apertura de la app volvería a avisar de lo mismo; y
 *     T-058 dice que `too_large` no se arregla solo, así que serían avisos
 *     todos los días por algo que el usuario ya sabe y no puede arreglar.
 *  2. **Se marca ANTES de entregar, al revés que `marcarCardEnviada`.** Allá un
 *     envío fallido se reintenta al próximo arranque, porque perder un anuncio
 *     de contacto se paga con un nombre viejo pegado para siempre. Acá el riesgo
 *     está del otro lado: un aviso que no salió se pierde, pero uno que se
 *     reintenta cada veinte segundos arruina la bandeja entera. Se prefiere
 *     avisar de menos.
 */

const storage = createSecureStorage('notices');
const KEY = 'sync_down_v1';

/** `{ groupId: razón ya avisada }`. Se lee del disco en cada llamada: sin copia
 *  en memoria no hay nada que soltar al cambiar de cuenta. */
function avisadas(): Record<string, string> {
  const raw = readScoped(storage, KEY);
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {}; // dato corrupto: se avisa de más, nunca de menos
  }
}

function guardar(todas: Record<string, string>): void {
  writeScoped(storage, KEY, JSON.stringify(todas));
}

/** ¿A este grupo ya le avisamos ESTA caída? */
export function caidaYaAvisada(groupId: string, reason: BlockingReason): boolean {
  return avisadas()[groupId] === reason;
}

export function marcarCaidaAvisada(groupId: string, reason: BlockingReason): void {
  guardar({ ...avisadas(), [groupId]: reason });
}

/** El grupo se recuperó: la próxima caída vuelve a ser noticia. */
export function olvidarCaida(groupId: string): void {
  const todas = avisadas();
  if (!(groupId in todas)) return;
  delete todas[groupId];
  guardar(todas);
}

/**
 * Qué avisar —si hay algo— después de intentar publicar este grupo.
 *
 * Devuelve el aviso a lo sumo una vez por caída y ya deja anotado que se dijo.
 * Los tres caminos:
 *
 *  - **Publicó bien** → se olvida la caída. Es el único borrador de la marca, el
 *    mismo evento que borra el fallo en `recordPublish`.
 *  - **Falló por red** → nada. Se reintenta solo en la próxima publicación, así
 *    que avisar sería ruido. Y **no toca la marca**: si un `network` entre dos
 *    `too_large` la limpiara, el aviso volvería a salir en cada alternancia.
 *  - **Falló por algo bloqueante** → avisa, salvo que ya se haya avisado ESA
 *    razón. Otra razón sí avisa: el texto que el usuario tiene que leer, y lo
 *    que tiene que hacer, son distintos.
 */
export function noticeDeCaida(
  groupId: string, groupName: string, result: PublishResult,
): Notice | null {
  if (result.ok) {
    olvidarCaida(groupId);
    return null;
  }
  if (!esBloqueante(result.reason)) return null;
  if (caidaYaAvisada(groupId, result.reason)) return null;

  marcarCaidaAvisada(groupId, result.reason);
  return { kind: 'sync_down', groupId, groupName, reason: result.reason };
}
