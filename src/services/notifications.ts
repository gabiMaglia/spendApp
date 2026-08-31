import * as Notifications from 'expo-notifications';
import i18n from '@/src/i18n';
import { formatMoney } from '@/src/constants/currencies';
import { useSettingsStore } from '@/src/store/settingsStore';
import type { Notice } from './syncNotices';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';

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
 */
export function installNotificationHandler(): void {
  if (handlerInstalado) return;
  handlerInstalado = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList:   true,
      shouldPlaySound:  true,
      shouldSetBadge:   false,
    }),
  });
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
    case 'joined':   return s.notifInvites;
    case 'settled':  return s.notifSettlements;
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
