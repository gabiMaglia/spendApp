import { useTierStore, dailyCountAt, ADS_DISPONIBLES, PRO_DISPONIBLE } from '../tierStore';
import { createStorage } from '@/src/utils/createStorage';

/**
 * El tope de gastos gratis por día (regla de negocio #6).
 *
 * Dos bugs reales, encontrados el 2026-09-01 al ir a encarar AdMob:
 *
 * 1. **Del 5to gasto del día en adelante, la app no dejaba guardar. Y no decía
 *    nada.** El botón decía «Ver anuncio y guardar», el usuario lo tocaba, y
 *    `handleSave` hacía `if (needsAd) return`. No existe ningún sistema de
 *    anuncios, así que esa puerta no se podía cruzar de ninguna forma: la app
 *    dejaba de poder cumplir su función principal, en silencio.
 * 2. **El día se cortaba en UTC.** Para el PO (UTC−3) el contador se reiniciaba
 *    a las 21:00: cuatro gastos a las 20:00 y otros cuatro a las 21:30 eran dos
 *    días para la app y el mismo día para él.
 */
const storage = createStorage('tier');
const YO = 'u1';

beforeEach(() => storage.clearAll());

describe('el tope no se puede cerrar si no existe la llave', () => {
  it('mientras no haya anuncios, NUNCA se exige uno', () => {
    for (let i = 0; i < 10; i++) useTierStore.getState().incrementCount(YO);
    expect(useTierStore.getState().requiresRewardedAd(YO, false)).toBe(false);
  });

  /**
   * El guard de la clase: si alguien enciende `ADS_DISPONIBLES` sin haber
   * conectado un anuncio, vuelve el botón muerto. Este test obliga a que
   * encenderlo sea una decisión consciente y no un flag que alguien mueve.
   */
  it('si se encienden los anuncios, hay que haber instalado la librería', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../../../package.json') as { dependencies: Record<string, string> };
    const instalada = 'react-native-google-mobile-ads' in pkg.dependencies;
    expect(ADS_DISPONIBLES).toBe(instalada);
  });

  /**
   * El mismo guard, para Pro. Encenderlo sin una forma de cobrar devuelve la
   * pantalla Yo al estado que el PO mandó apagar: un botón «Probar Pro gratis»
   * que no lleva a ningún lado. Si mañana entra RevenueCat o compras in-app,
   * este test avisa que ya se puede encender.
   */
  it('si se enciende Pro, tiene que haber alguna forma de cobrar', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../../../package.json') as { dependencies: Record<string, string> };
    const hayCobro = ['react-native-purchases', 'expo-in-app-purchases']
      .some(lib => lib in pkg.dependencies);
    expect(PRO_DISPONIBLE).toBe(hayCobro);
  });

  it('la REGLA sigue viva aunque no bloquee: pasar el tope se puede saber', () => {
    for (let i = 0; i < 4; i++) useTierStore.getState().incrementCount(YO);
    expect(useTierStore.getState().superoElTope(YO, false)).toBe(true);
    expect(useTierStore.getState().superoElTope(YO, true)).toBe(false); // Pro no tiene tope
  });

  it('con 3 gastos todavía no pasó el tope', () => {
    for (let i = 0; i < 3; i++) useTierStore.getState().incrementCount(YO);
    expect(useTierStore.getState().superoElTope(YO, false)).toBe(false);
  });
});

describe('el día se corta a la medianoche LOCAL, no en UTC', () => {
  /**
   * **Hay que CRUZAR el límite, no quedarse de un lado.** La primera versión de
   * este test comparaba las 21:30 con las 23:30, que en UTC−3 caen las dos
   * DESPUÉS del corte de UTC — cualquiera de las dos implementaciones las pone
   * en el mismo día, así que el test pasaba con el bug puesto. Lo cazó una
   * mutación que no tumbaba nada.
   */
  it('la mañana y la noche del mismo día local cuentan juntas', () => {
    const desfase = new Date(2026, 8, 1).getTimezoneOffset();
    if (desfase === 0) return; // en UTC puro no hay nada que distinguir

    const manana = new Date(2026, 8, 1, 0, 30);   // cruza el corte de UTC…
    const noche  = new Date(2026, 8, 1, 23, 30);  // …y este está del otro lado

    for (let i = 0; i < 4; i++) useTierStore.getState().incrementCount(YO, manana);

    expect(dailyCountAt(YO, noche)).toBe(4);
  });

  it('al día siguiente sí arranca de cero', () => {
    const hoy    = new Date(2026, 8, 1, 12, 0);
    const manana = new Date(2026, 8, 2, 12, 0);
    for (let i = 0; i < 4; i++) useTierStore.getState().incrementCount(YO, hoy);

    expect(dailyCountAt(YO, hoy)).toBe(4);
    expect(dailyCountAt(YO, manana)).toBe(0);
  });

  it('cada usuario cuenta lo suyo', () => {
    useTierStore.getState().incrementCount(YO);
    expect(useTierStore.getState().getDailyCount('otro')).toBe(0);
  });
});
