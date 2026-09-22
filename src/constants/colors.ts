// Design tokens — reskin "flat bands" (dirección 2a/3a)
// Uso: import { Colors } from '@/src/constants/colors'
// La FORMA del objeto no cambió: sólo los valores + dos alias nuevos (hair, hair2).

export const Colors = {
  light: {
    // T-137: brand ya NO comparte valor con semantic.positive — hasta acá
    // eran el mismo verde, así que un botón "Guardar" y un saldo a favor
    // mandaban la misma señal sin ser lo mismo. Azul noche apagado: es el
    // color dominante en fintech 2026 (calma/confianza, no personalidad) y
    // no choca con ninguna categoría (el lila de Alojamiento #8B7CC4 y el
    // celeste de Transporte #4D9FD6 son ambos más claros/saturados).
    brand: {
      primary:      '#3A4A5E',
      primaryStrong:'#2A3747',
      primarySoft:  '#E7ECF0',
      primaryOnSoft:'#2A3747',
      accent:       '#7C93AC',
      accentStrong: '#64798F',
      accentSoft:   '#EDF1F4',
      accentOnSoft: '#3A4A5E',
    },
    semantic: {
      // T-137: mismo rol (dinero a favor), tono más apagado — el verde
      // saturado de antes ("verde matrix") quedaba muy crudo al lado del
      // azul noche apagado de la marca. Sigue siendo indudablemente verde,
      // sólo con menos saturación, para que las dos familias convivan.
      positive:        '#3D7864',
      positiveSoft:    '#E8F1EC',
      positiveOnSoft:  '#28503F',
      negative:        '#B8500F',
      negativeSoft:    '#FBEDE2',
      negativeOnSoft:  '#8A3B0B',
      neutral:         '#8B9299',
      warning:         '#B07A18',
      warningSoft:     '#FAF1DF',
      error:           '#B23A2C',
      errorSoft:       '#FBE7E3',
    },
    bg:            '#FBFAF8',
    bgGrouped:     '#F4F3EF',
    surface:       '#FFFFFF',
    surfaceWarm:   '#F7F6F2',
    surfaceSunken: '#F4F3EF',
    overlay:       'rgba(16, 20, 18, 0.42)',
    // Bandas y divisores: `hair` cierra un bloque, `hair2` separa filas adentro.
    hair:          'rgba(20, 26, 20, 0.10)',
    hair2:         'rgba(20, 26, 20, 0.055)',
    borderHair:    'rgba(20, 26, 20, 0.055)',
    border:        'rgba(20, 26, 20, 0.10)',
    borderStrong:  'rgba(20, 26, 20, 0.18)',
    text:          '#14171A',
    textSecondary: '#565D64',
    textTertiary:  '#8B9299',
    textDisabled:  '#BFC4C8',
    textOnBrand:   '#FFFFFF',
    textOnAccent:  '#14171A',
    gray: {
      50:  '#FBFAF8',
      100: '#F4F3EF',
      200: '#E6E5E0',
      300: '#D0D2CE',
      400: '#A9AEB2',
      500: '#8B9299',
      600: '#6A7178',
      700: '#4A5158',
      800: '#2C3237',
      900: '#14171A',
    },
    category: {
      food:          '#E8965A',
      transport:     '#4D9FD6',
      accommodation: '#8B7CC4',
      entertainment: '#D4729C',
      utilities:     '#D4A848',
      health:        '#D45E72',
      shopping:      '#4DAA9E',
      other:         '#8B9299',
    },
  },

  dark: {
    // Mismo criterio que en claro (T-137): más luminoso/desaturado que el
    // verde de `semantic.positive`, nunca el mismo valor.
    brand: {
      primary:      '#8BA3BD',
      primaryStrong:'#A3B8CE',
      primarySoft:  'rgba(139, 163, 189, 0.14)',
      primaryOnSoft:'#B7C6D6',
      accent:       '#A9B9C9',
      accentStrong: '#BAC7D4',
      accentSoft:   'rgba(169, 185, 201, 0.16)',
      accentOnSoft: '#C7D2DC',
    },
    semantic: {
      // Mismo criterio que en claro (T-137): menos saturado, compatible con
      // el azul noche apagado de la marca.
      positive:        '#6FAF95',
      positiveSoft:    'rgba(111, 175, 149, 0.14)',
      positiveOnSoft:  '#9BCDB6',
      negative:        '#E28B4F',
      negativeSoft:    'rgba(226, 139, 79, 0.16)',
      negativeOnSoft:  '#F0AE7E',
      neutral:         '#767E85',
      warning:         '#D9B063',
      warningSoft:     'rgba(217, 176, 99, 0.16)',
      error:           '#DD6553',
      errorSoft:       'rgba(221, 101, 83, 0.18)',
    },
    bg:            '#0F1112',
    bgGrouped:     '#0F1112',
    surface:       '#181B1D',
    surfaceWarm:   '#202426',
    surfaceSunken: '#202426',
    overlay:       'rgba(0, 0, 0, 0.6)',
    hair:          'rgba(255, 255, 255, 0.10)',
    hair2:         'rgba(255, 255, 255, 0.055)',
    borderHair:    'rgba(255, 255, 255, 0.055)',
    border:        'rgba(255, 255, 255, 0.10)',
    borderStrong:  'rgba(255, 255, 255, 0.18)',
    text:          '#EBEEF0',
    textSecondary: '#A2AAB1',
    textTertiary:  '#767E85',
    textDisabled:  '#4E5559',
    // T-137: `brand.primary` en oscuro pasó de verde brillante a azul noche
    // claro — el texto que va ENCIMA tiene que ser oscuro igual, pero de la
    // misma familia (azul, no verde) para no desentonar.
    textOnBrand:   '#132430',
    textOnAccent:  '#14171A',
    gray: {
      50:  '#0F1112',
      100: '#181B1D',
      200: '#202426',
      300: '#343A3D',
      400: '#4E5559',
      500: '#767E85',
      600: '#98A0A6',
      700: '#BAC1C6',
      800: '#D5DADD',
      900: '#EBEEF0',
    },
    category: {
      food:          '#E8965A',
      transport:     '#5FB0DE',
      accommodation: '#9C8FD0',
      entertainment: '#DD83AA',
      utilities:     '#DDB45A',
      health:        '#DD7281',
      shopping:      '#5FBCB0',
      other:         '#767E85',
    },
  },
} as const;

export type ColorScheme = 'light' | 'dark';
export type CategoryKind = keyof typeof Colors.light.category;
