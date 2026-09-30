import { readFileSync } from 'fs';
import { join } from 'path';
import es from '../locales/es.json';
import en from '../locales/en.json';
import pt from '../locales/pt.json';

/**
 * **Lo que la app le promete al usuario tiene que ser cierto.**
 *
 * La pantalla de privacidad afirmaba dos cosas falsas: que los gastos «no pasan
 * por la nube» —pasan, cifrados, con cada cambio— y que hay Bluetooth cuando
 * estás cerca, cuando no existe una sola línea de BLE en el proyecto. Las dos
 * venían del plan original y sobrevivieron a la implementación porque nada las
 * ataba al código.
 *
 * Esto NO revisa que el copy sea lindo. Revisa que dos afirmaciones concretas
 * no se puedan escribir mientras el código diga lo contrario. Es el lugar donde
 * el usuario decide si confiar, y una promesa de privacidad de más pesa más que
 * una de menos.
 */

const RAIZ = join(__dirname, '..', '..', '..');
const POLITICA = join(RAIZ, 'docs', 'PRIVACIDAD.md');
const TERMINOS = join(RAIZ, 'docs', 'TERMINOS.md');
const DICTS: Record<string, unknown> = { es, en, pt };

function textos(d: unknown, out: string[] = []): string[] {
  if (typeof d === 'string') out.push(d);
  else if (d && typeof d === 'object') Object.values(d).forEach(v => textos(v, out));
  return out;
}

describe('la app no promete lo que no hace', () => {
  it('no se nombra Bluetooth mientras no haya una dependencia de Bluetooth', () => {
    const pkg = readFileSync(join(RAIZ, 'package.json'), 'utf8');
    const hayBluetooth = /ble-plx|bluetooth|react-native-bluetooth/i.test(pkg);
    if (hayBluetooth) return; // el día que exista, esta promesa pasa a ser verdad

    for (const [lang, dict] of Object.entries(DICTS)) {
      const culpables = textos(dict).filter(t => /bluetooth|\bBLE\b/i.test(t));
      expect(`${lang}: ${JSON.stringify(culpables)}`).toBe(`${lang}: []`);
    }
  });

  /**
   * `publishToGroup` sella el sobre y lo manda al buzón de Supabase con cada
   * cambio. Los datos SÍ pasan por un servidor —cifrados, que es la promesa
   * honesta y además más fuerte—. Decir que no pasan es falso.
   */
  it('no se dice que los datos no pasan por la nube mientras exista el relay', () => {
    const relay = readFileSync(join(RAIZ, 'src', 'sync', 'motor', 'relaySync.ts'), 'utf8');
    if (!/publishToGroup/.test(relay)) return; // sin relay, la promesa sería cierta

    /**
     * Apunta a los DATOS, no a la clave. «La clave nunca sale de tus
     * dispositivos» es CIERTO y es la mitad buena de la promesa; el guard tiene
     * que dejarla pasar. Lo falso es decir que los gastos no viajan.
     *
     * Esta distinción no es teórica: la primera versión de este test marcó como
     * mentira el texto honesto que yo acababa de escribir.
     */
    const SUJETO = '(datos|gastos|expenses|data|dados|despesas)';
    const NIEGA_LA_NUBE = [
      new RegExp(`${SUJETO}[^.]*no pasan por la nube`, 'i'),
      new RegExp(`${SUJETO}[^.]*(viven|vive) s[oó]lo en tu`, 'i'),
      new RegExp(`${SUJETO}[^.]*nunca (salen|sale) de tu dispositivo`, 'i'),
      new RegExp(`${SUJETO}[^.]*don'?t go through the cloud`, 'i'),
      new RegExp(`${SUJETO}[^.]*lives? only on your`, 'i'),
      new RegExp(`${SUJETO}[^.]*never leaves? your device`, 'i'),
      new RegExp(`${SUJETO}[^.]*n[aã]o pass(am|a) pela nuvem`, 'i'),
      new RegExp(`${SUJETO}[^.]*(vivem|vive) s[oó] no seu`, 'i'),
    ];

    for (const [lang, dict] of Object.entries(DICTS)) {
      const culpables = textos(dict).filter(t => NIEGA_LA_NUBE.some(r => r.test(t)));
      expect(`${lang}: ${JSON.stringify(culpables)}`).toBe(`${lang}: []`);
    }
  });

});

