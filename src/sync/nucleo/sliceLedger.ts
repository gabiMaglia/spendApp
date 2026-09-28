/**
 * Ledger de rebanadas publicadas (T-191, spec §2.2 y §7/§8 C5) — núcleo
 * puro: no importa stores ni `userScope` (frontera P15). Recibe el puerto de
 * almacenamiento (`AlmacenPort`) ya resuelto y scopeado por cuenta desde
 * quien lo llama (`relaySync.ts`, con `adaptador.almacen`).
 *
 * Qué recuerda, por `(topic, deviceId, ckey)` — la clave que cierra C5(a):
 * el `topic` distingue época (rotar clave = buzón nuevo, todo por publicar
 * de nuevo, como manda ADR-007 §4), y `deviceId` evita que un backup de MMKV
 * restaurado en otro aparato declare como "ya publicado" algo que ESE
 * dispositivo nunca mandó:
 *
 *  - el `digest` y el instante de la última publicación de cada cubo
 *    (`leerCubo`/`registrarCubo`) — para no reenviar lo que no cambió ni
 *    venció (`RENEWAL_WINDOW_MS`, en `relaySync.ts`, junto al resto de la
 *    lógica de publicación).
 *  - la profundidad de prefijo vigente por `(topic, campo)`
 *    (`profundidad`/`subirProfundidad`) — con histéresis: nada en este
 *    módulo la hace bajar, sólo subirProfundidad la sube.
 *
 * `olvidarTopic` borra las dos cosas — se llama al reingresar a un grupo
 * (`pendingDrain.ts#marcarPendienteDeDrenaje`) y al purgar el buzón propio
 * (`relaySync.ts#deleteMyGroupEnvelopes`), spec §7 C5(b): sin esto, tras un
 * reingreso el ledger declararía cubos como "ya publicados" sobre un buzón
 * que la purga (o el TTL) vació, y la próxima publicación mandaría sólo el
 * manifiesto sobre nada.
 */

// T-206-A (D6): antes este archivo declaraba su propio `AlmacenPort`,
// idéntico al de `appliedSlices.ts` — dos copias del mismo contrato. Ahora
// las dos importan `Almacen` de `puertos/puertos.ts` y lo re-exportan con
// el nombre que ya usaban (`AlmacenPort`), sin tocar a sus consumidores.
import type { Almacen as AlmacenPort } from '@/src/sync/puertos/puertos';
export type { AlmacenPort };

export type LedgerEntry = { digest: string; publicadaEn: number };

const SEP = '\u0000';
const ledgerKey = (topic: string, deviceId: string, ckey: string) => `sliceLedger${SEP}${topic}${SEP}${deviceId}${SEP}${ckey}`;
const indiceKey = (topic: string) => `sliceLedgerIndice${SEP}${topic}`;
const depthKey = (topic: string, campo: string) => `sliceLedgerDepth${SEP}${topic}${SEP}${campo}`;
const depthIndiceKey = (topic: string) => `sliceLedgerDepthIndice${SEP}${topic}`;
const campoCkeysKey = (topic: string, campo: string) => `sliceLedgerCkeysCampo${SEP}${topic}${SEP}${campo}`;
const campoCkeysIndiceKey = (topic: string) => `sliceLedgerCkeysCampoIndice${SEP}${topic}`;

type IndiceEntrada = { deviceId: string; ckey: string };

function leerJson<T>(almacen: AlmacenPort, key: string, esValido: (v: unknown) => v is T): T | null {
  const raw = almacen.get(key);
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return esValido(v) ? v : null;
  } catch {
    return null; // dato corrupto: se trata como ausente (mismo criterio que pendingDrain.ts)
  }
}

function esIndiceEntrada(v: unknown): v is IndiceEntrada {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.deviceId === 'string' && typeof o.ckey === 'string';
}
function esIndice(v: unknown): v is IndiceEntrada[] {
  return Array.isArray(v) && v.every(esIndiceEntrada);
}
function esLedgerEntry(v: unknown): v is LedgerEntry {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.digest === 'string' && typeof o.publicadaEn === 'number';
}
function esListaDeStrings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

function leerIndice(almacen: AlmacenPort, topic: string): IndiceEntrada[] {
  return leerJson(almacen, indiceKey(topic), esIndice) ?? [];
}

/** Última versión publicada de un cubo, o `null` si nunca se registró (o el ledger se perdió). */
export function leerCubo(almacen: AlmacenPort, topic: string, deviceId: string, ckey: string): LedgerEntry | null {
  return leerJson(almacen, ledgerKey(topic, deviceId, ckey), esLedgerEntry);
}

/**
 * Registra que `ckey` se publicó con este `digest` en `publicadaEn`. Se
 * llama SÓLO después de que `sendEnvelope` confirmó (mismo criterio que ya
 * usaba `recordSlicePublished`, spec §2.2 "Fix 3"): si se registrara antes y
 * el envío fallara, el cubo quedaría marcado "al día" sin haber llegado al
 * buzón.
 */
export function registrarCubo(
  almacen: AlmacenPort,
  topic: string,
  deviceId: string,
  ckey: string,
  digest: string,
  publicadaEn: number,
): void {
  almacen.set(ledgerKey(topic, deviceId, ckey), JSON.stringify({ digest, publicadaEn }));
  const indice = leerIndice(almacen, topic);
  if (!indice.some(e => e.deviceId === deviceId && e.ckey === ckey)) {
    indice.push({ deviceId, ckey });
    almacen.set(indiceKey(topic), JSON.stringify(indice));
  }
}

