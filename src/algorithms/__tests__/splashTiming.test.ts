import {
  DESPLAZAMIENTO,
  DURACION_MS,
  FIN_FADE_CUBOS,
  FIN_S,
  INICIO_S,
  avanceCubos,
  opacidadCubos,
  opacidadS,
  desplazamiento,
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

  /**
   * El pedido, textual: «que arranque uno en una esquina y el otro en otra y se
   * vayan juntando hasta llegar a la posición que tienen; empiezan levemente
   * alejados y se van juntando».
   *
   * La primera versión movía los dos cubos IGUAL, en la misma dirección: se
   * trasladaban juntos en vez de converger. Estos tests fijan la diferencia, que
   * no se ve mirando un solo cubo.
   */
  describe('los cubos convergen, no viajan juntos', () => {
    it('arrancan separados y en direcciones opuestas', () => {
      const a = desplazamiento('petroleo', 0);
      const b = desplazamiento('salvia', 0);
      expect(a).toBeLessThan(0);      // entra desde arriba-izquierda
      expect(b).toBeGreaterThan(0);   // entra desde abajo-derecha
      expect(a).toBeCloseTo(-b, 10);  // simétricos
    });

    it('los dos terminan exactamente en su lugar', () => {
      expect(desplazamiento('petroleo', 1)).toBe(0);
      expect(desplazamiento('salvia', 1)).toBe(0);
    });

    it('la distancia entre los dos sólo baja: se juntan, nunca se alejan', () => {
      let previa = Infinity;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const d = Math.abs(desplazamiento('salvia', t) - desplazamiento('petroleo', t));
        expect(d).toBeLessThanOrEqual(previa + 1e-9);
        previa = d;
      }
      expect(previa).toBeCloseTo(0, 10);
    });

    it('nunca se cruzan: el petróleo no pasa del otro lado', () => {
      for (let t = 0; t <= 1.0001; t += 0.05) {
        expect(desplazamiento('petroleo', t)).toBeLessThanOrEqual(0);
        expect(desplazamiento('salvia', t)).toBeGreaterThanOrEqual(0);
      }
    });

    it('«levemente alejados»: la separación inicial es una fracción de la marca', () => {
      // Es el doble del desplazamiento porque cada uno aporta el suyo.
      const separacion = 2 * DESPLAZAMIENTO;
      expect(separacion).toBeGreaterThan(0.15);  // se tiene que notar
      expect(separacion).toBeLessThan(0.6);      // pero no cruzar la pantalla
    });

    it('ya están juntos cuando entra la S', () => {
      const d = Math.abs(desplazamiento('salvia', INICIO_S) - desplazamiento('petroleo', INICIO_S));
      expect(d).toBeLessThan(0.02);
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
