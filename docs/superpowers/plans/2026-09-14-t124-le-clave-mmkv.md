# T-124 L-E · Clave MMKV de entropía real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la clave MMKV de 64 hex (64 bits efectivos) por una de 16 caracteres ASCII imprimibles (~104.9 bits), vaciando los datos locales en el primer arranque de la versión nueva.

**Architecture:** `encryptionKey.ts` genera y guarda la clave v2 con muestreo por rechazo y expone el borrado de la v1. `bootstrapSecureStorage()` detecta la falta de la marca `enc_clave_v2` y, en ese caso, vacía y recifra con v2 los 10 buckets cifrados, vacía `settings` y `tier`, escribe la marca y recién después borra la v1. La lista de buckets en claro por cuenta pasa a un módulo de constantes para evitar el ciclo `secureStorage → wipeDevice → authStore → secureStorage`.

**Tech Stack:** Expo SDK 54, TypeScript estricto, `react-native-mmkv` ^3.3.3, `expo-secure-store`, `expo-crypto`, Jest.

**Spec:** `docs/superpowers/specs/2026-09-14-t124-le-clave-mmkv-design.md`

## Global Constraints

- Nombre de la clave nueva en el llavero: `mmkv_encryption_key_v2`. La vieja: `mmkv_encryption_key_v1`.
- Opciones del llavero: `keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY` (sin cambios).
- Formato de clave: 16 caracteres en `0x21`–`0x7E` (alfabeto de 94); muestreo por rechazo descartando bytes `≥ 188`; `b % 94 + 0x21`.
- Marca en `enc_meta` (MMKV en claro): `enc_clave_v2`. Marcas viejas `enc_<id>_v1` se borran al migrar.
- Buckets en claro por cuenta que se vacían: `settings`, `tier`. **Nunca** `theme`, `lang`, `fx`, `migrations`.
- La clave v1 se borra del llavero **después** de escribir `enc_clave_v2`.
- Path alias `@/`, nunca `../` en código de producción (los tests existentes de `src/utils/__tests__` usan `../`; se respeta el estilo del archivo).
- Tests: sólo comportamiento, nunca estilos. Comentarios en español, con el estilo del archivo.
- Nivel Strong: QA Strong + verificador ciego antes de merge. Sin cambios de dependencias nativas (no `prebuild --clean`).
- Verificación de rutina: `npx jest`, `npx tsc --noEmit`, `npm run lint` (base 127 warnings / 0 errores).
- Commits terminan con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Rama: `fix/T-124-le-clave-mmkv`.

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/utils/encryptionKey.ts` | Modificar | Generar/leer la clave v2; borrar la v1 |
| `src/utils/__tests__/encryptionKey.test.ts` | Reescribir | Formato, rechazo, persistencia v2, borrado v1 |
| `src/constants/storageBuckets.ts` | Crear | Listas `SCOPED_PLAIN` y `DEVICE_PREFS` (fuente única) |
| `src/store/wipeDevice.ts` | Modificar | Importar las listas desde constants (re-exporta `DEVICE_PREFS` por compatibilidad) |
| `src/utils/secureStorage.ts` | Modificar | Arranque en limpio con marca `enc_clave_v2` |
| `src/utils/__tests__/secureStorage.test.ts` | Reescribir | Arranque en limpio, idempotencia, corte, fallas |

---

### Task 1: Clave v2 de 16 caracteres imprimibles

**Files:**
- Modify: `src/utils/encryptionKey.ts` (archivo entero)
- Test: `src/utils/__tests__/encryptionKey.test.ts` (archivo entero)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export const ALFABETO_CLAVE_MMKV: number` (= 94)
  - `export async function generarClaveMMKV(fuente: (n: number) => Promise<Uint8Array>): Promise<string>`
  - `export async function getOrCreateEncryptionKey(): Promise<string>` (ahora v2)
  - `export async function leerClaveV1(): Promise<string | null>`
  - `export async function borrarClaveV1(): Promise<void>`
  - `export function getCachedEncryptionKey(): string | null` (sin cambios)
  - `export function __resetEncryptionKeyCache(): void` (sin cambios)

- [ ] **Step 1: Crear la rama**

