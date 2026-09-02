// Grid de 4px. El reskin no cambia el espaciado; sí baja los radios.
export const Spacing = {
  0:  0,
  1:  4,
  2:  8,
  3:  12,
  4:  16,
  5:  20,
  6:  24,
  7:  32,
  8:  40,
  9:  48,
  10: 64,
  screenPad: 20,
  cardPad:   16,
  cardGap:   10,
  tapTarget: 44,
  /** Padding vertical de una fila de banda. */
  rowPadV:   14,
  /** Alto del header fijo (status 44 + nav 52). */
} as const;

export const Radius = {
  xs:   6,
  sm:   8,
  md:   11,
  lg:   12,
  xl:   14,
  '2xl':16,
  full: 9999,
} as const;
