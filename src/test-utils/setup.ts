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
        clearAll: () => store.clear(),
        recrypt: (_key?: string) => {},
      };
    }),
  };
});

// expo-crypto: bytes deterministas para tests (256-bit)
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (n: number) =>
    new Uint8Array(Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256)),
}));

// expo-secure-store: mock simple
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
