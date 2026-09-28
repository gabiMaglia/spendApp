/**
 * T-215: cero impacto en producción.
 *
 * `__DEV__` se fuerza a `false` ANTES de importar el módulo (con
 * `jest.isolateModules`, para que el early-return de nivel de módulo —el que
 * evita crear el bucket de MMKV y arrancar el `setInterval` del emisor— corra
 * de verdad, no sólo el de cada función). Sin esto el test podía pasar aunque
 * el módulo hiciera trabajo de más al importarse, porque `__DEV__` ya venía
 * en `true` de un import anterior en el mismo proceso de Jest.
 */
describe('contadorDeRenders en producción (__DEV__ = false)', () => {
  const originalDev = (global as unknown as { __DEV__?: boolean }).__DEV__;

  afterEach(() => {
    (global as unknown as { __DEV__?: boolean }).__DEV__ = originalDev;
  });

  it('registrarRender no acumula nada', () => {
    (global as unknown as { __DEV__?: boolean }).__DEV__ = false;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@/src/dev/contadorDeRenders');
      mod.registrarRender('Inicio', 'x');
      mod.registrarRender('Inicio', 'x');
      expect(mod.resumen()).toEqual([]);
    });
  });

  it('activo() es siempre false, incluso con el flag persistido o el env prendido', () => {
    (global as unknown as { __DEV__?: boolean }).__DEV__ = false;
    process.env.EXPO_PUBLIC_RENDER_LOG = '1';
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@/src/dev/contadorDeRenders');
      expect(mod.activo()).toBe(false);
    });
    delete process.env.EXPO_PUBLIC_RENDER_LOG;
  });

  it('setActivo() no persiste ni arranca el emisor', () => {
    (global as unknown as { __DEV__?: boolean }).__DEV__ = false;
    jest.useFakeTimers();
    const salida = jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@/src/dev/contadorDeRenders');
      mod.setActivo(true);
      mod.registrarRender('Inicio');
      jest.advanceTimersByTime(10000);
      expect(salida).not.toHaveBeenCalled();
    });
    salida.mockRestore();
    jest.useRealTimers();
  });
});
