import { readFileSync } from 'fs';
import { join } from 'path';
import es from '../locales/es.json';
import en from '../locales/en.json';
import pt from '../locales/pt.json';

/**
 * El borrado de cuenta no puede tener salida lateral (T-074 §13.5).
 *
 * Google prohíbe **dos** cosas que son tentadoras de ofrecer «para ayudar»:
 *
 *  1. proponer **desactivar / pausar / congelar** la cuenta en vez de borrarla;
 *  2. mandar al usuario a **escribir un mail** para completar el borrado — la
 *     excepción de «contactá al soporte» es sólo para industrias muy reguladas
 *     y ésta no lo es.
 *
 * Cualquiera de las dos, agregada con buena intención en un `Alert` o en un
 * texto de consuelo, es motivo de rechazo. Por eso están fijadas acá y no en la
 * memoria de quien toque la pantalla el año que viene.
 *
 * *(Este guard lee los JSON de traducción y el archivo de la pantalla; no barre
 * código fuente, así que no puede detectarse a sí mismo por nombrar las
 * palabras prohibidas en este docblock.)*
 */
const IDIOMAS = { es, en, pt } as const;

const PROHIBIDAS = [
  /desactiv/i, /congel/i, /pausar la cuenta/i,
  /deactivat/i, /freeze/i, /pause your account/i,
  /desativ/i,
];

describe('el borrado de cuenta existe en los tres idiomas', () => {
  const CLAVES = Object.keys(es.account_delete);

  it.each(Object.keys(IDIOMAS))('%s tiene todas las claves', (idioma) => {
    const dict = IDIOMAS[idioma as keyof typeof IDIOMAS].account_delete as Record<string, string>;
    const faltan = CLAVES.filter(k => !dict[k]);
    expect(faltan).toEqual([]);
  });

  it.each(Object.keys(IDIOMAS))('%s está traducido, no copiado del español', (idioma) => {
    if (idioma === 'es') return;
    const dict = IDIOMAS[idioma as keyof typeof IDIOMAS].account_delete as Record<string, string>;
    const base = es.account_delete as Record<string, string>;
    // El título y el botón son las dos frases donde un copy-paste se nota.
    expect(dict.title).not.toBe(base.title);
    expect(dict.confirm).not.toBe(base.confirm);
  });
});

describe('no hay salida lateral al borrado', () => {
  it.each(Object.keys(IDIOMAS))('%s no ofrece desactivar en vez de borrar', (idioma) => {
    const dict = IDIOMAS[idioma as keyof typeof IDIOMAS].account_delete as Record<string, string>;
    const ofensas = Object.entries(dict)
      .filter(([, texto]) => PROHIBIDAS.some(re => re.test(texto)))
      .map(([clave]) => clave);
    expect(ofensas).toEqual([]);
  });

  it('la pantalla no manda a escribir un mail para completar el borrado', () => {
    const pantalla = readFileSync(
      join(__dirname, '..', '..', '..', 'app', 'settings', 'borrar-cuenta.tsx'),
      'utf8',
    );
    expect(pantalla).not.toMatch(/mailto:/i);
    expect(pantalla).toContain('deleteAccount');   // borra de verdad, acá mismo
  });
});
