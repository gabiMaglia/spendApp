import { ENLACE_BASE } from '@/src/utils/appLink';
import {
  recordarEnlace, tomarEnlacePendiente, _reiniciarEnlacePendiente,
  marcarConsumido, descartarEnlacePendiente, procesarUrlEntrante,
} from '@/src/utils/enlacePendiente';

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

  it('un link que llega CON sesión no queda pendiente, ni después de cerrar sesión', () => {
    const url = 'spendapp://contact/add?id=u1&name=Ada';
    procesarUrlEntrante(url, true);
    expect(tomarEnlacePendiente()).toBeNull();
    // Aunque algo lo vuelva a presentar sin sesión, ya se usó.
    procesarUrlEntrante(url, false);
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('un link que llega SIN sesión queda pendiente una sola vez', () => {
    procesarUrlEntrante('spendapp://groups/join?g=g1&t=abc&e=1', false);
    expect(tomarEnlacePendiente()).toBe('/groups/join?g=g1&t=abc&e=1');
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('descartar borra el pendiente (cerrar sesión)', () => {
    recordarEnlace('spendapp://contact/add?id=u1&name=Ada');
    descartarEnlacePendiente();
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('marcarConsumido impide que ese link quede pendiente', () => {
    const url = 'spendapp://contact/add?id=u2&name=Bea';
    marcarConsumido(url);
    recordarEnlace(url);
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('null no hace nada', () => {
    procesarUrlEntrante(null, false);
    expect(tomarEnlacePendiente()).toBeNull();
  });
});
