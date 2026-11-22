import React from 'react';
import { useTranslation } from 'react-i18next';
import type { View } from 'react-native';

import { AbanicoCubos } from '@/src/components/menu/AbanicoCubos';
import type { OpcionCubo } from '@/src/components/menu/tipos';
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '@/src/constants/currencies';
import { useSkin } from '@/src/skins/useSkin';
import { hapticSeleccionar } from '@/src/utils/haptics';

/**
 * El abanico de monedas del gasto personal (T-286): una cápsula por moneda con
 * su símbolo en el cubo y «CODE · nombre». Hermano de `CuboCategoria`; el `t()`
 * vive acá y el abanico recibe las opciones ya traducidas.
 */
export function AbanicoMoneda({
  visible, onClose, ancla, value, onChange,
}: {
  visible: boolean;
  onClose: () => void;
  ancla: React.RefObject<View | null>;
  value: CurrencyCode;
  onChange: (code: CurrencyCode) => void;
}) {
  const { t } = useTranslation();
  const { skin } = useSkin();

  const opciones: OpcionCubo<CurrencyCode>[] = SUPPORTED_CURRENCIES.map(m => ({
    valor: m.code, texto: m.symbol, tinte: skin.colors.brand.primary,
    etiqueta: `${m.code} · ${t(`currency_names.${m.code}`)}`,
  }));

  const elegir = (code: CurrencyCode) => {
    if (code !== value) hapticSeleccionar();
    onChange(code);
  };

  return (
    <AbanicoCubos
      visible={visible} onClose={onClose} ancla={ancla}
      opciones={opciones} seleccionado={value} onElegir={elegir}
      accessibilityLabel={t('expense.currency_title')} etiquetaCerrar={t('common.close')}
      testID="selector-moneda"
    />
  );
}
