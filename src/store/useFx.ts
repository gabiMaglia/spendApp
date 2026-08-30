import { useEffect, useState } from 'react';
import type { CurrencyCode } from '@/src/constants/currencies';
import { ensureRates, readCache, type FxCache } from '@/src/services/fx';
import { useCurrenciesInUse } from './currenciesInUse';
import { useSettingsStore } from './settingsStore';

/**
 * Cotizaciones vigentes + la moneda en la que el usuario quiere ver sus totales.
 *
 * Vive acá y no en cada pantalla porque el mismo bloque estaba repetido en el
 * dashboard, en Amigos y en Grupos — y las tres, además, tenían `'ARS'`
 * hardcodeado, así que a cualquiera que no usara pesos argentinos le mostraban
 * 0 para siempre. Un solo lugar donde se resuelve evita que la próxima
 * pantalla repita el error.
 *
 * Stale-while-revalidate: devuelve la cache al instante y actualiza cuando la
 * red responde. No sale a la red si el usuario usa una sola moneda.
 */
export function useFx(): { fx: FxCache | null; display: CurrencyCode } {
  const display = useSettingsStore(s => s.displayCurrency);
  const monedasEnUso = useCurrenciesInUse();
  const [fx, setFx] = useState<FxCache | null>(() => readCache());

  useEffect(() => {
    let vivo = true;
    void ensureRates(monedasEnUso, display).then(r => { if (vivo) setFx(r); });
    return () => { vivo = false; };
  }, [monedasEnUso, display]);

  return { fx, display };
}
