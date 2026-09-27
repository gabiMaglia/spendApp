import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';

/**
 * **Ofertas de clave de grupo** (T-136 · ADR-013).
 *
 * Hasta acá, la primera clave firmada que llegaba por contacto para un grupo
 * que no teníamos ganaba para siempre. «Peer» es cualquiera que conozca mi
 * secreto de contacto —cualquiera que haya escaneado mi QR—, así que ese
 * «primero» podía ser un atacante: bloqueaba la entrega real, la invitación y
 * leía lo que la víctima escribía en su topic.
 *
 * Ahora cada clave entregada es una OFERTA por (grupo, remitente). Se adopta
 * sola sólo si todas las ofertas del grupo coinciden; si no, decide el usuario
 * (`services/elegirClaveDeGrupo.ts`). La membresía no sirve para arbitrar: el
 * roster viaja cifrado con la clave en disputa y `memberIds` no está firmado.
 *
 * **Fix round 1 (Sybil vía el tope).** El primer tope era de 5 REMITENTES por
 * grupo. Un atacante que conoce el secreto de contacto de la víctima puede
 * pinnear varios peers falsos con tarjetas auto-descriptas (nada verifica que
 * el nombre o el id de una tarjeta sea real): con 5 de ellos entregando la
 * MISMA clave inventada antes de que el miembro real entregara la suya, el
 * tope de remitentes quedaba lleno y la oferta real —el sexto remitente— se
 * ignoraba en silencio: ni oferta, ni conflicto, ni aviso, y la falsa se
 * adoptaba como unánime. El tope pasa a ser de **claves distintas**
 * (`MAX_CLAVES_DISTINTAS_POR_GRUPO`), que es lo que de verdad hay que acotar
 * para que `estadoDe` siga siendo barato de calcular; el tope de remitentes
 * (`MAX_REMITENTES_POR_GRUPO`) queda sólo como cota de almacenamiento, muy por
 * encima de cualquier grupo real, así que nunca tapa una clave distinta por sí
 * solo. Cuando una clave distinta NO puede guardarse porque un tope está
 * lleno, el grupo se marca en conflicto igual (`marcarConflictoForzado`): la
 * regla de oro es que ninguna disidencia se pierde en silencio, aunque no
 * entre en la tabla.
 *
 * Guarda CLAVES: por eso vive en el bucket cifrado `groupkeys` y scopeado por
 * cuenta, igual que `groupKeyStore`. No es un store de zustand ni cachea en
 * memoria: se lee del disco en cada llamada, así que no hay nada que soltar al
 * cambiar de cuenta.
 */

/** Tope de CLAVES DISTINTAS por grupo: lo que de verdad hay que acotar. */
export const MAX_CLAVES_DISTINTAS_POR_GRUPO = 5;
/**
 * Tope de REMITENTES por grupo: sólo una cota de almacenamiento. Muy por
 * encima de cualquier grupo real, para que nunca sea éste —y no el de claves
 * distintas— el que decida si una disidencia entra o no a la tabla.
 */
export const MAX_REMITENTES_POR_GRUPO = 50;
export const BUCKET_OFERTAS = 'groupkeys';
export const PREFIJO_OFERTA_INVITACION = 'invite:';

const storage = createSecureStorage(BUCKET_OFERTAS);
const K_OFERTAS = 'key_offers_v1';
const K_CONFLICTOS = 'key_offer_conflicts_v1';

export type OrigenOferta = 'contact' | 'invite';

export type KeyOffer = {
  groupId: string;
  /** Id de quien la entregó. Para una invitación: `invite:<huella>`. */
  fromUserId: string;
  /** Clave en hex, siempre en minúsculas. */
  key: string;
  epoch: number;
  origen: OrigenOferta;
  receivedAt: number;
  /** `true` si ESTA clave es la que se adoptó: la prueba de que la local vino de contacto. */
  adoptada: boolean;
};

export type EstadoOfertas = 'sin_ofertas' | 'unanime' | 'conflicto';