/**
 * La política de privacidad hace afirmaciones VERIFICABLES, y es el documento
 * que las tiendas leen y que el usuario puede citar. Vale la misma regla que el
 * copy de la app: si el código deja de cumplirlas, esto se cae.
 *
 * No se revisa la redacción — sólo que cuatro hechos concretos sigan siendo
 * hechos. Cada uno mira el CÓDIGO, no otro texto.
 */
describe('la política de privacidad sigue siendo cierta', () => {
  const politica = () => readFileSync(POLITICA, 'utf8');
  const pkg = () => JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')) as
    { dependencies: Record<string, string> };

  it('dice que no hay publicidad, y no hay librería de publicidad', () => {
    if (!/No hay publicidad/i.test(politica())) return; // si se saca la promesa, no hay qué guardar
    const deps = Object.keys(pkg().dependencies).join(' ');
    expect(deps).not.toMatch(/mobile-ads|admob|facebook-ads|applovin/i);
  });

  /**
   * **Aviso para el que implemente el reporte de errores (T-078 del plan de
   * lanzamiento): este test te va a frenar, y está bien.** Instalar Sentry o
   * equivalente manda datos de la app a un tercero, y la política dice hoy que
   * no hay nada de eso. El orden correcto es actualizar la política y el
   * formulario de datos de las tiendas, y recién entonces la dependencia — no
   * al revés, y menos borrando esta línea.
   */
  it('dice que no hay analítica, y no hay librería de analítica', () => {
    if (!/No hay anal[íi]tica/i.test(politica())) return;
    const deps = Object.keys(pkg().dependencies).join(' ');
    expect(deps).not.toMatch(/amplitude|mixpanel|segment|firebase\/analytics|posthog|@sentry/i);
  });

  it('dice que no pide micrófono ni Bluetooth, y el app.json los bloquea', () => {
    if (!/NO pide micr[óo]fono/i.test(politica())) return;
    const app = JSON.parse(readFileSync(join(RAIZ, 'app.json'), 'utf8')) as
      { expo: { android: { permissions: string[]; blockedPermissions?: string[] } } };
    const bloqueados = app.expo.android.blockedPermissions ?? [];
    expect(bloqueados).toContain('android.permission.RECORD_AUDIO');
    expect(bloqueados).toContain('android.permission.BLUETOOTH');
    expect(app.expo.android.permissions.join(' ')).not.toMatch(/LOCATION/);
  });

  /**
   * **La misma promesa, del lado de iOS — que hasta T-083 no se verificaba.**
   *
   * `blockedPermissions` es de Android y no tiene equivalente en iOS: allá lo
   * que declara el uso del micrófono es `NSMicrophoneUsageDescription` en el
   * `Info.plist`. El config plugin de `react-native-webrtc` **la inyectaba solo**
   * (`build/withPermissions.js:14-16`), así que la política decía «no pide
   * micrófono» y **el build de iOS lo declaraba igual**, sin que nada fallara.
   *
   * El plugin se fue con T-083. Este test es para que la promesa no se pueda
   * reabrir por el lado que nadie mira: cualquier plugin o cadena que vuelva a
   * declarar micrófono tiene que pasar por acá.
   *
   * ⚠️ **Y el que la inyectaba no era sólo WebRTC.** Al sacarlo, el
   * `Info.plist` GENERADO seguía teniendo la cadena: la pone también
   * `expo-camera` (`plugin/build/withCamera.js:6,10`), con el texto por default
   * en inglés *«Allow $(PRODUCT_NAME) to access your microphone»*. O sea que la
   * promesa estaba rota en iOS **por dos caminos** y ninguno se veía.
   *
   * **Por eso este test NO mira `ios.infoPlist` de `app.json`.** Ahí nunca
   * estuvo la cadena, así que un test que mirara eso pasaría en verde con el
   * micrófono declarado en el binario — un guard que da falso consuelo, que es
   * peor que no tenerlo. Lo que se verifica es **el control real**:
   * `microphonePermission: false` apaga la inyección en iOS y
   * `recordAudioAndroid: false` evita que se agregue en Android
   * (`@expo/config-plugins/build/ios/Permissions.js:28-30`: con `false` la clave
   * se BORRA del plist). Verificado sobre el plist generado el 2026-09-08:
   * con estas dos banderas, cero ocurrencias.
   */
  it('y en iOS no declara micrófono, que es donde la promesa no se veía', () => {
    if (!/NO pide micr[óo]fono/i.test(politica())) return;
    const app = JSON.parse(readFileSync(join(RAIZ, 'app.json'), 'utf8')) as
      { expo: { plugins: (string | [string, Record<string, unknown>])[]; ios?: { infoPlist?: Record<string, unknown> } } };

    const camera = app.expo.plugins.find(
      (p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === 'expo-camera',
    );

    expect(camera?.[1].microphonePermission).toBe(false);
    expect(camera?.[1].recordAudioAndroid).toBe(false);
    // Y que nadie la reintroduzca a mano por el otro lado.
    expect(Object.keys(app.expo.ios?.infoPlist ?? {})).not.toContain('NSMicrophoneUsageDescription');
  });

  /**
   * El plazo no es decorativo: es lo que la política le promete al usuario sobre
   * cuándo desaparece lo que ya no puede borrar a mano. Sale del esquema del
   * buzón, así que si alguien cambia el intervalo, el documento miente.
   */
  /**
   * La política describe «Ajustes → Borrar cuenta». **Ese botón todavía no
   * existe** (T-074), así que la sección lleva una marca de PENDIENTE. Este
   * test ata las dos cosas: la marca se puede sacar el día que el código tenga
   * el borrado, y no antes.
   *
   * Es el mismo error que esta app ya cometió —una pantalla que afirmaba tres
   * cosas que el código no hacía— pero en un documento que además leen las
   * tiendas.
   */
  it('la marca de PENDIENTE del borrado de cuenta se va cuando exista el borrado', () => {
    const { execSync } = require('child_process') as typeof import('child_process');
    const hayBorrado = execSync(
      `grep -rl "deleteAccount\\|borrarCuenta" app src --include='*.ts' --include='*.tsx' ` +
      `--exclude-dir=__tests__ || true`,
      { cwd: RAIZ, encoding: 'utf8' },
    ).trim() !== '';
    const dicePendiente = /PENDIENTE — T-074/.test(politica());
    // Mientras no haya borrado, la marca tiene que estar. Cuando lo haya, sobra.
    expect(`borrado:${hayBorrado} pendiente:${dicePendiente}`)
      .toBe(`borrado:${hayBorrado} pendiente:${!hayBorrado}`);
  });

  it('el plazo de 30 días del buzón es el que dice el SQL, en TODOS los documentos', () => {
    const sql = readFileSync(join(RAIZ, 'supabase', '001_mailbox.sql'), 'utf8');
    const enElSql = /interval\s+'30 days'/.test(sql);
    // Los textos repiten el plazo. Si el SQL cambia, mienten todos a la vez, así
    // que se revisan todos a la vez. Las páginas web entran acá (T-090) y no en
    // un test aparte: el plazo es UNO y el lugar donde se verifica también.
    const web = (n: string) => join(RAIZ, 'docs', 'web', n);
    for (const [nombre, ruta] of [
      ['privacidad', POLITICA],
      ['términos', TERMINOS],
      ['web · borrado', web('borrar-cuenta.es.html')],
      ['web · privacidad', web('privacidad.es.html')],
      ['web · términos', web('terminos.es.html')],
    ] as const) {
      const dice30 = /30 d[íi]as/.test(readFileSync(ruta, 'utf8'));
      expect(`${nombre}: ${dice30}`).toBe(`${nombre}: ${enElSql}`);
    }
  });
});
/**
 * Auditoría pre-tiendas 2026-09-29 (B-2). Cuatro afirmaciones que la app y la
 * política hacían y el código desmentía. Se miran en los tres idiomas de la
 * app, en `docs/PRIVACIDAD.md` y en las tres páginas web de privacidad, que
 * son las que leen las tiendas.
 */
describe('auditoría pre-tiendas: lo que ya no se puede prometer', () => {
  const WEB = ['es', 'en', 'pt'].map(l => join(RAIZ, 'docs', 'web', `privacidad.${l}.html`));
  const documentos = () => [
    readFileSync(POLITICA, 'utf8'),
    ...WEB.map(p => readFileSync(p, 'utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')),
  ];
  const todo = () => [...Object.values(DICTS).flatMap(d => textos(d)), ...documentos()];
  const culpables = (patrones: RegExp[]) => todo().filter(t => patrones.some(r => r.test(t)));

  it('no se dice que no tenemos tu mail ni tu cuenta, mientras la sesión del buzón sea con Google/Apple', () => {
    const auth = readFileSync(join(RAIZ, 'src', 'sync', 'sesion', 'directoryAuth.ts'), 'utf8');
    if (!/signInWithIdToken/.test(auth)) return;
    expect(culpables([
      /no tenemos (una base de datos con[^.]*)?tu mail/i, /no se guarda tu mail/i,
      /no existe en ning[uú]n servidor/i, /no (lo )?mandamos a ning[uú]n servidor/i,
      /don'?t have your e-?mail/i, /(isn'?t|is not) stored/i, /doesn'?t exist on any server/i,
      /n[aã]o temos o seu e-?mail/i, /n[aã]o existe em nenhum servidor/i,
    ])).toEqual([]);
  });

  it('no se promete sincronizar por QR sin servidor: se sacó en T-193', () => {
    expect(culpables([
      /QR[^.]*ning[uú]n servidor/i, /QR[^.]*any server/i, /QR[^.]*nenhum servidor/i,
    ])).toEqual([]);
  });

  it('las notificaciones no avisan pedidos de borrado: el modo con acuerdo se sacó en T-186', () => {
    expect(culpables([/pidi[oó] borrar/i, /asked to delete/i, /pediu para (apagar|excluir)/i])).toEqual([]);
  });

  it('si hay captcha de Cloudflare, la política lo dice', () => {
    const hayTurnstile = /challenges\.cloudflare\.com/.test(
      readFileSync(join(RAIZ, 'src', 'sync', 'sesion', 'turnstileHtml.ts'), 'utf8'));
    if (!hayTurnstile) return;
    for (const d of documentos()) expect(d).toMatch(/Cloudflare/);
  });
});

/**
 * La pantalla de entrada decía «Sin servidor. Sin nube. Sincronización P2P».
 * Las tres cosas son falsas desde que el sync va sólo por el buzón de Supabase
 * (T-083 sacó WebRTC, T-193 el QR). La promesa honesta es otra: nadie más
 * puede leer los gastos (PO 2026-09-29: «Cuentas claras…»).
 */
describe('la app no dice que no hay servidor', () => {
  it('ningún texto promete «sin servidor», «sin nube» ni sync P2P', () => {
    const patrones = [
      /sin servidor/i, /sin nube/i, /\bP2P\b/, /no server/i, /no cloud/i, /sem servidor/i, /sem nuvem/i,
    ];
    for (const [lang, dict] of Object.entries(DICTS)) {
      const culpables = textos(dict).filter(t => patrones.some(r => r.test(t)));
      expect(`${lang}: ${JSON.stringify(culpables)}`).toBe(`${lang}: []`);
    }
  });
});
