import { execSync } from 'child_process';

/**
 * T-289: una sola puerta a la vibración. Si un archivo importa `expo-haptics`
 * por su cuenta, esa vibración queda fuera del mapa de intenciones.
 */
describe('expo-haptics sólo se importa en src/utils/haptics.ts', () => {
  it('ningún otro archivo de la app lo importa', () => {
    const salida = execSync(
      "git grep -lE \"from 'expo-haptics'|require\\('expo-haptics'\\)\" -- 'app' 'src' 'components' 'hooks' ':!*__tests__*' || true",
      { cwd: process.cwd(), encoding: 'utf8' },
    ).split('\n').filter(Boolean);
    expect(salida).toEqual(['src/utils/haptics.ts']);
  });
});
