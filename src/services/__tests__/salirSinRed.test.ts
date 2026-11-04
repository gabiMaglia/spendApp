import { createSecureStorage } from '@/src/utils/secureStorage';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { salirDelGrupo, completarSalidasPendientes } from '@/src/services/salirDelGrupo';
import {
  salidasPendientes, estaPublicacionPendiente, limpiarPublicacionPendiente, marcarPublicacionPendiente,
} from '@/src/sync/motor/publicacionPendiente';
import type { User } from '@/src/types/models';

const mockPublishNow = jest.fn();
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/motor/relayEngine', () => ({
  schedulePublish: jest.fn(),
  deviceId: () => 'dev',
  olvidarCursor: jest.fn(),
  publishNow: (...a: unknown[]) => mockPublishNow(...a),
}));

/**
 * T-252 · salir sin red no pierde nada: la copia local (y lo no publicado)
 * se queda hasta que la salida realmente salga.
 */
const YO = { id: 'yo', name: 'Yo' } as User;
const meta = { updatedAt: 1, isDeleted: false };

beforeEach(() => {
  ['groups', 'expenses', 'groupkeys'].forEach(b => createSecureStorage(b as never).clearAll());
  mockPublishNow.mockReset();
  useAuthStore.setState({ currentUser: YO });
  useGroupStore.setState({ groups: [{ id: 'G', name: 'G', memberIds: ['yo'], currency: 'ARS', createdAt: 0, createdById: 'yo', ...meta } as never] });
  useExpenseStore.setState({ expenses: [{ id: 'e1', groupId: 'G', description: 'x', amount: 1, currency: 'ARS', paidById: 'yo', splitMode: 'equal', splits: [], category: 'other', date: 0, createdAt: 0, createdById: 'yo', ...meta } as never] });
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
});

describe('salirDelGrupo', () => {
  it('con red: publica la salida y purga la copia local', async () => {
    mockPublishNow.mockResolvedValue({ ok: true, seq: 1 });

    await salirDelGrupo('G', 'yo');

    expect(useGroupStore.getState().groups).toEqual([]);
    expect(useGroupKeyStore.getState().keys).toEqual([]);
    expect(salidasPendientes()).toEqual([]);
  });

  it('sin red: NO purga gastos ni clave, y deja la salida pendiente', async () => {
    mockPublishNow.mockResolvedValue({ ok: false, reason: 'network' });

    await salirDelGrupo('G', 'yo');

    expect(useExpenseStore.getState().expenses.map(e => e.id)).toEqual(['e1']);
    expect(useGroupKeyStore.getState().keys.map(k => k.groupId)).toEqual(['G']);
    expect(useGroupStore.getState().groups).toHaveLength(1); // con la baja ya aplicada
    expect(salidasPendientes()).toEqual(['G']);
  });

  it('si publishNow lanza, tampoco purga', async () => {
    mockPublishNow.mockRejectedValue(new Error('boom'));
    await salirDelGrupo('G', 'yo');
    expect(useGroupKeyStore.getState().keys).toHaveLength(1);
    expect(salidasPendientes()).toEqual(['G']);
  });

  it('cuando la publicación pendiente por fin sale, la salida se completa y se purga', async () => {
    mockPublishNow.mockResolvedValue({ ok: false, reason: 'network' });
    await salirDelGrupo('G', 'yo');
    marcarPublicacionPendiente('G'); // lo que hace el `publishNow` real al fallar

    await completarSalidasPendientes();
    expect(useGroupStore.getState().groups).toHaveLength(1); // aún pendiente de publicar

    limpiarPublicacionPendiente('G'); // lo que hace un ok del reintento
    expect(estaPublicacionPendiente('G')).toBe(false);
    await completarSalidasPendientes();

    expect(useGroupStore.getState().groups).toEqual([]);
    expect(useGroupKeyStore.getState().keys).toEqual([]);
    expect(salidasPendientes()).toEqual([]);
  });
});
