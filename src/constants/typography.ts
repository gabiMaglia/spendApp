import { Platform } from 'react-native';

export const FontFamily = Platform.select({
  ios:     { sans: 'System', mono: 'Menlo' },
  android: { sans: 'Roboto', mono: 'monospace' },
  default: { sans: 'System', mono: 'monospace' },
})!;

// Escala tipográfica — equivalente a tokens.css --sp-fs-* / --sp-lh-*
export const Typography = {
  display: { fontSize: 34, lineHeight: 41, fontWeight: '700' as const, letterSpacing: -0.4 },
  h1:      { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.3 },
  h2:      { fontSize: 22, lineHeight: 28, fontWeight: '600' as const, letterSpacing: -0.2 },
  h3:      { fontSize: 18, lineHeight: 24, fontWeight: '600' as const, letterSpacing: -0.1 },
  bodyL:   { fontSize: 17, lineHeight: 22, fontWeight: '400' as const },
  bodyM:   { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  bodyS:   { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
  label:   { fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 0.6 },

  // Montos — tabular nums, siempre bold
  amountXL: { fontSize: 48, lineHeight: 52, fontWeight: '700' as const, letterSpacing: -1.5 },
  amountL:  { fontSize: 28, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.8 },
  amountM:  { fontSize: 17, lineHeight: 20, fontWeight: '700' as const },
  amountS:  { fontSize: 14, lineHeight: 18, fontWeight: '700' as const },
} as const;
