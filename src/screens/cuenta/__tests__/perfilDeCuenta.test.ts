import { cambiosDePerfil, claveDeErrorDeImport, perfilDraftValido } from '@/src/screens/cuenta/perfilDeCuenta';

/**
 * T-223: lógica pura que vivía dentro de `app/(tabs)/user.tsx` (664 líneas).
 * Estos tests fijan el comportamiento de antes de la mudanza.
 */

describe('perfilDraftValido', () => {
  it('nombre y email válidos', () => {
    expect(perfilDraftValido('Ana', 'ana@x.com', true)).toBe(true);
  });

  it('el nombre es obligatorio, aunque sea sólo espacios', () => {
    expect(perfilDraftValido('   ', 'ana@x.com', true)).toBe(false);
    expect(perfilDraftValido('', '', false)).toBe(false);
  });

  it('el email editable puede quedar vacío', () => {
    expect(perfilDraftValido('Ana', '  ', true)).toBe(true);
  });

  it('el email editable con forma inválida no pasa', () => {
    expect(perfilDraftValido('Ana', 'no-es-email', true)).toBe(false);
  });

  it('con email no editable (Google) no se mira el email', () => {
    expect(perfilDraftValido('Ana', 'no-es-email', false)).toBe(true);
  });
});

describe('cambiosDePerfil', () => {
  it('limpia nombre y email', () => {
    expect(cambiosDePerfil(' Ana ', ' ana@x.com ', true)).toEqual({ name: 'Ana', email: 'ana@x.com' });
  });

  it('email vacío se guarda como vacío', () => {
    expect(cambiosDePerfil('Ana', '   ', true)).toEqual({ name: 'Ana', email: '' });
  });

  it('con email no editable sólo cambia el nombre', () => {
    expect(cambiosDePerfil('Ana', 'otro@x.com', false)).toEqual({ name: 'Ana' });
  });

  it('nombre vacío o email inválido ⇒ nada que guardar', () => {
    expect(cambiosDePerfil('  ', 'ana@x.com', true)).toBeNull();
    expect(cambiosDePerfil('Ana', 'mal', true)).toBeNull();
  });
});

describe('claveDeErrorDeImport', () => {
  it('respeta las claves backup.* que tira el parser', () => {
    expect(claveDeErrorDeImport(new Error('backup.error_version'))).toBe('backup.error_version');
  });

  it('cualquier otro error cae en formato inválido', () => {
    expect(claveDeErrorDeImport(new Error('Unexpected token'))).toBe('backup.error_invalid_format');
    expect(claveDeErrorDeImport(undefined)).toBe('backup.error_invalid_format');
    expect(claveDeErrorDeImport({ message: 42 })).toBe('backup.error_invalid_format');
    expect(claveDeErrorDeImport('backup.x')).toBe('backup.error_invalid_format');
  });
});
