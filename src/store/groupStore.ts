import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScopedLazy } from './userScope';
import { siguienteUpdatedAt } from './relojDelMerge';
import { mergeGroupsPure } from './mergeGroupsPure';
import { signOnCreate, signOnEdit } from '@/src/sync/confianza/signOnWrite';
import { schedulePublish } from '@/src/store/publicarGrupo';
import type { Group } from '@/src/types/models';
import { syncedNow } from '@/src/utils/syncedClock';
import { recordError } from '@/src/services/errorLog';
import { conBaja, rosterDe } from '@/src/algorithms/roster';

const storage = createSecureStorage('groups');
const KEY = 'data_v1';

interface GroupStoreState {
  groups: Group[];
  isLoading: boolean;
  getById: (id: string) => Group | undefined;
  addGroup: (group: Group) => void;
  /** `false` = la edición NO se guardó (T-152 · D2). Ver `expenseStore.updateExpense`. */
  updateGroup: (id: string, patch: Partial<Group>) => boolean;
  /** Borra el grupo para TODOS (tombstone). Sólo debería ofrecerlo el creador. */
  deleteGroup: (id: string) => void;
  /**
   * Me saco del grupo sin borrarlo.
   *
   * OJO: NO valida saldos. La regla (nadie sale con deuda viva, T-228) la
   * aplica la UI con `tieneDeudaViva` antes de llamar acá.
   */
  leaveGroup: (id: string, userId: string) => void;
  mergeGroups: (incoming: Group[], now?: number) => void;
  hydrate: () => void;
}

function persist(groups: Group[]) {
  writeScopedLazy(storage, KEY, () => JSON.stringify(groups));
}

export const useGroupStore = create<GroupStoreState>((set, get) => ({
  groups: [],
  isLoading: true,

  getById: (id) => get().groups.find(g => g.id === id),

  addGroup: (group) => {
    const groups = [...get().groups, signOnCreate('group', group)];
    persist(groups);
    set({ groups });

    schedulePublish(group.id);
  },

  updateGroup: (id, patch) => {
    // Del grupo se firma sólo `id`/`createdAt`/`createdById`: nada de lo que
    // pasa por acá los toca, así que `signOnEdit` no re-firma. Se llama igual
    // para que el día que el núcleo del grupo crezca, esto no quede mudo.
    const actual = get().groups.find(g => g.id === id);
    if (!actual) return true;

    // `memberIds` es derivado de `miembros` (T-182) — nadie lo escribe
    // directo, ni siquiera por acá. En dev es un error de programación (se
    // tira para que se note en el momento); en prod se ignora ese campo del
    // patch antes que dejar un grupo con un `memberIds` que no salió de
    // `conAlta`/`conBaja` y que el próximo merge va a pisar igual.
    if ('memberIds' in patch) {
      if (__DEV__) {
        throw new Error(
          'updateGroup: memberIds es derivado de miembros — usar conAlta/conBaja (src/algorithms/roster.ts)',
        );
      }
      const { memberIds: _ignorado, ...resto } = patch;
      patch = resto;
    }

    const ahora = syncedNow();
    const patchConRoster = patch.miembros !== undefined
      ? { ...patch, memberIds: rosterDe(patch.miembros) }
      : patch;
    const firmado = signOnEdit('group', actual, {
      ...actual, ...patchConRoster, updatedAt: siguienteUpdatedAt(actual.updatedAt, ahora),
    });
    if (firmado === null) {
      // T-152 · D2 (hoy inalcanzable: el núcleo del grupo no incluye nada que
      // `updateGroup` escriba — queda por si eso cambia).
      recordError({
        message: 'signOnEdit bloqueado: no se pudo re-firmar una edición propia de un grupo ya firmado',
        fatal: false,
      });
      return false;
    }

    const groups = get().groups.map(g => (g.id === id ? firmado : g));
    persist(groups);
    set({ groups });
    return true;
  },

  // LWW merge para sync P2P — gana el registro con mayor updatedAt
  // Tombstone, nunca borrado físico (regla de negocio #1): así el borrado se
  // propaga por sync en vez de "reaparecer" desde el otro dispositivo, que
  // seguiría teniendo el grupo y lo reintroduciría en el merge.
  deleteGroup: (id) => {
    const ahora = syncedNow();
    const groups = get().groups.map(g =>
      g.id === id ? { ...g, isDeleted: true, updatedAt: siguienteUpdatedAt(g.updatedAt, ahora) } : g,
    );
    persist(groups);
    set({ groups });
    // El borrado se publica ANTES de que dejemos de sincronizar el grupo: si no,
    // los demás nunca se enteran y el grupo les queda vivo para siempre.
    schedulePublish(id, 0);
  },

  /**
   * Salir del grupo = darme de baja en `miembros` (T-182; `memberIds` sale
   * derivado de ahí). El grupo sigue vivo para el resto.
   *
   * NO se borran mis gastos: las deudas que generé siguen existiendo y los que
   * quedan tienen que poder verlas para saldar cuentas. Irse no es lo mismo que
   * no haber estado.
   */
  leaveGroup: (id, userId) => {
    const ahora = syncedNow();
    const groups = get().groups.map(g =>
      g.id === id
        ? { ...conBaja(g, userId, ahora), updatedAt: siguienteUpdatedAt(g.updatedAt, ahora) }
        : g,
    );
    persist(groups);
    set({ groups });
    schedulePublish(id, 0); // sin debounce: después de salir dejamos de publicar

    /**
     * ⚠️ **La marca de T-089 NO va acá**, aunque la spec la ubicaba en este
     * punto. `schedulePublish` de arriba es un `setTimeout`: para cuando
     * dispara, una marca puesta en esta línea ya estaría trabando **la
     * publicación de salida**, y el grupo no se enteraría nunca de que la
     * persona se fue.
     *
     * La marca y la purga viven en `src/services/salirDelGrupo.ts`, que espera a
     * que esa publicación salga de verdad antes de trabar nada. **Salir del
     * grupo se hace por ahí**, no llamando a esto suelto.
     */
  },

  /**
   * Merge por niveles (T-041 · S7), más la regla del modo de borrado.
   *
   * Las aprobaciones de salida ya no se unen acá: son un campo colaborativo y
   * las une `mergeLevels` junto con los votos de borrado, en el mismo lugar y
   * con el mismo criterio. Estaban sueltas en este store desde antes de que
   * existiera un nivel colaborativo donde ponerlas.
   */
  mergeGroups: (incoming, now = syncedNow()) => {
    const merged = mergeGroupsPure(get().groups, incoming, now);
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
