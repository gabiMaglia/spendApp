import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { createStorage } from '@/src/utils/createStorage';
import { setFormatLanguage } from '@/src/constants/currencies';
import en from './locales/en.json';
import es from './locales/es.json';
import pt from './locales/pt.json';

export type SupportedLanguage = 'es' | 'en' | 'pt';
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['es', 'en', 'pt'];

// Compartido con src/store/langStore.ts (misma fuente de verdad de la preferencia).
export const LANG_STORAGE_KEY = 'app_language';
const langStorage = createStorage('lang');

/** Idioma del dispositivo si es uno de los soportados; si no, español. */
export function detectDeviceLanguage(): SupportedLanguage {
  const code = getLocales()[0]?.languageCode ?? 'es';
  return SUPPORTED_LANGUAGES.includes(code as SupportedLanguage)
    ? (code as SupportedLanguage)
    : 'es';
}

/** Preferencia fija persistida por el usuario, o null si eligió 'auto'/nunca eligió. */
export function readPersistedLanguage(): SupportedLanguage | null {
  const raw = langStorage.getString(LANG_STORAGE_KEY);
  return raw && SUPPORTED_LANGUAGES.includes(raw as SupportedLanguage)
    ? (raw as SupportedLanguage)
    : null;
}

/** Idioma con el que arranca la app: preferencia fija > idioma del dispositivo. */
export function resolveInitialLanguage(): SupportedLanguage {
  return readPersistedLanguage() ?? detectDeviceLanguage();
}

i18n.use(initReactI18next).init({
  resources: { es: { translation: es }, en: { translation: en }, pt: { translation: pt } },
  lng: resolveInitialLanguage(),
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
  compatibilityJSON: 'v4',
});

/**
 * El formateo de plata sigue al idioma (T-066).
 *
 * Va acá y no en `langStore` porque `langStore` es UNO de los caminos que
 * cambian el idioma —el otro es el arranque, con la preferencia persistida o la
 * del dispositivo— y el evento de i18next cubre los dos. Cablearlo en el store
 * dejaría el arranque sin sincronizar y nadie lo notaría: el default es 'es' y
 * la mayoría de los usuarios están en 'es'.
 */
function sincronizarFormatoDeMoneda(lng: string): void {
  const idioma = SUPPORTED_LANGUAGES.includes(lng as SupportedLanguage)
    ? (lng as SupportedLanguage)
    : 'es';
  setFormatLanguage(idioma);
}

sincronizarFormatoDeMoneda(i18n.language);
i18n.on('languageChanged', sincronizarFormatoDeMoneda);

export default i18n;
