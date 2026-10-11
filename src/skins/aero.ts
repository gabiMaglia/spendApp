import type { SkinDefinition } from './types';

/**
 * **Aero** ("aero mármol soft glow", PO 2026-09-25): paneles suspendidos sobre
 * un fondo frío, separados por aire y sombra difusa en vez de hairlines.
 *
 * Pasada de afinado (feat/reskin, 2026-10-11): misma familia de marca
 * (azul noche, verde a favor, naranja en contra), con neutros fríos tipo
 * pizarra en vez de los cálidos del default, marca un punto más entintada,
 * radios más generosos y sombras en capas más suaves. Solo declara lo que
 * cambia; lo demás sale del default.
 */
const RADIUS = { panel: 24, row: 18, chip: 14, fab: 20 };
const SPACE = { inset: 16, gapPanel: 20, padPanel: 18, gapSection: 24, gapInline: 12 };

export const AERO_SKIN: SkinDefinition = {
  light: {
    colors: {
      brand: {
        primary: '#2F4763',
        primaryStrong: '#213449',
        primarySoft: '#E5ECF4',
        primaryOnSoft: '#213449',
        accent: '#6E8BAA',
        accentStrong: '#57728F',
        accentSoft: '#EAF0F6',
        accentOnSoft: '#2F4763',
      },
      semantic: {
        positive: '#2E7A5F',
        positiveSoft: '#E4F2EB',
        positiveOnSoft: '#1F5542',
        negative: '#B4511A',
        negativeSoft: '#FCEDE3',
        negativeOnSoft: '#86390F',
      },
      bg: '#F5F7FA',
      bgGrouped: '#EEF2F6',
      surface: '#FFFFFF',
      surfaceRaised: '#FFFFFF',
      surfaceWarm: '#F7F9FB',
      surfaceSunken: '#EEF2F6',
      hair: 'rgba(15,23,42,0.08)',
      hair2: 'rgba(15,23,42,0.045)',
      borderHair: 'rgba(15,23,42,0.045)',
      border: 'rgba(15,23,42,0.08)',
      borderStrong: 'rgba(15,23,42,0.16)',
      text: '#0F1720',
      textSecondary: '#4B5563',
      // 4.7:1 sobre #EEF2F6, 5.3:1 sobre blanco.
      textTertiary: '#636C78',
      glow: 'rgba(47,71,99,0.12)',
      glowStrong: 'rgba(47,71,99,0.20)',
      edgeLight: 'rgba(255,255,255,0.95)',
      edgeShade: 'rgba(15,23,42,0.05)',
      bordeMarmol: 'rgba(15,23,42,0.08)',
      // El mármol es una foto beige: sobre los neutros pizarra quedaba crema.
      // Velo blanco-pizarra (#F1F5F9), no azul — aclara en vez de oscurecer
      // (el tinte azul del 2026-09-26 se descartó por eso).
      marmolVeil: 'rgba(241,245,249,0.50)',
      marmolOpacity: 0.55,
      vidrioVeilTop: 'rgba(241,245,249,0.20)',
      vidrioVeilBottom: 'rgba(241,245,249,0.40)',
      vidrioGloss: 'rgba(255,255,255,0.65)',
      vidrioTint: 'transparent',
      vidrioMarmolOpacity: 0.55,
    },
    elevation: {
      e1: { boxShadow: '0 1px 1px rgba(15,23,42,0.04), 0 6px 16px rgba(15,23,42,0.05)', elevationFallback: 1 },
      e2: { boxShadow: '0 1px 2px rgba(15,23,42,0.05), 0 12px 28px rgba(15,23,42,0.08)', elevationFallback: 2 },
      e3: { boxShadow: '0 4px 10px rgba(33,52,73,0.18), 0 16px 32px rgba(47,71,99,0.26)', elevationFallback: 4 },
    },
    radius: RADIUS,
    space: SPACE,
    flags: { soft: true },
  },
  dark: {
    // PO 2026-10-11: «Pizarra cálida» (variante 4) — grises tibios que
    // acompañan la veta del mármol; el azul de marca queda como acento.
    colors: {
      brand: {
        primary: '#A9BCD2',
        primaryStrong: '#C0CFE0',
        primarySoft: 'rgba(169,188,210,0.14)',
        primaryOnSoft: '#C7D4E2',
        accent: '#B7C4D2',
        accentStrong: '#C8D3DE',
        accentSoft: 'rgba(183,196,210,0.16)',
        accentOnSoft: '#D0D9E2',
      },
      semantic: {
        positive: '#7DBB98',
        positiveSoft: 'rgba(125,187,152,0.14)',
        positiveOnSoft: '#A6D2B8',
        negative: '#E89463',
        negativeSoft: 'rgba(232,148,99,0.16)',
        negativeOnSoft: '#F2B48E',
        // El #848B92 heredado de Clásico daba 4.42:1 sobre surfaceRaised (QA T-234).
        neutral: '#958E85',
      },
      bg: '#121110',
      bgGrouped: '#171514',
      surface: '#1E1C1A',
      surfaceRaised: '#282522',
      surfaceWarm: '#282522',
      surfaceSunken: '#171514',
      // PO 2026-10-11: más chato — el contorno lo daban borde + filo + brillo
      // sumados; ahora la pieza se separa por tono, no por luz en el borde.
      hair: 'rgba(255,245,230,0.05)',
      hair2: 'rgba(255,245,230,0.05)',
      borderHair: 'rgba(255,245,230,0.05)',
      border: 'rgba(255,245,230,0.09)',
      borderStrong: 'rgba(255,245,230,0.16)',
      text: '#EEEAE4',
      textSecondary: '#B3ACA3',
      // 5.3:1 sobre surface, 4.7:1 sobre surfaceRaised (tab bar, headers).
      textTertiary: '#958E85',
      textOnBrand: '#121110',
      glow: 'rgba(169,188,210,0.12)',
      glowStrong: 'rgba(169,188,210,0.22)',
      edgeLight: 'rgba(255,245,230,0.025)',
      edgeShade: 'rgba(0,0,0,0.45)',
      // Sin borde: aun al 2,5 % el filo claro «levantaba» el contorno del mármol.
      bordeMarmol: 'transparent',
      // PO 2026-10-11: el mármol se veía casi negro (la foto tiene luminancia
      // media 17/255). Velo CLARO y tibio en vez de oscuro: lo levanta hacia la
      // pizarra cálida y deja ver la veta.
      marmolVeil: 'rgba(255,245,230,0.07)',
      marmolOpacity: 1,
      vidrioVeilTop: 'rgba(255,245,230,0.08)',
      vidrioVeilBottom: 'rgba(255,245,230,0.04)',
      vidrioGloss: 'rgba(255,245,230,0.02)',
      vidrioTint: 'transparent',
      vidrioMarmolOpacity: 1,
    },
    elevation: {
      // Sombras cortas y suaves: la pieza se apoya, no flota (PO 2026-10-11, «más chato»).
      e1: { boxShadow: '0 1px 2px rgba(0,0,0,0.22)', elevationFallback: 1 },
      e2: { boxShadow: '0 1px 2px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.22)', elevationFallback: 2 },
      e3: { boxShadow: '0 4px 10px rgba(0,0,0,0.35), 0 16px 32px rgba(0,0,0,0.45)', elevationFallback: 4 },
    },
    radius: RADIUS,
    space: SPACE,
    flags: { soft: true },
  },
};
