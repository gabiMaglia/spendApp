import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped, activeUserId } from './userScope';
import { ALIAS_BASE } from './accountLink';
import { proveedoresDeCuenta } from './authStore';

/**
 * **Las identidades viejas de la persona que está usando la app** (T-048 · D-1).
 *
 * Cuando dos cuentas resultan ser la misma persona, `mergeAccounts` copia los
 * datos al scope destino **sin tocar un solo registro**: un gasto creado con la
 * identidad de Apple sigue diciendo `createdById: 'apple:000123'` para siempre,
 * y el roster de ese grupo sigue nombrando al miembro por ese id. Reescribirlos
 * está descartado y no por gusto — `createdById` está ADENTRO del núcleo firmado
 * de T-041, así que reescribirlo invalida la firma del autor honesto, y el id
 * nuevo se propagaría por LWW a teléfonos que nunca supieron del enlace
 * (ADR-008 §11-A). **D-6: ningún registro se reescribe, nunca.**
 *
 * Lo que queda entonces es traducir al leer, y ese es todo el trabajo de este
 * módulo. Dos preguntas, dos respuestas, y **no son intercambiables**:
 *
 *  - **`esYo(id)`** — «¿esto es mío?». Un booleano de presentación, local, que
 *    nunca sale del dispositivo. Es la respuesta correcta para las ~55 pantallas
 *    que preguntan si el gasto lo cargué yo o si soy miembro del grupo.
 *  - **`idCanonico(id)`** — «¿qué nodo del grafo de deudas es éste?». Colapsa
 *    mis dos ids en uno solo **antes** de que la aritmética los vea. Va en los
 *    tres puntos de ENTRADA del cálculo (ADR-008 §9) y **en ningún sitio de
 *    comparación**: repartir `esYo()` por la aritmética no arregla nada y rompe
 *    plata, porque los dos ids siguen existiendo como dos nodos y la
 *    simplificación puede emitir una transferencia de una mitad de la persona a
 *    la otra (ADR-008 §4, medido).
 *
 * **Lo que este módulo NO puede hacer, y hay un guard que lo impide:** llegar al
 * cable. `idCanonico` no puede aparecer en el cierre de imports de `buildDelta`
 * ni de `buildGroupPayload` — ver `src/sync/__tests__/canonicalNoAlcanzaElCable.test.ts`.
 * Un id canonicalizado que se publica ES la migración destructiva, sólo que
 * disfrazada y sin forma de volver atrás.
 *
 * **El conjunto es permanente y transitivo.** Permanente porque los registros
 * viejos duran para siempre; transitivo (A→B, después B→C ⇒ alias(C) = {A, B})
 * porque cada fusión hereda los alias del origen. **No se deriva de
 * `acct::merged_scopes`**: ese log es una agenda de purga que se vacía a los 30
 * días (`accountLink.ts`, `MERGE_GRACE_DAYS`), y un alias que caduca dejaría los
 * grupos históricos invisibles de nuevo, tres décadas de mes después.
 *
 * Lo escribe `mergeAccounts` (`accountLink.ts`, `mergeAlias`), que es el único
 * lugar donde dos cuentas se vuelven una. Acá se lee, se cachea por cuenta y se
 * suelta al cambiar de cuenta, con el patrón de `src/sync/ratchet.ts`.
 */

const storage = createSecureStorage('auth');

/**
 * Caché en memoria, **con el scope al que pertenece**.
 *
 * Guardar sólo el conjunto sería la filtración entre cuentas de T-055: la cuenta
 * que entra segunda en el mismo arranque leería los alias de la primera y se
 * adueñaría de sus registros. Se compara el scope en cada lectura además de
 * soltarse en `rehydrateForActiveUser`, para que un test —o un camino que
 * cambie de cuenta sin pasar por la sesión— tampoco pueda ver lo de la anterior.
 */
let alias = new Set<string>();
let scopeCargado: string | null = null;
let cargado = false;

function cargar(): Set<string> {
  const uid = activeUserId();
  if (cargado && scopeCargado === uid) return alias;

  cargado = true;
  scopeCargado = uid;
  alias = uid === null ? new Set() : leerDelScopeActivo();
  return alias;
}

function leerDelScopeActivo(): Set<string> {
  const raw = readScoped(storage, ALIAS_BASE);
  if (!raw) return new Set();
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    // Dato corrupto: se degrada a "sin alias", que es el comportamiento de hoy.
    // Nunca al revés — un alias inventado se apropiaría de registros ajenos.
    return new Set();
  }
}

function guardar(set: Set<string>): void {
  alias = set;
  writeScoped(storage, ALIAS_BASE, JSON.stringify([...set]));
}

/** Suelta la caché. Se llama al cambiar de cuenta activa (`session.ts`). */
export function recargarAlias(): void {
  alias = new Set();
  scopeCargado = null;
  cargado = false;
}

