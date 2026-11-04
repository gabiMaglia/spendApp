import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';
import { PUBLICACION_PENDIENTE_BASE, SALIDA_PENDIENTE_BASE } from '@/src/store/accountLink';

/**
 * **Cola persistente de publicaciones (T-252).**
 *
 * Antes, un fallo de red al publicar quedaba sólo en `publishHealth` (memoria)
 * y nadie lo reintentaba: el gasto cargado sin señal —o con la app muerta dentro
 * del debounce— no le llegaba a nadie hasta que esa persona tocara OTRA cosa del
 * mismo grupo. Como el sobre lleva el estado completo (regla #8), no hace falta
 * una cola de mensajes: alcanza una marca por grupo, «tiene cambios locales sin
 * publicar», y publicar el estado de nuevo. Mismo espíritu que la cola de envío
 * persistente de Jazz/CoJSON, sin su log de ops.
 *
 * La marca se pone ANTES de programar el envío y sólo baja con una publicación
 * ok. Sobrevive al reinicio (MMKV, scopeado por cuenta).
 */

const storage = createSecureStorage('groupkeys');

function leer(base: string): Set<string> {
  const raw = readScoped(storage, base);
  if (!raw) return new Set();
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    // Dato corrupto => «nada pendiente»: es el comportamiento de antes de T-252.
    return new Set();
  }
}

function guardar(base: string, set: Set<string>): void {
  writeScoped(storage, base, JSON.stringify([...set]));
}

/**
 * Versión de la marca por grupo (EN MEMORIA). Sube con cada `marcar`. Si
 * mientras una publicación estaba en vuelo alguien volvió a marcar (otro gasto),
 * el ok de esa publicación NO debe bajar la marca: lo nuevo no iba en ese sobre.
 */
const versiones = new Map<string, number>();

export function versionDePublicacion(groupId: string): number {
  return versiones.get(groupId) ?? 0;
}

/** Suelta las versiones en memoria al cambiar de cuenta (`rehydrateForActiveUser`). */
export function olvidarVersionesDePublicacion(): void {
  versiones.clear();
}

export function marcarPublicacionPendiente(groupId: string): void {
  versiones.set(groupId, versionDePublicacion(groupId) + 1);
  const set = leer(PUBLICACION_PENDIENTE_BASE);
  if (set.has(groupId)) return;
  set.add(groupId);
  guardar(PUBLICACION_PENDIENTE_BASE, set);
}

/** Baja la marca sólo si nadie la volvió a subir desde `versionVista`. */
export function limpiarPublicacionPendiente(groupId: string, versionVista?: number): void {
  if (versionVista !== undefined && versionVista !== versionDePublicacion(groupId)) return;
  const set = leer(PUBLICACION_PENDIENTE_BASE);
  if (!set.delete(groupId)) return;
  guardar(PUBLICACION_PENDIENTE_BASE, set);
}

export function estaPublicacionPendiente(groupId: string): boolean {
  return leer(PUBLICACION_PENDIENTE_BASE).has(groupId);
}

export function gruposConPublicacionPendiente(): string[] {
  return [...leer(PUBLICACION_PENDIENTE_BASE)];
}

/**
 * Salidas de grupo cuya publicación todavía no salió: la copia local NO se
 * purga hasta que salga (`salirDelGrupo`), si no la salida se perdería.
 */
export function marcarSalidaPendiente(groupId: string): void {
  const set = leer(SALIDA_PENDIENTE_BASE);
  if (set.has(groupId)) return;
  set.add(groupId);
  guardar(SALIDA_PENDIENTE_BASE, set);
}

export function limpiarSalidaPendiente(groupId: string): void {
  const set = leer(SALIDA_PENDIENTE_BASE);
  if (!set.delete(groupId)) return;
  guardar(SALIDA_PENDIENTE_BASE, set);
}

export function salidasPendientes(): string[] {
  return [...leer(SALIDA_PENDIENTE_BASE)];
}
