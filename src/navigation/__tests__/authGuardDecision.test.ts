import { decidirNavegacionAuthGuard } from '../authGuardDecision';

/**
 * T-147 (fila 9 de la retro, decisión del PO 2026-09-27): la app no pasa a
 * las tabs hasta que hay sesión del buzón o la persona elige seguir sin
 * verificar. Esta función es la ÚNICA que decide a dónde navega `AuthGuard`
 * — pura, sin React ni router, para poder probar la tabla completa sin
 * montar la app.
 */
describe('decidirNavegacionAuthGuard', () => {
  it('sigue cargando (hydrate en curso): no navega', () => {
    expect(decidirNavegacionAuthGuard({ isLoading: true, hayUsuario: false, inAuth: false, gate: 'ninguna' }))
      .toEqual({ accion: 'ninguna' });
  });

  it('sin usuario y fuera de /auth: va al login', () => {
    expect(decidirNavegacionAuthGuard({ isLoading: false, hayUsuario: false, inAuth: false, gate: 'ninguna' }))
      .toEqual({ accion: 'ir_a_auth' });
  });

  it('sin usuario y ya en /auth: no navega (nada que hacer)', () => {
    expect(decidirNavegacionAuthGuard({ isLoading: false, hayUsuario: false, inAuth: true, gate: 'ninguna' }))
      .toEqual({ accion: 'ninguna' });
  });

  /** Fila 9e: arranque en frío con sesión persistida — la verificación ya
   *  resolvió sola (gate 'lista') sin haber pasado por 'pendiente': jamás
   *  aparece la pantalla de verificación. */
  it('fila 9e: usuario + gate lista → tabs directo, sin pasar por verify', () => {
    expect(decidirNavegacionAuthGuard({ isLoading: false, hayUsuario: true, inAuth: true, gate: 'lista' }))
      .toEqual({ accion: 'ir_a_tabs' });
  });

  it('usuario + gate ninguna (nunca se pidió verificación) → tabs directo', () => {
    expect(decidirNavegacionAuthGuard({ isLoading: false, hayUsuario: true, inAuth: true, gate: 'ninguna' }))
      .toEqual({ accion: 'ir_a_tabs' });
  });

  /** Fila 9c (a mitad de camino): la hidratación inicial está chequeando si
   *  ya hay sesión del buzón — no se navega todavía, ni a tabs ni a verify,
   *  para no mostrar un flash de ninguna de las dos. */
  it('usuario + gate chequeando → no navega (esperando el chequeo)', () => {
    expect(decidirNavegacionAuthGuard({ isLoading: false, hayUsuario: true, inAuth: true, gate: 'chequeando' }))
      .toEqual({ accion: 'ninguna' });
  });

  /** Filas 9a/9b/9c (una vez que el chequeo terminó "necesita verificación"):
   *  bloquea el paso a tabs con la pantalla de verificación. */
  it('usuario + gate pendiente → a la pantalla de verificación, nunca a tabs', () => {
    expect(decidirNavegacionAuthGuard({ isLoading: false, hayUsuario: true, inAuth: true, gate: 'pendiente' }))
      .toEqual({ accion: 'ir_a_verify' });
  });

  it('usuario pero NO en /auth (ya en otra pantalla): no navega, sea cual sea el gate', () => {
    expect(decidirNavegacionAuthGuard({ isLoading: false, hayUsuario: true, inAuth: false, gate: 'pendiente' }))
      .toEqual({ accion: 'ninguna' });
  });
});
