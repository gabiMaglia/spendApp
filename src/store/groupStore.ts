import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import { mergeByIdLWW } from './lww';
import type { Group } from '@/src/types/models';

const storage = createSecureStorage('groups');
const KEY = 'data_v1';

interface GroupStoreState {
  groups: Group[];
  isLoading: boolean;
  getById: (id: string) => Group | undefined;
  addGroup: (group: Group) => void;
  updateGroup: (id: string, patch: Partial<Group>) => void;
  /** Borra el grupo para TODOS (tombstone). Sólo debería ofrecerlo el creador. */
  deleteGroup: (id: string) => void;
  /** Me saco del grupo sin borrarlo: el resto lo sigue viendo. */
  leaveGroup: (id: string, userId: string) => void;
  mergeGroups: (incoming: Group[]) => void;
  hydrate: () => void;
}

function persist(groups: Group[]) {
  writeScoped(storage, KEY, JSON.stringify(groups));
}

export const useGroupStore = create<GroupStoreState>((set, get) => ({
  groups: [],
  isLoading: true,

  getById: (id) => get().groups.find(g => g.id === id),

  addGroup: (group) => {
    const groups = [...get().groups, group];
    persist(groups);
    set({ groups });
  },

  updateGroup: (id, patch) => {
    const groups = get().groups.map(g =>
      g.id === id ? { ...g, ...patch, updatedAt: Date.now() } : g,
    );
    persist(groups);
    set({ groups });
  },

  // LWW merge para sync P2P — gana el registro con mayor updatedAt
  // Tombstone, nunca borrado físico (regla de negocio #1): así el borrado se
  // propaga por sync en vez de "reaparecer" desde el otro dispositivo, que
  // seguiría teniendo el grupo y lo reintroduciría en el merge.
  deleteGroup: (id) => {
    const groups = get().groups.map(g =>
      g.id === id ? { ...g, isDeleted: true, updatedAt: Date.now() } : g,
    );
    persist(groups);
    set({ groups });
  },

  /**
   * Salir del grupo = sacarme de `memberIds`. El grupo sigue vivo para el resto.
   *
   * NO se borran mis gastos: las deudas que generé siguen existiendo y los que
   * quedan tienen que poder verlas para saldar cuentas. Irse no es lo mismo que
   * no haber estado.
   */
  leaveGroup: (id, userId) => {
    const groups = get().groups.map(g =>
      g.id === id
        ? { ...g, memberIds: g.memberIds.filter(m => m !== userId), updatedAt: Date.now() }
        : g,
    );
    persist(groups);
    set({ groups });
  },

  mergeGroups: (incoming) => {
    const merged = mergeByIdLWW(get().groups, incoming);
    persist(merged);
    set({ groups: merged });
  },

  hydrate: () => {
    const raw = readScoped(storage, KEY);
    // Un dato corrupto NO puede tirar acá: hydrate corre en el arranque de la
    // app (app/_layout.tsx) y una excepción deja isLoading en true para
    // siempre, trabando la pantalla de carga sin salida. Ya pasó con la sesión
    // (T-020); estos 5 stores habían quedado sin la misma protección.
    let groups: Group[] = [];
    try {
      groups = raw ? (JSON.parse(raw) as Group[]) : [];
    } catch {
      groups = [];
    }
    set({ groups, isLoading: false });
  },
}));
