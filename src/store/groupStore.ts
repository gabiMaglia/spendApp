import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import { mergeByIdLWW } from './lww';
import { schedulePublish } from '@/src/sync/relayEngine';
import type { Group, LeaveRequest } from '@/src/types/models';
import { mergeDeletionMode } from '@/src/algorithms/deletionPolicy';
import { mergeApprovals } from '@/src/algorithms/leaveRequest';
import { syncedNow } from '@/src/utils/syncedClock';

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
  /**
   * Me saco del grupo sin borrarlo.
   *
   * OJO: NO valida saldos. Salir con cuentas abiertas exige absorción y
   * aprobación (ver `canLeaveGroup` y `src/algorithms/absorbBalance.ts`); la UI
   * debe resolver eso ANTES de llamar acá. Se deja sin validar a propósito para
   * que la salida siga funcionando cuando el plan ya se aplicó como pagos.
   */
  leaveGroup: (id: string, userId: string) => void;
  /** Pide salir con saldo abierto, proponiendo quién absorbe. */
  requestLeave: (id: string, userId: string, plan: LeaveRequest['plan']) => void;
  /** Aprueba el pedido de salida pendiente. Idempotente. */
  approveLeave: (id: string, userId: string) => void;
  /** Retira el pedido (lo cancela quien se iba, o se limpia al aplicarlo). */
  cancelLeave: (id: string) => void;
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

    schedulePublish(group.id);
  },

  updateGroup: (id, patch) => {
    const groups = get().groups.map(g =>
      g.id === id ? { ...g, ...patch, updatedAt: syncedNow() } : g,
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
      g.id === id ? { ...g, isDeleted: true, updatedAt: syncedNow() } : g,
    );
    persist(groups);
    set({ groups });
    // El borrado se publica ANTES de que dejemos de sincronizar el grupo: si no,
    // los demás nunca se enteran y el grupo les queda vivo para siempre.
    schedulePublish(id, 0);
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
        ? { ...g, memberIds: g.memberIds.filter(m => m !== userId), updatedAt: syncedNow() }
        : g,
    );
    persist(groups);
    set({ groups });
    schedulePublish(id, 0); // sin debounce: después de salir dejamos de publicar
  },

  requestLeave: (id, userId, plan) => {
    const groups = get().groups.map(g => g.id === id ? {
      ...g,
      leaveRequest: { userId, plan, requestedAt: Date.now(), approvedBy: [] },
      updatedAt: syncedNow(),
    } : g);
    persist(groups);
    set({ groups });
    schedulePublish(id, 0); // sin debounce: los demás tienen que poder aprobar ya
  },

  approveLeave: (id, userId) => {
    const groups = get().groups.map(g => {
      if (g.id !== id || !g.leaveRequest) return g;
      if (g.leaveRequest.approvedBy.includes(userId)) return g; // idempotente
      return {
        ...g,
        leaveRequest: {
          ...g.leaveRequest,
          approvedBy: [...g.leaveRequest.approvedBy, userId],
        },
        updatedAt: syncedNow(),
      };
    });
    persist(groups);
    set({ groups });
    schedulePublish(id, 0);
  },

  cancelLeave: (id) => {
    const groups = get().groups.map(g =>
      g.id === id ? { ...g, leaveRequest: undefined, updatedAt: syncedNow() } : g,
    );
    persist(groups);
    set({ groups });
    schedulePublish(id, 0);
  },

  /**
   * LWW por registro, PERO las aprobaciones de salida se unen.
   *
   * Sin eso, dos personas aprobando en paralelo pierden una de las dos firmas
   * —gana el registro con `updatedAt` mayor y se lleva puesto al otro— y el
   * pedido no junta nunca las que necesita. Nadie se entera: simplemente no
   * pasa nada. Ver `mergeApprovals`.
   */
  mergeGroups: (incoming) => {
    const antes = new Map(get().groups.map(g => [g.id, g]));
    const merged = mergeByIdLWW(get().groups, incoming).map(g => {
      const local = antes.get(g.id);
      const remoto = incoming.find(x => x.id === g.id);
      const unido = mergeApprovals(local?.leaveRequest, remoto?.leaveRequest);
      // El modo de borrado NO se sincroniza: lo fija quien crea el grupo. Ver
      // `mergeDeletionMode` — sin esto cualquiera afloja el grupo por sync.
      const modo = mergeDeletionMode(antes.has(g.id), local?.deletionMode, remoto?.deletionMode);
      const base = g.deletionMode === modo ? g : { ...g, deletionMode: modo };
      return unido === undefined && base.leaveRequest === undefined ? base : { ...base, leaveRequest: unido };
    });
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
