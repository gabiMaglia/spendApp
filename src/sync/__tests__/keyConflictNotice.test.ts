jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', olvidarCursor: jest.fn(),
  publishNow: jest.fn(async () => {}), drainNow: jest.fn(async () => 0), startRelay: jest.fn(async () => {}),
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => {},
  getPermissionsAsync: async () => ({ granted: true }),
  requestPermissionsAsync: async () => ({ granted: true }),
  scheduleNotificationAsync: async () => 'id',
}));

import { avisarConflictosDelDrenaje, noticeDeConflicto } from '../keyConflictNotice';
import { registrarOferta, type KeyOffer } from '../groupKeyOffers';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

const oferta = (fromUserId: string, key: string, groupId = 'g1'): KeyOffer => ({
  groupId, fromUserId, key, epoch: 1, origen: 'contact', receivedAt: 0, adoptada: false,
});

beforeEach(() => {
  for (const b of ['groupkeys', 'groups', 'notices'] as const) createSecureStorage(b).clearAll();
  useAuthStore.setState({ currentUser: { id: 'ana' } as User });
  useGroupStore.setState({ groups: [] });
  useNoticeInboxStore.setState({ items: [] });
});

describe('noticeDeConflicto', () => {
  it('con menos de dos remitentes no hay conflicto que avisar', () => {
    registrarOferta(oferta('u-beto', 'ab'.repeat(32)));
    expect(noticeDeConflicto('g1', 'Viaje')).toBeNull();
  });

  it('sin grupo local, el nombre sale del drop', () => {
    registrarOferta(oferta('u-beto', 'ab'.repeat(32)));
    registrarOferta(oferta('u-mallory', 'cd'.repeat(32)));
    expect(noticeDeConflicto('g1', 'Viaje')).toEqual({
      kind: 'group_key_conflict', groupId: 'g1', groupName: 'Viaje',
      senderIds: ['u-beto', 'u-mallory'],
    });
  });

  it('con grupo local vivo, usa su nombre', () => {
    registrarOferta(oferta('u-beto', 'ab'.repeat(32)));
    registrarOferta(oferta('u-mallory', 'cd'.repeat(32)));
    useGroupStore.setState({ groups: [{ id: 'g1', name: 'Asado', isDeleted: false } as never] });
    expect(noticeDeConflicto('g1', 'Otro')).toMatchObject({ groupName: 'Asado' });
  });
});

describe('avisarConflictosDelDrenaje', () => {
  it('avisa cada grupo en conflicto una vez', async () => {
    registrarOferta(oferta('u-beto', 'ab'.repeat(32)));
    registrarOferta(oferta('u-mallory', 'cd'.repeat(32)));
    const r = { conflictedGroups: ['g1'], nombresDeDrop: { g1: 'Viaje' } };

    expect(await avisarConflictosDelDrenaje(r)).toBe(1);
    expect(await avisarConflictosDelDrenaje(r)).toBe(0);
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
  });

  // Los ids de grupo vienen de afuera: `nombresDeDrop['constructor']` no puede
  // devolver una función del prototipo como nombre.
  it('un groupId hostil no toma nombres del prototipo', async () => {
    registrarOferta(oferta('u-beto', 'ab'.repeat(32), 'constructor'));
    registrarOferta(oferta('u-mallory', 'cd'.repeat(32), 'constructor'));
    await avisarConflictosDelDrenaje({ conflictedGroups: ['constructor'], nombresDeDrop: {} });

    const aviso = useNoticeInboxStore.getState().items[0]!.notice;
    expect(aviso).toMatchObject({ groupId: 'constructor', groupName: '' });
  });
});
