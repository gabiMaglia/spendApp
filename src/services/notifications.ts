import i18n from '@/src/i18n';
import { formatMoney } from '@/src/constants/currencies';
import { useSettingsStore } from '@/src/store/settingsStore';
import type { Notice } from './syncNotices';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import { claveDeFalloDeSync } from '@/src/sync/publishHealth';

/**
 * Entrega de notificaciones locales (T-010).
 *
 * **Locales, nunca push.** No hay Firebase, ni token de dispositivo, ni
 * servidor que sepa qué pasó: el aviso lo dispara ESTE teléfono cuando su
 * propio sync encontró algo. Es la única forma compatible con la premisa del
 * proyecto — el relay ve sobres cifrados, así que no podría redactar un aviso
 * aunque quisiéramos.
 *
 * Todo acá es **best effort**. Si el usuario negó el permiso, si el módulo
 * nativo no está (Expo Go), o si expo-notifications tira, el sync tiene que
 * seguir igual: una notificación que no sale es una molestia, un sync que se
 * cae por una notificación es un bug.
 *
 * La decisión de QUÉ avisar vive en `syncNotices.ts`, que es puro y testeable.
 * Acá sólo se traduce y se entrega.
 */

/**
 * El nativo se carga PEREZOSAMENTE, igual que en `avatar.ts:16-27`.
 *
 * Importarlo en el tope lo metía en el camino del sync: `groupStore` →
 * `relayEngine` → acá. Como todos los stores cuelgan de esa cadena, un build sin
 * el binario no perdía las notificaciones, no abría la app — que es exactamente
 * lo que pasó el 30/08 con `expo-image-manipulator`. Cargarlo recién al usarlo
 * hace que la ausencia DEGRADE en vez de romper.
 */
let modCache: typeof import('expo-notifications') | null | undefined;

function cargarNotificaciones(): typeof import('expo-notifications') | null {
  // Memoizado: en un build sin el módulo, cada intento imprime un error rojo en
  // dev, y esto se llama una vez por aviso entregado.
  if (modCache !== undefined) return modCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    modCache = require('expo-notifications');
  } catch {
    modCache = null;
  }
  return modCache ?? null;
}

let handlerInstalado = false;

/**
 * Registra CÓMO se presenta un aviso mientras la app está en primer plano.
 *
 * Sin esto no se ve nada: la doc de Expo SDK 54 es explícita — *"the default
 * behavior when the handler is not set or does not respond in time is not to
 * show the notification"*. El aviso se generaba bien, `scheduleNotificationAsync`
 * devolvía su id, y el sistema lo descartaba sin pintarlo. Era invisible para
 * los tests porque todos miraban la entrega, no la presentación.
 *
 * `shouldShowAlert` está deprecado en SDK 54; lo reemplazan `shouldShowBanner`
 * (el globo que baja) y `shouldShowList` (queda en el centro de notificaciones).
 *
 * `shouldSetBadge: false` a propósito: no hay nada que limpie el número del
 * ícono, así que encenderlo dejaría un badge pegado para siempre. Cuando exista
 * la bandeja de avisos (T-044) el badge pasa a tener dueño y se puede prender.
 *
 * Corre a nivel de módulo desde `app/_layout.tsx`, antes del primer render: si
 * tirara, la app no llegaría a pintar nada. Por eso sin el nativo se va en
 * silencio — la marca queda en `false` porque no hay handler registrado, y
 * decir lo contrario sería mentirle al próximo que lea el flag.
 */
export function installNotificationHandler(): void {
  if (handlerInstalado) return;
  const Notifications = cargarNotificaciones();
  if (!Notifications) return;

  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList:   true,
        shouldPlaySound:  true,
        shouldSetBadge:   false,
      }),
    });
    handlerInstalado = true;
  } catch {
    // Registrar la presentación es lo último que puede costar el arranque.
  }
}

/** Sólo para tests: permite volver a registrar el handler. */
export function resetNotificationHandler(): void {
  handlerInstalado = false;
}

/** `undefined` = todavía no se preguntó en esta corrida. */
let permiso: boolean | undefined;

/**
 * Pide el permiso una sola vez por corrida.
 *
 * No se pide al arrancar a propósito: un permiso pedido antes de que la app
 * haya hecho algo útil es el que más se niega, y una negativa en iOS es difícil
 * de revertir — hay que ir a Ajustes del sistema. Se pide cuando de verdad hay
 * algo para avisar.
 */
