import type { Colors } from '@/src/constants/colors';

/** Quita el `as const` de `Colors`: los valores pasan a `string`/`number` genéricos. */
export type Widen<T> = T extends string ? string
  : T extends number ? number
  : T extends boolean ? boolean
  : { -readonly [K in keyof T]: Widen<T[K]> };

export type SkinColors = Widen<typeof Colors.light> & {
  surfaceRaised: string;
  /** Halo de marca detrás de superficies clave. */
  glow: string;
  glowStrong: string;
  /** Filo de luz de 1px arriba de un panel. */
  edgeLight: string;
  /** Divisor suave dentro de un panel. */
  edgeShade: string;
  /** Velo sobre el mármol para que el texto se lea. */
  marmolVeil: string;
  marmolOpacity: number;
  /** Mármol "detrás de vidrio" (Aero): velo en degradé de arriba a abajo. */
  vidrioVeilTop: string;
  vidrioVeilBottom: string;
  /** Brillo superior (gloss) y tinte de marca que entra desde abajo. */
  vidrioGloss: string;
  vidrioTint: string;
  /** Opacidad del mármol cuando va detrás del vidrio. */
  vidrioMarmolOpacity: number;
};

export type Elevation = { boxShadow: string; elevationFallback: number };

export type Skin = {
  colors: SkinColors;
  elevation: { e1: Elevation; e2: Elevation; e3: Elevation };
  radius: { panel: number; row: number; chip: number; fab: number };
  space: { inset: number; gapPanel: number; padPanel: number; gapSection: number };
  /** `soft`: el skin dibuja paneles con sombra/halo en vez de bandas planas. */
  flags: { soft: boolean };
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type SkinOverride = DeepPartial<Skin>;
export type SkinDefinition = { light: SkinOverride; dark: SkinOverride };
export type SkinCompleto = { light: Skin; dark: Skin };
