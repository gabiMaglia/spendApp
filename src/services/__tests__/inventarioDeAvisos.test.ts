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
  restored:  'alguien restauró un gasto que yo tenía borrado',
  joined:    'nos entregaron la clave de un grupo nuevo',
  settled:   'alguien registró un saldo que me involucra',
  sync_down: 'un grupo dejó de sincronizar por algo que no se arregla esperando',
  /**
   * **Lo que hay que hacer está FUERA de la app**, y entra igual.
   *
   * `syncedNow()` corrige el merge contra el reloj del relay, así que los datos
   * están bien. Lo que no se corrige son **las fechas que el usuario ve**: con
   * la hora del teléfono mal, los gastos aparecen con fecha equivocada. La app
   * lo sabía desde ADR-005 y sólo lo mostraba en una pantalla DEV — el mismo
   * defecto que T-037 vino a cerrar, en otro lugar.
   *
   * Avisa UNA vez por desvío y se olvida cuando el reloj se arregla
   * (`sync/clockNotice.ts`), así que no puede volverse ruido.
   */
  clock_off: 'el reloj del teléfono está mal y las fechas se ven cambiadas',
  /**
   * **Pide elegir, y entra igual** (T-136 · ADR-013). Lo que llega a la bandeja
   * es enterarse; la elección se hace en la tarjeta que abre el aviso, con los
   * remitentes delante. Un modal en el arranque sería lo que el PO no quiere.
   */
  group_key_conflict: 'dos o más contactos entregaron claves distintas para un grupo y hay que elegir una',
  /**
   * **Informativo, T-058.** El traspaso ya se aplicó — el grupo viejo queda
   * archivado, de solo lectura — así que no hay nada que aprobar u objetar,
   * sólo enterarse de que el grupo activo ahora es otro.
   */
  group_replaced: 'un grupo del que soy miembro se traspasó a uno nuevo por el límite de gastos',
  /**
   * **Informativo, T-150 ronda 2/5 (ruling del orquestador).** El reclamo ya
   * fue rechazado — no hay nada que aprobar; sólo enterarse de que alguien
   * intentó entrar con el link a un grupo que ya está en el tope de miembros.
   */
  group_invite_full: 'alguien intentó entrar con mi link de invitación a un grupo que ya está en el tope de miembros',
  /**
   * **Pide una acción FUERA de la app, y entra igual** (T-172, ítem 2), mismo
   * criterio que `clock_off`: mi reclamo de ingreso nunca cerró y no hay
   * nada más que la app pueda reintentar sola.
   */
  join_claim_stalled: 'mi reclamo de ingreso por link nunca cerró tras varios intentos',
  /**
   * **Informativo, T-172 (ítem 3).** El traspaso del resto ya se aplicó; sólo
   * enterarse de que una recurrente quedó bloqueada en el grupo archivado.
   */
  group_traspaso_recurring_blocked: 'una recurrente no se pudo mover al traspasar el grupo por falta de firma',
  /**
   * **T-194.** Comentaron un gasto compartido. Mismo casillero que `expenses`
   * (agrega por grupo, nunca avisa lo propio) — antes el comentario llegaba y
   * se mergeaba bien, pero `Snapshot`/`noticesFor` no lo miraban, así que
   * nunca había nada que avisar.
   */
  comment: 'comentaron un gasto compartido',
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
  /**
   * T-189: el motor de sync se partió en `relayEngine.ts` (fachada) +
   * `sync/relay/*.ts` — el aviso vive donde vive la lógica que lo dispara.
   * La lista sigue siendo CERRADA y exacta (QA T-189): un módulo nuevo del
   * motor que empiece a avisar tiene que agregarse acá a mano.
   */
  it('sólo el motor de sync llama a announce(): lista cerrada', () => {
    const llamadores = [...fuentes(SRC), ...fuentes(APP)]
      .filter(ruta => /(^|[^A-Za-z])announce\s*\(/.test(readFileSync(ruta, 'utf8')))
      .map(ruta => relative(SRC, ruta).replace(/\.tsx?$/, '').split(sep).join('/'))
      .sort();

    expect(llamadores).toEqual([
      'services/notifications',
      'sync/relay/contactos',
      'sync/relay/drain',
      'sync/relay/publish',
    ]);
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
  // T-136 anidó `sync.key_conflict` (un objeto, no un string): el cast directo
  // ya no estructura bien contra `Record<string, Record<string, string>>`. Pasa
  // por `unknown` a propósito — ninguno de los `it.each` de abajo lee esa
  // clave anidada, así que el chequeo de forma no protege nada acá.
  const dicts = { es, en, pt } as unknown as Record<string, Record<string, Record<string, string>>>;

  it.each([
    ['notifications.restored', '{{description}}'],
    ['notifications.sync_down_title', '{{group}}'],
    ['notifications.group_replaced_title', '{{group}}'],
    ['notifications.group_replaced_body', '{{newGroup}}'],
  ])('%s lleva su interpolado en los tres idiomas', (clave, marca) => {
    const [seccion, k] = clave.split('.');
    for (const [lang, dict] of Object.entries(dicts)) {
      expect(`${lang}: ${dict[seccion]?.[k] ?? ''}`).toContain(marca);
    }
  });

  it.each([
    ['notifications', 'restored'],
    ['notifications', 'sync_down_title'],
    ['notifications', 'group_replaced_title'],
    ['notifications', 'group_replaced_body'],
    ['sync', 'failure_too_large'],
    ['sync', 'failure_no_key'],
  ])('%s.%s está traducido, no copiado del español', (seccion, k) => {
    const textos = Object.values(dicts).map(d => d[seccion]?.[k]);
    expect(textos.every(Boolean)).toBe(true);
    expect(new Set(textos).size).toBe(3);
  });
});
