import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';

/**
 * Grupos archivados — una preferencia de VISTA, no un cambio en el grupo.
 *
 * Archivar es personal a propósito: sacar de mi lista un viaje que ya terminó
 * no puede hacérselo desaparecer a los demás, que quizá siguen saldando. Por
 * eso NO vive en el registro `Group` (que se sincroniza por LWW y llegaría a
 * todos) sino acá, scopeado por cuenta y sin salir del teléfono.
 *
 * Y NO es un borrado: el grupo sigue entero, con sus gastos y sus saldos. Sólo
 * deja de ocupar la lista principal.
 */

const storage = createSecureStorage('groups');
const KEY = 'archived_v1';

interface ArchiveState {
  archivedIds: string[];
  isArchived: (groupId: string) => boolean;
  setArchived: (groupId: string, archived: boolean) => void;
  hydrate: () => void;
}

function persist(ids: string[]) {
  writeScoped(storage, KEY, JSON.stringify(ids));
}

export const useArchiveStore = create<ArchiveState>((set, get) => ({
  archivedIds: [],

  isArchived: (groupId) => get().archivedIds.includes(groupId),

  setArchived: (groupId, archived) => {
    const actual = get().archivedIds;
    // Idempotente: archivar lo ya archivado (o desarchivar lo que no estaba)
    // no escribe ni re-renderiza.
    if (actual.includes(groupId) === archived) return;

    const ids = archived ? [...actual, groupId] : actual.filter(id => id !== groupId);
    persist(ids);
    set({ archivedIds: ids });
  },

  hydrate: () => {
    const raw = readScoped(storage, KEY);
    // Un dato corrupto no puede tirar: hydrate corre en el arranque y una
    // excepción acá deja la app trabada en el splash (T-020).
    let archivedIds: string[] = [];
    try {
      archivedIds = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      archivedIds = [];
    }
    set({ archivedIds });
  },
}));