```bash
cd /Users/gabrielsk/Documents/Proyects/spendApp
git checkout main && git pull -q && git checkout -b fix/T-124-le-clave-mmkv
```

- [ ] **Step 2: Escribir los tests que fallan**

Reemplazar el contenido entero de `src/utils/__tests__/encryptionKey.test.ts`:

```ts
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
```

- [ ] **Step 3: Correr los tests y confirmar que fallan (prueba de rojo)**

Run: `npx jest src/utils/__tests__/encryptionKey.test.ts`
Expected: FAIL — `generarClaveMMKV`, `ALFABETO_CLAVE_MMKV`, `leerClaveV1` y `borrarClaveV1` no existen (TypeError / undefined), y el test de `mmkv_encryption_key_v2` falla. Anotar la salida para el handoff.

- [ ] **Step 4: Implementar**

Reemplazar el contenido entero de `src/utils/encryptionKey.ts`:

```ts
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

// Clave de cifrado at-rest para MMKV. Vive en el llavero seguro del dispositivo
// (Keychain iOS / Keystore Android) vía expo-secure-store, accesible solo con el
// dispositivo desbloqueado y sin backup a iCloud/Google
// (WHEN_UNLOCKED_THIS_DEVICE_ONLY). Nunca se persiste en MMKV ni en texto plano.
//
// T-124 L-E (auditoría de seguridad #2): la v1 eran 64 caracteres hex, pero MMKV
// copia como mucho 16 BYTES de la clave (`AESCrypt.cpp:51`, `AES_KEY_LEN`): los
// primeros 16 hex = 8 bytes de entropía, AES-128 con 64 bits reales. La v2 son
// 16 caracteres del ASCII imprimible (94 símbolos): cada uno es 1 byte en UTF-8,
// así que son exactamente los 16 bytes que MMKV usa, ≈104.9 bits. No se usan
// bytes crudos: la clave viaja a nativo como string UTF-8 (`MmkvHostObject.cpp:21`)
// y un carácter > 0x7F ocupa 2 bytes — MMKV la cortaría a mitad de carácter.
const KEY_NAME = 'mmkv_encryption_key_v2';
const KEY_NAME_V1 = 'mmkv_encryption_key_v1';

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Símbolos posibles por carácter de la clave: `0x21`–`0x7E`. */
export const ALFABETO_CLAVE_MMKV = 94;
const LARGO_CLAVE = 16;
const PRIMER_CARACTER = 0x21;
// Mayor múltiplo de 94 que entra en un byte: los bytes >= 188 se descartan para
// que `b % 94` no favorezca a los primeros símbolos (sesgo de módulo).
const LIMITE_RECHAZO = ALFABETO_CLAVE_MMKV * Math.floor(256 / ALFABETO_CLAVE_MMKV);

let cached: string | null = null;

/**
 * Genera una clave de 16 caracteres imprimibles con muestreo por rechazo.
 * Recibe la fuente de bytes para poder testear el rechazo con bytes conocidos.
 */
export async function generarClaveMMKV(fuente: (n: number) => Promise<Uint8Array>): Promise<string> {
  let clave = '';
  while (clave.length < LARGO_CLAVE) {
    const bytes = await fuente(LARGO_CLAVE);
    for (let i = 0; i < bytes.length && clave.length < LARGO_CLAVE; i++) {
      if (bytes[i] >= LIMITE_RECHAZO) continue;
      clave += String.fromCharCode((bytes[i] % ALFABETO_CLAVE_MMKV) + PRIMER_CARACTER);
    }
  }
  return clave;
}

/**
 * Devuelve la clave v2, generándola de forma idempotente la primera vez.
 * Cachea en memoria para no golpear el llavero en cada acceso.
 */
export async function getOrCreateEncryptionKey(): Promise<string> {
  if (cached) return cached;

  const existing = await SecureStore.getItemAsync(KEY_NAME, SECURE_OPTS);
  if (existing) {
    cached = existing;
    return existing;
  }

  const key = await generarClaveMMKV((n) => Crypto.getRandomBytesAsync(n));
  await SecureStore.setItemAsync(KEY_NAME, key, SECURE_OPTS);
  cached = key;
  return key;
}

/** La clave v1 si sigue en el llavero (instalaciones previas a T-124), o null. */
export async function leerClaveV1(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_NAME_V1, SECURE_OPTS);
}

/** Borra la clave v1. Idempotente: no falla si ya no existe. */
export async function borrarClaveV1(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY_NAME_V1, SECURE_OPTS);
  } catch {
    // Ya no estaba o el llavero no responde: el próximo arranque lo reintenta
    // sólo si la marca v2 no quedó escrita, y si quedó, la v1 ya no se usa.
  }
}

/** Clave ya cargada en memoria, o null si todavía no se llamó a getOrCreate. */
export function getCachedEncryptionKey(): string | null {
  return cached;
}

/** Solo para tests: resetea el cache en memoria. */
export function __resetEncryptionKeyCache(): void {
  cached = null;
}
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `npx jest src/utils/__tests__/encryptionKey.test.ts`
Expected: PASS (10 tests).

Nota: `src/utils/__tests__/secureStorage.test.ts` va a fallar en este punto (espera clave hex de 64). Es esperado; se reescribe en la Task 2. No commitear con `--no-verify` para esquivarlo: si hay hook de tests, commitear igual con el fallo conocido anotado en el mensaje, o seguir directo a la Task 2 y commitear ambas juntas.

- [ ] **Step 6: Commit**

```bash
git add src/utils/encryptionKey.ts src/utils/__tests__/encryptionKey.test.ts
git commit -m "feat(crypto): clave MMKV v2 de 16 caracteres imprimibles (T-124 L-E)

