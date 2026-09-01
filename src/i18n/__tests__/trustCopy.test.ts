import es from '../locales/es.json';
import en from '../locales/en.json';
import pt from '../locales/pt.json';

/**
 * **El copy de la marca, en los tres idiomas** (T-041 · S10).
 *
 * No es un test de traducción: es un test de una decisión del PO con
 * consecuencia social. **El cartel es NEUTRO, nunca acusatorio** — «no se pudo
 * verificar quién cargó esto», no «este gasto podría ser falso».
 *
 * La razón está en el código y en el ADR: el borde de ADR-004 (Apple manda
 * `email` sólo en la primera autorización) deja a esa persona como otro `owner`
 * y `account_keys` no la encuentra, así que **registros legítimos no
 * verifican**. Un texto acusatorio acusaría a gente honesta por una limitación
 * nuestra.
 *
 * Y hay un techo más: D3. `valida` sólo prueba que firmó un dispositivo cuya
 * clave nos llegó por el canal de contactos —`savePeerFromCard` puede sembrar la
 * primera desde una tarjeta que llegó por el relay—, no que la persona estuviera
 * delante nuestro. La marca no puede insinuar que detectamos suplantación más
 * allá de eso.
 *
 * La paridad de claves entre idiomas la cubre `paridad.test.ts`; acá se mira el
 * TONO, que es lo que ese guard no puede ver.
 */

const IDIOMAS = { es, en, pt } as Record<string, { trust: Record<string, string> }>;
const CLAVES = ['badge', 'expense', 'payment', 'vote'];

/**
 * Palabras que afirman más de lo que T-041 puede probar, o que acusan.
 * Deliberadamente cortas y en los tres idiomas: lo que se quiere atrapar es la
 * tentación de "mejorar" el copy en una revisión futura.
 */
const ACUSATORIAS = [
  'falso', 'fals', 'fraud', 'sospech', 'suspicious', 'suspeit',
  'impostor', 'suplant', 'fake', 'alterad', 'manipulad', 'peligro',
  'no confiable', 'untrusted', 'invál', 'invalid',
];

describe.each(Object.keys(IDIOMAS))('el copy de la marca en %s', (lang) => {
  const trust = IDIOMAS[lang]!.trust;

  it('tiene las cuatro claves', () => {
    expect(Object.keys(trust).sort()).toEqual([...CLAVES].sort());
  });

  it('no acusa a nadie', () => {
    const acusa = CLAVES.filter(k =>
      ACUSATORIAS.some(p => trust[k]!.toLowerCase().includes(p)),
    );
    expect(acusa).toEqual([]);
  });

  /**
   * El aviso largo dice que **no se pudo verificar**, no que algo esté mal. Es
   * la diferencia entre falta de información y una acusación, y es la única
   * afirmación que las tres causas de la marca sostienen a la vez.
   */
  it.each(['expense', 'payment', 'vote'])('«%s» habla de verificar, no de culpar', (clave) => {
    expect(trust[clave]!.toLowerCase()).toMatch(/verif/);
  });

  /** La chapita va en filas densas: si no entra, se corta y no dice nada. */
  it('la chapita es corta', () => {
    expect(trust.badge!.length).toBeLessThanOrEqual(20);
  });
});

/**
 * El español es la fuente de verdad (lo dice CLAUDE.md) y este texto en
 * particular es **el que el PO escribió**. Se fija literal a propósito: si
 * alguien lo cambia, que sea una decisión y no un descuido de revisión.
 */
describe('el texto que eligió el PO', () => {
  it('es el de la decisión del 2026-08-31, palabra por palabra', () => {
    expect(es.trust.expense).toBe('No se pudo verificar quién cargó esto');
  });
});
