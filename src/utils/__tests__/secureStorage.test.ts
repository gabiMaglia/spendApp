// Mocks a nivel de archivo: MMKV per-id (simula disco) que registra con qué
// clave se abrió cada instancia, cada clearAll y cada recrypt; y un llavero
// stateful. Las vars llevan prefijo `mock` para que Jest permita usarlas
// dentro del factory hoisteado.
const mockMaps = new Map<string, Map<string, string | number | boolean>>();
const mockEventos: { tipo: 'abrir' | 'clearAll' | 'recrypt' | 'borrarV1' | 'marca'; id: string; key?: string }[] = [];
const mockKeychain = new Map<string, string>();
let mockRecryptFallaEn: string | null = null;

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation((opts: { id: string; encryptionKey?: string }) => {
    const id = opts.id;
    if (!mockMaps.has(id)) mockMaps.set(id, new Map());
    const m = mockMaps.get(id)!;
    mockEventos.push({ tipo: 'abrir', id, key: opts.encryptionKey });
    return {
      set: (k: string, v: string | number | boolean) => {
        if (id === 'enc_meta' && k === 'enc_clave_v2') mockEventos.push({ tipo: 'marca', id });
        m.set(k, v);
      },
      getString: (k: string) => m.get(k),
      getBoolean: (k: string) => m.get(k),
      getNumber: (k: string) => m.get(k),
      delete: (k: string) => m.delete(k),
      contains: (k: string) => m.has(k),
      getAllKeys: () => [...m.keys()],
      clearAll: () => { mockEventos.push({ tipo: 'clearAll', id }); m.clear(); },
      recrypt: (key: string) => {
        if (mockRecryptFallaEn === id) throw new Error('corte simulado');
        mockEventos.push({ tipo: 'recrypt', id, key });
      },
    };
  }),
}));

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x',
  getItemAsync: jest.fn(async (k: string) => mockKeychain.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockKeychain.set(k, v); }),
  deleteItemAsync: jest.fn(async (k: string) => {
    if (k === 'mmkv_encryption_key_v1') mockEventos.push({ tipo: 'borrarV1', id: '' });
    mockKeychain.delete(k);
  }),
}));

import {
  bootstrapSecureStorage,
  createSecureStorage,
  MARCA_CLAVE_V2,
  SECURE_IDS,
  __resetSecureStorage,
} from '../secureStorage';
import { __resetEncryptionKeyCache } from '../encryptionKey';

const V1 = 'f'.repeat(64);

/** Simula una instalación previa a T-124: clave v1, buckets cifrados con v1 y datos. */
function sembrarInstalacionV1() {
  mockKeychain.set('mmkv_encryption_key_v1', V1);
  const meta = new Map<string, string | number | boolean>();
  for (const id of SECURE_IDS) {
    meta.set(`enc_${id}_v1`, true);
    mockMaps.set(id, new Map([['data_v1', `datos de ${id}`]]));
  }
  mockMaps.set('enc_meta', meta);
  mockMaps.set('settings', new Map([['currency', 'ARS']]));
  mockMaps.set('tier', new Map([['pro', false]]));
  mockMaps.set('theme', new Map([['mode', 'dark']]));
  mockMaps.set('lang', new Map([['lang', 'es']]));
}

/** Reinicio de app: memoria fresca, el "disco" (mockMaps) y el llavero persisten. */
function reiniciar() {
  __resetSecureStorage();
  __resetEncryptionKeyCache();
  mockEventos.length = 0;
}

