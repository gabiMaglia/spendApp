import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import { mergeByIdLWW } from './lww';
import i18n from '@/src/i18n';
import { preservarAvatar } from './userAvatar';
import type { User } from '@/src/types/models';
import { syncedNow } from '@/src/utils/syncedClock';

const storage = createSecureStorage('users');
const KEY = 'data_v1';

interface UserStoreState {
  users: User[];
  getUserById: (id: string) => User | undefined;
  getUserName: (id: string) => string;
  addOrUpdateUser: (user: User) => void;
  removeUser: (id: string) => void;
  mergeUsers: (incoming: User[]) => void;
  hydrate: () => void;
}

function persist(users: User[]) {
  writeScoped(storage, KEY, JSON.stringify(users));
}

export const useUserStore = create<UserStoreState>((set, get) => ({
  users: [],

  getUserById: (id) => get().users.find(u => u.id === id),

  /**
   * El nombre visible de alguien.
   *
   * **Una cuenta borrada se rotula en el idioma del que MIRA** (T-074 · T-091
   * §6.1). El `name` que llega dice «Cuenta borrada» en el idioma del que se
   * borró; `deletedAt` es lo que permite ignorarlo y escribir el propio. Un peer
   * viejo no manda `deletedAt` y cae al `name` literal, que es correcto.
   *
   * `i18n.t` y no `useTranslation` porque esto no es un componente. Hay
   * precedente en `src/constants/legal.ts` y en `src/components/CommentThread.tsx`.
   */
  getUserName: (id) => {
    const u = get().users.find(x => x.id === id);
    if (!u) return 'Usuario';
    return u.deletedAt ? i18n.t('account_delete.anon_name') : u.name;
  },

  removeUser: (id) => {
    const users = get().users.map(u =>
      u.id === id ? { ...u, isDeleted: true, updatedAt: syncedNow() } : u,
    );
    persist(users);
    set({ users });
  },

  addOrUpdateUser: (user) => {
    const current = get().users;
    const idx = current.findIndex(u => u.id === user.id);
    const users = idx === -1
      ? [...current, user]
      : current.map(u => u.id === user.id ? preservarAvatar(u, { ...u, ...user }) : u);
    persist(users);
    set({ users });
  },

  /**
   * LWW merge para sync P2P — propaga perfiles de otros usuarios.
   *
   * ⚠️ **El perfil ajeno NO se verifica, y es una decisión escrita, no un
   * olvido** (T-091). `CORE_KINDS` no incluye `'user'`, así que estos registros
   * no pasan por ninguna firma: **cualquiera con la clave de un grupo puede
   * reescribirle el nombre y la foto a cualquier miembro.** El riesgo se acepta
   * declarado — está acotado a miembros del grupo, es reversible (el dueño
   * reescribe su nombre y gana por LWW con `updatedAt` nuevo) y **no mueve un
   * centavo**: los importes viven en `Expense` y `Payment`, que sí están
   * firmados desde T-041.
   *
   * **Lo que sí conviene saber, y la auditoría lo agregó:** el dueño **no se
   * entera**. Su propio teléfono filtra su perfil del sobre entrante
   * (`useSyncQR.ts`, T-048), así que él sigue viendo su nombre correcto y el
   * vandalizado lo ve el resto del grupo.
   *
   * Firmarlo se auditó y **se descartó**: `avatar` no puede entrar al núcleo
   * porque `preservarAvatar` reescribe el registro después de recibirlo, y seis
   * caminos de esta app crean `User` de terceros —dos de ellos para gente que
   * **no tiene la app y por lo tanto no tiene clave con qué firmar**—, así que
   * la marca sería ruido permanente sobre gente honesta. El costeo completo está
   * en `engram/plans/T-091.md`; el guard que impide reabrirlo por descuido, en
   * `src/sync/__tests__/usersNoEstaFirmado.test.ts`.
   */
  mergeUsers: (incoming) => {
    // Los previos se leen ANTES del merge: después de mergear ya no está lo que
    // había, que es justo contra lo que hay que proteger la foto.
    const previos = new Map(get().users.map(u => [u.id, u]));
    const merged = mergeByIdLWW(get().users, incoming)
      .map(u => preservarAvatar(previos.get(u.id), u));
    persist(merged);
    set({ users: merged });
  },

  hydrate: () => {
    const raw = readScoped(storage, KEY);
    // Un dato corrupto NO puede tirar acá: hydrate corre en el arranque de la app
    // (app/_layout.tsx) y una excepción deja isLoading en true para siempre,
    // trabando la pantalla de carga sin salida. Ya pasó con la sesión (T-020);
    // estos stores habían quedado sin la misma protección.
    let users: User[] = [];
    try {
      users = raw ? (JSON.parse(raw) as User[]) : [];
    } catch {
      users = [];
    }
    set({ users });
  },
}));
