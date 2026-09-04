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
    const relay = readFileSync(join(RAIZ, 'src', 'sync', 'relaySync.ts'), 'utf8');
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

  it('el plazo de 30 días del buzón es el que dice el SQL, en los DOS documentos', () => {
    const sql = readFileSync(join(RAIZ, 'supabase', '001_mailbox.sql'), 'utf8');
    const enElSql = /interval\s+'30 days'/.test(sql);
    // Los dos textos repiten el plazo. Si el SQL cambia, los dos mienten a la
    // vez, así que los dos se revisan a la vez.
    for (const [nombre, ruta] of [['privacidad', POLITICA], ['términos', TERMINOS]] as const) {
      const dice30 = /30 d[íi]as/.test(readFileSync(ruta, 'utf8'));
      expect(`${nombre}: ${dice30}`).toBe(`${nombre}: ${enElSql}`);
    }
  });
});