describe('secureStorage · arranque en limpio con clave v2 (T-124 L-E)', () => {
  beforeEach(() => {
    __resetSecureStorage();
    __resetEncryptionKeyCache();
    mockMaps.clear();
    mockEventos.length = 0;
    mockKeychain.clear();
    mockRecryptFallaEn = null;
  });

  it('instalación v1: vacía y recifra con v2 los 10 buckets, vacía settings/tier y respeta theme/lang', async () => {
    sembrarInstalacionV1();
    await bootstrapSecureStorage();

    const v2 = mockKeychain.get('mmkv_encryption_key_v2')!;
    expect(v2).toHaveLength(16);

    const vaciados = mockEventos.filter(e => e.tipo === 'clearAll').map(e => e.id);
    const recifrados = mockEventos.filter(e => e.tipo === 'recrypt');
    expect([...new Set(recifrados.map(e => e.id))].sort()).toEqual([...SECURE_IDS].sort());
    expect(recifrados.every(e => e.key === v2)).toBe(true);
    for (const id of SECURE_IDS) {
      expect(vaciados).toContain(id);
      expect(createSecureStorage(id).getString('data_v1')).toBeUndefined();
    }
    expect(mockMaps.get('settings')!.size).toBe(0);
    expect(mockMaps.get('tier')!.size).toBe(0);
    expect(mockMaps.get('theme')!.get('mode')).toBe('dark');
    expect(mockMaps.get('lang')!.get('lang')).toBe('es');
  });

  it('cada bucket se vacía ANTES de recifrarse', async () => {
    sembrarInstalacionV1();
    await bootstrapSecureStorage();
    for (const id of SECURE_IDS) {
      const iClear = mockEventos.findIndex(e => e.tipo === 'clearAll' && e.id === id);
      const iRecrypt = mockEventos.findIndex(e => e.tipo === 'recrypt' && e.id === id);
      expect(iClear).toBeGreaterThanOrEqual(0);
      expect(iClear).toBeLessThan(iRecrypt);
    }
  });

  it('escribe la marca v2, borra las marcas v1 y borra la clave v1 DESPUÉS de la marca', async () => {
    sembrarInstalacionV1();
    await bootstrapSecureStorage();

    const meta = mockMaps.get('enc_meta')!;
    expect(meta.get(MARCA_CLAVE_V2)).toBe(true);
    for (const id of SECURE_IDS) expect(meta.has(`enc_${id}_v1`)).toBe(false);
    expect(mockKeychain.has('mmkv_encryption_key_v1')).toBe(false);

    const iMarca = mockEventos.findIndex(e => e.tipo === 'marca');
    const iBorrar = mockEventos.findIndex(e => e.tipo === 'borrarV1');
    expect(iMarca).toBeGreaterThanOrEqual(0);
    expect(iMarca).toBeLessThan(iBorrar);
  });

  it('instalación limpia (sin v1 ni marcas): termina con la marca v2 sin fallar', async () => {
    await bootstrapSecureStorage();
    expect(mockMaps.get('enc_meta')!.get(MARCA_CLAVE_V2)).toBe(true);
    expect(mockKeychain.get('mmkv_encryption_key_v2')).toHaveLength(16);
    createSecureStorage('expenses').set('data_v1', '[]');
    expect(createSecureStorage('expenses').getString('data_v1')).toBe('[]');
  });

  it('con la marca v2: abre con v2 y no vacía ni recifra nada (los datos persisten)', async () => {
    await bootstrapSecureStorage();
    const v2 = mockKeychain.get('mmkv_encryption_key_v2')!;
    createSecureStorage('groups').set('data_v1', '[{"id":"g1"}]');

    reiniciar();
    await bootstrapSecureStorage();

    expect(mockEventos.filter(e => e.tipo === 'clearAll')).toHaveLength(0);
    expect(mockEventos.filter(e => e.tipo === 'recrypt')).toHaveLength(0);
    const aperturas = mockEventos.filter(e => e.tipo === 'abrir' && (SECURE_IDS as readonly string[]).includes(e.id));
    expect(aperturas.every(e => e.key === v2)).toBe(true);
    expect(createSecureStorage('groups').getString('data_v1')).toBe('[{"id":"g1"}]');
  });

  it('corte a mitad de camino (antes de la marca): el arranque siguiente repite todo y llega al mismo estado', async () => {
    sembrarInstalacionV1();
    // Primer arranque "interrumpido": se vacían y recifran algunos buckets pero
    // la app muere antes de escribir la marca. Se simula dejando el disco así.
    const meta = mockMaps.get('enc_meta')!;
    for (const id of SECURE_IDS.slice(0, 5)) mockMaps.set(id, new Map());
    expect(meta.has(MARCA_CLAVE_V2)).toBe(false);
    expect(mockKeychain.has('mmkv_encryption_key_v1')).toBe(true);

    await bootstrapSecureStorage();

    for (const id of SECURE_IDS) expect(mockMaps.get(id)!.has('data_v1')).toBe(false);
    expect(meta.get(MARCA_CLAVE_V2)).toBe(true);
    expect(mockKeychain.has('mmkv_encryption_key_v1')).toBe(false);
  });

  it('un bucket que falla cae a memoria, no escribe la marca, no borra la v1, y el próximo arranque repite todo', async () => {
    sembrarInstalacionV1();
    mockRecryptFallaEn = 'payments';
    const consola = jest.spyOn(console, 'error').mockImplementation(() => {});

    await bootstrapSecureStorage();

    const v2 = mockKeychain.get('mmkv_encryption_key_v2')!;
    const recifrados = mockEventos.filter(e => e.tipo === 'recrypt').map(e => e.id);
    expect(recifrados).not.toContain('payments');
    expect(recifrados).toHaveLength(SECURE_IDS.length - 1);
    expect(mockEventos.filter(e => e.tipo === 'recrypt').every(e => e.key === v2)).toBe(true);
    // payments en memoria: funciona pero no toca el "disco".
    createSecureStorage('payments').set('k', 'v');
    expect(createSecureStorage('payments').getString('k')).toBe('v');
    expect(mockMaps.get('payments')!.has('k')).toBe(false);

    // Un bucket sin vaciar/recifrar no puede quedar bajo la marca: si quedara,
    // el próximo arranque lo vería "yaEnV2" y ese bucket jamás se repararía.
    expect(mockMaps.get('enc_meta')!.get(MARCA_CLAVE_V2)).not.toBe(true);
    expect(mockKeychain.has('mmkv_encryption_key_v1')).toBe(true);

    // Arranque siguiente: el corte se resolvió, ahora sí recifra todo y termina
    // en el mismo estado final que una instalación sin fallas.
    mockRecryptFallaEn = null;
    reiniciar();
    await bootstrapSecureStorage();

    const v2b = mockKeychain.get('mmkv_encryption_key_v2')!;
    const recifrados2 = mockEventos.filter(e => e.tipo === 'recrypt').map(e => e.id);
    expect([...new Set(recifrados2)].sort()).toEqual([...SECURE_IDS].sort());
    expect(mockMaps.get('enc_meta')!.get(MARCA_CLAVE_V2)).toBe(true);
    expect(mockKeychain.has('mmkv_encryption_key_v1')).toBe(false);
    expect(createSecureStorage('payments').getString('data_v1')).toBeUndefined();
    void v2b;
    consola.mockRestore();
  });

  it('con la marca v2 y una v1 huérfana en el llavero, la borra', async () => {
    // Corte simulado ENTRE `meta.set(MARCA_CLAVE_V2, true)` y `borrarClaveV1()`:
    // la marca quedó escrita pero la clave v1 sigue en el llavero.
    const meta = new Map<string, string | number | boolean>();
    meta.set(MARCA_CLAVE_V2, true);
    mockMaps.set('enc_meta', meta);
    mockKeychain.set('mmkv_encryption_key_v1', V1);
    mockKeychain.set('mmkv_encryption_key_v2', 'x'.repeat(16));

    await bootstrapSecureStorage();

    expect(mockKeychain.has('mmkv_encryption_key_v1')).toBe(false);
    expect(mockEventos.filter(e => e.tipo === 'clearAll')).toHaveLength(0);
    expect(mockEventos.filter(e => e.tipo === 'recrypt')).toHaveLength(0);
  });

  it('antes del bootstrap cae a memoria sin romper (Expo Go / arranque)', () => {
    const s = createSecureStorage('payments');
    s.set('k', 'v');
    expect(s.getString('k')).toBe('v');
  });
});
