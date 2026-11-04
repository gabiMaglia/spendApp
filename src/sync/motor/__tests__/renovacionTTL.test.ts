/**
 * T-267 · Un grupo quieto no vence en el buzón: si el cubo más viejo que este
 * aparato publicó pasó la ventana de renovación, el ciclo de sync republica.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/adaptadores/supabase/relay', () => ({
  isRelayConfigured: () => true,
  getRelayClient: () => null,
  esFuncionAusente: () => false,
}));
jest.mock('../relaySync', () => ({
  publishToGroup: jest.fn(async () => ({ ok: true, seq: 1 })),
}));

import { __resetReintentos } from '../agendaDePublicacion';
import { renovarGruposVencidos, __resetRenovaciones } from '../renovacion';
import { publishToGroup } from '../relaySync';
import { deviceId } from '../cursor';
import { deriveTopic } from '@/src/sync/nucleo/envelopeCrypto';
import { registrarCubo } from '@/src/sync/nucleo/sliceLedger';
import { RENEWAL_WINDOW_MS } from '@/src/sync/nucleo/limites';
import * as adaptador from '@/src/sync/adaptadores/hushsplit/adaptadorHushSplit';
import { groupKeyBytes, useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group, User } from '@/src/types/models';

const mockPublish = publishToGroup as jest.Mock;
const ME = 'ua';
const DIA = 24 * 60 * 60 * 1000;
const T0 = 1_800_000_000_000;

async function grupoConLedger(id: string, publicadaEn: number | null): Promise<void> {
  useGroupStore.setState(s => ({
    groups: [...s.groups, {
      id, name: id, memberIds: [ME], currency: 'ARS', createdAt: 0, createdById: ME,
      updatedAt: 1, isDeleted: false,
    } as Group],
  }));
  useGroupKeyStore.getState().ensureKey(id);
  if (publicadaEn === null) return;
  const rec = useGroupKeyStore.getState().getKey(id)!;
  const topic = await deriveTopic(groupKeyBytes(id)!, rec.epoch);
  registrarCubo(adaptador.almacen, topic, deviceId(), 'ck1', 'dig', publicadaEn);
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(T0);
  createSecureStorage('groupkeys').clearAll();
  useAuthStore.setState({ currentUser: { id: ME } as User });
  useGroupStore.setState({ groups: [], isLoading: false });
  useGroupKeyStore.setState({ keys: [] });
  mockPublish.mockReset().mockResolvedValue({ ok: true, seq: 1 });
  __resetReintentos();
  __resetRenovaciones();
});
afterEach(() => jest.restoreAllMocks());

describe('T-267 · renovación contra el TTL sin cambios locales', () => {
  it('dispara cuando el cubo propio más viejo pasó la ventana de renovación', async () => {
    await grupoConLedger('g1', T0 - RENEWAL_WINDOW_MS - DIA);
    await renovarGruposVencidos();
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith('g1', ME, deviceId());
  });

  it('NO dispara si todo está dentro de la ventana', async () => {
    await grupoConLedger('g1', T0 - RENEWAL_WINDOW_MS + DIA);
    await renovarGruposVencidos();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('NO dispara si este aparato nunca publicó (ledger vacío): no hay nada propio que venza', async () => {
    await grupoConLedger('g1', null);
    await renovarGruposVencidos();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('no repite en cada vuelta: tras un fallo espera el enfriamiento', async () => {
    await grupoConLedger('g1', T0 - RENEWAL_WINDOW_MS - DIA);
    mockPublish.mockResolvedValue({ ok: false, reason: 'network', detail: 'sin señal' });
    await renovarGruposVencidos();
    await renovarGruposVencidos();
    expect(mockPublish).toHaveBeenCalledTimes(1);

    (Date.now as jest.Mock).mockReturnValue(T0 + 2 * 60 * 60 * 1000);
    await renovarGruposVencidos();
    expect(mockPublish).toHaveBeenCalledTimes(2);
  });

  it('sólo renueva los grupos vencidos', async () => {
    await grupoConLedger('viejo', T0 - RENEWAL_WINDOW_MS - DIA);
    await grupoConLedger('fresco', T0 - DIA);
    await renovarGruposVencidos();
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith('viejo', ME, deviceId());
  });
});
