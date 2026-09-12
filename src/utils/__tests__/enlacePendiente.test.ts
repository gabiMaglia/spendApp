import { ENLACE_BASE } from '@/src/utils/appLink';
import { recordarEnlace, tomarEnlacePendiente, _reiniciarEnlacePendiente } from '@/src/utils/enlacePendiente';

/**
 * **Un link abierto sin sesión no se pierde** (PO, 2026-09-12).
 *
 * Sin sesión, el guard de auth redirige al login y el destino del link se olvidaba: la
 * persona entraba y aterrizaba en el inicio, sin el contacto ni la invitación que abrió.
 */

beforeEach(() => _reiniciarEnlacePendiente());

describe('enlace pendiente', () => {
  it('guarda un link de la app y lo devuelve una sola vez, como ruta del router', () => {
    recordarEnlace(`${ENLACE_BASE}#groups/join?g=g1&t=abc`);
    expect(tomarEnlacePendiente()).toBe('/groups/join?g=g1&t=abc');
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('ignora lo que no es un link enlazable', () => {
    recordarEnlace('spendapp://settings/borrar-cuenta');
    recordarEnlace('exp+spendapp://expo-development-client/?url=x');
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('el último link gana', () => {
    recordarEnlace('spendapp://groups/join?g=viejo');
    recordarEnlace('spendapp://contact/add?id=u1&name=Ada');
    expect(tomarEnlacePendiente()).toBe('/contact/add?id=u1&name=Ada');
  });

  it('un link ya consumido no vuelve a quedar pendiente — logout y login de nuevo no lo reabre', () => {
    // `Linking.useURL()` sigue devolviendo la URL con la que arrancó la app aunque ya se
    // haya usado: sin esto, cada logout la re-guardaría y el próximo login la reabriría.
    const url = 'spendapp://contact/add?id=u1&name=Ada';
    recordarEnlace(url);
    expect(tomarEnlacePendiente()).not.toBeNull();
    recordarEnlace(url);
    expect(tomarEnlacePendiente()).toBeNull();
  });
});
