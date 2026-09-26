import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';

/**
 * Dedupe de avisos, PERSISTIDO APARTE de la bandeja (T-172, ítem 6).
 *
 * `announceInviteFull`/`announceJoinStalled` no pueden apilar por reintento
 * (T-150 ronda 2/5, ruling del orquestador): un buzón de invitación se relee
 * entero en cada sync mientras siga vivo, así que sin dedupe cada reintento
 * fallido sumaría otro aviso.
 *
 * Antes ese dedupe miraba los ÍTEMS de `noticeInboxStore` (`.some(i => ...)`),
 * que tiene un tope de 200 (`noticeInboxStore.ts:39`) y descarta lo más
 * viejo primero. Si el aviso original se desalojaba de esa cola por avisos
 * más nuevos, el dedupe se perdía sin que el reclamo hubiera cambiado en
 * nada — T-150 ronda 3 ya lo documentó como residual aceptado; acá se
 * arregla, barato: se guarda sólo la CLAVE de lo que ya se avisó (nunca el
 * contenido), así que este registro pesa órdenes de magnitud menos que un
 * `StoredNotice` completo y puede darse el lujo de un tope mucho más alto sin
 * competir con el de la bandeja, pensado para lo que el usuario de verdad lee.
 *
 * Scopeado por cuenta (`userScope`), igual que la bandeja: es dedupe DE esa
 * cuenta, no del aparato.
 */

const storage = createSecureStorage('notices');
const KEY = 'notice_dedupe_v1';

/** Tope generoso: sólo strings cortos, no compite con el de la bandeja. */
const MAX = 2_000;

function leer(): string[] {
  const raw = readScoped(storage, KEY);
  if (!raw) return [];
  try {
    const d: unknown = JSON.parse(raw);
    return Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function yaSeAviso(clave: string): boolean {
  return leer().includes(clave);
}

/** Idempotente: marcar dos veces la misma clave no la duplica en la lista. */
export function marcarAvisado(clave: string): void {
  const actuales = leer();
  if (actuales.includes(clave)) return;
  // Se descarta lo más viejo, nunca lo que se acaba de marcar.
  const siguientes = [...actuales, clave].slice(-MAX);
  try { writeScoped(storage, KEY, JSON.stringify(siguientes)); } catch { /* best effort, como el resto de avisos */ }
}

/** Sólo tests, logout y wipe. */
export function __resetNoticeDedupe(): void {
  try { writeScoped(storage, KEY, '[]'); } catch { /* noop */ }
}
