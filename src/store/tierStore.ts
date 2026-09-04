import { create } from 'zustand';
import { createStorage } from '@/src/utils/createStorage';

const storage = createStorage('tier');

const FREE_DAILY_FREE_EXPENSES = 4;

/**
 * **¿Existe un sistema de anuncios en esta build?**
 *
 * Hoy NO: `react-native-google-mobile-ads` no está instalado y no hay app id de
 * AdMob en la config. La regla de negocio #6 está escrita —4 gastos gratis por
 * día, del 5to en adelante un anuncio recompensado— pero la mitad que le da
 * salida al usuario nunca se construyó.
 *
 * Mientras esto sea `false`, **el tope NO bloquea**. El contador sigue contando
 * y la regla queda entera: lo único que no se hace es cerrar una puerta que
 * nadie puede cruzar.
 *
 * El motivo es concreto y no es filosofía: hasta hoy, del 5to gasto del día en
 * adelante el botón decía «Ver anuncio y guardar», el usuario lo tocaba y
 * `handleSave` hacía `if (needsAd) return` — **no pasaba nada, nunca**. La app
 * dejaba de poder guardar gastos, en silencio, y sin ninguna forma de seguir.
 * Un tope que no se puede satisfacer no es un tope: es la app rota.
 *
 * El día que AdMob entre, esto pasa a `true` y todo lo demás ya está. Hay un
 * test que se cae si alguien lo enciende sin haber conectado un anuncio.
 */
export const ADS_DISPONIBLES = false;

/**
 * ¿Existe el plan Pro? Hoy NO, y la UI no debe ofrecerlo.
 *
 * Mismo criterio que `ADS_DISPONIBLES`, por el mismo motivo: **no se le ofrece
 * al usuario una puerta que no lleva a ningún lado.** El botón «Probar Pro
 * gratis» de la pantalla Yo era un `Pressable` SIN `onPress` — se tocaba y no
 * pasaba nada. Y aunque se cableara, no habría a dónde ir: no hay compras
 * in-app ni ninguna forma de cobrar en el proyecto.
 *
 * Decisión del PO (2026-09-03): el lanzamiento es **gratis, sin ads y sin Pro**.
 * Monetizar sin usuarios agrega integraciones y revisiones de tienda a cambio
 * de nada.
 *
 * El día que exista una forma de pagar, esto pasa a `true` y la sección vuelve.
 * El test de `tierStore` se cae si alguien lo enciende sin eso.
 */
export const PRO_DISPONIBLE = false;

/**
 * La clave del día, en hora LOCAL.
 *
 * Antes usaba `toISOString()`, que es UTC: para el PO (UTC−3) el contador se
 * reiniciaba **a las 21:00**, no a medianoche. Cuatro gastos a las 20:00 y otros
 * cuatro a las 21:30 eran «dos días» para la app y el mismo día para él.
 */
function todayKey(userId: string, now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `expense_count_${userId}_${y}-${m}-${d}`;
}

/** Cuántos gastos lleva hoy. Expuesta para poder testear el corte del día. */
export function dailyCountAt(userId: string, now: Date): number {
  const raw = storage.getString(todayKey(userId, now));
  return raw ? parseInt(raw, 10) : 0;
}

/**
 * ¿Este gasto necesita un anuncio para poder guardarse?
 *
 * Con `ADS_DISPONIBLES` en `false` devuelve siempre `false`: ver
 * `ADS_DISPONIBLES`. Lo que decide si el usuario ya pasó el tope —y lo que la
 * UI usa para contarle en qué anda— es `superoElTope`.
 */
interface TierState {
  getDailyCount: (userId: string) => number;
  /** Pasó los 4 del día. Es la REGLA, independiente de si hay anuncios. */
  superoElTope: (userId: string, isPro: boolean) => boolean;
  /** Hay que mostrar un anuncio antes de guardar. Hoy siempre `false`. */
  requiresRewardedAd: (userId: string, isPro: boolean) => boolean;
  incrementCount: (userId: string, now?: Date) => void;
}

export const useTierStore = create<TierState>(() => ({
  getDailyCount: (userId) => dailyCountAt(userId, new Date()),

  superoElTope: (userId, isPro) => {
    if (isPro) return false;
    return dailyCountAt(userId, new Date()) >= FREE_DAILY_FREE_EXPENSES;
  },

  requiresRewardedAd: (userId, isPro) => {
    // La puerta sólo se cierra si existe la llave.
    if (!ADS_DISPONIBLES) return false;
    if (isPro) return false;
    return dailyCountAt(userId, new Date()) >= FREE_DAILY_FREE_EXPENSES;
  },

  incrementCount: (userId, now = new Date()) => {
    const key = todayKey(userId, now);
    const current = storage.getString(key);
    const count = current ? parseInt(current, 10) : 0;
    storage.set(key, String(count + 1));
  },
}));
