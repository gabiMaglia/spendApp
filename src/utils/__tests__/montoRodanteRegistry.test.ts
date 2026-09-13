import {
  crearRegistroDeMontos, debeRodar, numeroSemilla, proximoRetrasoDeEntrada,
  __resetProximoRetrasoParaTests,
} from '../montoRodanteRegistry';

/**
 * Decisión pura de "¿anima o no?" para `MontoRodante` (T-106).
 *
 * Las animaciones en sí no se testean acá — sólo esta función, que es la que
 * decide si corresponde animar. El componente le pasa esto directo.
 */
describe('debeRodar', () => {
  it('la primera vez que se ve un id, anima (no hay valor previo)', () => {
    const registro = crearRegistroDeMontos();
    expect(debeRodar(registro, 'home.disponible', '$1.000')).toBe(true);
  });

  it('mismo id, mismo valor de nuevo: no anima (volver a la pestaña sin cambios)', () => {
    const registro = crearRegistroDeMontos();
    debeRodar(registro, 'home.disponible', '$1.000');
    expect(debeRodar(registro, 'home.disponible', '$1.000')).toBe(false);
  });

  it('mismo id, valor distinto: anima (el número cambió)', () => {
    const registro = crearRegistroDeMontos();
    debeRodar(registro, 'home.disponible', '$1.000');
    expect(debeRodar(registro, 'home.disponible', '$1.500')).toBe(true);
  });

  it('cambio de divisa: el texto formateado cambia aunque la magnitud "sea la misma" → anima', () => {
    const registro = crearRegistroDeMontos();
    debeRodar(registro, 'home.disponible', '$1.000');
    expect(debeRodar(registro, 'home.disponible', 'US$1.000')).toBe(true);
  });

  it('ids distintos no se pisan entre sí', () => {
    const registro = crearRegistroDeMontos();
    debeRodar(registro, 'home.disponible', '$1.000');
    // Un id nuevo nunca vio nada: anima, sin importar lo que haya en OTRO id.
    expect(debeRodar(registro, 'home.owedToYou', '$1.000')).toBe(true);
  });

  it('vuelve a animar tras un valor intermedio distinto y luego repetir el último', () => {
    const registro = crearRegistroDeMontos();
    debeRodar(registro, 'home.disponible', '$1.000');       // 1ra vez: anima
    debeRodar(registro, 'home.disponible', '$1.500');       // cambió: anima
    expect(debeRodar(registro, 'home.disponible', '$1.500')).toBe(false); // igual al último: no
  });

  it('simula desmontar y remontar con el mismo valor: el registro sobrevive porque no es estado de React', () => {
    // El registro de módulo (`registroDeMontosDeLaApp`) no se resetea con el
    // desmontaje del componente — es justamente lo que hace que "volver a la
    // pestaña con el mismo valor" no anime. Acá lo probamos con un registro
    // explícito para no depender de un mount real de React Native.
    const registro = crearRegistroDeMontos();
    debeRodar(registro, 'personal.disponible', '$500'); // "monta" con $500
    // "desmonta" (no se toca el registro) y "remonta" con el mismo valor:
    expect(debeRodar(registro, 'personal.disponible', '$500')).toBe(false);
  });
});

/**
 * T-106 — «si el valor es 0, igual tiene que girar»: la semilla de la primera
 * aparición tiene que ser DISTINTA del valor real en cada dígito (para que
 * `number-flow-react-native`, que sólo anima por diferencia, vea un cambio
 * genuino), con el mismo formato/cantidad de dígitos.
 */
describe('numeroSemilla', () => {
  it('para 0, devuelve algo distinto de 0 con el mismo formato (un dígito)', () => {
    const semilla = numeroSemilla(0);
    expect(semilla).not.toBe(0);
    expect(String(semilla)).toHaveLength(1);
  });

  it('cada dígito de la semilla es el opuesto en la rueda (+5 mod 10) del real', () => {
    expect(numeroSemilla(0)).toBe(5);
    expect(numeroSemilla(5)).toBe(0);
    expect(numeroSemilla(9)).toBe(4);
  });

  it('mantiene la misma cantidad de dígitos que el valor real (no salta el ancho)', () => {
    expect(String(numeroSemilla(1234))).toHaveLength(4);
    expect(String(Math.trunc(numeroSemilla(1234.5)))).toHaveLength(4);
  });

  it('difiere del real en TODAS las posiciones, no sólo en una', () => {
    const real = 1234;
    const semilla = String(numeroSemilla(real));
    const textoReal = String(real);
    for (let i = 0; i < textoReal.length; i++) {
      expect(semilla[i]).not.toBe(textoReal[i]);
    }
  });

  it('funciona igual para negativos (opera sobre el valor absoluto)', () => {
    expect(numeroSemilla(-5)).toBe(0);
  });
});

/**
 * T-109 (FPS bajos): varios `MontoRodante` que aparecen por primera vez en el
 * mismo tick (abrir Home, con 4-5 montos) no deben pasar TODOS de la semilla
 * al valor real en el mismo frame — eso es lo que tranca cuadros en gama
 * media/baja. Esta función pura sólo reparte turnos crecientes dentro del
 * mismo lote y resetea apenas ese lote termina (macrotask siguiente), así el
 * próximo grupo de montos que aparezca (otra pantalla) vuelve a arrancar
 * desde el turno 0 sin arrastrar demora de la pantalla anterior.
 */
describe('proximoRetrasoDeEntrada', () => {
  beforeEach(() => { jest.useFakeTimers(); __resetProximoRetrasoParaTests(); });
  afterEach(() => jest.useRealTimers());

  it('crece en pasos fijos dentro del mismo lote (mismo tick)', () => {
    const a = proximoRetrasoDeEntrada();
    const b = proximoRetrasoDeEntrada();
    const c = proximoRetrasoDeEntrada();
    expect(a).toBe(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('resetea a 0 en el próximo lote (después de que el tick actual termine)', () => {
    proximoRetrasoDeEntrada();
    proximoRetrasoDeEntrada();
    jest.runAllTimers();
    expect(proximoRetrasoDeEntrada()).toBe(0);
  });

  it('tiene un tope: no demora sin límite con muchos montos en una sola pantalla', () => {
    let ultimo = -1;
    for (let i = 0; i < 20; i++) ultimo = proximoRetrasoDeEntrada();
    const otraVezElTope = proximoRetrasoDeEntrada();
    expect(otraVezElTope).toBe(ultimo);
  });
});
