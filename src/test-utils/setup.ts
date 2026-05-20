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

// MMKV: mock en memoria para tests
jest.mock('react-native-mmkv', () => {
  const store = new Map<string, string | number | boolean>();
  return {
    MMKV: jest.fn().mockImplementation(() => ({
      set: (key: string, value: string | number | boolean) => store.set(key, value),
      getString: (key: string) => store.get(key) as string | undefined,
      getNumber: (key: string) => store.get(key) as number | undefined,
      getBoolean: (key: string) => store.get(key) as boolean | undefined,
      delete: (key: string) => store.delete(key),
      contains: (key: string) => store.has(key),
      clearAll: () => store.clear(),
    })),
  };
});

// expo-secure-store: mock simple
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