MMKV usa sólo 16 bytes de la clave: la v1 en hex daba 64 bits reales.
secureStorage.test queda en rojo hasta la Task 2 (espera el formato hex).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Arranque en limpio con la clave v2

**Files:**
- Create: `src/constants/storageBuckets.ts`
- Modify: `src/store/wipeDevice.ts:1-40` (listas → import)
- Modify: `src/utils/secureStorage.ts:1-83` (imports + `bootstrapSecureStorage`)
- Test: `src/utils/__tests__/secureStorage.test.ts` (archivo entero)

**Interfaces:**
- Consumes (Task 1): `getOrCreateEncryptionKey(): Promise<string>`, `leerClaveV1(): Promise<string | null>`, `borrarClaveV1(): Promise<void>`.
- Produces:
  - `src/constants/storageBuckets.ts`: `export const SCOPED_PLAIN = ['settings', 'tier'] as const;` y `export const DEVICE_PREFS = ['theme', 'lang'] as const;`
  - `src/utils/secureStorage.ts`: `export const MARCA_CLAVE_V2 = 'enc_clave_v2';` — `bootstrapSecureStorage()` conserva su firma `(): Promise<void>`.

- [ ] **Step 1: Escribir los tests que fallan**

Reemplazar el contenido entero de `src/utils/__tests__/secureStorage.test.ts`. Los tests viejos «migra los datos existentes en claro (no se pierden al cifrar)» y «clave 64 hex» se eliminan **a propósito**: la spec aprobada por el PO (enfoque B, 2026-09-14) invierte ese comportamiento. Es cambio de especificación, no aflojar tests (P-18); dejarlo dicho en el handoff.

```ts
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

  it('un bucket que falla cae a memoria y los demás siguen cifrados con v2', async () => {
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
    consola.mockRestore();
  });

  it('antes del bootstrap cae a memoria sin romper (Expo Go / arranque)', () => {
    const s = createSecureStorage('payments');
    s.set('k', 'v');
    expect(s.getString('k')).toBe('v');
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan (prueba de rojo)**

Run: `npx jest src/utils/__tests__/secureStorage.test.ts`
Expected: FAIL — `MARCA_CLAVE_V2` es undefined; los tests de vaciado encuentran `data_v1` todavía presente (el bootstrap actual recifra sin `clearAll`); `settings`/`tier` no se vacían. Anotar la salida.

- [ ] **Step 3: Crear el módulo de constantes**

Crear `src/constants/storageBuckets.ts`:

```ts
/**
 * **Listas de buckets en claro** (fuente única).
 *
 * Viven acá y no en `src/store/wipeDevice.ts` porque las usa también
 * `src/utils/secureStorage.ts` en el arranque en limpio de T-124 L-E, y
 * `wipeDevice` importa `authStore`, que importa `secureStorage`: importarlas
 * desde `wipeDevice` armaba un ciclo. Duplicarlas tampoco: una lista copiada es
 * el bug de T-055, T-057 y T-060.
 */

