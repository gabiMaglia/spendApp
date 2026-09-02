import { Platform } from 'react-native';

export const FontFamily = Platform.select({
  ios:     { sans: 'System', mono: 'Menlo' },
  android: { sans: 'Roboto', mono: 'monospace' },
  default: { sans: 'System', mono: 'monospace' },
})!;

// Escala tipográfica — reskin "flat bands".
// Sin serif ni fuente custom: la del sistema. Los montos siempre tabulares.
export const Typography = {
  display: { fontSize: 30, lineHeight: 35, fontWeight: '700' as const, letterSpacing: -0.6 },
  h1:      { fontSize: 26, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.4 },
  h2:      { fontSize: 21, lineHeight: 27, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3:      { fontSize: 17, lineHeight: 23, fontWeight: '700' as const, letterSpacing: -0.2 },
  /** Fila principal de lista (nombre de grupo, contacto, movimiento). */
  bodyL:   { fontSize: 15, lineHeight: 20, fontWeight: '600' as const },
  bodyM:   { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  bodyS:   { fontSize: 12.5, lineHeight: 17, fontWeight: '400' as const },
  caption: { fontSize: 11.5, lineHeight: 15, fontWeight: '500' as const },
  /** Etiqueta de sección: SIEMPRE uppercase + textTertiary. */
  label:   { fontSize: 10.5, lineHeight: 13, fontWeight: '600' as const, letterSpacing: 1 },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  amountXL: { fontSize: 30, lineHeight: 36, fontWeight: '700' as const, letterSpacing: -0.6, fontVariant: ['tabular-nums'] as any },
  amountL:  { fontSize: 24, lineHeight: 31, fontWeight: '700' as const, letterSpacing: -0.4, fontVariant: ['tabular-nums'] as any },
  /** Cifra de banda (GASTADO / DISPONIBLE / TE DEBEN). */
  amountM:  { fontSize: 22, lineHeight: 30, fontWeight: '700' as const, letterSpacing: -0.4, fontVariant: ['tabular-nums'] as any },
  amountS:  { fontSize: 14.5, lineHeight: 18, fontWeight: '700' as const, fontVariant: ['tabular-nums'] as any },
} as const;
