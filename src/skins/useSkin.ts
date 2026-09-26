import { useMemo } from 'react';
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
  const scheme = useColorScheme() ?? 'light';
  const id = useSettingsStore(s => s.skin);
  const reducidas = useAnimacionesReducidas() === true;
  const skin = useMemo(() => resolveSkin(id, scheme), [id, scheme]);
  const degradado = !skin.flags.soft || reducidas || esDispositivoDeGamaBaja();
  return { skin, id, degradado };
}
