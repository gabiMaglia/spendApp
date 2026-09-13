import { destinoDeUrlExterna, ESQUEMA_GOOGLE_SIGNIN } from '@/src/utils/intencionNativa';
import { enlaceCompacto } from '@/src/utils/appLink';
import appJson from '@/app.json';

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

  it.each([
    'SPENDAPP://debug/identity',
    'SpendApp://settings/borrar-cuenta',
  ])('un esquema en mayúsculas no evade la lista blanca: %s', (url) => {
    expect(destinoDeUrlExterna(url)).toBe('/');
  });

  it('un esquema en mayúsculas sigue abriendo una ruta enlazable', () => {
    expect(destinoDeUrlExterna('SPENDAPP://contact/add?id=u1&name=Ada')).toBe('/contact/add?id=u1&name=Ada');
  });

  it('el https de la página en mayúsculas también rige (host y esquema son case-insensitive por RFC 3986)', () => {
    expect(destinoDeUrlExterna('HTTPS://SPENDAPP.GITHUB.IO/#debug/identity')).toBe('/');
    expect(destinoDeUrlExterna('HTTPS://SPENDAPP.GITHUB.IO/#contact/add?id=u1')).toBe('/contact/add?id=u1');
  });

  it.each(['', '/', 'spendapp://', 'spendapp:', 'spendapp://%%%'])('basura o vacío va al inicio sin lanzar: %j', (url) => {
    expect(destinoDeUrlExterna(url)).toBe('/');
  });

  it('no toca URLs que no son de la app (login de Google, dev client)', () => {
    // El esquema de Google es el REAL de `app.json` (ver test de abajo que los ata):
    // ronda 3 pasó a "deniega por defecto" y ya no deja pasar un esquema `com.googleusercontent.apps.*`
    // cualquiera — sólo el nuestro. Un id inventado ahora cae a `/` (ver test siguiente).
    const google = `${ESQUEMA_GOOGLE_SIGNIN}/oauth2redirect?code=x`;
    const devClient = 'exp+spendapp://expo-development-client/?url=http%3A%2F%2F192.168.0.2%3A8081';
    expect(destinoDeUrlExterna(google)).toBe(google);
    expect(destinoDeUrlExterna(devClient)).toBe(devClient);
  });

  describe('esquemas ajenos no abren pantallas de la app (T-120 · SEC M-5)', () => {
    it.each([
      `${ESQUEMA_GOOGLE_SIGNIN}/groups/leave?id=x`,
      `${ESQUEMA_GOOGLE_SIGNIN}//settle/new?toId=x`,
      `${ESQUEMA_GOOGLE_SIGNIN}/settings/borrar-cuenta`,
      `${ESQUEMA_GOOGLE_SIGNIN}/oauth2redirectX/debug/identity`,
    ])('Google con una ruta que no es el retorno de OAuth va al inicio: %s', (url) => {
      expect(destinoDeUrlExterna(url, false)).toBe('/');
    });

    it('el retorno de OAuth de Google sigue pasando intacto, también en producción', () => {
      const retorno = `${ESQUEMA_GOOGLE_SIGNIN}/oauth2redirect?code=x`;
      expect(destinoDeUrlExterna(retorno, false)).toBe(retorno);
    });

    it.each([
      'exp+spendapp://settle/new?toId=x',
      'exp+spendapp://expo-development-client/?url=spendapp%3A%2F%2Fsettings%2Fborrar-cuenta',
    ])('en producción el esquema del dev client va al inicio: %s', (url) => {
      expect(destinoDeUrlExterna(url, false)).toBe('/');
    });

    it('en desarrollo el dev client sigue funcionando', () => {
      const dev = 'exp+spendapp://expo-development-client/?url=http%3A%2F%2F192.168.0.2%3A8081';
      expect(destinoDeUrlExterna(dev, true)).toBe(dev);
    });
  });

  it('ESQUEMA_GOOGLE_SIGNIN coincide con el iosUrlScheme del plugin de google-signin en app.json', () => {
    const plugin = (appJson.expo.plugins as unknown[]).find(
      (p): p is [string, { iosUrlScheme: string }] =>
        Array.isArray(p) && p[0] === '@react-native-google-signin/google-signin',
    );
    expect(plugin).toBeDefined();
    expect(`${plugin?.[1].iosUrlScheme}:`).toBe(ESQUEMA_GOOGLE_SIGNIN);
  });

  it.each([
    ' spendapp://debug/identity',
    '\tSPENDAPP://debug/identity',
    ' spendapp://debug',
    'javascript:alert(1)',
  ])('espacio/tab inicial o un esquema peligroso no evaden la lista blanca: %j', (url) => {
    expect(destinoDeUrlExterna(url)).toBe('/');
  });

  it('un esquema desconocido, sin espacio ni mayúsculas, también deniega por defecto', () => {
    expect(destinoDeUrlExterna('otraapp://x')).toBe('/');
  });

  it('un link real con espacio alrededor sigue abriendo su pantalla (el trim no rompe el camino feliz)', () => {
    expect(destinoDeUrlExterna(' spendapp://contact/add?id=u1&name=Ada ')).toBe('/contact/add?id=u1&name=Ada');
  });

  it('un valor que no es string no rompe', () => {
    expect(destinoDeUrlExterna(undefined as unknown as string)).toBe('/');
  });
});
