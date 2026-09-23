import { Platform } from 'react-native';
import { esDispositivoDeGamaBaja, UMBRAL_API_GAMA_BAJA } from '@/src/utils/deviceTier';

// `Platform.OS`/`Platform.Version` son getters (no setters) en el mock de
// jest-expo (default `OS: 'ios'`) — una asignación directa falla en
// silencio. `Object.defineProperty` los pisa porque son `configurable: true`.
function setPlatform(os: 'android' | 'ios', version: number | string): void {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  Object.defineProperty(Platform, 'Version', { value: version, configurable: true });
}

describe('esDispositivoDeGamaBaja', () => {
  afterEach(() => setPlatform('ios', undefined as unknown as string));

  it('Android con API igual al umbral: gama baja', () => {
    setPlatform('android', UMBRAL_API_GAMA_BAJA);
    expect(esDispositivoDeGamaBaja()).toBe(true);
  });

  it('Android con API por debajo del umbral: gama baja', () => {
    setPlatform('android', UMBRAL_API_GAMA_BAJA - 1);
    expect(esDispositivoDeGamaBaja()).toBe(true);
  });

  it('Android con API por encima del umbral: NO es gama baja', () => {
    setPlatform('android', UMBRAL_API_GAMA_BAJA + 1);
    expect(esDispositivoDeGamaBaja()).toBe(false);
  });

  it('iOS nunca se marca como gama baja (heurístico es sólo de Android)', () => {
    // En iOS `Platform.Version` es un string ("9.0") — no debe importar acá.
    setPlatform('ios', '9.0');
    expect(esDispositivoDeGamaBaja()).toBe(false);
  });
});
