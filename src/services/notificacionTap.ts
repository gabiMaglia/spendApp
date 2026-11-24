import { cargarNotificaciones } from '@/src/services/nativoNotificaciones';

/**
 * Al tocar una notificación que trae `destino` (hoy sólo el resumen), navega.
 * Los avisos individuales no lo traen y siguen abriendo la app sin más.
 * Devuelve la baja de la suscripción.
 */
export function onNotificationTap(navegar: (destino: string) => void): () => void {
  const Notifications = cargarNotificaciones();
  if (!Notifications) return () => {};
  try {
    const sub = Notifications.addNotificationResponseReceivedListener(r => {
      // Se marca aunque no navegue: el mismo tap queda como "última respuesta"
      // y el arranque no debe reatenderlo.
      atendidas.add(r.notification.request.identifier);
      const destino = r.notification.request.content.data?.destino;
      if (typeof destino === 'string') navegar(destino);
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

/** Identifiers de respuestas ya atendidas: evita re-navegar al re-renderizar o volver de background. */
const atendidas = new Set<string>();

export function olvidarRespuestasAtendidas(): void {
  atendidas.clear();
}

/**
 * Tap con la app CERRADA: el listener no existía todavía cuando el sistema
 * entregó la respuesta, así que se la pide al módulo (`getLastNotificationResponse`,
 * la versión síncrona; la Async está deprecada en SDK 54). El llamador decide
 * CUÁNDO (sesión lista y router montado); acá sólo se garantiza "una vez por respuesta".
 */
export function atenderRespuestaDeArranque(navegar: (destino: string) => void): void {
  const Notifications = cargarNotificaciones();
  if (!Notifications) return;
  try {
    const r = Notifications.getLastNotificationResponse();
    if (!r) return;
    const id = r.notification.request.identifier;
    if (atendidas.has(id)) return;
    atendidas.add(id);
    const destino = r.notification.request.content.data?.destino;
    if (typeof destino === 'string') navegar(destino);
  } catch {
    // best effort, como el resto del módulo
  }
}
