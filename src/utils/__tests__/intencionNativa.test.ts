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

  it('el esquema de Google nunca navega (JS no necesita ver su redirect; lo consume el SDK nativo) y el dev client sigue pasando intacto', () => {
    // El esquema de Google es el REAL de `app.json` (ver test de abajo que los ata).
    // T-133 (reabre T-120 · S3-M1): antes se dejaba pasar `oauth2redirect` intacto y
    // expo-router normalizaba `..` hacia otra pantalla. `GoogleSignInAppDelegate` (nativo)
    // ya consume ese redirect antes de que JS lo vea — no hay ninguna ruta `oauth2redirect`
    // en `app/` — así que ahora NINGÚN path con este esquema navega, siempre `''`.
    const google = `${ESQUEMA_GOOGLE_SIGNIN}/oauth2redirect?code=x`;
    const devClient = 'exp+spendapp://expo-development-client/?url=http%3A%2F%2F192.168.0.2%3A8081';
    expect(destinoDeUrlExterna(google)).toBe('');
    expect(destinoDeUrlExterna(devClient)).toBe(devClient);
  });

  describe('esquemas ajenos no abren pantallas de la app (T-120 · SEC M-5)', () => {
    it.each([
      `${ESQUEMA_GOOGLE_SIGNIN}/groups/leave?id=x`,
      `${ESQUEMA_GOOGLE_SIGNIN}//settle/new?toId=x`,
      `${ESQUEMA_GOOGLE_SIGNIN}/settings/borrar-cuenta`,
      `${ESQUEMA_GOOGLE_SIGNIN}/oauth2redirectX/debug/identity`,
    ])('Google con una ruta que no es el retorno de OAuth no navega: %s', (url) => {
      expect(destinoDeUrlExterna(url, false)).toBe('');
    });

    it('el retorno legítimo de OAuth de Google tampoco navega — no hace falta, el SDK nativo ya lo consumió', () => {
      const retorno = `${ESQUEMA_GOOGLE_SIGNIN}/oauth2redirect?code=x`;
      expect(destinoDeUrlExterna(retorno, false)).toBe('');
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

  describe('T-133 · SEC3 S3-M1 (reabre T-120) — path traversal en el redirect de Google', () => {
    // PoC de la auditoría: expo-router normaliza `..` en el pathname (WHATWG URL) DESPUÉS
    // de que `destinoDeUrlExterna` decida dejarlo pasar. El regex viejo (`RETORNO_GOOGLE`)
    // sólo miraba el PREFIJO (`oauth2redirect/`) y no rechazaba lo que viniera después, así
    // que `oauth2redirect/../settle/new` matcheaba igual y el `..` llegaba intacto a
    // expo-router, que lo resolvía a `settle/new` con los query params precargados.
    it.each([
      `${ESQUEMA_GOOGLE_SIGNIN}/oauth2redirect/../settle/new?toId=x&maxAmount=9`,
      `${ESQUEMA_GOOGLE_SIGNIN}/oauth2redirect/%2e%2e/settings/borrar-cuenta`,
      `${ESQUEMA_GOOGLE_SIGNIN}/oauth2redirect/%2E%2E/settings/borrar-cuenta`,
      `${ESQUEMA_GOOGLE_SIGNIN}/OAUTH2REDIRECT/../groups/leave?id=g1`,
      `${ESQUEMA_GOOGLE_SIGNIN}/oauth2redirect/..%2fgroups/leave?id=g1`,
      `${ESQUEMA_GOOGLE_SIGNIN}/oauth2redirect//../settle/new?toId=x`,
      `${ESQUEMA_GOOGLE_SIGNIN}/oauth2redirect/..\\settle/new?toId=x`,
    ])('un `..` (o su escape/mayúscula/barra múltiple/backslash) tras oauth2redirect no navega: %s', (url) => {
      expect(destinoDeUrlExterna(url, false)).toBe('');
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
