// Mock stateful de expo-secure-store (el de setup.ts es no-stateful). El Map se
// expone con prefijo `mock` para poder sembrar la clave v1 y limpiarlo.
const mockKeychain = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  getItemAsync: jest.fn(async (k: string) => mockKeychain.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockKeychain.set(k, v); }),
  deleteItemAsync: jest.fn(async (k: string) => { mockKeychain.delete(k); }),
}));

import {
  ALFABETO_CLAVE_MMKV,
  borrarClaveV1,
  generarClaveMMKV,
  getCachedEncryptionKey,
  getOrCreateEncryptionKey,
  leerClaveV1,
  __resetEncryptionKeyCache,
} from '../encryptionKey';

/** Fuente que entrega los bytes dados en orden, en tandas del tamaño pedido. */
function fuenteFija(bytes: number[]) {
  let i = 0;
  return async (n: number) => {
    const out = new Uint8Array(n);
    for (let j = 0; j < n; j++) out[j] = bytes[i++ % bytes.length];
    return out;
  };
}

describe('encryptionKey (T-124 L-E)', () => {
  beforeEach(() => {
    __resetEncryptionKeyCache();
    mockKeychain.clear();
  });

  describe('generarClaveMMKV', () => {
    it('da 16 caracteres ASCII imprimibles = 16 bytes exactos en UTF-8 (lo que MMKV usa)', async () => {
      const clave = await generarClaveMMKV(fuenteFija([0, 50, 93, 100, 187]));
      expect(clave).toHaveLength(16);
      for (const ch of clave) {
        const c = ch.charCodeAt(0);
        expect(c).toBeGreaterThanOrEqual(0x21);
        expect(c).toBeLessThanOrEqual(0x7e);
      }
      expect(Buffer.byteLength(clave, 'utf8')).toBe(16);
    });

    it('mapea cada byte aceptado a b % 94 + 0x21', async () => {
      // 0 → '!', 93 → '~', 94 → '!', 187 → '~'
      const clave = await generarClaveMMKV(fuenteFija([0, 93, 94, 187]));
      expect(clave).toBe('!~!~!~!~!~!~!~!~');
    });

    it('descarta los bytes >= 188 (sin sesgo de módulo) y pide más hasta completar', async () => {
      // Los primeros 20 bytes son todos inválidos; después vienen 0s.
      const bytes = [...Array(20).fill(255), ...Array(16).fill(0)];
      const clave = await generarClaveMMKV(fuenteFija(bytes));
      expect(clave).toBe('!'.repeat(16));
    });

    it('el alfabeto es de 94 símbolos: entropía por diseño >= 104 bits (no volver a hex)', () => {
      expect(ALFABETO_CLAVE_MMKV).toBe(94);
      expect(16 * Math.log2(ALFABETO_CLAVE_MMKV)).toBeGreaterThanOrEqual(104);
    });
  });

  describe('llavero', () => {
    it('crea la clave v2 bajo mmkv_encryption_key_v2 y la reutiliza en la misma sesión', async () => {
      const k1 = await getOrCreateEncryptionKey();
      expect(k1).toHaveLength(16);
      expect(mockKeychain.get('mmkv_encryption_key_v2')).toBe(k1);
      expect(await getOrCreateEncryptionKey()).toBe(k1);
    });

    it('reusa la v2 persistida tras un reinicio (cache reseteado)', async () => {
      const k1 = await getOrCreateEncryptionKey();
      __resetEncryptionKeyCache();
      expect(await getOrCreateEncryptionKey()).toBe(k1);
    });

    it('nunca devuelve la clave v1 aunque exista en el llavero', async () => {
      mockKeychain.set('mmkv_encryption_key_v1', 'a'.repeat(64));
      const k = await getOrCreateEncryptionKey();
      expect(k).not.toBe('a'.repeat(64));
      expect(k).toHaveLength(16);
    });

    it('cachea en memoria tras el primer acceso', async () => {
      expect(getCachedEncryptionKey()).toBeNull();
      const k = await getOrCreateEncryptionKey();
      expect(getCachedEncryptionKey()).toBe(k);
    });

    it('leerClaveV1 devuelve la v1 o null', async () => {
      expect(await leerClaveV1()).toBeNull();
      mockKeychain.set('mmkv_encryption_key_v1', 'b'.repeat(64));
      expect(await leerClaveV1()).toBe('b'.repeat(64));
    });

    it('borrarClaveV1 elimina la v1, no toca la v2 y no falla si no existe', async () => {
      await borrarClaveV1(); // no existe: no revienta
      mockKeychain.set('mmkv_encryption_key_v1', 'c'.repeat(64));
      const v2 = await getOrCreateEncryptionKey();
      await borrarClaveV1();
      expect(mockKeychain.has('mmkv_encryption_key_v1')).toBe(false);
      expect(mockKeychain.get('mmkv_encryption_key_v2')).toBe(v2);
    });
  });
});
