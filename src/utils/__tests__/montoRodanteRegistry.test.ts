import { crearRegistroDeMontos, debeRodar } from '../montoRodanteRegistry';

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
