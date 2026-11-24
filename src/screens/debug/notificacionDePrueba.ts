import { DESTINO_RESUMEN, ensurePermission } from '@/src/services/notifications';
import { cargarNotificaciones } from '@/src/services/nativoNotificaciones';
import { textoResumen } from '@/src/services/textoAvisos';
import type { Notice } from '@/src/services/syncNotices';

/** Tres avisos de grupos distintos: pasan el umbral del resumen (T-295). */
const AVISOS: Notice[] = [
  { kind: 'expenses', groupId: 'demo-bariloche', groupName: 'Viaje a Bariloche', count: 2 },
  { kind: 'expenses', groupId: 'demo-rio', groupName: 'Escapada a Río', count: 1 },
  { kind: 'joined', groupId: 'demo-asado', groupName: 'Asado de los viernes' },
];

/**
 * Sólo DEV: programa la notificación de resumen tal como la arma `deliver`
 * (mismo texto, mismo `destino`) pero a `segundos` vista, con un disparador
 * del sistema y no un `setTimeout`: así llega aunque la app esté cerrada, que
 * es el caso del tap en arranque en frío (T-304 D1).
 */
export async function programarResumenDePrueba(segundos: number, isDev: boolean = __DEV__): Promise<boolean> {
  if (!isDev) return false;
  const Notifications = cargarNotificaciones();
  if (!Notifications) return false;
  if (!(await ensurePermission())) return false;
  await Notifications.scheduleNotificationAsync({
    content: { ...textoResumen(AVISOS), data: { destino: DESTINO_RESUMEN } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: segundos },
  });
  return true;
}
