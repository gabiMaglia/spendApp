import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Expense, Group, Payment, User } from '@/src/types/models';

/**
 * T-216 — dataset compartido "realista" para los 5 arneses de nodos host
 * (uno por pestaña, en archivos separados: un solo archivo con las 5
 * pantallas colgó Jest en T-204 por el entorno de `@expo/vector-icons`
 * cargando fuentes async entre tests — ver nota en cada archivo).
 *
 * Tamaño pedido por el ticket: 8 grupos, 200 gastos, 60 eventos de
 * actividad (se derivan de gastos+pagos, no hace falta poblarlos aparte),
 * 20 amigos (contactos sin historial).
 */
export const MEMBER_IDS = Array.from({ length: 6 }, (_, i) => `user${i}`);

export const usuario = (id: string): User => ({
  id, name: `Nombre ${id}`, email: `${id}@test.com`, authProvider: 'guest',
  createdAt: 0, updatedAt: 0, isDeleted: false,
} as User);

export const grupo = (id: string, members: string[]): Group => ({
  id, name: `Grupo ${id}`, memberIds: members, currency: 'ARS',
  miembros: {}, createdAt: 0, createdById: members[0], updatedAt: 0, isDeleted: false,
} as Group);

export const gasto = (id: string, groupId: string, members: string[], paidById: string): Expense => {
  const share = Math.floor(300_050 / members.length);
  return {
    id, groupId, description: `Gasto ${id}`, amount: share * members.length,
    currency: 'ARS', paidById, splitMode: 'equal',
    splits: members.map(userId => ({ userId, amount: share, isPaid: userId === paidById })),
    memberIds: members, category: 'other', date: 0, createdAt: 0,
    createdById: paidById, updatedAt: 0, isDeleted: false,
  } as Expense;
};

export const pago = (id: string, groupId: string, from: string, to: string): Payment => ({
  id, groupId, fromUserId: from, toUserId: to, amount: 50_025, currency: 'ARS',
  date: 0, createdAt: 0, createdById: from, updatedAt: 0, isDeleted: false,
} as Payment);

export function sembrarDatasetRealista(): void {
  createSecureStorage('groups').clearAll();

  const memberUsers = MEMBER_IDS.map(usuario);
  const contactUsers = Array.from({ length: 20 }, (_, i) => usuario(`contact${i}`));
  const groups = Array.from({ length: 8 }, (_, i) => grupo(`g${i}`, MEMBER_IDS.slice(0, 3 + (i % 4))));

  // T-154 (2da vuelta, rechazo QA): fechas repartidas en ~60 días, no todas
  // en `date: 0` — 200 gastos concentrados en UN solo día caía siempre en
  // la sección "Antes" (`useActivitySections` sólo agrupa Hoy/Ayer/Antes,
  // nunca por día calendario), lo cual no es realista: una cuenta usada
  // ~2 meses reparte su actividad, no la vuelca entera en una fecha. Con el
  // ítem de FlashList = SECCIÓN (no fila, ver `ActivityFeedList.tsx`),
  // "Antes" sigue siendo una sola sección — eso es arquitectura existente,
  // no algo que este ticket cambie — así que la mayoría de los eventos
  // (días 2 a 59) siguen cayendo ahí.
  const DIA_MS = 24 * 60 * 60 * 1000;
  const expenses: Expense[] = [];
  for (let i = 0; i < 200; i++) {
    const group = groups[i % groups.length];
    const dia = i % 60;
    expenses.push({
      ...gasto(`e${i}`, group.id, group.memberIds, group.memberIds[i % group.memberIds.length]),
      date: Date.now() - dia * DIA_MS,
    });
  }

  const payments: Payment[] = [];
  for (let i = 0; i < 30; i++) {
    const group = groups[i % groups.length];
    const dia = i % 60;
    payments.push({ ...pago(`p${i}`, group.id, group.memberIds[0], group.memberIds[1]), date: Date.now() - dia * DIA_MS });
  }

  useAuthStore.setState({ currentUser: memberUsers[0], isPro: false });
  useUserStore.setState({ users: [...memberUsers, ...contactUsers] });
  useGroupStore.setState({ groups });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
  useExpenseStore.setState({ expenses });
  usePaymentStore.setState({ payments });
  usePersonalStore.setState({ entries: [], budget: usePersonalStore.getState().budget });
}

/** Cuenta nodos host recursivamente sobre el `toJSON()` de react-test-renderer. */
export function contarNodosHost(json: unknown): number {
  if (json === null || json === undefined) return 0;
  const nodos = Array.isArray(json) ? json : [json];
  let total = 0;
  for (const n of nodos) {
    if (!n || typeof n !== 'object') continue;
    total += 1;
    const hijos = (n as { children?: unknown }).children;
    if (hijos) total += contarNodosHost(hijos);
  }
  return total;
}
