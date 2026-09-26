import type { SkinDefinition } from './types';

/**
 * **Aero** ("aero mármol soft glow", PO 2026-09-25): paneles suspendidos sobre
 * un fondo frío, separados por aire y sombra difusa en vez de hairlines. Solo
 * declara lo que cambia; marca, semánticos y tipografía vienen del default.
 */
const RADIUS = { panel: 20, row: 16, chip: 12, fab: 18 };
const SPACE = { inset: 16, gapPanel: 12, padPanel: 16, gapSection: 20 };

export const AERO_SKIN: SkinDefinition = {
  light: {
    colors: {
      // PO 2026-09-26: más luminoso que el primer #F1F3F6.
      bg: '#F8F9FB',
      bgGrouped: '#F4F6F9',
      surface: '#FFFFFF',
      surfaceRaised: '#FFFFFF',
      surfaceSunken: '#F1F3F7',
      // El #8B9299 del default no pasa AA sobre #F1F3F6.
      textTertiary: '#6A7178',
      glow: 'rgba(58,74,94,0.14)',
      glowStrong: 'rgba(58,74,94,0.22)',
      edgeLight: 'rgba(255,255,255,0.90)',
      edgeShade: 'rgba(20,26,20,0.06)',
      marmolVeil: 'rgba(255,255,255,0.35)',
      marmolOpacity: 0.7,
      // PO 2026-09-26: en claro, ni niebla blanca (lavaba el mármol) ni tinte
      // azul (oscurecía). Variante "perla": solo luz — veta suave, velo leve
      // abajo y un brillo alto; sin tinte.
      vidrioVeilTop: 'rgba(255,255,255,0)',
      vidrioVeilBottom: 'rgba(255,255,255,0.22)',
      vidrioGloss: 'rgba(255,255,255,0.60)',
      vidrioTint: 'transparent',
      vidrioMarmolOpacity: 0.7,
    },
    elevation: {
      e1: { boxShadow: '0 1px 2px rgba(20,30,50,0.06), 0 4px 12px rgba(20,30,50,0.05)', elevationFallback: 1 },
      e2: { boxShadow: '0 2px 4px rgba(20,30,50,0.07), 0 10px 24px rgba(20,30,50,0.09)', elevationFallback: 2 },
      e3: { boxShadow: '0 4px 8px rgba(42,55,71,0.18), 0 14px 28px rgba(58,74,94,0.28)', elevationFallback: 4 },
    },
    radius: RADIUS,
    space: SPACE,
    flags: { soft: true },
  },
  dark: {
    colors: {
      bg: '#0C0E11',
      bgGrouped: '#121417',
      surface: '#171A1E',
      surfaceRaised: '#1E2227',
      surfaceSunken: '#121417',
      // El #767E85 del default da 4.23:1 sobre #171A1E; este, 4.98:1 (y 4.56:1
      // sobre surfaceRaised #1E2227).
      textTertiary: '#828A91',
      glow: 'rgba(139,163,189,0.16)',
      glowStrong: 'rgba(139,163,189,0.26)',
      edgeLight: 'rgba(255,255,255,0.07)',
      edgeShade: 'rgba(0,0,0,0.35)',
      marmolVeil: 'rgba(15,17,18,0.30)',
      marmolOpacity: 0.55,
      vidrioVeilTop: 'rgba(12,14,17,0.10)',
      vidrioVeilBottom: 'rgba(12,14,17,0.60)',
      vidrioGloss: 'rgba(255,255,255,0.08)',
      vidrioTint: 'rgba(139,163,189,0.16)',
      vidrioMarmolOpacity: 0.4,
    },
    elevation: {
      e1: { boxShadow: '0 1px 2px rgba(0,0,0,0.5)', elevationFallback: 1 },
      e2: { boxShadow: '0 8px 20px rgba(0,0,0,0.55)', elevationFallback: 2 },
      e3: { boxShadow: '0 4px 8px rgba(42,55,71,0.18), 0 14px 28px rgba(58,74,94,0.28)', elevationFallback: 4 },
    },
    radius: RADIUS,
    space: SPACE,
    flags: { soft: true },
  },
};
