import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';

/**
 * **Lista de bloqueados** (T-180 · 7.1).
 *
 * Quien tiene mi secreto de contacto —cualquiera que haya escaneado mi QR
 * alguna vez— me escribe para siempre en mi topic de contactos
 * (`contactChannel.drainContacts`) y me puede entregar claves de grupo
 * (`groupKeyOffers`). No había forma de ignorarlo. Esto es esa forma: una
 * lista LOCAL, scoped por cuenta — mismo mecanismo que `savePeer`
 * (`contactChannel.ts`, bucket cifrado `users`) — que corta la entrada en
 * los puntos donde ese contacto puede escribirme algo, sin rotar el secreto
 * (rotar significa un QR nuevo, y no es lo que el PO pidió acá) y sin
 * afectar lo que ya comparto por GRUPOS donde ambos somos miembros: ese
 * canal sigue abierto porque la membresía lo autoriza, y está fuera de
 * alcance de este ticket.
 *
 * Sin estado en memoria, a propósito, igual que `contactChannel.listPeers`:
 * cada llamada relee el storage, así que no hay nada que sincronizar entre
 * módulos ni que perder al cambiar de cuenta.
 */

const storage = createSecureStorage('users');
const K_BLOCKED = 'blocked_peers_v1';

function leer(): string[] {
  const raw = readScoped(storage, K_BLOCKED);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return []; // dato corrupto: se degrada a "no hay nadie bloqueado", no rompe
  }
}

function guardar(ids: string[]): void {
  writeScoped(storage, K_BLOCKED, JSON.stringify(ids));
}

export function isBlocked(userId: string): boolean {
  return leer().includes(userId);
}

export function block(userId: string): void {
  const ids = leer();
  if (!ids.includes(userId)) guardar([...ids, userId]);
}

export function unblock(userId: string): void {
  guardar(leer().filter(id => id !== userId));
}

export function blockedIds(): string[] {
  return leer();
}
