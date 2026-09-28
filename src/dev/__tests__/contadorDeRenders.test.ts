import {
  registrarRender, resumen, reset, activo, setActivo,
} from '@/src/dev/contadorDeRenders';

/**
 * T-215: instrumentación DEV-ONLY de re-renders para chequeo manual del PO.
 *
 * `__DEV__` ya es `true` en este entorno de Jest (jest-expo); el test de "cero
 * impacto en prod" que fuerza `__DEV__ = false` vive aparte, en
 * `contadorDeRendersProd.test.ts` — acá se prueba el comportamiento real.
 */
describe('contadorDeRenders', () => {
  const envOriginal = process.env.EXPO_PUBLIC_RENDER_LOG;

  beforeEach(() => {
    reset();
    setActivo(false);
    delete process.env.EXPO_PUBLIC_RENDER_LOG;
  });

  afterEach(() => {
    setActivo(false);
    if (envOriginal === undefined) delete process.env.EXPO_PUBLIC_RENDER_LOG;
    else process.env.EXPO_PUBLIC_RENDER_LOG = envOriginal;
  });

  it('cuenta renders por nombre', () => {
    registrarRender('Inicio');
    registrarRender('Inicio');
    registrarRender('Grupos');
    const s = resumen();
    expect(s.find(x => x.nombre === 'Inicio')?.renders).toBe(2);
    expect(s.find(x => x.nombre === 'Grupos')?.renders).toBe(1);
  });

  it('acumula motivos por nombre', () => {
    registrarRender('Detalle de grupo', 'users');
    registrarRender('Detalle de grupo', 'users');
    registrarRender('Detalle de grupo', 'expenses');
    const fila = resumen().find(x => x.nombre === 'Detalle de grupo');
    expect(fila?.renders).toBe(3);
    expect(fila?.motivos).toEqual({ users: 2, expenses: 1 });
  });

  it('un render sin motivo no agrega nada a motivos', () => {
    registrarRender('Inicio');
    const fila = resumen().find(x => x.nombre === 'Inicio');
    expect(fila?.motivos).toEqual({});
  });

  it('reset() limpia todo el estado acumulado', () => {
    registrarRender('Inicio', 'x');
    reset();
    expect(resumen()).toEqual([]);
  });

  describe('flag activo()', () => {
    it('apagado por default (sin persistencia ni env)', () => {
      expect(activo()).toBe(false);
    });

    it('setActivo(true) persiste y activa el flag', () => {
      setActivo(true);
      expect(activo()).toBe(true);
    });

    it('setActivo(false) lo apaga de nuevo', () => {
      setActivo(true);
      setActivo(false);
      expect(activo()).toBe(false);
    });

    it('EXPO_PUBLIC_RENDER_LOG=1 activa el flag sin persistencia', () => {
      process.env.EXPO_PUBLIC_RENDER_LOG = '1';
      expect(activo()).toBe(true);
    });
  });

  describe('emisor agregado (cada 2s)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('imprime una línea por componente con motivos y limpia el acumulado', () => {
      const salida = jest.spyOn(console, 'info').mockImplementation(() => {});
      setActivo(true);

      registrarRender('Detalle de grupo', 'users');
      registrarRender('Detalle de grupo', 'users');
      registrarRender('Detalle de grupo', 'expenses');

      jest.advanceTimersByTime(2000);

      expect(salida).toHaveBeenCalledWith('[renders] Detalle de grupo: 3 (users×2, expenses×1)');

      // El acumulado de esa ventana se limpia: un segundo volcado sin renders
      // nuevos no vuelve a imprimir nada para ese componente.
      salida.mockClear();
      jest.advanceTimersByTime(2000);
      expect(salida).not.toHaveBeenCalled();

      salida.mockRestore();
    });

    it('no imprime nada si el flag está apagado', () => {
      const salida = jest.spyOn(console, 'info').mockImplementation(() => {});
      setActivo(false);
      registrarRender('Inicio');
      jest.advanceTimersByTime(4000);
      expect(salida).not.toHaveBeenCalled();
      salida.mockRestore();
    });

    it('sin motivos, la línea sale sin paréntesis', () => {
      const salida = jest.spyOn(console, 'info').mockImplementation(() => {});
      setActivo(true);
      registrarRender('Grupos');
      jest.advanceTimersByTime(2000);
      expect(salida).toHaveBeenCalledWith('[renders] Grupos: 1');
      salida.mockRestore();
    });
  });
});
