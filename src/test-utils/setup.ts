// i18n: devuelve la clave como valor para que los tests no dependan de traducciones
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && Object.keys(opts).length > 0) {
        return `${key}(${JSON.stringify(opts)})`;
      }
      return key;
    },
    i18n: { changeLanguage: jest.fn(), language: 'es' },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

// MMKV: mock en memoria para tests.
//
// UN MAP POR `id`, no uno compartido. En producción `new MMKV({ id })` crea
// stores independientes: un `clearAll()` en 'groups' no toca 'expenses'. El
// mock tenía un solo Map global, así que cualquier `clearAll()` borraba TODO y
// los tests no podían distinguir "esto borra su bucket" de "esto borra todo" —
// justo lo que hay que verificar en cosas como wipeAllAccounts.
jest.mock('react-native-mmkv', () => {
  const stores = new Map<string, Map<string, string | number | boolean>>();
  const storeFor = (id: string) => {
    let s = stores.get(id);
    if (!s) { s = new Map(); stores.set(id, s); }
    return s;
  };

  return {
    MMKV: jest.fn().mockImplementation((config?: { id?: string }) => {
      const store = storeFor(config?.id ?? 'default');
      return {
        set: (key: string, value: string | number | boolean) => store.set(key, value),
        getString: (key: string) => store.get(key) as string | undefined,
        getNumber: (key: string) => store.get(key) as number | undefined,
        getBoolean: (key: string) => store.get(key) as boolean | undefined,
        delete: (key: string) => store.delete(key),
        contains: (key: string) => store.has(key),
        // La purga de scopes BARRE el bucket buscando el sufijo de la cuenta
        // en vez de enumerar qué guardó cada módulo (T-060). Sin esto en el
        // mock, el barrido no existe en los tests y el bug que cierra volvería
        // sin que nada fallara.
        getAllKeys: () => [...store.keys()],
        clearAll: () => store.clear(),
        recrypt: (_key?: string) => {},
      };
    }),
  };
});

// expo-crypto para tests.
//
// `getRandomBytes` NO puede ser determinista: el cifrado de sobres usa nonces
// aleatorios, y con bytes fijos dos sobres del mismo texto darían idénticos —
// el test que verifica lo contrario pasaría por construcción y no protegería
// nada. `getRandomBytesAsync` se mantiene determinista porque la clave de
// cifrado at-rest sí espera valores estables entre corridas.
let mockSeed = 1;
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (n: number) =>
    new Uint8Array(Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256)),
  getRandomBytes: (n: number) =>
    new Uint8Array(Array.from({ length: n }, () => {
      mockSeed = (mockSeed * 1103515245 + 12345) & 0x7fffffff;
      return mockSeed % 256;
    })),
  digestStringAsync: async (_alg: string, data: string) => {
    // Hash de juguete: sólo tiene que ser determinista y distinguir entradas.
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < data.length; i++) {
      h1 = ((h1 ^ data.charCodeAt(i)) * 16777619) >>> 0;
      h2 = ((h2 + data.charCodeAt(i) * (i + 1)) * 2654435761) >>> 0;
    }
    return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(4);
  },
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

// expo-secure-store: mock simple
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

/**
 * `react-native-safe-area-context` necesita un provider en el árbol y los tests
 * renderizan pantallas sueltas, sin `<SafeAreaProvider>`. No hacía falta hasta
 * el reskin del 2026-09-02 (`f8186f9`), que metió `useSafeAreaInsets` en
 * `CollapsibleHeader` — un componente que ahora usa casi toda la app. Sin esto,
 * 48 tests de 8 suites mueren con «No safe area value available» y el mensaje no
 * dice nada sobre lo que el test estaba probando.
 *
 * Se usa el mock OFICIAL del paquete (`jest/mock`) en vez de uno propio: si el
 * día de mañana la librería agrega un hook, el mock de ellos lo trae y el
 * nuestro sería un archivo más que se desactualiza en silencio.
 *
 * Va acá y no en cada test a propósito: son 8 suites hoy y todas las pantallas
 * mañana.
 */
jest.mock('react-native-safe-area-context', () =>
  // `.default`: el mock del paquete exporta un objeto por default, no un
  // namespace. Sin esto el módulo queda envuelto y `SafeAreaView` llega
  // `undefined`, con un error que habla de imports mezclados y no de esto.
  require('react-native-safe-area-context/jest/mock').default);

/**
 * **El idioma del entorno de test es 'es', fijo.**
 *
 * `expo-localization` devuelve el idioma de la MÁQUINA que corre los tests, y
 * desde T-066 el formateo de plata sigue al idioma de la app. Sin fijarlo, un
 * aserto sobre «3.000» pasa en una máquina en español y falla en una en inglés
 * —donde da «3,000»—: el tipo de test que está verde acá y rojo en CI, por algo
 * que no tiene nada que ver con lo que el test prueba.
 *
 * Se mockea la FUENTE y no el resultado: fijar sólo el formateo dejaría el
 * idioma de i18n corriendo por su cuenta, y el init de i18n vuelve a pisar el
 * formateo al arrancar. Una sola perilla, sin carrera entre las dos.
 */
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'es', languageTag: 'es-AR', regionCode: 'AR' }],
  getCalendars: () => [{ timeZone: 'America/Argentina/Buenos_Aires' }],
}));