/**
 * Olvida un cubo puntual — cuando quedó vacío (traspaso, miembro que se va)
 * o su profundidad quedó obsoleta, y ya se publicó `[]` en su lugar (spec
 * §8 C5, corrige la afirmación de §2.1 "un cubo que existió no se vacía").
 */
export function olvidarCubo(almacen: AlmacenPort, topic: string, deviceId: string, ckey: string): void {
  almacen.delete(ledgerKey(topic, deviceId, ckey));
  const indice = leerIndice(almacen, topic).filter(e => !(e.deviceId === deviceId && e.ckey === ckey));
  almacen.set(indiceKey(topic), JSON.stringify(indice));
}

/** Todas las `ckey` que ESTE `deviceId` tiene registradas para `topic`, de cualquier campo. */
export function __ckeysDelTopic(almacen: AlmacenPort, topic: string, deviceId: string): string[] {
  return leerIndice(almacen, topic).filter(e => e.deviceId === deviceId).map(e => e.ckey);
}

/** Profundidad de prefijo vigente para `(topic, campo)`. Default 1 (sin registro previo). */
export function profundidad(almacen: AlmacenPort, topic: string, campo: string): number {
  const raw = almacen.get(depthKey(topic, campo));
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Sube (nunca baja — histéresis, spec §7 C3) la profundidad registrada de
 * `(topic, campo)`. Quien decide SI hace falta subir es `profundidadNecesaria`
 * (`cubos.ts`); este módulo sólo persiste el resultado.
 */
export function subirProfundidad(almacen: AlmacenPort, topic: string, campo: string, d: number): void {
  almacen.set(depthKey(topic, campo), String(d));
  const indice = leerJson(almacen, depthIndiceKey(topic), esListaDeStrings) ?? [];
  if (!indice.includes(campo)) {
    indice.push(campo);
    almacen.set(depthIndiceKey(topic), JSON.stringify(indice));
  }
}

/**
 * Últimas `ckey` publicadas del campo `(topic, campo)` — snapshot de la
 * publicación ANTERIOR, para que quien llama pueda detectar qué cubo quedó
 * VACÍO a la MISMA profundidad (T-191: un miembro que
 * se va de `users`, un gasto traspasado a otro grupo — `armar()` ya no lo
 * incluye, así que su prefijo deja de aparecer entre los cubos actuales,
 * pero nada lo vaciaba ni lo borraba del ledger). Distinto de
 * `__ckeysDelTopic` (que lista TODO lo publicado, de cualquier campo, sin
 * poder aislar uno): acá la lista es por campo a propósito.
 */
export function ckeysDeCampo(almacen: AlmacenPort, topic: string, campo: string): string[] {
  return leerJson(almacen, campoCkeysKey(topic, campo), esListaDeStrings) ?? [];
}

/** Persiste el snapshot de `ckeysDeCampo` — se llama tras confirmar TODOS los envíos del campo. */
export function guardarCkeysDeCampo(almacen: AlmacenPort, topic: string, campo: string, ckeys: string[]): void {
  almacen.set(campoCkeysKey(topic, campo), JSON.stringify(ckeys));
  const indice = leerJson(almacen, campoCkeysIndiceKey(topic), esListaDeStrings) ?? [];
  if (!indice.includes(campo)) {
    indice.push(campo);
    almacen.set(campoCkeysIndiceKey(topic), JSON.stringify(indice));
  }
}

/**
 * Olvida lo que el ledger sabe PUBLICAR de un `topic` — los digests/
 * `publicadaEn` de cada cubo (de CUALQUIER `deviceId`) y la profundidad —
 * al reingresar a un grupo (`marcarPendienteDeDrenaje`) o purgar el buzón
 * propio (`deleteMyGroupEnvelopes`). La próxima publicación, sin nada
 * registrado, reenvía TODO cubo actual — el mismo camino que un ledger
 * perdido por reinstalación (P9), y es correcto por la misma razón.
 *
 * **NO borra el snapshot de `ckeysDeCampo`**: ese snapshot es precisamente
 * lo que permite detectar un cubo VACIADO mientras el dispositivo estuvo
 * afuera (miembro que se fue, gasto
 * traspasado) — sin él, la publicación completa que sigue no tiene con qué
 * compararse y no manda `[]` para lo que ya no está, dejándolo huérfano en
 * el buzón hasta el TTL. Conservarlo es seguro: la comparación es contra las
 * ckeys de la publicación ACTUAL, así que un snapshot "viejo" (de antes del
 * reingreso) sigue describiendo correctamente qué había la última vez que
 * ESTE dispositivo publicó — que es exactamente lo que hace falta para el
 * diff.
 */
export function olvidarTopic(almacen: AlmacenPort, topic: string): void {
  for (const { deviceId, ckey } of leerIndice(almacen, topic)) {
    almacen.delete(ledgerKey(topic, deviceId, ckey));
  }
  almacen.delete(indiceKey(topic));

  for (const campo of leerJson(almacen, depthIndiceKey(topic), esListaDeStrings) ?? []) {
    almacen.delete(depthKey(topic, campo));
  }
  almacen.delete(depthIndiceKey(topic));
}
