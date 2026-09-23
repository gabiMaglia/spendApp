import { Platform } from 'react-native';

/**
 * Umbral de API level de Android para el heurístico de "gama baja" (PO
 * 2026-09-22). Es un heurístico ADMITIDAMENTE impreciso — la versión de
 * Android no mide potencia real, sólo correlaciona con la antigüedad del
 * equipo — y sólo decide el DEFAULT de `reduceAnimations` en
 * `settingsStore`: el toggle manual en "Yo" siempre puede pisarlo.
 *
 * 28 = Android 9 (Pie, 2018). Deliberadamente conservador: un equipo con
 * Android 9 casi seguro es de gama baja hoy; uno más nuevo puede serlo
 * igual (caso conocido: el Motorola de gama baja del PO corre Android 11),
 * pero para ese caso está el toggle manual.
 */
export const UMBRAL_API_GAMA_BAJA = 28;

/** Sin dependencias nativas nuevas: sólo `Platform`, ya presente en RN. */
export function esDispositivoDeGamaBaja(): boolean {
  if (Platform.OS !== 'android') return false;
  return Platform.Version <= UMBRAL_API_GAMA_BAJA;
}
