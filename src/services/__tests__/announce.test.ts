import {
  announce, announceKeyConflict, announceInviteFull, announceJoinStalled,
  announceRecurringTraspasoBlocked,
} from '../notifications';
import { useSettingsStore } from '@/src/store/settingsStore';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import { useAuthStore } from '@/src/store/authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { KeyConflictNotice, Notice } from '../syncNotices';
import type { User } from '@/src/types/models';

const mockSchedule = jest.fn(async () => 'id');
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => {},
  getPermissionsAsync: async () => ({ granted: true }),
  requestPermissionsAsync: async () => ({ granted: true }),
  scheduleNotificationAsync: () => mockSchedule(),
}));

const gasto: Notice = { kind: 'expenses', groupId: 'g1', groupName: 'Asado', count: 1 };

beforeEach(() => {
  mockSchedule.mockClear();
  createSecureStorage('notices').clearAll();
  useAuthStore.setState({ currentUser: { id: 'u1' } as User });
  useNoticeInboxStore.getState().clear();
  useSettingsStore.setState({ notifExpenses: true, notifDeletions: true, notifInvites: true });
});

describe('announce', () => {
  it('registra en la bandeja y ademas avisa al sistema', async () => {
    await announce([gasto]);
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it('con el toggle APAGADO no avisa al sistema, pero SI queda en la bandeja', async () => {
    // Decision del PO (D4): el toggle gobierna el aviso, no el registro.
    // Perder el registro en silencio es peor que no vibrar.
    useSettingsStore.setState({ notifExpenses: false });
    await announce([gasto]);
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
    expect(useNoticeInboxStore.getState().unreadCount()).toBe(1);
  });

  it('sin avisos no hace nada', async () => {
    await announce([]);
    expect(useNoticeInboxStore.getState().items).toHaveLength(0);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('si la bandeja falla, el aviso del sistema sale igual', async () => {
    // Misma premisa que el resto del modulo: nada de esto puede tumbar el sync.
    const spy = jest.spyOn(useNoticeInboxStore.getState(), 'record').mockImplementation(() => {
      throw new Error('storage lleno');
    });
    await expect(announce([gasto])).resolves.not.toThrow();
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    // Sin restaurar, el mock sobrevive a este test y rompe `record()` para
    // cualquier test de este archivo que corra después (orden de ejecución).
    spy.mockRestore();
  });
});

describe('announceKeyConflict (T-136): como máximo un aviso sin leer por grupo', () => {
  const conflicto: KeyConflictNotice = {
    kind: 'group_key_conflict', groupId: 'g1', groupName: 'Viaje',
    senderIds: ['u-beto', 'u-mallory'],
  };

  it('el primero se registra y avisa', async () => {
    expect(await announceKeyConflict(conflicto)).toBe(1);
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
  });

  it('otro conflicto del MISMO grupo con uno sin leer no apila', async () => {
    await announceKeyConflict(conflicto);
    expect(await announceKeyConflict({ ...conflicto, senderIds: ['u-beto', 'u-mallory', 'u-carla'] })).toBe(0);
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it('otro grupo sí avisa', async () => {
    await announceKeyConflict(conflicto);
    await announceKeyConflict({ ...conflicto, groupId: 'g2' });
    expect(useNoticeInboxStore.getState().items).toHaveLength(2);
  });

  it('con el anterior ya leído, un conflicto nuevo vuelve a avisar', async () => {
    await announceKeyConflict(conflicto);
    useNoticeInboxStore.getState().markAllRead();
    await announceKeyConflict(conflicto);
    expect(useNoticeInboxStore.getState().items).toHaveLength(2);
  });
});

describe('announceInviteFull (T-150 ronda 2/5): sin apilar por reintento, para siempre', () => {
  it('el primero se registra y avisa', async () => {
    expect(await announceInviteFull('g1', 'Viaje', 'tok-1')).toBe(1);
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
  });

  it('el mismo grupo+token no vuelve a avisar, leído o no', async () => {
    await announceInviteFull('g1', 'Viaje', 'tok-1');
    useNoticeInboxStore.getState().markAllRead();
    expect(await announceInviteFull('g1', 'Viaje', 'tok-1')).toBe(0);
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
  });

  /**
   * **T-172 (ítem 6, deuda documentada en T-150 ronda 3).** El dedupe
   * miraba los ÍTEMS de la bandeja (tope de 200, `noticeInboxStore.ts:39`):
   * si el aviso original se desalojaba de esa cola por avisos más nuevos, el
   * dedupe se perdía sin que el reclamo rechazado hubiera cambiado en nada.
   * Ahora el dedupe se persiste APARTE (`noticeDedupe.ts`), sin ese tope.
   */
  it('aunque el aviso original se desaloje de la bandeja (tope de 200), NO vuelve a avisar', async () => {
    await announceInviteFull('g1', 'Viaje', 'tok-1');

    // 200 avisos nuevos desalojan cualquier rastro del original de la cola.
    await announce(Array.from({ length: 200 }, (_, i) => (
      { kind: 'expenses', groupId: `g-otro-${i}`, groupName: 'Otro', count: 1 } as Notice
    )));
    expect(useNoticeInboxStore.getState().items.some(i => i.notice.kind === 'group_invite_full')).toBe(false);

    expect(await announceInviteFull('g1', 'Viaje', 'tok-1')).toBe(0);
  });

  it('otro token del mismo grupo sí avisa', async () => {
    await announceInviteFull('g1', 'Viaje', 'tok-1');
    expect(await announceInviteFull('g1', 'Viaje', 'tok-2')).toBe(1);
  });
});

describe('announceJoinStalled (T-172, ítem 2): aviso al invitado cuyo reclamo nunca cerró', () => {
  it('el primero se registra y avisa', async () => {
    expect(await announceJoinStalled('g1', 'Viaje', 'tok-1')).toBe(1);
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
  });

  it('el mismo token no vuelve a avisar', async () => {
    await announceJoinStalled('g1', 'Viaje', 'tok-1');
    expect(await announceJoinStalled('g1', 'Viaje', 'tok-1')).toBe(0);
  });

  it('sobrevive al desalojo de la bandeja (mismo mecanismo que announceInviteFull)', async () => {
    await announceJoinStalled('g1', 'Viaje', 'tok-1');
    await announce(Array.from({ length: 200 }, (_, i) => (
      { kind: 'expenses', groupId: `g-otro-${i}`, groupName: 'Otro', count: 1 } as Notice
    )));
    expect(await announceJoinStalled('g1', 'Viaje', 'tok-1')).toBe(0);
  });
});

describe('announceRecurringTraspasoBlocked (T-172, ítem 3)', () => {
  it('avisa (no dedupe entre traspasos: cada uno es un evento propio)', async () => {
    expect(await announceRecurringTraspasoBlocked('g-viejo', 'Viaje', 'g-nuevo')).toBe(1);
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
  });
});
