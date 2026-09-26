import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAnimacionesReducidas } from '@/src/hooks/useAnimacionesReducidas';
import { useSettingsStore } from '@/src/store/settingsStore';
import { esDispositivoDeGamaBaja } from '@/src/utils/deviceTier';
import { resolveSkin } from './resolveSkin';
import type { SkinId } from './registry';
import type { Skin } from './types';

/**
 * **Skin activo, ya resuelto contra el respaldo.**
 *
 * `degradado`: las superficies usan sombra simple (`elevation`) + borde y
 * color plano en vez de `boxShadow` difuso, glow y gradientes. Pasa con el
 * skin default (que no es `soft`), en equipos de gama baja (Android ≤ API 28,
 * donde las sombras difusas caen a `elevation` sin color de todos modos) y con
 * "reducir animaciones" / "reducir movimiento" del sistema.
 */
export function useSkin(): { skin: Skin; id: SkinId; degradado: boolean } {
  const id = useSettingsStore(s => s.skin);
  const skin = useSkinTokens();
  const reducidas = useAnimacionesReducidas() === true;
  const degradado = !skin.flags.soft || reducidas || esDispositivoDeGamaBaja();
  return { skin, id, degradado };
}

/**
 * **Solo los tokens del skin activo** (colores, radios, espacios, flags).
 * Sin `degradado`, y por eso sin la consulta async a "reducir movimiento" ni
 * el re-render que dispara: es lo que usan las filas y todo lo que no dibuja
 * sombras/glow. `resolveSkin` cachea, así que devuelve el mismo objeto en
 * toda la app para el mismo skin y esquema.
 */
export function useSkinTokens(): Skin {
  const scheme = useColorScheme() ?? 'light';
  const id = useSettingsStore(s => s.skin);
  return resolveSkin(id, scheme);
}
