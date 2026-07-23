// Mock stateful de expo-secure-store (el de setup.ts es no-stateful).
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k: string) => { store.delete(k); }),
  };
});

import {
  getOrCreateEncryptionKey,
  getCachedEncryptionKey,
  __resetEncryptionKeyCache,
} from '../encryptionKey';

describe('encryptionKey', () => {
  beforeEach(() => __resetEncryptionKeyCache());

  it('genera una clave de 256 bits (64 hex) idempotente en la misma sesión', async () => {
    const k1 = await getOrCreateEncryptionKey();
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
    const k2 = await getOrCreateEncryptionKey();
    expect(k2).toBe(k1); // no regenera
  });

  it('reusa la clave persistida en el llavero cuando el cache se resetea (reinicio)', async () => {
    const k1 = await getOrCreateEncryptionKey();
    __resetEncryptionKeyCache(); // simula un arranque nuevo
    const k2 = await getOrCreateEncryptionKey();
    expect(k2).toBe(k1); // la leyó de secure-store, no generó otra
  });

  it('cachea en memoria tras el primer acceso', async () => {
    expect(getCachedEncryptionKey()).toBeNull();
    const k = await getOrCreateEncryptionKey();
    expect(getCachedEncryptionKey()).toBe(k);
  });
});
