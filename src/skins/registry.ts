import { AERO_SKIN } from './aero';
import { DEFAULT_SKIN } from './default';
import type { SkinDefinition } from './types';

export const SKIN_IDS = ['default', 'aero'] as const;
export type SkinId = (typeof SKIN_IDS)[number];

/**
 * **Skin de respaldo** (PO 2026-09-25): configuración del proyecto, no del
 * usuario. Lo que el skin elegido no declare —o declare mal— sale de acá.
 * Cambiarlo es cambiar esta línea; `resolveSkin` completa cualquier hueco del
 * fallback con `DEFAULT_SKIN`, así que puede ser un skin parcial.
 */
export const FALLBACK_SKIN: SkinId = 'default';

/**
 * **Skin inicial** (PO 2026-09-29): el que ve quien no eligió ninguno, y al que
 * cae un valor guardado inválido. Es distinto de `FALLBACK_SKIN` a propósito:
 * ése es la BASE con la que `resolveSkin` completa huecos, y si fuera Aero,
 * Clásico heredaría de Aero lo que no declara (Clásico es intocable).
 */
export const SKIN_INICIAL: SkinId = 'aero';

export const SKINS: Record<SkinId, SkinDefinition> = {
  default: DEFAULT_SKIN,
  aero: AERO_SKIN,
};

export function esSkinId(v: unknown): v is SkinId {
  return typeof v === 'string' && (SKIN_IDS as readonly string[]).includes(v);
}
