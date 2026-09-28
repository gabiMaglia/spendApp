import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';

/**
 * **Trinquete por autor** (T-041 · S6, decisión D1 del Orquestador).
 *
 * Dos posiciones, una sola dirección:
 *
 *  - `desconocido` — nunca vimos una firma válida de este autor;
 *  - `firma` — vimos **al menos una**, y de ahí no vuelve nunca.
 *
 * **Para qué sirve, ahora que no se rechaza nada.** En el §4 del §QUÉ el
 * trinquete era el gatillo del rechazo (la posición `exigido`). Esa posición
 * murió con la decisión R1 del PO: acá se marca, no se bloquea. Lo que queda es
 * su otra mitad, y es la que sostiene la medición: **separa "de este autor nunca
 * vimos una firma" de "este autor firma"**. Sin esa separación, el porcentaje de
 * registros verificables se calcula contra el universo entero y sale siempre
 * bajo — la lectura equivocada que `authorHealth.ts:55-65` ya documenta en el
 * código.
 *
 * **Lo que deliberadamente NO hace: promover un veredicto.** El §C.8 del plan
 * proponía contar `invalida` cuando un autor trabado en `firma` manda un núcleo
 * sin firma. Eso no se implementa, y la razón es la misma que la de D2:
 * **envenenaría la métrica con casos legítimos, y en masa.** Por R2 (opción A)
 * el histórico NO se re-firma, así que todo autor que firma hoy arrastra sus
 * registros viejos sin firma para siempre; el sobre lleva el estado completo del
 * grupo, así que esos registros circulan sin parar. Con esa regla, `invalida`
 * arrancaría en decenas por autor honesto y el criterio de cierre
 * («`invalida` sostenido en 0 con `valida` > 0») sería literalmente inalcanzable.
 * Un contador que cuenta lo legítimo no es una métrica.
 *
 * Lo que sí aporta está en `recordHealth.ts`: los `no_verificable` se reportan
 * partidos por posición del trinquete. "No trae firma y su autor tampoco firma
 * nunca" es información distinta de "no trae firma y su autor firma el resto",
 * y ésa es la fila que hay que mirar el día que se discuta encender el rechazo.
 *
 * Persistido y scopeado por cuenta, con el patrón de `authorHealth.ts:83-112`:
 * es una afirmación acumulada sobre los pares de ESA cuenta, y una que se
 * resetea en cada arranque vive siempre en `desconocido`.
 */

export type RatchetPos = 'desconocido' | 'firma';

const storage = createSecureStorage('users');

export const RATCHET_KEY = 'author_ratchet_v1';

let firmantes = new Set<string>();
let cargado = false;

function cargar(): void {
  if (cargado) return;
  cargado = true;

  const raw = readScoped(storage, RATCHET_KEY);
  if (!raw) return;

  try {
    const d = JSON.parse(raw) as { a?: unknown };
    if (!Array.isArray(d.a)) return;
    for (const autor of d.a) {
      if (typeof autor === 'string' && autor !== '') firmantes.add(autor);
    }
  } catch {
    // Dato corrupto ⇒ se arranca vacío. Perder el trinquete degrada la lectura
    // de la medición; leerlo mal la falsearía, que es peor.
    firmantes = new Set();
  }
}

function guardar(): void {
  writeScoped(storage, RATCHET_KEY, JSON.stringify({ a: [...firmantes] }));
}

/** En qué posición está el trinquete de este autor. */
export function authorRatchet(authorId: string): RatchetPos {
  if (!authorId) return 'desconocido';
  cargar();
  return firmantes.has(authorId) ? 'firma' : 'desconocido';
}

/**
 * Traba el trinquete de un autor. **No existe la operación inversa, y ésa es la
 * garantía**: si se pudiera destrabar, a un miembro malicioso le alcanzaría con
 * mandar un registro sin firma para apagar la única señal que dice que él sabe
 * firmar.
 */
export function markAuthorSigns(authorId: string): void {
  if (!authorId) return;
  cargar();
  if (firmantes.has(authorId)) return;
  firmantes.add(authorId);
  guardar();
}

/** Los autores a los que ya les vimos firmar. Es el denominador de la medición. */
export function signingAuthors(): readonly string[] {
  cargar();
  return [...firmantes];
}

/** Vacía memoria y disco. Logout, wipe, tests. */
export function clearRatchet(): void {
  firmantes = new Set();
  cargado = true;
  writeScoped(storage, RATCHET_KEY, '');
}

/** Suelta lo que hay en memoria y vuelve a leer de disco. Cambio de cuenta y tests. */
export function reloadRatchet(): void {
  firmantes = new Set();
  cargado = false;
}
