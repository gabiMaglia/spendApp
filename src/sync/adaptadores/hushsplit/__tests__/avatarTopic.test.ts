/**
 * T-206-A (D12, spec §4 fila D12): tests de `avatarTopic.ts` reubicados acá
 * (antes vivían en `nucleo/__tests__/avatarTopic.test.ts`, aunque el módulo
 * que ejercitan siempre estuvo en `adaptadores/hushsplit/` — mudanza previa
 * a la de carpetas que nunca se corrigió). Los 3 tests de `deriveAvatarTopic`
 * son los MISMOS de antes, sin debilitar ninguna aserción.
 *
 * D12 borra `sliceRenewal.ts`: la dedup de la foto propia pasa a reutilizar
 * el ledger de cubos (`nucleo/sliceLedger.ts#leerCubo`/`registrarCubo`, con
 * el `almacen` del adaptador) y la caché negativa de reintentos de
 * `fetchAvatarIfMissing` pasa a un `Map` en memoria — ninguna de las dos
 * necesita sobrevivir un restart de la app (la primera se reconstruye
 * comparando contra el ledger real; la segunda es sólo un freno de red).
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { generateGroupKey } from '@/src/sync/nucleo/envelopeCrypto';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useUserStore } from '@/src/store/userStore';
import { deriveAvatarTopic, publishAvatarIfOwn, fetchAvatarIfMissing } from '../avatarTopic';

jest.mock('../../supabase/relay', () => ({
  sendEnvelope: jest.fn(async () => ({ ok: true, seq: 1 })),
  fetchSince: jest.fn(async () => ({ ok: true, envelopes: [] })),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const relayMock = jest.requireMock('../../supabase/relay') as {
  sendEnvelope: jest.Mock;
  fetchSince: jest.Mock;
};

describe('deriveAvatarTopic', () => {
  it('es determinística para la misma clave/usuario/digest', async () => {
    const key = generateGroupKey();
    const a = await deriveAvatarTopic(key, 'u1', 'digest1');
    const b = await deriveAvatarTopic(key, 'u1', 'digest1');
    expect(a).toBe(b);
  });

  it('cambia si cambia el digest (la foto)', async () => {
    const key = generateGroupKey();
    const a = await deriveAvatarTopic(key, 'u1', 'digest1');
    const b = await deriveAvatarTopic(key, 'u1', 'digest2');
    expect(a).not.toBe(b);
  });

  it('cambia si cambia el usuario', async () => {
    const key = generateGroupKey();
    const a = await deriveAvatarTopic(key, 'u1', 'digest1');
    const b = await deriveAvatarTopic(key, 'u2', 'digest1');
    expect(a).not.toBe(b);
  });
});

describe('publishAvatarIfOwn — dedup por ledger de cubos (D12)', () => {
  let groupId: string;
  let userId: string;

  beforeEach(() => {
    relayMock.sendEnvelope.mockClear();
    relayMock.sendEnvelope.mockResolvedValue({ ok: true, seq: 1 });
    groupId = `G-${Math.random()}`;
    userId = `u-${Math.random()}`;
    useGroupKeyStore.setState({ keys: [] });
    useGroupKeyStore.getState().ensureKey(groupId);
  });

  it('no se republica si el ledger tiene el mismo digest y no venció', async () => {
    useUserStore.getState().addOrUpdateUser({
      id: userId, name: 'Uno', email: '', authProvider: 'google',
      createdAt: 1, updatedAt: 1, isDeleted: false, avatar: 'foto-estable',
    } as never);

    await publishAvatarIfOwn(groupId, userId, 'device1');
    expect(relayMock.sendEnvelope).toHaveBeenCalledTimes(1);

    await publishAvatarIfOwn(groupId, userId, 'device1');
    // mismo digest, ventana de renovación intacta: no reenvía.
    expect(relayMock.sendEnvelope).toHaveBeenCalledTimes(1);
  });

  it('se republica si cambió el digest', async () => {
    useUserStore.getState().addOrUpdateUser({
      id: userId, name: 'Uno', email: '', authProvider: 'google',
      createdAt: 1, updatedAt: 1, isDeleted: false, avatar: 'foto-vieja',
    } as never);
    await publishAvatarIfOwn(groupId, userId, 'device1');
    expect(relayMock.sendEnvelope).toHaveBeenCalledTimes(1);

    useUserStore.getState().addOrUpdateUser({
      id: userId, name: 'Uno', email: '', authProvider: 'google',
      createdAt: 1, updatedAt: 2, isDeleted: false, avatar: 'foto-nueva',
    } as never);
    await publishAvatarIfOwn(groupId, userId, 'device1');
    expect(relayMock.sendEnvelope).toHaveBeenCalledTimes(2);
  });

  it('se republica si venció la ventana de renovación', async () => {
    useUserStore.getState().addOrUpdateUser({
      id: userId, name: 'Uno', email: '', authProvider: 'google',
      createdAt: 1, updatedAt: 1, isDeleted: false, avatar: 'foto-estable',
    } as never);

    const inicio = Date.now();
    const ahora = jest.spyOn(Date, 'now').mockReturnValue(inicio);
    try {
      await publishAvatarIfOwn(groupId, userId, 'device1');
      expect(relayMock.sendEnvelope).toHaveBeenCalledTimes(1);

      // mismo digest, pero pasó de largo la ventana de 20 días (RENEWAL_WINDOW_MS).
      ahora.mockReturnValue(inicio + 20 * 24 * 60 * 60 * 1000 + 1);
      await publishAvatarIfOwn(groupId, userId, 'device1');
      expect(relayMock.sendEnvelope).toHaveBeenCalledTimes(2);
    } finally {
      ahora.mockRestore();
    }
  });
});

describe('fetchAvatarIfMissing — caché negativa de reintentos en memoria (D12)', () => {
  let userId: string;
  const groupId = 'G-fetch';

  beforeEach(() => {
    relayMock.fetchSince.mockClear();
    relayMock.fetchSince.mockResolvedValue({ ok: true, envelopes: [] }); // sigue sin llegar al buzón
    userId = `u-${Math.random()}`;
    useGroupKeyStore.setState({ keys: [] });
    useGroupKeyStore.getState().ensureKey(groupId);
    useUserStore.getState().addOrUpdateUser({
      id: userId, name: 'Dos', email: '', authProvider: 'google',
      createdAt: 1, updatedAt: 1, isDeleted: false,
    } as never); // sin avatar local: cualquier avatarDigest entrante dispara el intento
  });

  it('tras un intento fallido no se reintenta dentro de 5 minutos', async () => {
    const inicio = Date.now();
    const ahora = jest.spyOn(Date, 'now').mockReturnValue(inicio);
    try {
      await fetchAvatarIfMissing(groupId, userId, 'digest-x');
      expect(relayMock.fetchSince).toHaveBeenCalledTimes(1);

      ahora.mockReturnValue(inicio + 60_000); // 1 minuto después, dentro de la ventana de 5
      await fetchAvatarIfMissing(groupId, userId, 'digest-x');
      expect(relayMock.fetchSince).toHaveBeenCalledTimes(1); // no reintenta todavía

      ahora.mockReturnValue(inicio + 5 * 60 * 1000 + 1); // pasada la ventana
      await fetchAvatarIfMissing(groupId, userId, 'digest-x');
      expect(relayMock.fetchSince).toHaveBeenCalledTimes(2);
    } finally {
      ahora.mockRestore();
    }
  });
});

describe('D12: sliceRenewal.ts se borró', () => {
  it('sliceRenewal.ts ya no existe en adaptadores/hushsplit', () => {
    const ruta = join(__dirname, '..', 'sliceRenewal.ts');
    expect(existsSync(ruta)).toBe(false);
  });
});