/** Preferencias del dispositivo, no de una cuenta: nunca se borran. */
export const DEVICE_PREFS = ['theme', 'lang'] as const;

/** Storages en claro que sí son por cuenta. */
export const SCOPED_PLAIN = ['settings', 'tier'] as const;
```

- [ ] **Step 4: Apuntar `wipeDevice.ts` a las constantes**

En `src/store/wipeDevice.ts`, reemplazar:

```ts
import { createSecureStorage, SECURE_IDS } from '@/src/utils/secureStorage';
import { createStorage } from '@/src/utils/createStorage';
import { useAuthStore } from './authStore';
```

por:

```ts
import { createSecureStorage, SECURE_IDS } from '@/src/utils/secureStorage';
import { createStorage } from '@/src/utils/createStorage';
import { DEVICE_PREFS, SCOPED_PLAIN } from '@/src/constants/storageBuckets';
import { useAuthStore } from './authStore';
```

y borrar estas dos declaraciones (con sus comentarios de una línea):

```ts
/** Lo que NO se borra: preferencias globales del dispositivo, no de una cuenta. */
const DEVICE_PREFS = ['theme', 'lang'] as const;

/** Storages en claro que sí son por-cuenta. */
const SCOPED_PLAIN = ['settings', 'tier'] as const;
```

El `export { DEVICE_PREFS };` del final se deja: re-exporta el import y mantiene la API para quien lo use.

Run: `npx jest src/store/__tests__/wipeDevice.test.ts`
Expected: PASS (sin cambios de comportamiento).

- [ ] **Step 5: Implementar el arranque en limpio**

En `src/utils/secureStorage.ts`, reemplazar los imports:

```ts
import {
  MemoryStorage,
  loadMMKVClass,
  logStorageFailure,
  type SimpleStorage,
  registrarBucket,
} from './createStorage';
import { getOrCreateEncryptionKey } from './encryptionKey';
```

por:

```ts
import {
  MemoryStorage,
  loadMMKVClass,
  logStorageFailure,
  type SimpleStorage,
  registrarBucket,
} from './createStorage';
import { borrarClaveV1, getOrCreateEncryptionKey, leerClaveV1 } from './encryptionKey';
import { SCOPED_PLAIN } from '@/src/constants/storageBuckets';
```

Y reemplazar la función `bootstrapSecureStorage` entera (desde su bloque de comentario `/** Carga/genera la clave…` hasta el `}` de cierre) por:

```ts
/** Marca en `enc_meta`: los buckets ya se vaciaron y recifraron con la clave v2. */
export const MARCA_CLAVE_V2 = 'enc_clave_v2';

/**
 * Carga/genera la clave v2 y abre cada storage sensible CIFRADO.
 *
 * **Arranque en limpio (T-124 L-E, decisión del PO 2026-09-14).** La clave v1
 * daba 64 bits reales (ver `encryptionKey.ts`). Sin la marca `enc_clave_v2`, se
 * vacía cada bucket cifrado y se recifra con la v2, se vacían los buckets en
 * claro por cuenta (`SCOPED_PLAIN`), se escribe la marca y RECIÉN DESPUÉS se
 * borra la clave v1. No se preservan datos: no había instalaciones con datos
 * reales. Si la app muere antes de la marca, el arranque siguiente repite todo
 * y llega al mismo estado (todo vacío con v2): por eso no hay marcas por bucket.
 *
 * Debe llamarse (y await-earse) ANTES de hidratar los stores sensibles. Es
 * idempotente. Si MMKV no está (Expo Go) o el cifrado falla, los proxies caen a
 * memoria y la app sigue funcionando (sin persistir).
 */