export type ResultadoAplicarOferta = {
  /** `null` si esta llamada no cambia la lista de ofertas. */
  lista: KeyOffer[] | null;
  /**
   * `true` si esta llamada encontró una clave DISTINTA que no pudo guardarse
   * por algún tope lleno. Es la señal de "no pierdas esta disidencia": aunque
   * la oferta no entre a la tabla, el grupo tiene que quedar en conflicto
   * igual (`marcarConflictoForzado`) — nunca silenciarse.
   */
  forzarConflicto: boolean;
};

/**
 * Suma una oferta a la lista.
 *
 *  - Misma clave del mismo remitente → no-op: es el reenvío de cada arranque.
 *  - Otra clave del mismo remitente → reemplaza SU oferta, salvo que ya esté
 *    adoptada (esa es la prueba de origen de la clave local y no se pisa) o que
 *    la clave nueva no entre por el tope de claves distintas — en ese caso se
 *    fuerza conflicto en vez de perder la disidencia.
 *  - Remitente nuevo con una clave YA presente entre las del grupo → se agrega
 *    mientras no se llene el tope de REMITENTES (sólo almacenamiento: nunca
 *    tapa una clave distinta).
 *  - Remitente nuevo con una clave DISTINTA de todas las del grupo → se agrega
 *    sólo si hay lugar en los dos topes; si no, se fuerza conflicto.
 */
export function aplicarOferta(lista: readonly KeyOffer[], o: KeyOffer): ResultadoAplicarOferta {
  const entrante: KeyOffer = { ...o, key: o.key.toLowerCase() };
  const delGrupo = lista.filter(x => x.groupId === entrante.groupId);
  const i = delGrupo.findIndex(x => x.fromUserId === entrante.fromUserId);
  const SIN_CAMBIO: ResultadoAplicarOferta = { lista: null, forzarConflicto: false };

  if (i !== -1) {
    const previa = delGrupo[i]!;
    if (previa.key === entrante.key) return SIN_CAMBIO;
    if (previa.adoptada) return SIN_CAMBIO;

    // Reemplazo de SU oferta: el resto del grupo no cambia de remitentes, así
    // que sólo el tope de claves distintas puede llegar a importar acá.
    const clavesSinEsteRemitente = new Set(delGrupo.filter((_, idx) => idx !== i).map(x => x.key));
    if (!clavesSinEsteRemitente.has(entrante.key) && clavesSinEsteRemitente.size >= MAX_CLAVES_DISTINTAS_POR_GRUPO) {
      return { lista: null, forzarConflicto: true };
    }

    const nueva = lista.map(x =>
      (x.groupId === entrante.groupId && x.fromUserId === entrante.fromUserId) ? entrante : x);
    return { lista: nueva, forzarConflicto: false };
  }

  // Remitente nuevo.
  const claves = new Set(delGrupo.map(x => x.key));
  const esClaveYaPresente = claves.has(entrante.key);

  if (delGrupo.length >= MAX_REMITENTES_POR_GRUPO) {
    // Tope de remitentes lleno. Si la clave que trae ya está entre las del
    // grupo, no hay disidencia nueva que perder: sólo se descarta por espacio.
    // Si es DISTINTA, es la disidencia que el atacante quiere tapar — se
    // fuerza conflicto igual, aunque no entre a la tabla.
    return { lista: null, forzarConflicto: !esClaveYaPresente };
  }

  if (!esClaveYaPresente && claves.size >= MAX_CLAVES_DISTINTAS_POR_GRUPO) {
    return { lista: null, forzarConflicto: true };
  }

  return { lista: [...lista, entrante], forzarConflicto: false };
}

/** ¿Las ofertas (y la clave local, si se pasa) coinciden todas? */
export function estadoDe(ofertas: readonly KeyOffer[], claveLocal?: string): EstadoOfertas {
  if (ofertas.length === 0) return 'sin_ofertas';
  const claves = new Set(ofertas.map(o => o.key.toLowerCase()));
  if (claveLocal !== undefined) claves.add(claveLocal.toLowerCase());
  return claves.size === 1 ? 'unanime' : 'conflicto';
}

function esOferta(x: unknown): x is KeyOffer {
  const o = x as Partial<KeyOffer> | null;
  return !!o
    && typeof o.groupId === 'string'
    && typeof o.fromUserId === 'string'
    && typeof o.key === 'string'
    && typeof o.epoch === 'number'
    && typeof o.adoptada === 'boolean';
}

