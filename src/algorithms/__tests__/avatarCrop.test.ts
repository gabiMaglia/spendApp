import {
  escalaParaCubrir, limitesDePan, acotar, recorteDelVisor,
} from '../avatarCrop';

const VISOR = 300;

describe('la escala que cubre el visor', () => {
  // Apaisada: el alto es el lado corto, así que manda el alto.
  it('en una foto apaisada manda el alto', () => {
    expect(escalaParaCubrir({ width: 1000, height: 500 }, VISOR)).toBeCloseTo(0.6);
  });

  it('en una vertical manda el ancho', () => {
    expect(escalaParaCubrir({ width: 500, height: 1000 }, VISOR)).toBeCloseTo(0.6);
  });

  it('una foto más chica que el visor se AGRANDA para cubrirlo', () => {
    // Nunca «entrar» entera: un avatar con bordes vacíos no es un avatar.
    expect(escalaParaCubrir({ width: 100, height: 100 }, VISOR)).toBeCloseTo(3);
  });

  // Una imagen sin medidas no puede tirar: llega de `ImagePicker`, que a veces
  // no las trae.
  it('sin medidas no rompe', () => {
    expect(escalaParaCubrir({ width: 0, height: 0 }, VISOR)).toBe(1);
  });
});

describe('hasta dónde se puede arrastrar', () => {
  it('en el eje que sobra, la mitad de lo que sobra', () => {
    // 1000×500 a escala 0.6 → 600×300. Sobran 300 de ancho ⇒ ±150.
    expect(limitesDePan({ width: 1000, height: 500 }, VISOR, 1)).toEqual({ x: 150, y: 0 });
  });

  it('un cuadrado sin zoom no se mueve para ningún lado', () => {
    expect(limitesDePan({ width: 800, height: 800 }, VISOR, 1)).toEqual({ x: 0, y: 0 });
  });

  it('con zoom, el cuadrado sí se puede mover', () => {
    // A zoom 2 el lado dibujado es 600: sobran 300 ⇒ ±150 en los dos ejes.
    expect(limitesDePan({ width: 800, height: 800 }, VISOR, 2)).toEqual({ x: 150, y: 150 });
  });
});

describe('el rectángulo que se recorta', () => {
  it('sin tocar nada, sale el cuadrado del CENTRO', () => {
    // 1000×500: el cuadrado más grande es 500×500, centrado en x.
    expect(recorteDelVisor({ width: 1000, height: 500 }, VISOR, 1, 0, 0))
      .toEqual({ originX: 250, originY: 0, width: 500, height: 500 });
  });

  it('de una foto cuadrada sale la foto entera', () => {
    expect(recorteDelVisor({ width: 800, height: 800 }, VISOR, 1, 0, 0))
      .toEqual({ originX: 0, originY: 0, width: 800, height: 800 });
  });

  it('arrastrar a la derecha corre el recorte a la IZQUIERDA de la foto', () => {
    // Mover la imagen +x muestra lo que estaba a la izquierda.
    const r = recorteDelVisor({ width: 1000, height: 500 }, VISOR, 1, 150, 0);
    expect(r.originX).toBe(0);
    expect(r.width).toBe(500);
  });

  it('arrastrar al otro extremo llega al borde derecho, y no más', () => {
    const r = recorteDelVisor({ width: 1000, height: 500 }, VISOR, 1, -150, 0);
    expect(r.originX).toBe(500);   // 1000 - 500
  });

  /**
   * **El aserto que justifica que el acotado esté acá y no sólo en el gesto.**
   * Un `originX` negativo no hace fallar a `expo-image-manipulator`: recorta
   * cualquier cosa, en silencio.
   */
  it('un pan imposible se acota, nunca produce un origen negativo', () => {
    const r = recorteDelVisor({ width: 1000, height: 500 }, VISOR, 1, 99_999, 0);
    expect(r.originX).toBe(0);

    const r2 = recorteDelVisor({ width: 1000, height: 500 }, VISOR, 1, -99_999, 0);
    expect(r2.originX + r2.width).toBeLessThanOrEqual(1000);
  });

  it('el zoom achica el recorte: se ve MENOS foto, más grande', () => {
    const sinZoom = recorteDelVisor({ width: 800, height: 800 }, VISOR, 1, 0, 0);
    const conZoom = recorteDelVisor({ width: 800, height: 800 }, VISOR, 2, 0, 0);
    expect(conZoom.width).toBeLessThan(sinZoom.width);
    expect(conZoom.width).toBe(400);
  });

  /**
   * Alejar por debajo del mínimo dejaría bordes vacíos: se ignora.
   *
   * **Con `tx = 0` este caso no prueba nada** y así estaba escrito: el recorte
   * sale igual con zoom 0.2 que con 1, porque el lado del recorte ya está
   * topeado por el tamaño de la imagen. La diferencia aparece con PAN, donde
   * un zoom menor daría límites de arrastre más chicos. Lo descubrió una
   * mutación que sobrevivió.
   */
  it('un zoom menor a 1 se trata como 1, también al arrastrar', () => {
    const conPan = { width: 1000, height: 500 };
    expect(recorteDelVisor(conPan, VISOR, 0.2, 150, 0))
      .toEqual(recorteDelVisor(conPan, VISOR, 1, 150, 0));
    // Y ese pan llega hasta el borde: con un piso menor no llegaría.
    expect(recorteDelVisor(conPan, VISOR, 0.2, 150, 0).originX).toBe(0);
  });

  it('el recorte SIEMPRE es cuadrado y cae dentro de la imagen', () => {
    const casos: [number, number, number, number, number][] = [
      [1000, 500, 1, 120, 0], [500, 1000, 1.5, 0, -80], [800, 800, 3, 40, 40],
      [100, 100, 1, 0, 0],    [4032, 3024, 2.2, -300, 150],
    ];
    for (const [w, h, zoom, tx, ty] of casos) {
      const r = recorteDelVisor({ width: w, height: h }, VISOR, zoom, tx, ty);
      const etiqueta = `${w}x${h} z${zoom}`;
      expect(`${etiqueta} cuadrado: ${r.width === r.height}`).toBe(`${etiqueta} cuadrado: true`);
      expect(`${etiqueta} dentro: ${r.originX >= 0 && r.originY >= 0
        && r.originX + r.width <= w && r.originY + r.height <= h}`).toBe(`${etiqueta} dentro: true`);
    }
  });

  it('todo sale en enteros', () => {
    const r = recorteDelVisor({ width: 4032, height: 3024 }, VISOR, 1.37, 11, -7);
    Object.values(r).forEach(v => expect(Number.isInteger(v)).toBe(true));
  });
});

describe('acotar', () => {
  it('deja pasar lo que está dentro y corta lo que no', () => {
    expect(acotar(5, 0, 10)).toBe(5);
    expect(acotar(-5, 0, 10)).toBe(0);
    expect(acotar(50, 0, 10)).toBe(10);
  });
});
