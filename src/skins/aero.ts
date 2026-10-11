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
      marmolVeil: 'rgba(255,255,255,0.45)',
      marmolOpacity: 0.55,
      vidrioVeilTop: 'rgba(255,255,255,0)',
      vidrioVeilBottom: 'rgba(255,255,255,0.30)',
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
    colors: {
      brand: {
        primary: '#93AFCE',
        primaryStrong: '#AEC4DC',
        primarySoft: 'rgba(147,175,206,0.14)',
        primaryOnSoft: '#BBCDE0',
        accent: '#A7BBD0',
        accentStrong: '#BCCCDC',
        accentSoft: 'rgba(167,187,208,0.16)',
        accentOnSoft: '#C8D5E2',
      },
      bg: '#0A0D12',
      bgGrouped: '#0F1319',
      surface: '#151A21',
      surfaceRaised: '#1B2129',
      surfaceWarm: '#1B2129',
      surfaceSunken: '#0F1319',
      hair: 'rgba(226,232,240,0.09)',
      hair2: 'rgba(226,232,240,0.05)',
      borderHair: 'rgba(226,232,240,0.05)',
      border: 'rgba(226,232,240,0.09)',
      borderStrong: 'rgba(226,232,240,0.16)',
      text: '#E8EDF2',
      textSecondary: '#A3ADB8',
      // 5.2:1 sobre #151A21, 4.9:1 sobre #1B2129.
      textTertiary: '#848E99',
      textOnBrand: '#0E1A27',
      glow: 'rgba(147,175,206,0.14)',
      glowStrong: 'rgba(147,175,206,0.24)',
      edgeLight: 'rgba(255,255,255,0.06)',
      edgeShade: 'rgba(0,0,0,0.40)',
      marmolVeil: 'rgba(10,13,18,0.40)',
      marmolOpacity: 0.45,
      vidrioVeilTop: 'rgba(10,13,18,0.15)',
      vidrioVeilBottom: 'rgba(10,13,18,0.65)',
      vidrioGloss: 'rgba(255,255,255,0.06)',
      vidrioTint: 'rgba(147,175,206,0.14)',
      vidrioMarmolOpacity: 0.35,
    },
    elevation: {
      e1: { boxShadow: '0 1px 2px rgba(0,0,0,0.45)', elevationFallback: 1 },
      e2: { boxShadow: '0 1px 2px rgba(0,0,0,0.40), 0 10px 24px rgba(0,0,0,0.50)', elevationFallback: 2 },
      e3: { boxShadow: '0 4px 10px rgba(0,0,0,0.35), 0 16px 32px rgba(0,0,0,0.45)', elevationFallback: 4 },
    },
    radius: RADIUS,
    space: SPACE,
    flags: { soft: true },
  },
};
