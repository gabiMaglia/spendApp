import { create } from 'zustand';
import { createStorage } from '@/src/utils/createStorage';
import i18n, {
  LANG_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  detectDeviceLanguage,
  type SupportedLanguage,
} from '@/src/i18n';

const storage = createStorage('lang');

// 'auto' = seguir el idioma del dispositivo (no persiste un idioma fijo).
export type LanguageChoice = 'auto' | SupportedLanguage;

interface LangState {
  /** Lo que eligió el usuario: 'auto' o un idioma fijo. */
  choice: LanguageChoice;
  /** Idioma efectivamente activo en i18next (nunca 'auto'). */
  active: SupportedLanguage;
  setLanguage: (choice: LanguageChoice) => void;
  hydrate: () => void;
}

function readPersistedChoice(): LanguageChoice {
  const raw = storage.getString(LANG_STORAGE_KEY);
  return raw && SUPPORTED_LANGUAGES.includes(raw as SupportedLanguage)
    ? (raw as SupportedLanguage)
    : 'auto';
}

// MMKV es sincrónico: leemos la preferencia al crear el store (no en useEffect)
// para que el primer render ya use el idioma correcto. Factory exportada para
// que los tests creen una instancia fresca tras escribir en storage.
export function createLangStore() {
  return create<LangState>((set) => ({
    choice: readPersistedChoice(),
    active: (i18n.language as SupportedLanguage) ?? 'es',

    setLanguage: (choice) => {
      if (choice === 'auto') {
        storage.delete(LANG_STORAGE_KEY);
      } else {
        storage.set(LANG_STORAGE_KEY, choice);
      }
      const target: SupportedLanguage =
        choice === 'auto' ? detectDeviceLanguage() : choice;
      void i18n.changeLanguage(target);
      set({ choice, active: target });
    },

    hydrate: () => {},
  }));
}

export const useLangStore = createLangStore();
