import { shortFingerprint } from '../keyFingerprint';

/**
 * Huella corta de una clave pública, para mostrar en la confirmación de
 * contacto (T-093 / SEC H-1): agrupada de a 4 para que se pueda leer en voz
 * alta y comparar contra la pantalla del otro.
 */
describe('shortFingerprint', () => {
  it('agrupa los primeros 16 hex en bloques de 4', () => {
    expect(shortFingerprint('a1b2c3d4e5f6a7b8restodelaclave')).toBe('a1b2 c3d4 e5f6 a7b8');
  });

  it('sin clave, string vacío', () => {
    expect(shortFingerprint(undefined)).toBe('');
    expect(shortFingerprint('')).toBe('');
  });

  it('clave más corta que un bloque: se muestra igual, sin reventar', () => {
    expect(shortFingerprint('a1b2')).toBe('a1b2');
  });

  it('no cambia mayúsculas/minúsculas: se muestra tal cual llega', () => {
    expect(shortFingerprint('AB'.repeat(8))).toBe('ABAB ABAB ABAB ABAB');
  });
});
