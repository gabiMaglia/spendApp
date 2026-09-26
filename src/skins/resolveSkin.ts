import type { ColorScheme } from '@/src/constants/colors';
import { DEFAULT_SKIN } from './default';
import { FALLBACK_SKIN, SKINS } from './registry';
import type { Skin, SkinDefinition } from './types';

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Un valor del override se acepta solo si es del mismo tipo que el de la base (y no vacío). */
function valeComo(base: unknown, v: unknown): boolean {
  if (typeof base === 'string') return typeof v === 'string' && v.trim() !== '';
  if (typeof base === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (typeof base === 'boolean') return typeof v === 'boolean';
  return false;
}

/**
 * Recorre las claves de la BASE (no las del override): una clave inventada
 * no entra, y un objeto se reconstruye siempre, así el resultado nunca
 * comparte referencias con `DEFAULT_SKIN` ni con los skins registrados.
 */
function fusionar<T>(base: T, override: unknown): T {
  if (!esObjeto(base)) return (valeComo(base, override) ? override : base) as T;
  const o = esObjeto(override) ? override : {};
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(base)) out[k] = fusionar((base as Record<string, unknown>)[k], o[k]);
  return out as T;
}

/**
 * **Skin resuelto para un esquema.** Cadena: `DEFAULT_SKIN` (completo) ←
 * fallback ← skin elegido, campo a campo. Un id que no existe, un esquema sin
 * override o un valor inválido caen al nivel de abajo. Nunca lanza.
 */
export function resolveSkin(
  id: string,
  scheme: ColorScheme,
  opts?: { skins?: Record<string, SkinDefinition>; fallback?: string },
): Skin {
  const skins: Record<string, SkinDefinition> = opts?.skins ?? SKINS;
  const fallback = opts?.fallback ?? FALLBACK_SKIN;
  try {
    const conFallback = fusionar(DEFAULT_SKIN[scheme], skins[fallback]?.[scheme]);
    return id === fallback ? conFallback : fusionar(conFallback, skins[id]?.[scheme]);
  } catch {
    return fusionar(DEFAULT_SKIN[scheme], undefined);
  }
}
