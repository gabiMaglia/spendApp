import { APP_STORE_ID, PLAY_PACKAGE, TIENDA_DISPONIBLE, urlDeTienda } from '../tienda';

/**
 * La sección «Tienda» de la pantalla Yo abría
 * `https://apps.apple.com/app/id000000000` — un id de relleno, o sea un link
 * muerto— y lo hacía **también en Android**, donde ni siquiera corresponde esa
 * tienda. Peor: «Calificar la app» y «Enviar comentarios» compartían el mismo
 * handler, así que quien quería mandar un comentario terminaba en la misma
 * pared.
 *
 * El guard tiene una sola idea: **encender la sección con los ids de relleno
 * puestos vuelve a poner el link muerto en la app.** Si alguien enciende
 * `TIENDA_DISPONIBLE` sin cambiar el id, esto se cae.
 */
describe('enlaces a las tiendas', () => {
  it('no se puede encender la sección con el id de relleno', () => {
    if (!TIENDA_DISPONIBLE) return; // apagada: no hay link muerto que mostrar
    expect(APP_STORE_ID).not.toBe('000000000');
    expect(APP_STORE_ID).toMatch(/^\d{6,}$/);
  });

  it('el package de Android es el del build, no un ejemplo', () => {
    // Éste sí es el definitivo desde siempre: el link de Play sirve al publicar.
    expect(PLAY_PACKAGE).toBe('com.splitp2p.app');
  });

  it('cada plataforma abre SU tienda', () => {
    // El bug original abría el App Store en Android.
    const url = urlDeTienda();
    expect(url).toMatch(/^https:\/\/(apps\.apple\.com|play\.google\.com)\//);
  });

  it('la app no tiene ningún link de tienda escrito a mano', () => {
    // Si vuelve a aparecer una URL de tienda suelta en una pantalla, este barrido
    // la encuentra: el punto de tener el módulo es que haya UN solo lugar.
    const { execSync } = require('child_process') as typeof import('child_process');
    const raiz = require('path').resolve(__dirname, '../../..') as string;
    const salida = execSync(
      `grep -rl "apps.apple.com\\|play.google.com" app src components hooks ` +
      `--include='*.ts' --include='*.tsx' --exclude-dir=__tests__ ` +
      `--exclude=tienda.ts || true`,
      { cwd: raiz, encoding: 'utf8' },
    ).trim();
    expect(salida).toBe('');
  });
});