export async function ensurePermission(): Promise<boolean> {
  if (permiso !== undefined) return permiso;
  const Notifications = cargarNotificaciones();
  if (!Notifications) return (permiso = false); // build sin el nativo
  try {
    const actual = await Notifications.getPermissionsAsync();
    permiso = actual.granted
      ? true
      : (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    permiso = false; // sin módulo nativo (Expo Go): no hay nada que entregar
  }
  return permiso;
}

/** Sólo para tests: vuelve a "todavía no se preguntó". */
export function resetPermissionCache(): void {
  permiso = undefined;
}

/** ¿El usuario quiere este tipo de aviso? Cada `kind` tiene su toggle. */
export function isEnabled(notice: Notice): boolean {
  const s = useSettingsStore.getState();
  switch (notice.kind) {
    case 'expenses': return s.notifExpenses;
    case 'deletion': return s.notifDeletions;
    // Restaurar es la contraparte de borrar: mismo dominio, mismo toggle. Dos
    // interruptores para las dos mitades de una misma ronda sólo darían la
    // forma de apagar la buena noticia y dejar la mala.
    case 'restored': return s.notifDeletions;
    case 'joined':   return s.notifInvites;
    case 'settled':  return s.notifSettlements;
    /**
     * **Sin toggle, a propósito.** «Este grupo dejó de sincronizar» no es una
     * preferencia: es la app admitiendo que dejó de hacer lo suyo, y es el caso
     * donde no saber sale más caro (T-058: el grupo deja de viajar para
     * siempre). Avisa UNA vez por caída —`syncDownNotices` se encarga— así que
     * no puede volverse la clase de ruido que un toggle existe para apagar.
     */
    case 'sync_down': return true;
  }
}

/** Texto del aviso. Sin strings sueltos: todo pasa por i18n (es/en/pt). */
export function textFor(notice: Notice): { title: string; body: string } {
  const t = i18n.t.bind(i18n);
  switch (notice.kind) {
    case 'expenses':
      return {
        title: notice.groupName,
        body: t('notifications.new_expenses', { count: notice.count }),
      };
    case 'deletion':
      return {
        title: notice.groupName,
        body: t('notifications.deletion_requested', { description: notice.description }),
      };
    case 'restored':
      return {
        title: notice.groupName,
        body: t('notifications.restored', { description: notice.description }),
      };
    case 'joined':
      return {
        title: t('notifications.joined_title'),
        body: t('notifications.joined_body', { group: notice.groupName }),
      };
    case 'settled':
      return {
        title: notice.groupName,
        // El monto se formatea con SU moneda, no con la de visualización: un
        // aviso convertido diría un número que no coincide con el pago real.
        body: t('notifications.settled', {
          name: '',
          amount: formatMoney(notice.amount, notice.currency),
        }).trim(),
      };
    case 'sync_down':
      return {
        // El grupo va en el TÍTULO junto al hecho: «Asado» solo, como en los
        // demás, escondería lo único que importa leer de un vistazo.
        title: t('notifications.sync_down_title', { group: notice.groupName }),
        // Mismo texto que el banner del grupo, de la misma función. Dos
        // redacciones para el mismo problema se contradicen sin que nadie mire.
        body: t(claveDeFalloDeSync(notice.reason)),
      };
  }
}

/**
 * Entrega los avisos que el usuario quiera recibir.
 *
 * Devuelve cuántos salieron — lo usan los tests y sirve para diagnosticar.
 * El permiso se pide UNA vez, y sólo si quedó algún aviso después de filtrar
 * por preferencias: preguntar por un aviso que el usuario ya apagó sería pedir
 * permiso para nada.
 */
export async function deliver(notices: Notice[]): Promise<number> {
  const queridos = notices.filter(isEnabled);
  if (queridos.length === 0) return 0;

  // El módulo ANTES que el permiso: sin el nativo no hay a quién pedírselo, y
  // preguntar primero haría que la ausencia se reportara como una negativa del
  // usuario. Son dos causas distintas de "no salió el aviso".
  const Notifications = cargarNotificaciones();
  if (!Notifications) return 0;
  if (!(await ensurePermission())) return 0;

  let entregados = 0;
  for (const notice of queridos) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: textFor(notice),
        trigger: null, // ya mismo
      });
      entregados++;
    } catch {
      // Una que falla no puede frenar a las demás ni tirar el sync.
    }
  }
  return entregados;
}

/**
 * Punto único para dar a conocer un aviso: lo REGISTRA en la bandeja y además
 * lo entrega al sistema si el usuario quiere ese tipo de aviso.
 *
 * Los dos pasos están acá y no en cada llamador porque son la misma intención
 * —"pasó algo que el usuario debería saber"— y separarlos invita a que un
 * futuro llamador registre sin avisar, o avise sin registrar.
 *
 * **El toggle gobierna el aviso del sistema, NO la bandeja** (decisión del PO):
 * un aviso con su toggle apagado no vibra pero queda anotado. Perder el
 * registro en silencio es peor que no vibrar — el usuario apagó una molestia,
 * no pidió que le escondamos lo que pasó.
 *
 * Best effort de punta a punta: si la bandeja no puede escribir, el aviso sale
 * igual; ninguna de las dos cosas puede tumbar el sync.
 */
export async function announce(notices: Notice[]): Promise<number> {
  if (notices.length === 0) return 0;
  try {
    useNoticeInboxStore.getState().record(notices);
  } catch {
    // La bandeja es lo secundario: que falle no puede costar el aviso.
  }
  return deliver(notices);
}
