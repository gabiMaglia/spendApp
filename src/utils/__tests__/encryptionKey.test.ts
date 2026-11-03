// Mock stateful de expo-secure-store (el de setup.ts es no-stateful). El Map se
// expone con prefijo `mock` para poder sembrar la clave v1 y limpiarlo.
const mockKeychain = new Map<string, string>();
// Accesibilidad con la que se escribió cada nombre, y orden de las escrituras/borrados.
const mockAccesibilidad = new Map<string, string | undefined>();
const mockLog: string[] = [];
let mockLecturaCorrompida: string | null = null;
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  AFTER_FIRST_UNLOCK: 'afterFirstUnlock',
  getItemAsync: jest.fn(async (k: string) => (k === mockLecturaCorrompida && mockKeychain.has(k) ?'corrupta' : mockKeychain.get(k) ?? null)),
  setItemAsync: jest.fn(async (k: string, v: string, o?: { keychainAccessible?: string }) => {
    mockLog.push(`set:${k}`);
    mockKeychain.set(k, v);
    mockAccesibilidad.set(k, o?.keychainAccessible);
  }),
  deleteItemAsync: jest.fn(async (k: string) => { mockLog.push(`del:${k}`); mockKeychain.delete(k); }),
}));

import {
  ALFABETO_CLAVE_MMKV,
  borrarClaveV1,
  crearClaveNueva,
  generarClaveMMKV,
  leerClaveExistente,
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
    mockAccesibilidad.clear();
    mockLog.length = 0;
    mockLecturaCorrompida = null;
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
    it('crea la clave bajo el nombre migrable y la reutiliza en la misma sesión', async () => {
      const k1 = await getOrCreateEncryptionKey();
      expect(k1).toHaveLength(16);
      expect(mockKeychain.get('mmkv_encryption_key_v2m')).toBe(k1);
      expect(await getOrCreateEncryptionKey()).toBe(k1);
    });

    it('T-248: instalación nueva → accesibilidad AFTER_FIRST_UNLOCK (viaja en el respaldo), no THIS_DEVICE_ONLY', async () => {
      await getOrCreateEncryptionKey();
      expect(mockAccesibilidad.get('mmkv_encryption_key_v2m')).toBe('afterFirstUnlock');
      expect(mockKeychain.has('mmkv_encryption_key_v2')).toBe(false);
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
      expect(mockKeychain.get('mmkv_encryption_key_v2m')).toBe(v2);
    });
  });

  describe('T-248 · migración de la clave THIS_DEVICE_ONLY a la forma migrable', () => {
    const VIEJA = 'Abc123!@#xyz4567';

    it('usuario existente: copia el MISMO valor a la forma migrable, verifica y recién después borra la vieja', async () => {
      mockKeychain.set('mmkv_encryption_key_v2', VIEJA);
      expect(await getOrCreateEncryptionKey()).toBe(VIEJA);
      expect(mockKeychain.get('mmkv_encryption_key_v2m')).toBe(VIEJA);
      expect(mockAccesibilidad.get('mmkv_encryption_key_v2m')).toBe('afterFirstUnlock');
      expect(mockKeychain.has('mmkv_encryption_key_v2')).toBe(false);
      expect(mockLog.indexOf('set:mmkv_encryption_key_v2m')).toBeLessThan(mockLog.indexOf('del:mmkv_encryption_key_v2'));
    });

    it('no genera una clave nueva para quien actualiza (cero pérdida de datos)', async () => {
      mockKeychain.set('mmkv_encryption_key_v2', VIEJA);
      await getOrCreateEncryptionKey();
      __resetEncryptionKeyCache();
      expect(await getOrCreateEncryptionKey()).toBe(VIEJA);
    });

    it('murió tras copiar y antes de borrar: el siguiente arranque usa la nueva y termina de borrar la vieja', async () => {
      mockKeychain.set('mmkv_encryption_key_v2', VIEJA);
      mockKeychain.set('mmkv_encryption_key_v2m', VIEJA);
      expect(await leerClaveExistente()).toBe(VIEJA);
      expect(mockKeychain.has('mmkv_encryption_key_v2')).toBe(false);
      expect(mockKeychain.get('mmkv_encryption_key_v2m')).toBe(VIEJA);
    });

    it('si la lectura de verificación no coincide, conserva la vieja y devuelve su valor', async () => {
      mockKeychain.set('mmkv_encryption_key_v2', VIEJA);
      mockLecturaCorrompida = 'mmkv_encryption_key_v2m';
      expect(await leerClaveExistente()).toBe(VIEJA);
      expect(mockKeychain.get('mmkv_encryption_key_v2')).toBe(VIEJA);
    });

    it('leerClaveExistente devuelve null sin generar nada cuando no hay ninguna clave', async () => {
      expect(await leerClaveExistente()).toBeNull();
      expect(mockKeychain.size).toBe(0);
    });

    it('crearClaveNueva genera, guarda migrable y deja la clave en cache', async () => {
      const k = await crearClaveNueva();
      expect(mockKeychain.get('mmkv_encryption_key_v2m')).toBe(k);
      expect(getCachedEncryptionKey()).toBe(k);
    });
  });
});
