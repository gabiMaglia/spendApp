import { createSecureStorage, SECURE_IDS } from '@/src/utils/secureStorage';
import { createStorage } from '@/src/utils/createStorage';
import { useAuthStore } from './authStore';

/**
 * Borra TODAS las cuentas y sus datos de este dispositivo.
 *
 * Es para volver a un teléfono en blanco durante el desarrollo: el índice de
 * identidad, los perfiles, la sesión y los datos de cada cuenta. Sin esto, para
 * probar el flujo de "primer login" hay que desinstalar la app.
 *
 * NO toca las preferencias de dispositivo (tema e idioma): no son de ninguna
 * cuenta y borrarlas sólo molesta.
 */

/** Lo que NO se borra: preferencias globales del dispositivo, no de una cuenta. */
const DEVICE_PREFS = ['theme', 'lang'] as const;

/** Storages en claro que sí son por-cuenta. */
const SCOPED_PLAIN = ['settings', 'tier'] as const;

export type WipeReport = {
  secureBuckets: number;
  plainBuckets: number;
};

export function wipeAllAccounts(): WipeReport {
  for (const id of SECURE_IDS) {
    createSecureStorage(id).clearAll();
  }
  for (const id of SCOPED_PLAIN) {
    createStorage(id).clearAll();
  }

  // La sesión en memoria también, o la UI sigue mostrando al usuario borrado.
  useAuthStore.setState({ currentUser: null, isPro: false, isLoading: false });

  return { secureBuckets: SECURE_IDS.length, plainBuckets: SCOPED_PLAIN.length };
}

export { DEVICE_PREFS };
