import {
  DURACION_MS,
  FIN_FADE_CUBOS,
  FIN_S,
  INICIO_S,
  avanceCubos,
  opacidadCubos,
  opacidadS,
  restanteDelViaje,
} from '../splashTiming';

describe('tiempo del splash', () => {
  describe('el viaje de los cubos', () => {
    it('arranca en cero y termina en uno', () => {
      expect(avanceCubos(0)).toBe(0);
      expect(avanceCubos(1)).toBe(1);
    });

    it('nunca retrocede', () => {
      let previo = -1;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const v = avanceCubos(t);
        expect(v).toBeGreaterThanOrEqual(previo);
        previo = v;
      }
    });

    it('se aguanta valores fuera de rango sin devolver basura', () => {
      expect(avanceCubos(-3)).toBe(0);
      expect(avanceCubos(7)).toBe(1);
      expect(avanceCubos(NaN)).toBe(0);
    });
  });

  describe('las dos condiciones que pidió el PO', () => {
    /**
     * «en el momento que alcanzan la superposición justa».
     *
     * Esto es lo que amarra `INICIO_S` a la CURVA y no a un gusto: cuando la
     * «S» empieza a aparecer, a los cubos les puede quedar movimiento, pero
     * tiene que ser un resto que no se lee como movimiento. Si alguien cambia
     * el easing por uno más lento y no mueve `INICIO_S`, este test se cae — que
     * es justo lo que tiene que pasar.
     */
    it('la S no empieza hasta que los cubos ya recorrieron el 96% del viaje', () => {
      expect(restanteDelViaje(INICIO_S)).toBeLessThan(0.04);
    });

    it('pero tampoco espera al final: si empezara en 1 no se vería el fade', () => {
      expect(INICIO_S).toBeLessThan(1);
      expect(opacidadS(INICIO_S)).toBe(0);
    });

    /** «que termina cuando termina el movimiento de los cubos». */
    it('la S termina exactamente con el movimiento, no antes', () => {
      expect(FIN_S).toBe(1);
      expect(opacidadS(1)).toBe(1);
      expect(opacidadS(0.999)).toBeLessThan(1);
    });
  });

  describe('opacidades', () => {
    it('la S está invisible durante todo el tramo previo', () => {
      expect(opacidadS(0)).toBe(0);
      expect(opacidadS(INICIO_S / 2)).toBe(0);
    });

    it('la S crece sin saltos entre su inicio y el final', () => {
      const medio = INICIO_S + (1 - INICIO_S) / 2;
      expect(opacidadS(medio)).toBeCloseTo(0.5, 5);
    });

    it('los cubos terminan de aparecer antes de terminar de moverse', () => {
      expect(FIN_FADE_CUBOS).toBeLessThan(1);
      expect(opacidadCubos(FIN_FADE_CUBOS)).toBe(1);
      expect(opacidadCubos(0)).toBe(0);
    });

    it('los cubos ya están visibles cuando entra la S', () => {
      expect(opacidadCubos(INICIO_S)).toBe(1);
    });
  });

  it('la duración es un tiempo de splash, no una espera', () => {
    expect(DURACION_MS).toBeGreaterThan(300);
    expect(DURACION_MS).toBeLessThan(1200);
  });
});
