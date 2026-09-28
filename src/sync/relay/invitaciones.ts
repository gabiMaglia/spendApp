import { subscribeTopic } from '../relay';
import { deriveInviteTopic, type GroupInvite } from '../groupInvite';
import { activeInvites, processInvite } from '../inviteEngine';
import { ensureContactSecret, deriveContactTopic, drainContacts } from '../contactChannel';
import { avisarConflictosDelDrenaje } from '../keyConflictNotice';
import { readCursor, writeCursor, deviceId } from './cursor';

/**
 * Invitaciones y contactos (T-189: extraído de `relayEngine.ts`): escucha
 * los buzones de invitación abiertos (quien invita espera reclamos, quien
 * entra espera su clave) y el buzón de contactos propio.
 */

/**
 * `drainContactsNow` necesita `drainNow` (fachada, atado ahí por
 * `syncNotices.test.ts`) y `startRelay` — se inyectan una vez desde la
 * fachada, mismo patrón que `setDrainPublishImpl` en `./contactos.ts`. El
 * aviso de "me uní a un grupo" (con `kind: 'joined'`) tiene la misma
 * restricción de `inventarioDeAvisos.test.ts` / `syncNotices.test.ts` que ya
 * obligó a esos hooks: se dispara por un hook aparte que registra la
 * fachada, para que el texto de esa notificación se quede ahí.
 */
type ContactosImpl = { drainNow: (groupId: string) => Promise<number>; startRelay: () => Promise<void> };
let impl: ContactosImpl = { drainNow: async () => 0, startRelay: async () => {} };
export function setContactosImpl(fn: ContactosImpl): void {
  impl = fn;
}

type NotificadorDeJoined = (groupIds: string[]) => void;
let notificarJoined: NotificadorDeJoined = () => {};
export function setNotificadorDeJoined(fn: NotificadorDeJoined): void {
  notificarJoined = fn;
}

/**
 * Recoge lo que dejaron en mi buzón de contacto: tarjetas y claves de grupo.
 * El cursor se persiste DESPUÉS de aplicarlas.
 */
export async function drainContactsNow(): Promise<number> {
  const secret = ensureContactSecret();
  if (!secret) return 0;

  try {
    const topic = await deriveContactTopic(secret);
    const r = await drainContacts(secret, deviceId(), readCursor(topic));
    writeCursor(topic, r.cursor);

    // T-136: va ANTES del drainNow/joined-groups — ese bloque puede tirar y
    // se comería el aviso de un conflicto de clave ya persistido.
    await avisarConflictosDelDrenaje(r);

    // Llegó la clave de un grupo nuevo: bajar su contenido y quedarse escuchando.
    if (r.joinedGroups.length > 0) {
      for (const groupId of r.joinedGroups) await impl.drainNow(groupId);
      void impl.startRelay();
      // T-010: va DESPUÉS de drenar — recién ahí el grupo tiene nombre.
      notificarJoined(r.joinedGroups);
    }

    return r.added + r.joinedGroups.length + r.conflictedGroups.length;
  } catch {
    return 0; // offline: se reintenta al próximo arranque o aviso
  }
}

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