export async function bootstrapSecureStorage(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  const MMKV = loadMMKVClass();
  if (!MMKV) return; // Expo Go / sin nativo → proxies usan memoria

  let key: string;
  try {
    key = await getOrCreateEncryptionKey();
  } catch (e) {
    console.error('[secure] no se pudo obtener la clave de cifrado → datos en memoria (no persisten)', e);
    return;
  }

  // Meta store EN CLARO: solo guarda marcas de migración (no datos sensibles).
  let meta: SimpleStorage | null = null;
  try { meta = new MMKV({ id: 'enc_meta' }); } catch { meta = null; }

  const yaEnV2 = meta?.getBoolean(MARCA_CLAVE_V2) === true;
  if (yaEnV2) {
    for (const id of SECURE_IDS) {
      try {
        const inst: SimpleStorage = new MMKV({ id, encryptionKey: key });
        inst.contains('__probe__'); // smoke test nativo
        instances.set(id, inst);
      } catch (e) {
        logStorageFailure(id, e);
      }
    }
    return;
  }

  // ── Arranque en limpio ───────────────────────────────────────────────────
  let claveV1: string | null = null;
  try { claveV1 = await leerClaveV1(); } catch { claveV1 = null; }

  for (const id of SECURE_IDS) {
    try {
      const cifradoConV1 = meta?.getBoolean(`enc_${id}_v1`) === true && !!claveV1;
      const inst: SimpleStorage = cifradoConV1
        ? new MMKV({ id, encryptionKey: claveV1 })
        : new MMKV({ id });
      inst.clearAll();
      (inst as unknown as { recrypt: (k: string) => void }).recrypt(key);
      inst.contains('__probe__'); // smoke test nativo
      instances.set(id, inst);
    } catch (e) {
      // Un id falla → cae a memoria solo ese id; el resto sigue.
      logStorageFailure(id, e);
    }
  }

  for (const id of SCOPED_PLAIN) {
    try { new MMKV({ id }).clearAll(); } catch (e) { logStorageFailure(id, e); }
  }

  if (!meta) return; // sin meta no hay marca: el próximo arranque lo reintenta
  meta.set(MARCA_CLAVE_V2, true);
  for (const id of SECURE_IDS) meta.delete(`enc_${id}_v1`);
  await borrarClaveV1();
}
```

- [ ] **Step 6: Correr los tests y confirmar que pasan**

Run: `npx jest src/utils/__tests__/secureStorage.test.ts src/utils/__tests__/encryptionKey.test.ts src/store/__tests__/wipeDevice.test.ts`
Expected: PASS (8 + 10 + los de wipeDevice).

- [ ] **Step 7: Suite completa, tipos y lint**

Run: `npx jest 2>&1 | grep -E "^Tests:|failed"` → Expected: sin fallos.
Run: `npx tsc --noEmit` → Expected: sin salida.
Run: `npm run lint 2>&1 | grep problems` → Expected: `127 problems (0 errors, 127 warnings)`.

Si falla algún test fuera de estos archivos que dependía de la clave hex o del recrypt sin `clearAll` (buscar con `grep -rn "64}\$/\|enc_.*_v1\|recrypt" src --include=*.test.ts`), leer qué afirma: si afirma el comportamiento viejo que la spec invierte, actualizarlo y anotarlo en el handoff; si afirma otra cosa, el bug está en la implementación.

- [ ] **Step 8: Commit**

```bash
git add src/constants/storageBuckets.ts src/store/wipeDevice.ts src/utils/secureStorage.ts src/utils/__tests__/secureStorage.test.ts
git commit -m "feat(crypto): arranque en limpio con la clave MMKV v2 (T-124 L-E)

Sin la marca enc_clave_v2 se vacían y recifran los 10 buckets cifrados, se
vacían settings/tier, se escribe la marca y recién después se borra la v1.
Las listas de buckets en claro pasan a src/constants/storageBuckets.ts para
no armar un ciclo secureStorage → wipeDevice → authStore → secureStorage.
Los tests viejos «migra datos en claro» y «clave 64 hex» se reemplazan: la
spec aprobada por el PO invierte ese comportamiento.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Mutaciones, handoff y cierre para revisión

**Files:**
- Modify (temporal, se revierte): `src/utils/encryptionKey.ts`, `src/utils/secureStorage.ts`
- Modify: `engram/05_handoff_log.md` (entrada nueva arriba), `engram/03_backlog.md` (fila T-124)

**Interfaces:**
- Consumes: todo lo anterior. Produces: evidencia para QA Strong y verificador ciego.

- [ ] **Step 1: Mutación 1 — clave de vuelta a hex**

