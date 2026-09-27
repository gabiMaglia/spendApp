import { codigoDeErrorGoogle } from '@/src/utils/googleSignInError';

describe('codigoDeErrorGoogle', () => {
  it('nombra el DEVELOPER_ERROR de Android (SHA-1 no registrado)', () => {
    expect(codigoDeErrorGoogle({ code: '10' })).toBe('DEVELOPER_ERROR · 10');
  });

  it('acepta el código como número', () => {
    expect(codigoDeErrorGoogle({ code: 12500 })).toBe('SIGN_IN_FAILED · 12500');
  });

  it('un código sin nombre conocido se muestra tal cual', () => {
    expect(codigoDeErrorGoogle({ code: 'PLAY_SERVICES_NOT_AVAILABLE' })).toBe('PLAY_SERVICES_NOT_AVAILABLE');
  });

  it('sin código, o con algo que no es un error, dice UNKNOWN', () => {
    expect(codigoDeErrorGoogle(new Error('boom'))).toBe('UNKNOWN');
    expect(codigoDeErrorGoogle(null)).toBe('UNKNOWN');
    expect(codigoDeErrorGoogle(undefined)).toBe('UNKNOWN');
    expect(codigoDeErrorGoogle({ code: '' })).toBe('UNKNOWN');
  });
});