function leer(): KeyOffer[] {
  const raw = readScoped(storage, K_OFERTAS);
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(esOferta) : [];
  } catch {
    return []; // dato corrupto: sin ofertas no hay nada elegible, que es el lado seguro
  }
}

function guardar(lista: KeyOffer[]): void {
  writeScoped(storage, K_OFERTAS, JSON.stringify(lista));
}

function leerConflictos(): string[] {
  const raw = readScoped(storage, K_CONFLICTOS);
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return []; // dato corrupto: sin flag no hay conflicto forzado, que es el lado seguro
  }
}

function guardarConflictos(lista: string[]): void {
  writeScoped(storage, K_CONFLICTOS, JSON.stringify(lista));
}

/**
 * Marca el grupo como en conflicto FORZADO: una clave distinta no entró a la
 * tabla por un tope lleno, pero la disidencia no se puede perder.
 * Persistido junto a las ofertas — `olvidarOfertas` lo limpia.
 */
export function marcarConflictoForzado(groupId: string): void {
  const lista = leerConflictos();
  if (!lista.includes(groupId)) guardarConflictos([...lista, groupId]);
}

export function conflictoForzado(groupId: string): boolean {
  return leerConflictos().includes(groupId);
}

/**
 * `true` si la llamada dejó al grupo con algo NUEVO que resolver: una oferta
 * nueva o reemplazada en la tabla, o un conflicto forzado por tope lleno. Es
 * lo que el canal usa para decidir qué grupos revisar al final del lote — un
 * conflicto forzado sin cambio de tabla igual tiene que entrar a esa revisión,
 * o `estado()` nunca se vuelve a mirar para este grupo en este lote.
 */
export function registrarOferta(o: KeyOffer): boolean {
  const r = aplicarOferta(leer(), o);
  if (r.forzarConflicto) marcarConflictoForzado(o.groupId);
  if (!r.lista) return r.forzarConflicto;
  guardar(r.lista);
  return true;
}

export function ofertasDe(groupId: string): KeyOffer[] {
  return leer().filter(o => o.groupId === groupId);
}

/**
 * Ve todas las ofertas del grupo, MÁS el conflicto forzado si lo hay: una
 * clave distinta que no entró a la tabla por tope lleno sigue siendo
 * conflicto, aunque `estadoDe` sobre la tabla sola no la vea.
 */
export function estado(groupId: string, claveLocal?: string): EstadoOfertas {
  if (conflictoForzado(groupId)) return 'conflicto';
  return estadoDe(ofertasDe(groupId), claveLocal);
}

export function marcarAdoptada(groupId: string, fromUserId: string): void {
  let cambio = false;
  const nueva = leer().map(o => {
    if (o.groupId !== groupId || o.fromUserId !== fromUserId || o.adoptada) return o;
    cambio = true;
    return { ...o, adoptada: true };
  });
  if (cambio) guardar(nueva);
}

export function olvidarOfertas(groupId: string): void {
  const lista = leer();
  const quedan = lista.filter(o => o.groupId !== groupId);
  if (quedan.length !== lista.length) guardar(quedan);

  const conflictos = leerConflictos();
  const sinEste = conflictos.filter(g => g !== groupId);
  if (sinEste.length !== conflictos.length) guardarConflictos(sinEste);
}

/**
 * ¿La clave local de este grupo vino de una oferta adoptada?
 *
 * Es LA guarda de S3-A1: sólo una clave de contacto puede entrar en disputa.
 * Las de `ensureKey`, QR o invitación no tienen oferta adoptada, así que nunca
 * son sustituibles por este camino.
 */
export function claveLocalVinoDeContacto(groupId: string): boolean {
  const local = useGroupKeyStore.getState().getKey(groupId);
  if (!local) return false;
  const k = local.key.toLowerCase();
  return ofertasDe(groupId).some(o => o.adoptada && o.key === k);
}

/** `InviteGrant` no trae el id de quien entrega: se usa la huella del link. */
export function idDeOfertaDeInvitacion(inviterFingerprint: string): string {
  return `${PREFIJO_OFERTA_INVITACION}${inviterFingerprint}`;
}

export function esOfertaDeInvitacion(fromUserId: string): boolean {
  return fromUserId.startsWith(PREFIJO_OFERTA_INVITACION);
}
