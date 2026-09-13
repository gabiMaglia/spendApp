import { createNoticeInboxStore } from '../noticeInboxStore';
import { useAuthStore } from '../authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { esAccionable, type Notice } from '@/src/services/syncNotices';
import type { User } from '@/src/types/models';

/**
 * T-119 (PO 2026-09-13): «abrir la campana marca como leídas todas las
 * notificaciones SIN acción». Las accionables (`esAccionable`, ya definido en
 * `syncNotices.ts` — `deletion`, `settlement_pending`, `sync_down`) siguen
 * pendientes hasta resolverse: abrir la bandeja NO las apaga.
 *
 * `markReadWhere` es el mecanismo genérico; el predicado de "sin acción" es
 * `!esAccionable(item.notice.kind)`, la MISMA clasificación que ya usa
 * `NoticeInboxSheet` para la pestaña "Acción" — no una categoría inventada.
 */

const gasto = (g = 'g1'): Notice => ({ kind: 'expenses', groupId: g, groupName: 'Asado', count: 2 });
const borrado = (): Notice => ({ kind: 'deletion', groupId: 'g1', groupName: 'Asado', description: 'Pizza' });
const saldoPendiente = (): Notice => ({
  kind: 'settlement_pending', groupId: 'g1', groupName: 'Asado', paymentId: 'p1',
  amount: 1000, currency: 'ARS',
});

const T0 = Date.UTC(2026, 7, 29, 12);

beforeEach(() => {
  createSecureStorage('notices').clearAll();
  useAuthStore.setState({ currentUser: { id: 'u1' } as User });
});

describe('markReadWhere — abrir la campana no toca las accionables', () => {
  it('marca leídas las que NO requieren acción, deja pendientes las que sí', () => {
    const s = createNoticeInboxStore();
    s.getState().record([gasto(), borrado(), saldoPendiente()], T0);

    s.getState().markReadWhere(item => !esAccionable(item.notice.kind), T0 + 10);

    const porKind = Object.fromEntries(s.getState().items.map(i => [i.notice.kind, i]));
    expect(porKind.expenses.readAt).toBe(T0 + 10);
    expect(porKind.deletion.readAt).toBeNull();
    expect(porKind.settlement_pending.readAt).toBeNull();
  });

  it('el contador de sin-leer sólo baja lo que se marcó', () => {
    const s = createNoticeInboxStore();
    s.getState().record([gasto(), borrado()], T0);
    expect(s.getState().unreadCount()).toBe(2);

    s.getState().markReadWhere(item => !esAccionable(item.notice.kind), T0 + 10);
    expect(s.getState().unreadCount()).toBe(1); // sólo la accionable sigue sin leer
  });

  it('no rompe con la bandeja vacía', () => {
    const s = createNoticeInboxStore();
    expect(() => s.getState().markReadWhere(() => true, T0)).not.toThrow();
    expect(s.getState().items).toEqual([]);
  });

  it('ya leídas no cambian su fecha de acuse', () => {
    const s = createNoticeInboxStore();
    s.getState().record([gasto()], T0);
    s.getState().markRead(s.getState().items[0].id, T0 + 5);
    s.getState().markReadWhere(() => true, T0 + 999);
    expect(s.getState().items[0].readAt).toBe(T0 + 5);
  });
});
