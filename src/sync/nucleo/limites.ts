/**
 * Constantes de tope y timeout del sync, en un solo lugar (T-206-A Task 2,
 * D8 — spec 2026-09-28-sync-extraible-design.md §4).
 *
 * Antes vivían triplicadas o cruzadas entre carpetas: `15_000` aparecía
 * suelto en `avatarTopic.ts`, `relayQueue.ts` y `motor/publicar.ts`, cada
 * uno con su propio nombre pero el mismo valor; `262_144` aparecía en
 * `ckey.ts` (`MAX_SLICE_BYTES`) y en `topes.ts` (`MAX_REGISTRO_BYTES`); y
 * `RENEWAL_WINDOW_MS` vivía en `adaptadores/hushsplit/sliceRenewal.ts`, un
 * módulo con `createStorage` (MMKV) — `nucleo/publicarCubos.ts` lo
 * importaba de ahí y arrastraba ese storage al núcleo de forma transitiva
 * (spec §2.2 V3). Este archivo no importa nada: es una hoja.
 *
 * Cada sitio que antes declaraba su propia constante ahora la re-exporta
 * desde acá (mismo nombre, mismo valor — cero cambio de comportamiento),
 * salvo `ckey.ts#MAX_SLICE_BYTES`: no tenía ningún consumidor real fuera de
 * un test que comparaba los dos nombres entre sí, así que D3 lo borró en vez
 * de re-exportarlo — quien necesite este tope importa `MAX_REGISTRO_BYTES`
 * directo de acá.
 */

/** Timeout de un envío (publicación de un cubo o de la foto de perfil). */
export const TIMEOUT_ENVIO_MS = 15_000;

/** Tope duro de bytes (JSON) por registro individual, antes de sellar/firmar. */
export const MAX_REGISTRO_BYTES = 262_144;

/** Ventana de renovación de una rebanada/pieza compactable: 20 días. */
export const RENEWAL_WINDOW_MS = 20 * 24 * 60 * 60 * 1000;

/** Objetivo de tamaño por cubo (spec §8, C3 — decisión del PO, opción B). */
export const SPLIT_BYTES = 196_608;