/**
 * Todas las identidades de la persona logueada: la activa primero, después las
 * viejas. Vacío si no hay sesión.
 */
export function misIdentidades(): string[] {
  const uid = activeUserId();
  if (uid === null) return [];
  return [uid, ...[...cargar()].filter(id => id !== uid)];
}

/**
 * «¿Este id soy yo?» — el id activo o cualquiera de mis identidades viejas.
 *
 * Sin sesión devuelve `false`: sin saber quién soy, nada es mío.
 */
export function esYo(id: string | null | undefined): boolean {
  if (!id) return false;
  const uid = activeUserId();
  if (uid === null) return false;
  return id === uid || cargar().has(id);
}

/**
 * ¿Estos dos ids son la misma persona?
 *
 * **Es el primitivo que pueden usar los módulos que el sobre alcanza.** Como
 * `esYo`, devuelve un booleano: no puede reescribir un id, así que no puede
 * convertirse por accidente en la migración destructiva que el guard
 * `canonicalNoAlcanzaElCable.test.ts` existe para impedir. `idCanonico`
 * devuelve un id, y por eso ése sí está prohibido en el grafo del sobre.
 *
 * Ninguno de los dos tiene que ser mío: dos ids ajenos son la misma persona
 * sólo si son iguales — de los enlaces de otro no sabemos nada.
 */
export function mismaPersona(a: string, b: string): boolean {
  return a === b || (esYo(a) && esYo(b));
}

/**
 * El id con el que este id entra a la aritmética de saldos.
 *
 * Devuelve el id activo si es una identidad mía, y el mismo id en cualquier otro
 * caso — **nunca traduce ids ajenos**, ni siquiera cuando el otro peer haya
 * enlazado sus propias cuentas: de eso no sabemos nada y adivinarlo sería
 * fusionarle las deudas a alguien por nuestra cuenta.
 */
export function idCanonico(id: string): string {
  const uid = activeUserId();
  if (uid === null || id === uid) return id;
  return cargar().has(id) ? uid : id;
}

/**
 * Colapsa una lista de ids y **de-duplica**.
 *
 * La de-duplicación no es prolijidad: el roster también alimenta el quórum de
 * aprobaciones para salir de un grupo (`canLeaveGroup`), así que un miembro
 * contado dos veces cambia quién tiene que aprobar. Y en `calculateBalances`
 * dos claves para la misma persona son exactamente los dos nodos que el
 * canonicalizado existe para impedir.
 */
export function rosterCanonico(ids: readonly string[]): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const c = idCanonico(id);
    if (vistos.has(c)) continue;
    vistos.add(c);
    out.push(c);
  }
  return out;
}

/**
 * **Siembra los alias de quien enlazó cuentas ANTES de que T-048 existiera.**
 *
 * A esa persona nadie le va a escribir el alias: su fusión ya ocurrió y
 * `mergeAccounts` no va a volver a correr. Sin esto, el defecto que T-048 cierra
 * le queda abierto para siempre justo a quien ya lo sufrió.
 *
 * **De dónde sale el dato, y por qué NO de `acct::merged_scopes`.** El plan
 * proponía sembrar del log de fusiones, y no sirve por dos razones que se ven
 * recién al abrirlo: ese log **se purga a los 30 días**, y **no dice hacia qué
 * cuenta se fusionó cada scope** — en un teléfono con dos cuentas, sembrar de
 * ahí le adjudicaría a una los scopes absorbidos por la otra, que es mezclarle
 * la plata a dos personas distintas.
 *
 * El índice de identidad sí lo dice y sí es permanente: al absorber la cuenta A
 * dentro de B, `link()` deja `acct::p:A → B` (`accountIdentity.ts`,
 * `confirmLink`). Todo proveedor que apunta a la cuenta activa y no es ella
 * misma es una identidad vieja suya. Nada lo purga —la purga de scopes no toca
 * el índice— así que esto también alcanza a quien enlazó hace más de 30 días,
 * que es el caso que el plan daba por perdido.
 *
 * **Lo que sí queda perdido, declarado:** la transitividad histórica. Si A se
 * absorbió en B y después B en C, el índice dejó `acct::p:A → B`, no `→ C`, así
 * que A no se recupera. Se recupera B, que es la identidad con la que esa
 * persona escribió más recientemente.
 *
 * Es idempotente: sólo escribe si encontró algo que todavía no estaba.
 */
export function sembrarAliasDesdeIndice(): void {
  const uid = activeUserId();
  if (uid === null) return;

  const viejas = proveedoresDeCuenta(uid).filter((p: string) => p !== uid);
  if (viejas.length === 0) return;

  const set = new Set(cargar());
  const antes = set.size;
  for (const p of viejas) set.add(p);
  if (set.size !== antes) guardar(set);
}
