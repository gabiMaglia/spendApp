import Constants from 'expo-constants';

/**
 * La versión que la app muestra en «Yo».
 *
 * Estaba hardcodeada como `'1.0.0'` en `app/(tabs)/user.tsx`. El perfil
 * `production` de `eas.json` tiene `autoIncrement`, así que la versión real
 * sube en cada build y la pantalla iba a seguir diciendo 1.0.0 para siempre.
 *
 * **Eso no es cosmética:** el número que el usuario copia en un reporte de bug
 * es el único dato que dice contra qué build estaba. Si miente, el reporte no
 * sirve — y es el primer lugar donde uno mira cuando algo anda mal en un
 * teléfono al que no tiene acceso.
 *
 * `expoConfig` puede faltar en algunos contextos (tests, arranques raros), así
 * que hay un fallback explícito en vez de imprimir `undefined` en la pantalla.
 */
export const APP_VERSION: string = Constants.expoConfig?.version ?? '—';
