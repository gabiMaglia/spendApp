import { useState } from 'react';

import type { CurrencyCode } from '@/src/constants/currencies';
import { useSettingsStore } from '@/src/store/settingsStore';

/**
 * Moneda con la que nace el gasto (T-255, regla 7).
 *
 * Con grupo manda la del grupo y no se toca. Sin grupo (gasto/ingreso
 * personal) el usuario la elige; si no eligió, se propone la del último gasto
 * personal y, si nunca hubo uno, la de pantalla. Se lee `displayCurrency` del
 * store y no `useFx()`: es el mismo valor y no hace falta pedir cotizaciones
 * para decidir una moneda.
 */
export function useMonedaDelGasto(groupId: string, groupCurrency: CurrencyCode | undefined) {
  const ultima = useSettingsStore(s => s.lastPersonalCurrency);
  const pantalla = useSettingsStore(s => s.displayCurrency);

  const [elegida, setElegida] = useState<CurrencyCode | null>(null);
  // Lo elegido vale para «Sin grupo»; cambiar de grupo lo descarta y se vuelve
  // al default (ajuste durante el render para no pintar un cuadro con la
  // moneda vieja).
  const [grupoPrevio, setGrupoPrevio] = useState(groupId);
  if (grupoPrevio !== groupId) {
    setGrupoPrevio(groupId);
    setElegida(null);
  }

  // Un grupo que ya no existe sigue siendo «con grupo»: no se elige moneda
  // (guardar igual queda bloqueado, porque no hay miembros).
  const editable = groupId === '';
  const currency: CurrencyCode = editable
    ? elegida ?? ultima ?? pantalla
    : groupCurrency ?? pantalla;

  return { currency, setCurrency: setElegida, editable };
}
