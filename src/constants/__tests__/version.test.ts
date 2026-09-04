/**
 * La versión estaba escrita a mano en la pantalla «Yo» (`'1.0.0'`) mientras el
 * perfil `production` de `eas.json` la autoincrementa en cada build: la
 * pantalla iba a decir 1.0.0 para siempre.
 *
 * No es cosmética. El número que el usuario copia en un reporte de bug es el
 * único dato que dice contra qué build estaba, y es lo primero que uno mira
 * cuando algo falla en un teléfono al que no tiene acceso.
 */
describe('la versión que muestra la app', () => {
  afterEach(() => { jest.resetModules(); });

  it('sale de la config de Expo', () => {
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { version: '2.7.1' } },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect((require('../version') as { APP_VERSION: string }).APP_VERSION).toBe('2.7.1');
  });

  it('sin config no imprime «undefined» en la pantalla', () => {
    jest.doMock('expo-constants', () => ({ __esModule: true, default: {} }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect((require('../version') as { APP_VERSION: string }).APP_VERSION).toBe('—');
  });

  it('ninguna pantalla escribe un número de versión a mano', () => {
    // Es la forma en que este bug reaparece: alguien pone el número al lado del
    // texto en vez de leerlo de la config.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('child_process') as typeof import('child_process');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raiz = (require('path') as typeof import('path')).resolve(__dirname, '../../..');
    const salida = execSync(
      `grep -rn "version: *['\\"][0-9]" app src components hooks ` +
      `--include='*.ts' --include='*.tsx' --exclude-dir=__tests__ || true`,
      { cwd: raiz, encoding: 'utf8' },
    ).trim();
    expect(salida).toBe('');
  });
});
