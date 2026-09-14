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
 * Guarda CLAVES: por eso vive en el bucket cifrado `groupkeys` y scopeado por
 * cuenta, igual que `groupKeyStore`. No es un store de zustand ni cachea en
 * memoria: se lee del disco en cada llamada, así que no hay nada que soltar al
 * cambiar de cuenta.
 */

export const MAX_OFERTAS_POR_GRUPO = 5;
export const BUCKET_OFERTAS = 'groupkeys';
export const PREFIJO_OFERTA_INVITACION = 'invite:';

const storage = createSecureStorage(BUCKET_OFERTAS);
const K_OFERTAS = 'key_offers_v1';

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

/**
 * Suma una oferta a la lista. `null` si no cambia nada.
 *
 *  - Misma clave del mismo remitente → no-op: es el reenvío de cada arranque.
 *  - Otra clave del mismo remitente → reemplaza SU oferta, salvo que ya esté
 *    adoptada: esa es la prueba de origen de la clave local y no se pisa.
 *  - Remitente nuevo con el grupo lleno (`MAX_OFERTAS_POR_GRUPO`) → se ignora.
 */
export function aplicarOferta(lista: readonly KeyOffer[], o: KeyOffer): KeyOffer[] | null {
  const entrante: KeyOffer = { ...o, key: o.key.toLowerCase() };
  const i = lista.findIndex(x => x.groupId === entrante.groupId && x.fromUserId === entrante.fromUserId);

  if (i !== -1) {
    const previa = lista[i]!;
    if (previa.key === entrante.key) return null;
    if (previa.adoptada) return null;
    const nueva = [...lista];
    nueva[i] = entrante;
    return nueva;
  }

  const delGrupo = lista.filter(x => x.groupId === entrante.groupId).length;
  if (delGrupo >= MAX_OFERTAS_POR_GRUPO) return null;
  return [...lista, entrante];
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

/** `true` si la oferta dejó la tabla distinta (nueva o reemplazada). */
export function registrarOferta(o: KeyOffer): boolean {
  const nueva = aplicarOferta(leer(), o);
  if (!nueva) return false;
  guardar(nueva);
  return true;
}

export function ofertasDe(groupId: string): KeyOffer[] {
  return leer().filter(o => o.groupId === groupId);
}

export function estado(groupId: string, claveLocal?: string): EstadoOfertas {
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
