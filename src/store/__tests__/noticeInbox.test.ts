import { createNoticeInboxStore } from '../noticeInboxStore';
import { useAuthStore } from '../authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Notice } from '@/src/services/syncNotices';
import type { User } from '@/src/types/models';

const gasto = (g = 'g1'): Notice => ({ kind: 'expenses', groupId: g, groupName: 'Asado', count: 2 });
const unido = (): Notice => ({ kind: 'joined', groupId: 'g9', groupName: 'Viaje' });

const T0 = Date.UTC(2026, 7, 29, 12);

beforeEach(() => {
  createSecureStorage('notices').clearAll();
  useAuthStore.setState({ currentUser: { id: 'u1' } as User });
});

describe('registrar avisos', () => {
  it('un aviso entra como NO leido y suma al badge', () => {
    const s = createNoticeInboxStore();
    s.getState().record([gasto()], T0);
    expect(s.getState().items).toHaveLength(1);
    expect(s.getState().items[0].readAt).toBeNull();
    expect(s.getState().unreadCount()).toBe(1);
  });

  it('el mas nuevo queda primero', () => {
    const s = createNoticeInboxStore();
    s.getState().record([gasto('g1')], T0);
    s.getState().record([unido()], T0 + 1000);
    expect(s.getState().items[0].notice.kind).toBe('joined');
  });

  it('cada aviso tiene id propio: dos iguales NO se pisan', () => {
    const s = createNoticeInboxStore();
    s.getState().record([gasto(), gasto()], T0);
    const ids = s.getState().items.map(i => i.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('acuse de recibo (local)', () => {
  it('marcar uno baja el badge y NO lo borra de la lista', () => {
    const s = createNoticeInboxStore();
    s.getState().record([gasto(), unido()], T0);
    const id = s.getState().items[0].id;
    s.getState().markRead(id, T0 + 5);
    expect(s.getState().unreadCount()).toBe(1);
    expect(s.getState().items).toHaveLength(2);
    expect(s.getState().items.find(i => i.id === id)!.readAt).toBe(T0 + 5);
  });

  it('marcar todo deja el badge en cero sin borrar nada', () => {
    const s = createNoticeInboxStore();
    s.getState().record([gasto(), unido(), gasto('g2')], T0);
    s.getState().markAllRead(T0 + 9);
    expect(s.getState().unreadCount()).toBe(0);
    expect(s.getState().items).toHaveLength(3);
  });

  it('marcar dos veces no cambia la fecha del acuse', () => {
    const s = createNoticeInboxStore();
    s.getState().record([gasto()], T0);
    const id = s.getState().items[0].id;
    s.getState().markRead(id, T0 + 5);
    s.getState().markRead(id, T0 + 99);
    expect(s.getState().items[0].readAt).toBe(T0 + 5);
  });

  it('marcar un id que no existe no rompe', () => {
    const s = createNoticeInboxStore();
    s.getState().record([gasto()], T0);
    expect(() => s.getState().markRead('no-existe', T0)).not.toThrow();
    expect(s.getState().unreadCount()).toBe(1);
  });
});

describe('persistencia y aislamiento por cuenta', () => {
  it('el acuse sobrevive al reinicio de la app', () => {
    const s1 = createNoticeInboxStore();
    s1.getState().record([gasto(), unido(), gasto('g2')], T0);
    s1.getState().markRead(s1.getState().items[0].id, T0 + 5);

    const s2 = createNoticeInboxStore();   // app reabierta
    s2.getState().hydrate();
    expect(s2.getState().items).toHaveLength(3);
    expect(s2.getState().unreadCount()).toBe(2);
  });

  it('otra cuenta en el mismo device no ve nada', () => {
    const s = createNoticeInboxStore();
    s.getState().record([gasto()], T0);

    useAuthStore.setState({ currentUser: { id: 'u2' } as User });
    s.getState().hydrate();
    expect(s.getState().items).toEqual([]);
    expect(s.getState().unreadCount()).toBe(0);

    useAuthStore.setState({ currentUser: { id: 'u1' } as User });
    s.getState().hydrate();
    expect(s.getState().items).toHaveLength(1);
  });
});

describe('retencion acotada', () => {
  it('se conserva el tope y se descarta lo MAS VIEJO, nunca lo nuevo', () => {
    const s = createNoticeInboxStore();
    const tope = s.getState().max;
    for (let i = 0; i < tope + 10; i++) s.getState().record([gasto(`g${i}`)], T0 + i);
    expect(s.getState().items).toHaveLength(tope);
    // el ultimo registrado tiene que seguir estando
    expect(s.getState().items[0].notice).toMatchObject({ groupId: `g${tope + 9}` });
  });
});