En `src/utils/encryptionKey.ts`, dentro de `getOrCreateEncryptionKey`, reemplazar temporalmente
`const key = await generarClaveMMKV((n) => Crypto.getRandomBytesAsync(n));`
por
`const key = Array.from(await Crypto.getRandomBytesAsync(32), (b) => b.toString(16).padStart(2, '0')).join('');`

Run: `npx jest src/utils/__tests__/encryptionKey.test.ts src/utils/__tests__/secureStorage.test.ts`
Expected: FAIL (tests de largo 16). Anotar cuáles. Revertir: `git checkout -- src/utils/encryptionKey.ts`.

- [ ] **Step 2: Mutación 2 — borrar la v1 antes de la marca**

En `src/utils/secureStorage.ts`, mover `await borrarClaveV1();` a la línea anterior a `meta.set(MARCA_CLAVE_V2, true);`.

Run: `npx jest src/utils/__tests__/secureStorage.test.ts`
Expected: FAIL en «borra la clave v1 DESPUÉS de la marca». Revertir: `git checkout -- src/utils/secureStorage.ts`.

- [ ] **Step 3: Mutación 3 — sin `clearAll`**

En `src/utils/secureStorage.ts`, comentar `inst.clearAll();` dentro del bucle de `SECURE_IDS` del arranque en limpio.

Run: `npx jest src/utils/__tests__/secureStorage.test.ts`
Expected: FAIL en «vacía y recifra con v2 los 10 buckets» y «cada bucket se vacía ANTES de recifrarse». Revertir: `git checkout -- src/utils/secureStorage.ts`.

- [ ] **Step 4: Mutación 4 — sin vaciar `SCOPED_PLAIN`**

En `src/utils/secureStorage.ts`, comentar el bucle `for (const id of SCOPED_PLAIN)`.

Run: `npx jest src/utils/__tests__/secureStorage.test.ts`
Expected: FAIL en el test de `settings`/`tier`. Revertir: `git checkout -- src/utils/secureStorage.ts`.

- [ ] **Step 5: Confirmar árbol limpio y suite verde**

Run: `git status --short` → Expected: vacío.
Run: `npx jest 2>&1 | grep -E "^Tests:"` → Expected: sin fallos.

- [ ] **Step 6: Handoff y backlog**

Agregar arriba de `engram/05_handoff_log.md` (tras el encabezado del archivo) una entrada:

```markdown
### [2026-09-14] RETURN nerv-mobile → Orq · T-124 L-E
**Status:** código completo en `fix/T-124-le-clave-mmkv`, En revisión QA (Strong + verificador ciego).
**Spec / plan:** `docs/superpowers/specs/2026-09-14-t124-le-clave-mmkv-design.md` · `docs/superpowers/plans/2026-09-14-t124-le-clave-mmkv.md`.
**Files:** `src/utils/encryptionKey.ts`, `src/utils/secureStorage.ts`, `src/constants/storageBuckets.ts` (nuevo), `src/store/wipeDevice.ts`, tests de `encryptionKey` y `secureStorage` reescritos.
**Desvío de la spec:** `SCOPED_PLAIN` se importa desde `src/constants/storageBuckets.ts`, no desde `wipeDevice.ts` (ciclo de imports). Misma intención: una sola lista.
**Tests reemplazados a propósito (P-18):** «migra los datos existentes en claro» y «clave 64 hex» — la spec aprobada invierte ese comportamiento.
**Proof of red:** <pegar salida de Task 1 Step 3 y Task 2 Step 2>.
**Mutaciones:** <pegar qué test cayó en cada una de las 4>.
**Pendiente antes de Done:** verificación en aparato §5 de la spec (iOS y Android), a cargo del PO.
**Aviso para el build:** quien actualice queda sin sesión y sin datos locales; los contactos lo tienen que volver a escanear.
```

En `engram/03_backlog.md`, fila `T-124`: estado → `En revisión QA (L-E, rama fix/T-124-le-clave-mmkv; L-B/L-C/L-F pendientes)`.

- [ ] **Step 7: Commit final (sólo si quedó algo por commitear en el repo)**

`engram/` está gitignored: no se commitea. Si `git status --short` está vacío, no hay commit en este paso.
