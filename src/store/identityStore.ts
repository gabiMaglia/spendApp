import * as Crypto from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha2.js';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { toHex, utf8Bytes } from '@/src/sync/hexBytes';
import { generateIdentity, generateWrapKeypair, type GroupInvite } from '@/src/sync/groupInvite';

/**
 * Identidad criptográfica de ESTE dispositivo y las invitaciones que emitió.
 *
 * Las privadas viven en el storage cifrado y **no se scopean por cuenta**: son
 * del aparato, no de la persona. Si se scopearan, cambiar de cuenta generaría
 * una identidad nueva y los sobres dirigidos a la anterior quedarían sin poder
 * abrirse.
 *
 * Las invitaciones emitidas se guardan porque **el token es lo único que permite
 * abrir el reclamo del invitado**. Si se pierde, la invitación queda muerta:
 * llega un sobre que nadie puede leer.
 */

const storage = createSecureStorage('groupkeys');
const K_IDENTITY = 'identity_v1';
const K_OWNER    = 'owner_secret_v1';
const K_WRAP     = 'wrapkeys_v1';
const K_INVITES  = 'invites_v1';
const K_PENDING  = 'pending_joins_v1';

type Keypair = { privateKey: string; publicKey: string };

function readJson<T>(key: string, fallback: T): T {
  const raw = storage.getString(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** Par Ed25519 para firmar. Se crea una vez y se reusa siempre. */
export function ensureIdentity(): Keypair {
  const existing = readJson<Keypair | null>(K_IDENTITY, null);
  if (existing?.privateKey) return existing;

  const fresh = generateIdentity();
  storage.set(K_IDENTITY, JSON.stringify(fresh));
  return fresh;
}

/** Par X25519 para recibir claves envueltas. Separado del de firma. */
export function ensureWrapKeypair(): Keypair {
  const existing = readJson<Keypair | null>(K_WRAP, null);
  if (existing?.privateKey) return existing;

  const fresh = generateWrapKeypair();
  storage.set(K_WRAP, JSON.stringify(fresh));
  return fresh;
}

export type Prenda = { secret: string; proof: string };

/**
 * Prenda de escritura del buzón (ADR-009 D-1, T-088).
 *
 * `secret`: 32 bytes aleatorios en hex. **Nunca sale del aparato** salvo en la
 * llamada de borrado, que es rara y explícita.
 * `proof`: `sha256(secret)` — es lo único que viaja, en cada publicación.
 *
 * El servidor guarda `sha256(proof)`. Así ni quien lee la tabla ni quien viera
 * el cuerpo de un INSERT obtiene con qué borrar: para eso hace falta el
 * preimagen, que no viaja nunca.
 *
 * El `proof` se calcula UNA vez y se persiste: el camino de publicación tiene
 * debounce de 1,5 s y poll de 20 s, y no se le agrega un hash por sobre.
 *
 * Vive acá y no scopeado por cuenta por la misma razón que las privadas: es del
 * aparato. Al destruir la identidad (T-074) se borra **después** de purgar el
 * buzón, nunca antes: sin el secreto los sobres quedan sólo a merced del TTL.
 */
export function ensureOwnerPledge(): Prenda {
  const existing = readJson<Prenda | null>(K_OWNER, null);
  if (existing?.secret && existing.proof) return existing;

  const secret = toHex(Crypto.getRandomBytes(32));
  const fresh: Prenda = { secret, proof: toHex(sha256(utf8Bytes(secret))) };
  storage.set(K_OWNER, JSON.stringify(fresh));
  return fresh;
}

/**
 * Destruye la identidad de ESTE aparato: firma, envoltura, prenda del buzón e
 * invitaciones (T-074 fase 4).
 *
 * ⚠️ **Sólo se llama cuando la cuenta borrada era la última Y el buzón ya se
 * purgó.** Con otra cuenta enlazada viva, borrar esto la dejaría sin poder
 * firmar y —peor— sin poder purgar SUS propios sobres nunca más: la prenda no
 * se puede regenerar (ADR-009 §4·A). Con purga pendiente, es lo único que puede
 * terminarla.
 *
 * No borra `device_id`: es el filtro de relectura del relay, no dato de nadie,
 * y regenerarlo sólo haría que la app se reprocese sus propios sobres una vez.
 */
export function destruirIdentidadDelAparato(): void {
  for (const k of [K_IDENTITY, K_OWNER, K_WRAP, K_INVITES, K_PENDING]) {
    storage.delete(k);
  }
}

export function saveInvite(invite: GroupInvite): void {
  const all = readJson<GroupInvite[]>(K_INVITES, []);
  // Se purgan las vencidas al guardar: sin esto la lista crece para siempre.
  const vivas = all.filter(i => i.expiresAt > Date.now() && i.token !== invite.token);
  storage.set(K_INVITES, JSON.stringify([...vivas, invite]));
}

export function listInvites(): GroupInvite[] {
  return readJson<GroupInvite[]>(K_INVITES, []).filter(i => i.expiresAt > Date.now());
}

/** Recupera el token de una invitación emitida, para abrir el reclamo. */
export function findInviteToken(groupId: string, token: string): GroupInvite | undefined {
  return listInvites().find(i => i.groupId === groupId && i.token === token);
}

/**
 * Invitaciones que ACEPTAMOS y todavía no se completaron.
 *
 * Se persisten porque la entrega de la clave depende de que el que invitó abra
 * la app, y eso puede pasar horas después. Sin esto, cerrar la app antes de que
 * conteste dejaría el ingreso a medias para siempre, sin nada que lo reintente.
 */
export function savePendingJoin(invite: GroupInvite): void {
  const all = readJson<GroupInvite[]>(K_PENDING, []);
  const vivas = all.filter(i => i.expiresAt > Date.now() && i.token !== invite.token);
  storage.set(K_PENDING, JSON.stringify([...vivas, invite]));
}

export function listPendingJoins(): GroupInvite[] {
  return readJson<GroupInvite[]>(K_PENDING, []).filter(i => i.expiresAt > Date.now());
}

/** Se llama al adoptar la clave: el ingreso ya no está pendiente. */
export function removePendingJoin(token: string): void {
  const all = readJson<GroupInvite[]>(K_PENDING, []);
  storage.set(K_PENDING, JSON.stringify(all.filter(i => i.token !== token)));
}
