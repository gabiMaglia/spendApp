/**
 * Regresión del hallazgo I-1 de la revisión de Task 5
 * (`.superpowers/sdd/2026-09-21-compactacion-ckey-manifiesto/task-5-report.md`).
 *
 * `SLICED_FIELDS` (`relaySync.ts`) parte la publicación de un grupo en varios
 * sobres — uno por tipo de entidad — y hoy es correcto SÓLO porque el array
 * está ordenado `groups, expenses, payments, users, recurring, comments` y los
 * sobres se drenan en ese mismo orden (`seq`). `acotarDeltaAlGrupo` filtra
 * `comments` contra el conjunto de `expenses` ya locales y `users` contra la
 * membresía local del grupo — ambos dependen de que `groups`/`expenses` ya se
 * hayan aplicado. Este test reproduce el caso exacto que el revisor trazó a
 * mano: un miembro NUEVO (sin nada local) drena una publicación en rebanadas
 * de un miembro existente, y tiene que terminar con el comentario del gasto Y
 * el perfil del otro miembro — ninguno de los dos se puede perder en silencio
 * por cómo caen los sobres.
 */

jest.mock('../relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; compactable?: boolean; ckey?: string }[]>();
  let seq = 0;
  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; },
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async (topic: string, payload: string, sender: string, compactable = false, ckey?: string) => {
      const lista = buzones.get(topic) ?? [];
      lista.push({ seq: ++seq, topic, payload, sender, compactable, ckey });
      buzones.set(topic, lista);
      return { ok: true, seq };
    },
    fetchSince: async (topic: string, since: number) => {
      const lista = (buzones.get(topic) ?? []).filter(e => e.seq > since);
      return { ok: true, envelopes: lista, cursor: lista.length ? lista[lista.length - 1].seq : since };
    },
    deleteMyEnvelopes: async () => ({ ok: true }),
  };
});

// Sin esto, `drainGroup` dispara consultas de red reales al directorio de
// autores (`authorHealth`/`authorKeys`) — diagnóstico fuera de banda, no
// relevante para lo que este test verifica.
jest.mock('../authorHealth', () => ({ observeAuthor: jest.fn() }));
jest.mock('../authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { publishToGroup, drainGroup } from '../relaySync';
import type { Group, Expense, ExpenseComment, User } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as { __reset: () => void };

const PUBLISHER = 'publisher';
const NEW_MEMBER = 'newmember';

function grupo(): Group {
  return {
    id: 'A', name: 'Asado', memberIds: [PUBLISHER, NEW_MEMBER], currency: 'ARS',
    createdAt: 0, createdById: PUBLISHER, deletionVotes: [],
    updatedAt: 1_000, isDeleted: false,
  } as Group;
}

function gasto(): Expense {
  return {
    id: 'e1', groupId: 'A', description: 'Carne', amount: 20_000, currency: 'ARS',
    paidById: PUBLISHER, splits: [{ userId: PUBLISHER, amount: 20_000, isPaid: false }],
    splitMode: 'equal', category: 'food', date: 0, createdAt: 0, createdById: PUBLISHER,
    deletionVotes: [], updatedAt: 1_000, isDeleted: false,
  } as Expense;
}

function comentario(): ExpenseComment {
  return {
    id: 'c1', expenseId: 'e1', authorId: PUBLISHER, text: 'Quedó bien',
    createdAt: 0, updatedAt: 1_000, isDeleted: false,
  } as ExpenseComment;
}

function usuarios(): User[] {
  return [
    { id: PUBLISHER, name: 'Publisher', email: '', avatar: 'data:image/jpeg;base64,pub', updatedAt: 1_000, isDeleted: false } as User,
    { id: NEW_MEMBER, name: 'New Member', email: '', avatar: 'data:image/jpeg;base64,new', updatedAt: 1_000, isDeleted: false } as User,
  ];
}

describe('SLICED_FIELDS: el orden de los sobres importa para users/comments', () => {
  beforeEach(() => {
    relayMock.__reset();
    useGroupKeyStore.setState({ keys: [] });
    useGroupKeyStore.getState().ensureKey('A');
  });

  it('un miembro nuevo que drena una publicación en rebanadas recibe el comentario y el perfil del otro miembro', async () => {
    // 1. El publicador arma su estado real de A y lo publica en rebanadas.
    useAuthStore.setState({ currentUser: { id: PUBLISHER } as User });
    useGroupStore.setState({ groups: [grupo()] } as never);
    useExpenseStore.setState({ expenses: [gasto()] } as never);
    useCommentStore.setState({ comments: [comentario()] } as never);
    useUserStore.setState({ users: usuarios() } as never);

    const result = await publishToGroup('A', PUBLISHER, 'device-publisher');
    expect(result.ok).toBe(true);

    // 2. El miembro nuevo no tiene NADA local todavía.
    useAuthStore.setState({ currentUser: { id: NEW_MEMBER } as User });
    useGroupStore.setState({ groups: [] } as never);
    useExpenseStore.setState({ expenses: [] } as never);
    useCommentStore.setState({ comments: [] } as never);
    useUserStore.setState({ users: [] } as never);

    const drenado = await drainGroup('A', NEW_MEMBER, 'device-new', 0);
    expect(drenado.ok).toBe(true);
    if (!drenado.ok) return;

    // Se drenó más de un sobre (rebanadas + manifiesto) — si esto fuera 1,
    // el test no estaría probando nada sobre el orden de aplicación.
    expect(drenado.applied).toBeGreaterThan(1);

    // El comentario no se perdió: dependía de que `expenses` ya estuviera
    // aplicado cuando se procesó el sobre de `comments`.
    expect(useCommentStore.getState().comments.map(c => c.id)).toEqual(['c1']);

    // El perfil del publicador llegó: dependía de que `groups` ya estuviera
    // aplicado cuando se procesó el sobre de `users`.
    const perfilPublicador = useUserStore.getState().users.find(u => u.id === PUBLISHER);
    expect(perfilPublicador?.name).toBe('Publisher');
    expect(perfilPublicador?.avatar).toBe('data:image/jpeg;base64,pub');
  });
});
