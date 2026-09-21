import { createStorage } from '@/src/utils/createStorage';

/**
 * Cuándo se publicó por última vez cada rebanada (`ckey`), para la regla de
 * renovación a 20 días (ADR-007 §3.4): una rebanada que nadie volvió a tocar
 * igual tiene que resalir del buzón antes de que el TTL de 30 días se la
 * lleve, o un miembro que entra tarde puede perderla.
 *
 * Es un mapa `ckey -> timestamp`, nada más — no revela contenido del grupo ni
 * claves, así que va en storage plano (`createStorage`), no en
 * `createSecureStorage` (misma distinción de tier que ya traza
 * `secureStorage.ts` con `SECURE_IDS`).
 */
const storage = createStorage('slice-renewal');

/** Ventana de renovación: 20 días. */
export const RENEWAL_WINDOW_MS = 20 * 24 * 60 * 60 * 1000;

/**
 * Registra que la rebanada de esta `ckey` se publicó (fresca) en `at`.
 * Se llama en CADA publicación, incluso si el contenido no cambió — publicar
 * es lo que resetea el reloj de renovación.
 */
export function recordSlicePublished(ckey: string, at: number): void {
  storage.set(ckey, at);
}

/**
 * De las `ckeys` dadas, cuáles están vencidas: nunca se publicaron desde este
 * dispositivo (sin registro — p.ej. después de una reinstalación, el mismo
 * camino de "publicar todo" que describe ADR-007 §3.4), o su última
 * publicación registrada es anterior a la ventana de renovación.
 *
 * `windowMs` es opcional (default `RENEWAL_WINDOW_MS`, 20 días) para permitir
 * reusar el mismo mecanismo marcador-más-timestamp con una ventana corta —
 * p.ej. la caché negativa de intentos fallidos de `avatarTopic.ts`
 * (`fetchAvatarIfMissing`), que necesita "¿lo intenté hace poco?" en minutos,
 * no en días. Es el mismo problema ("¿ya lo hice recientemente?") con otra
 * escala de tiempo, no un mecanismo nuevo.
 */
export function staleSliceCkeys(ckeys: string[], now: number, windowMs: number = RENEWAL_WINDOW_MS): string[] {
  return ckeys.filter(ckey => {
    const last = storage.getNumber(ckey);
    if (last === undefined) return true;
    return now - last > windowMs;
  });
}
