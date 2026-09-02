import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import type { Notice } from '@/src/services/syncNotices';

/**
 * Bandeja de avisos con acuse de recibo LOCAL (T-044).
 *
 * Antes el aviso salía al centro de notificaciones del sistema y se evaporaba:
 * si el usuario lo descartaba, no quedaba rastro de que algo había pasado.
 *
 * **El acuse no viaja** (decisión del PO): leído/no leído es de este teléfono y
 * nadie más se entera. Por eso esto no es un registro sincronizable — no tiene
 * `updatedAt`, no lleva tombstone y no entra al merge. Es estado local.
 *
 * El `Notice` de `syncNotices` es DERIVADO y efímero: se calcula del diff de un
 * snapshot y se descarta. Acá se congela una copia en el momento de crearse,
 * con id propio, porque recalcularlo después daría otro resultado (o el mismo
 * aviso reaparecería como no leído para siempre).
 */

export type StoredNotice = {
  id: string;
  notice: Notice;
  createdAt: number;
  /** ms del acuse, o `null` si sigue sin leer. */
  readAt: number | null;
};

const storage = createSecureStorage('notices');
const KEY = 'inbox_v1';

/**
 * Tope de avisos guardados. Sin límite, MMKV crece sin fin en un store que
 * nadie limpia nunca. 200 alcanza para semanas de uso real y es lo que se
 * puede recorrer a mano.
 */
const MAX = 200;

interface NoticeInboxState {
  items: StoredNotice[];
  max: number;
  record: (notices: Notice[], now?: number) => void;
  markRead: (id: string, now?: number) => void;
  markAllRead: (now?: number) => void;
  unreadCount: () => number;
  hydrate: () => void;
  clear: () => void;
}

/**
 * **Qué cuenta como «sin leer». Una sola definición.**
 *
 * La usan el hook de React y el método del store, que antes tenían la misma
 * cuenta escrita dos veces — la clase de duplicación que ya nos costó T-055,
 * T-057 y T-060.
 */
export function contarSinLeer(items: readonly StoredNotice[]): number {
  return items.reduce((n, i) => n + (i.readAt === null ? 1 : 0), 0);
}

export function createNoticeInboxStore() {
  return create<NoticeInboxState>((set, get) => {
    const persist = (items: StoredNotice[]) => {
      try { writeScoped(storage, KEY, JSON.stringify(items)); } catch { /* sin persistir se sigue */ }
    };

    return {
      items: [],
      max: MAX,

      record: (notices, now = Date.now()) => {
        if (notices.length === 0) return;
        const nuevos: StoredNotice[] = notices.map(notice => ({
          id: uuidv4(), notice, createdAt: now, readAt: null,
        }));
        // Más nuevos primero, y se recorta por la cola: lo que se descarta es
        // siempre lo más viejo, nunca lo que acaba de entrar.
        const items = [...nuevos.reverse(), ...get().items].slice(0, MAX);
        persist(items);
        set({ items });
      },

      markRead: (id, now = Date.now()) => {
        let cambio = false;
        const items = get().items.map(i => {
          if (i.id !== id || i.readAt !== null) return i;
          cambio = true;
          return { ...i, readAt: now };
        });
        if (!cambio) return;
        persist(items);
        set({ items });
      },

      markAllRead: (now = Date.now()) => {
        const items = get().items.map(i => (i.readAt === null ? { ...i, readAt: now } : i));
        persist(items);
        set({ items });
      },

      unreadCount: () => contarSinLeer(get().items),

      hydrate: () => {
        const raw = readScoped(storage, KEY);
        if (!raw) { set({ items: [] }); return; }
        try {
          const v = JSON.parse(raw);
          set({ items: Array.isArray(v) ? (v as StoredNotice[]) : [] });
        } catch {
          set({ items: [] }); // bandeja corrupta: se ignora, no tumba el arranque
        }
      },

      clear: () => { persist([]); set({ items: [] }); },
    };
  });
}

export const useNoticeInboxStore = createNoticeInboxStore();

/**
 * **El contador de avisos sin leer, para la UI.**
 *
 * Existe porque el patrón anterior estaba roto de dos formas a la vez:
 *
 * ```ts
 * const sinLeer = useNoticeInboxStore(s => s.unreadCount)();
 * ```
 *
 * 1. **Se suscribe a la FUNCIÓN**, cuya referencia nunca cambia. Esa
 *    suscripción no dispara un re-render nunca; lo que redibujaba el badge era
 *    otra suscripción del mismo componente, por casualidad.
 * 2. **`unreadCount()` lee `get()` durante el render**, salteándose el snapshot
 *    suscrito. Con seis headers montados a la vez, cada uno puede renderizar
 *    contra un estado distinto — y el PO vio exactamente eso: contadores
 *    distintos en tabs distintas.
 *
 * Acá se selecciona el NÚMERO. Zustand vuelve a renderizar cuando el número
 * cambia, y todos los headers leen el mismo snapshot.
 */
export function useUnreadNoticeCount(): number {
  return useNoticeInboxStore(s => contarSinLeer(s.items));
}
