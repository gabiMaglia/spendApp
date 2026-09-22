import { sanitizeEmail } from '../sanitizeEmail';

describe('sanitizeEmail', () => {
  it('acepta un email con forma válida', () => {
    expect(sanitizeEmail('gab.maglia@gmail.com')).toBe('gab.maglia@gmail.com');
  });

  it('recorta espacios alrededor', () => {
    expect(sanitizeEmail('  gab.maglia@gmail.com  ')).toBe('gab.maglia@gmail.com');
  });

  it('rechaza sin arroba', () => {
    expect(sanitizeEmail('gab.magliagmail.com')).toBeNull();
  });

  it('rechaza sin dominio', () => {
    expect(sanitizeEmail('gab@gmail')).toBeNull();
  });

  it('rechaza vacío', () => {
    expect(sanitizeEmail('   ')).toBeNull();
  });
});
