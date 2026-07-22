// Mock stateful de secure-store (el de setup.ts es no-op) + crypto determinista.
jest.mock('expo-secure-store', () => {
  let stored: string | null = null;
  return {
    getItemAsync: jest.fn(async () => stored),
    setItemAsync: jest.fn(async (_k: string, v: string) => { stored = v; }),
    deleteItemAsync: jest.fn(async () => { stored = null; }),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'unlocked_this_device',
  };
});
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async (n: number) => {
    const a = new Uint8Array(n);
    for (let i = 0; i < n; i++) a[i] = (i * 7) % 256; // determinista para el test
    return a;
  }),
}));

import { getOrCreateEncryptionKey } from '../encryptionKey';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

describe('getOrCreateEncryptionKey (S-01)', () => {
  it('genera una clave de 256 bits (64 hex) y la persiste en el primer arranque', async () => {
    const key = await getOrCreateEncryptionKey();
    expect(key).toHaveLength(64); // 32 bytes → 64 chars hex
    expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  });

  it('es idempotente: reutiliza la clave persistida, no genera otra', async () => {
    const k1 = await getOrCreateEncryptionKey();
    (Crypto.getRandomBytesAsync as jest.Mock).mockClear();
    const k2 = await getOrCreateEncryptionKey();
    expect(k2).toBe(k1);
    expect(Crypto.getRandomBytesAsync).not.toHaveBeenCalled(); // no regeneró
  });
});
