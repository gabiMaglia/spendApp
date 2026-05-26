import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import es from './locales/es.json';
import pt from './locales/pt.json';

export type SupportedLanguage = 'es' | 'en' | 'pt';
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['es', 'en', 'pt'];

function detectLanguage(): SupportedLanguage {
  const deviceLocale = getLocales()[0]?.languageCode ?? 'es';
  if (SUPPORTED_LANGUAGES.includes(deviceLocale as SupportedLanguage)) {
    return deviceLocale as SupportedLanguage;
  }
  return 'es';
}

i18n.use(initReactI18next).init({
  resources: { es: { translation: es }, en: { translation: en }, pt: { translation: pt } },
  lng: detectLanguage(),
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
  compatibilityJSON: 'v4',
});

export default i18n;
