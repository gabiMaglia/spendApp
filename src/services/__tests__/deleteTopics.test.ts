import { topicsDeLaCuenta } from '../deleteTopics';
import { useGroupKeyStore, groupKeyBytes } from '@/src/store/groupKeyStore';
import { deriveTopic } from '@/src/sync/envelopeCrypto';
import { deriveContactTopic, savePeer } from '@/src/sync/contactChannel';
import { deriveInviteTopic, createInvite } from '@/src/sync/groupInvite';
import { saveInvite } from '@/src/store/identityStore';
import { useAuthStore } from '@/src/store/authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

/**
 * T-074 §3.4. **Son tres tipos de topic, no uno.**
 *
 * `deleteMyGroupEnvelopes` cubre sólo el buzón del grupo. Los sobres de
 * contacto no están en mi buzón sino **en el del otro**, y los de invitación
 * cuelgan del token. Si los tres no se derivan ANTES de borrar, el borrado de
 * cuenta deja rastro — y para entonces las claves de las que salen ya no están.
 */
const YO: User = {
  id: 'u1', name: 'Gabriel', email: 'g@x.com', authProvider: 'google',
  createdAt: 1, updatedAt: 1, isDeleted: false,
};

beforeEach(() => {
  createSecureStorage('groupkeys').clearAll();
  createSecureStorage('users').clearAll();
  useAuthStore.setState({ currentUser: YO });
  useGroupKeyStore.setState({ keys: [] });
});

describe('los topics de una cuenta', () => {
  it('junta los tres tipos, sin repetidos', async () => {
    useGroupKeyStore.getState().ensureKey('g1');
    useGroupKeyStore.getState().ensureKey('g2');
    savePeer('u2', { secret: 'aa'.repeat(16) });
    savePeer('u3', { secret: 'bb'.repeat(16) });
    saveInvite(createInvite('g1', 'Viaje', 'cc'.repeat(32)));

    const topics = await topicsDeLaCuenta();

    expect(topics).toHaveLength(5);
    expect(new Set(topics).size).toBe(5);
  });

  it('son LOS MISMOS que usa cada canal para publicar', async () => {
    // Comparados contra las funciones de derivación reales, no re-derivados con
    // la misma función bajo test: si el topic no coincide, la purga no borra
    // nada y devuelve `deleted: 0` sin que nadie se entere.
    const record = useGroupKeyStore.getState().ensureKey('g1');
    savePeer('u2', { secret: 'aa'.repeat(16) });
    const invite = createInvite('g1', 'Viaje', 'cc'.repeat(32));
    saveInvite(invite);

    const topics = await topicsDeLaCuenta();

    expect(topics).toContain(await deriveTopic(groupKeyBytes('g1')!, record.epoch));
    expect(topics).toContain(await deriveContactTopic('aa'.repeat(16)));
    expect(topics).toContain(await deriveInviteTopic(invite.token));
  });

  it('un grupo sin clave no aporta topic: no se inventa uno', async () => {
    useGroupKeyStore.setState({ keys: [{ groupId: 'sinclave', key: '', epoch: 1 }] });
    expect(await topicsDeLaCuenta()).toHaveLength(0);
  });

  it('sin nada que purgar devuelve una lista vacía, no lanza', async () => {
    await expect(topicsDeLaCuenta()).resolves.toEqual([]);
  });

  it('un peer sin secreto se saltea en vez de romper el borrado', async () => {
    savePeer('u2', { secret: '' });
    savePeer('u3', { secret: 'bb'.repeat(16) });
    expect(await topicsDeLaCuenta()).toHaveLength(1);
  });

  it('una invitación vencida ya no aporta topic', async () => {
    // `listInvites` filtra por vencimiento: sus sobres ya los levantó el TTL.
    const vieja = createInvite('g1', 'Viaje', 'cc'.repeat(32), Date.now() - 90 * 24 * 3600_000);
    saveInvite(vieja);
    expect(await topicsDeLaCuenta()).toHaveLength(0);
  });
});
