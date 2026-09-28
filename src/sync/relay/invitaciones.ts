import { subscribeTopic } from '../relay';
import { deriveInviteTopic, type GroupInvite } from '../groupInvite';
import { activeInvites, processInvite } from '../inviteEngine';
import { ensureContactSecret, deriveContactTopic } from '../contactChannel';
import { deviceId } from './cursor';

/**
 * Invitaciones y contactos (T-189): escucha los buzones de invitación
 * abiertos (quien invita espera reclamos, quien entra espera su clave) y el
 * buzón de contactos propio. `drainContactsNow` vive en `./contactos.ts`
 * (dirección fija: fachada → invitaciones → contactos → drain → publish →
 * poll/cursor); este módulo sólo suscribe.
 */

/**
 * Escucha mi buzón de contactos: quien escanea mi QR deja su tarjeta ahí.
 * Devuelve las funciones de desuscripción, igual que `subscribeInvites`.
 */
export async function subscribeContacts(onNews: () => void): Promise<(() => void)[]> {
  const secret = ensureContactSecret();
  if (!secret) return [];

  try {
    const topic = await deriveContactTopic(secret);
    return [subscribeTopic(topic, onNews)];
  } catch {
    return []; // sin buzón de contactos la app sigue andando
  }
}

/**
 * Suscribe todas las invitaciones activas. Devuelve las funciones de
 * desuscripción en vez de empujarlas a un array de la fachada (`unsubs`
 * es estado de ciclo de vida, dueño de la fachada) — quien llama las agrega
 * a su propia lista.
 */
export async function subscribeInvites(onNews: (invite: GroupInvite) => void): Promise<(() => void)[]> {
  const unsubs: (() => void)[] = [];
  for (const invite of activeInvites()) {
    try {
      const topic = await deriveInviteTopic(invite.token);
      unsubs.push(subscribeTopic(topic, () => onNews(invite)));
    } catch { /* una invitación rota no debe impedir las demás */ }
  }
  return unsubs;
}

/**
 * Fábrica del handler de aviso de invitación: recibe `startRelay` por
 * parámetro (no lo importa de la fachada, que es quien lo suscribe) para no
 * crear un ciclo — mismo patrón que `startPolling(releer)` en `./poll.ts`.
 */
export function crearOnInviteNews(startRelay: () => Promise<void>): (invite: GroupInvite) => Promise<void> {
  return async function onInviteNews(invite: GroupInvite): Promise<void> {
    const adoptados = await processInvite(invite, deviceId()).catch(() => [] as string[]);
    if (adoptados.length === 0) return;

    // Adoptamos una clave nueva: hay que suscribirse al grupo. La recursión
    // está acotada — el ingreso ya se marcó como resuelto, así que el
    // `startRelay` de adentro no vuelve a adoptar nada.
    await startRelay();
  };
}
