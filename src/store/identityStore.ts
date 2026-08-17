import { createSecureStorage } from '@/src/utils/secureStorage';
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
const K_WRAP     = 'wrapkeys_v1';
const K_INVITES  = 'invites_v1';

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
