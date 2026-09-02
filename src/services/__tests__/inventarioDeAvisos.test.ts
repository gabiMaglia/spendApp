import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

import es from '@/src/i18n/locales/es.json';
import en from '@/src/i18n/locales/en.json';
import pt from '@/src/i18n/locales/pt.json';

/**
 * **Qué llega a la bandeja, y qué no.**
 *
 * La regla que el PO fijó tiene cinco casilleros y sólo uno es la bandeja:
 * «pasó algo que tenés que saber, sin nada que decidir». Los otros cuatro
 * (modal, alerta, marca en la fila, banner) NO son bandeja, y meter algo en el
 * casillero equivocado es lo que entrena al usuario a ignorar los avisos.
 *
 * Este archivo es el inventario de ese casillero. Falla por DIFERENCIA a
 * propósito: un `kind` nuevo obliga a escribirlo acá con su disparador, y ahí
 * es donde se nota si el aviso pertenece a este casillero o a otro.
 */
const SRC = join(__dirname, '..', '..');
const APP = join(SRC, '..', 'app');
const FUENTE_NOTICE = readFileSync(join(SRC, 'services', 'syncNotices.ts'), 'utf8');

/**
 * Lo que la bandeja puede contener, con el evento que lo dispara.
 *
 * **`record_unverified` NO está, y es deliberado (R1 del PO).** Un registro
 * cuya firma no verifica se muestra, suma al balance y lleva su marca en la
 * fila — pero **nunca se acusa**. El borde de ADR-004 hace que registros
 * legítimos no verifiquen, así que un aviso con notificación del sistema
 * convertiría un dato incompleto en una acusación contra una persona real.
 */
const INVENTARIO: Record<string, string> = {
  expenses:  'llegaron gastos ajenos a un grupo',
  deletion:  'alguien pidió borrar un gasto y hay 72hs para objetar',
  restored:  'alguien restauró un gasto que yo tenía borrado',
  joined:    'nos entregaron la clave de un grupo nuevo',
  settled:   'alguien registró un saldo que me involucra',
  /**
   * **El único de la lista que pide hacer algo, y entra igual — con una razón.**
   *
   * La regla del casillero dice «sin nada que decidir», y acá hay que decidir.
   * Pero lo que llega a la bandeja no es la decisión: es **enterarse**. La
   * decisión se toma en la fila del pago, con el monto y la persona delante.
   * Un modal en el arranque para esto sería justo lo que el PO pidió no hacer.
   *
   * Sin este aviso, D2 del plan de T-064 —el pendiente no vence nunca— dejaría
   * el saldado esperando a alguien que no se enteró de que lo esperan.
   */
  settlement_pending: 'alguien dice que me pagó y falta que yo lo confirme',
  sync_down: 'un grupo dejó de sincronizar por algo que no se arregla esperando',
};

/** Los `kind` declarados en la unión `Notice`, leídos del fuente. */
function kindsDeclarados(): string[] {
  const union = FUENTE_NOTICE.slice(
    FUENTE_NOTICE.indexOf('export type Notice'),
    FUENTE_NOTICE.indexOf('export type Snapshot'),
  );
  return [...new Set([...union.matchAll(/kind: '([a-z_]+)'/g)].map(m => m[1]))].sort();
}

describe('el inventario de la bandeja', () => {
  it('no hay ningún tipo de aviso sin declarar, ni declarado de más', () => {
    expect(kindsDeclarados()).toEqual(Object.keys(INVENTARIO).sort());
  });

  it('un registro que no verifica NO tiene aviso: se marca, no se acusa', () => {
    expect(kindsDeclarados()).not.toContain('record_unverified');
    expect(kindsDeclarados().some(k => /verif|firma|sign|trust/.test(k))).toBe(false);
  });
});

/** Todos los fuentes de `src/` y `app/`, recursivo. Los tests no cuentan. */
function fuentes(dir: string): string[] {
  return readdirSync(dir).flatMap(entrada => {
    if (entrada === '__tests__' || entrada === 'node_modules') return [];
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) return fuentes(ruta);
    return /\.tsx?$/.test(entrada) ? [ruta] : [];
  });
}

/**
 * `announce()` es el único portón a la bandeja + notificación del sistema.
 *
 * La lista de quién lo cruza se enumera del fuente y se compara por diferencia:
 * si mañana alguien cablea el veredicto de una firma —o cualquier otra cosa que
 * no sea "pasó algo que tenés que saber"— a este portón, este test lo dice.
 * Un grep a mano no lo diría nunca.
 */
describe('quién puede escribir en la bandeja', () => {
  it('sólo el motor de sync llama a announce()', () => {
    const llamadores = [...fuentes(SRC), ...fuentes(APP)]
      .filter(ruta => /(^|[^A-Za-z])announce\s*\(/.test(readFileSync(ruta, 'utf8')))
      .map(ruta => relative(SRC, ruta).replace(/\.tsx?$/, '').split(sep).join('/'))
      .sort();

    expect(llamadores).toEqual(['services/notifications', 'sync/relayEngine']);
  });
});

/**
 * Los tres idiomas, de verdad.
 *
 * El guard de paridad ya exige que las claves existan en los tres y que no
 * estén vacías — lo que NO puede ver es que alguien haya copiado el español en
 * `en.json` y `pt.json`, ni que se haya perdido el interpolado (`{{group}}`
 * ausente = un aviso que no dice de qué grupo habla).
 */
describe('el texto de los avisos nuevos, en es/en/pt', () => {
  const dicts = { es, en, pt } as Record<string, Record<string, Record<string, string>>>;

  it.each([
    ['notifications.restored', '{{description}}'],
    ['notifications.sync_down_title', '{{group}}'],
    ['notifications.settlement_pending', '{{amount}}'],
  ])('%s lleva su interpolado en los tres idiomas', (clave, marca) => {
    const [seccion, k] = clave.split('.');
    for (const [lang, dict] of Object.entries(dicts)) {
      expect(`${lang}: ${dict[seccion]?.[k] ?? ''}`).toContain(marca);
    }
  });

  it.each([
    ['notifications', 'restored'],
    ['notifications', 'sync_down_title'],
    ['notifications', 'settlement_pending'],
    ['sync', 'failure_too_large'],
    ['sync', 'failure_no_key'],
  ])('%s.%s está traducido, no copiado del español', (seccion, k) => {
    const textos = Object.values(dicts).map(d => d[seccion]?.[k]);
    expect(textos.every(Boolean)).toBe(true);
    expect(new Set(textos).size).toBe(3);
  });
});
