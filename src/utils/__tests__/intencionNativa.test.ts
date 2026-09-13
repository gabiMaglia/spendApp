import { destinoDeUrlExterna } from '@/src/utils/intencionNativa';
import { enlaceCompacto } from '@/src/utils/appLink';

/**
 * **La lista blanca también rige con sesión** (T-095 · SEC M-2).
 *
 * Con sesión, expo-router abría cualquier `spendapp://…`: una web podía mandar a
 * `debug/identity` (con «borrar todo») o a `settings/borrar-cuenta`.
 */
describe('destinoDeUrlExterna', () => {
  it.each([
    'spendapp://debug/identity',
    'spendapp://debug/relay',
    'spendapp://settings/borrar-cuenta',
    'spendapp://settle/new?toId=x&maxAmount=999',
    'spendapp://groups/leave?id=x',
    '/debug/identity',
    '/settings/borrar-cuenta',
  ])('una ruta no enlazable va al inicio: %s', (url) => {
    expect(destinoDeUrlExterna(url)).toBe('/');
  });

  it('los links de la app siguen abriendo su pantalla', () => {
    expect(destinoDeUrlExterna('spendapp://contact/add?id=u1&name=Ada')).toBe('/contact/add?id=u1&name=Ada');
    expect(destinoDeUrlExterna('spendapp://groups/join?g=g1&t=abc&e=1')).toBe('/groups/join?g=g1&t=abc&e=1');
    expect(destinoDeUrlExterna('/contact/add?id=u1&name=Ada')).toBe('/contact/add?id=u1&name=Ada');
  });

  it('las formas compactas y el https de la página también', () => {
    expect(destinoDeUrlExterna('spendapp://cABC_-')).toBe('/contact/add?c=ABC_-');
    expect(destinoDeUrlExterna(enlaceCompacto('g', 'XYZ'))).toBe('/groups/join?c=XYZ');
  });

  it.each(['', '/', 'spendapp://', 'spendapp:', 'spendapp://%%%'])('basura o vacío va al inicio sin lanzar: %j', (url) => {
    expect(destinoDeUrlExterna(url)).toBe('/');
  });

  it('no toca URLs que no son de la app (login de Google, dev client)', () => {
    const google = 'com.googleusercontent.apps.123-abc:/oauth2redirect?code=x';
    const devClient = 'exp+spendapp://expo-development-client/?url=http%3A%2F%2F192.168.0.2%3A8081';
    expect(destinoDeUrlExterna(google)).toBe(google);
    expect(destinoDeUrlExterna(devClient)).toBe(devClient);
  });

  it('un valor que no es string no rompe', () => {
    expect(destinoDeUrlExterna(undefined as unknown as string)).toBe('/');
  });
});
