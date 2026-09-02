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
