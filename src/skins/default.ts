import { Colors, type ColorScheme } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import type { Elevation, Skin, SkinCompleto } from './types';

/**
 * **El look actual ("bandas planas") expresado como skin.** Es la raíz de toda
 * resolución: cualquier token que otro skin no declare —o declare mal— sale de
 * acá. Los valores de `colors` son los de `Colors` tal cual, así que una
 * pantalla que pasa de `Colors[scheme]` a `useSkin().skin.colors` no cambia.
 *
 * `soft: false`: las superficies de `src/components/skin/` devuelven el mismo
 * árbol que hoy (banda plana, sin sombra ni halo).
 */
const SIN_SOMBRA: Elevation = { boxShadow: 'none', elevationFallback: 0 };

function paraEsquema(scheme: ColorScheme): Skin {
  const c = Colors[scheme];
  return {
    colors: {
      ...c,
      surfaceRaised: c.surface,
      glow: 'transparent',
      glowStrong: 'transparent',
      edgeLight: 'transparent',
      edgeShade: c.hair2,
      marmolVeil: 'transparent',
      marmolOpacity: 1,
    },
    elevation: {
      e1: SIN_SOMBRA,
      e2: SIN_SOMBRA,
      // La misma sombra que hoy tiene el FAB primario (`Fab.tsx`).
      e3: { boxShadow: '0 6px 16px rgba(20,60,40,0.22)', elevationFallback: 4 },
    },
    radius: { panel: 0, row: 0, chip: Radius.sm, fab: Radius.lg },
    space: { inset: 0, gapPanel: 0, padPanel: Spacing.screenPad, gapSection: 0 },
    flags: { soft: false },
  };
}

export const DEFAULT_SKIN: SkinCompleto = {
  light: paraEsquema('light'),
  dark: paraEsquema('dark'),
};
