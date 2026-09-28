import { createSecureStorage } from '@/src/utils/secureStorage';

/**
 * Cursores por topic e id de dispositivo (T-189: extraído de `relayEngine.ts`).
 *
 * El cursor se persiste, no vive en memoria. Si se reiniciara en cada
 * arranque, cada apertura de la app volvería a bajar y re-aplicar toda la
 * cola. Funciona (el merge es idempotente) pero desperdicia batería y datos
 * en algo que ya se hizo.
 */

const storage = createSecureStorage('groupkeys');
const CURSOR_PREFIX = 'cursor::';

export function readCursor(topic: string): number {
  const raw = storage.getString(CURSOR_PREFIX + topic);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function writeCursor(topic: string, seq: number): void {
  storage.set(CURSOR_PREFIX + topic, String(seq));
}

/**
 * Olvida el cursor de un topic (T-074). Se llama al purgar el buzón de una
 * cuenta que se borra: sin esto queda un puntero a un grupo cuya clave ya no
 * está. No es un defecto —una relectura desde 0 es idempotente— pero es basura.
 */
export function olvidarCursor(topic: string): void {
  storage.delete(CURSOR_PREFIX + topic);
}

/** Id estable de este dispositivo, para no reprocesar lo propio. */
export function deviceId(): string {
  const existing = storage.getString('device_id');
  if (existing) return existing;
  const id = `d_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  storage.set('device_id', id);
  return id;
}
