import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * T-103.B — el PO: «ponele home a la sección cuentas, pero dejale el título
 * "Tus cuentas"». La ETIQUETA de la pestaña cambia (ícono de casa, clave
 * i18n nueva); el TÍTULO adentro de la pantalla no se toca.
 */

const RAIZ = join(__dirname, '..', '..');
const leer = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

describe('T-103.B — pestaña Home', () => {
  it('la pestaña de cuentas (index) usa la clave i18n tabs.home con ícono de casa', () => {
    const src = leer('app/(tabs)/_layout.tsx');
    const lineaIndex = src.split('\n').find(l => l.includes("screen('index'"));
    expect(lineaIndex).toBeDefined();
    expect(lineaIndex).toMatch(/t\('tabs\.home'\)/);
    expect(lineaIndex).toMatch(/'home-outline'/);
  });

  it('la clave tabs.home existe en es/en/pt con los tres textos pedidos', () => {
    const es = JSON.parse(leer('src/i18n/locales/es.json'));
    const en = JSON.parse(leer('src/i18n/locales/en.json'));
    const pt = JSON.parse(leer('src/i18n/locales/pt.json'));
    expect(es.tabs.home).toBe('Inicio');
    expect(en.tabs.home).toBe('Home');
    expect(pt.tabs.home).toBe('Início');
  });

  it('la clave vieja tabs.account ya no existe (no queda huérfana)', () => {
    const es = JSON.parse(leer('src/i18n/locales/es.json'));
    expect(es.tabs.account).toBeUndefined();
  });

  it('el título de la pantalla sigue siendo dashboard.title ("Tus cuentas")', () => {
    const src = leer('app/(tabs)/index.tsx');
    expect(src).toMatch(/t\('dashboard\.title'\)/);
    const es = JSON.parse(leer('src/i18n/locales/es.json'));
    expect(es.dashboard.title).toBe('Tus cuentas');
  });
});
