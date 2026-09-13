import { readFileSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { REQUERIDAS, faltantes, main } = require('../../scripts/verificar-env-build.js');

/**
 * **Un build sin buzón no sale** (T-099).
 *
 * Sin `EXPO_PUBLIC_SUPABASE_*`, la sync se apaga en silencio (`relayEngine.ts:129`) y
 * además `authStore.ts:240` fusiona cuentas sin probar el proveedor.
 */
const COMPLETO = Object.fromEntries(
  ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB', 'EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS']
    .map(n => [n, `CENTINELA-${n}`]),
);

describe('verificar-env-build', () => {
  it('exige exactamente las 4 variables que lee el código', () => {
    expect([...REQUERIDAS].sort()).toEqual(Object.keys(COMPLETO).sort());
  });

  it('con las 4 presentes no falta nada', () => {
    expect(faltantes(COMPLETO, 'production')).toEqual([]);
  });

  it('lista las ausentes y las vacías, en production y preview', () => {
    const env = { ...COMPLETO, EXPO_PUBLIC_SUPABASE_URL: undefined, EXPO_PUBLIC_SUPABASE_ANON_KEY: '   ' };
    for (const perfil of ['production', 'preview']) {
      expect(faltantes(env, perfil).sort()).toEqual(['EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_URL']);
    }
  });

  it('development no se chequea', () => {
    expect(faltantes({}, 'development')).toEqual([]);
  });

  it('fuera de EAS no hace nada (expo start, builds locales)', () => {
    const log = jest.fn();
    expect(main({}, log)).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });

  it('en EAS falla si falta algo, y la salida NO contiene ningún valor', () => {
    const log = jest.fn();
    const env = { ...COMPLETO, EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS: '' };
    expect(main(env, log)).toBe(1);
    const salida = log.mock.calls.flat().join('\n');
    expect(salida).toContain('EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS');
    expect(salida).not.toMatch(/CENTINELA/);
  });

  it('en EAS con todo presente pasa', () => {
    expect(main({ ...COMPLETO, EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'preview' }, jest.fn())).toBe(0);
  });

  it('EAS lo corre: package.json lo engancha como eas-build-post-install', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
    expect(pkg.scripts['eas-build-post-install']).toBe('node scripts/verificar-env-build.js');
  });

  it('las 4 variables son las que usa el código', () => {
    const relay = readFileSync(join(__dirname, '..', 'sync', 'relay.ts'), 'utf8');
    const auth = readFileSync(join(__dirname, '..', '..', 'app', 'auth', 'index.tsx'), 'utf8');
    const usadas = new Set([...(relay + auth).matchAll(/process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g)].map(m => m[1]));
    expect([...usadas].sort()).toEqual([...REQUERIDAS].sort());
  });
});
