import { useEffect, useState } from 'react';
import type { CurrencyCode } from '@/src/constants/currencies';
import { ensureRates, needsRates, readCache, type FxCache } from '@/src/services/fx';
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
 *
 * `loading` (T-109): true SOLO mientras hay un pedido de cotizaciones en
 * vuelo que hace falta de verdad (`needsRates`) y todavía no hay ninguna
 * cache — es la ventana en la que un total convertido puede saltar de un
 * valor parcial al real ("doble animación" reportada por el PO). Se apaga
 * apenas el pedido resuelve, ÉXITO O FRACASO: si sigue sin cache después de
 * eso, es un fallo real de red, no algo "pendiente", y la pantalla vuelve al
 * aviso de siempre (`UnconvertedNotice`) en vez de quedarse en `--` para
 * siempre.
 */
export function useFx(): { fx: FxCache | null; display: CurrencyCode; loading: boolean } {
  const display = useSettingsStore(s => s.displayCurrency);
  const monedasEnUso = useCurrenciesInUse();
  const [fx, setFx] = useState<FxCache | null>(() => readCache());
  const [loading, setLoading] = useState(() => needsRates(monedasEnUso, display) && !fx);

  useEffect(() => {
    let vivo = true;
    if (needsRates(monedasEnUso, display) && !readCache()) setLoading(true);
    void ensureRates(monedasEnUso, display).then(r => {
      if (!vivo) return;
      setFx(r);
      setLoading(false);
    });
    return () => { vivo = false; };
  }, [monedasEnUso, display]);

  return { fx, display, loading };
}
