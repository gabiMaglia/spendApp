// Mocks a nivel de archivo: MMKV per-id (simula disco) con spy de recrypt, y
// secure-store stateful. Las vars deben prefijarse con `mock` para que Jest
// permita referenciarlas dentro del factory hoisteado.
const mockMaps = new Map<string, Map<string, string | number | boolean>>();
const mockRecryptCalls: { id: string; key: string }[] = [];

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation((opts: { id: string; encryptionKey?: string }) => {
    const id = opts.id;
    if (!mockMaps.has(id)) mockMaps.set(id, new Map());
    const m = mockMaps.get(id)!;
    return {
      set: (k: string, v: string | number | boolean) => m.set(k, v),
      getString: (k: string) => m.get(k),
      getBoolean: (k: string) => m.get(k),
      getNumber: (k: string) => m.get(k),
      delete: (k: string) => m.delete(k),
      contains: (k: string) => m.has(k),
      clearAll: () => m.clear(),
      recrypt: (key: string) => mockRecryptCalls.push({ id, key }),
    };
  }),
}));

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x',
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k: string) => { store.delete(k); }),
  };
});

import {
  bootstrapSecureStorage,
  createSecureStorage,
  SECURE_IDS,
  __resetSecureStorage,
} from '../secureStorage';
import { __resetEncryptionKeyCache } from '../encryptionKey';

describe('secureStorage', () => {
  beforeEach(() => {
    __resetSecureStorage();
    __resetEncryptionKeyCache();
    mockMaps.clear();
    mockRecryptCalls.length = 0;
  });

  it('cifra in-place (recrypt) cada store sensible en la primera corrida, con una única clave 256-bit', async () => {
    await bootstrapSecureStorage();

    const ids = mockRecryptCalls.map(c => c.id).sort();
    expect(ids).toEqual([...SECURE_IDS].sort());
    // misma clave para todos, formato 64 hex
    expect(new Set(mockRecryptCalls.map(c => c.key)).size).toBe(1);
    expect(mockRecryptCalls[0].key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('en la segunda corrida NO vuelve a cifrar (flag de migración persistido)', async () => {
    await bootstrapSecureStorage();
    const firstCount = mockRecryptCalls.length;
    expect(firstCount).toBe(SECURE_IDS.length);

    // Simula reinicio de app: registro en memoria fresco, pero el "disco"
    // (mockMaps, incl. flags de enc_meta) persiste.
    __resetSecureStorage();
    await bootstrapSecureStorage();

    expect(mockRecryptCalls.length).toBe(firstCount); // ningún recrypt nuevo
  });

  it('migra los datos existentes en claro (no se pierden al cifrar)', async () => {
    // Sembramos data en claro en "groups" ANTES del bootstrap (como un install
    // previo sin cifrado). recrypt cifra in-place, así que debe seguir ahí.
    mockMaps.set('groups', new Map([['data_v1', '[{"id":"g1"}]']]));

    await bootstrapSecureStorage();

    expect(createSecureStorage('groups').getString('data_v1')).toBe('[{"id":"g1"}]');
  });

  it('createSecureStorage persiste (lee/escribe) tras el bootstrap', async () => {
    await bootstrapSecureStorage();
    createSecureStorage('expenses').set('data_v1', '[]');
    // otra instancia del proxy ve el mismo dato
    expect(createSecureStorage('expenses').getString('data_v1')).toBe('[]');
  });

  it('antes del bootstrap cae a memoria sin romper (Expo Go / arranque)', () => {
    const s = createSecureStorage('payments');
    s.set('k', 'v');
    expect(s.getString('k')).toBe('v');
  });
});
