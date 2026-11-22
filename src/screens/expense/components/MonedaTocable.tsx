import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import type { CurrencyCode } from '@/src/constants/currencies';
import { CurrencySheet } from '@/src/components/CurrencyPicker';
import { useAbanicoAnclado } from '@/src/components/menu/useAbanicoAnclado';
import { AbanicoMoneda } from '@/src/screens/expense/components/AbanicoMoneda';

/**
 * Badge de moneda del gasto, compartido por la tarjeta Aero y el héroe Clásico.
 * Sin `onChange` (gasto de grupo: la moneda es la del grupo, regla 7) es un
 * contenedor inerte; con `onChange` (gasto personal) es un botón: en Aero
 * (`abanico`) despliega las monedas como cubos (T-286), en Clásico abre la hoja.
 * Los textos llegan traducidos de afuera.
 */
export function MonedaTocable({
  currency, onChange, label, title, style, abanico, children,
}: {
  currency: CurrencyCode;
  onChange?: (code: CurrencyCode) => void;
  label: string;
  title: string;
  style?: StyleProp<ViewStyle>;
  abanico?: boolean;
  children: React.ReactNode;
}) {
  const { ancla, abierto, abrir, cerrar } = useAbanicoAnclado();

  if (!onChange) return <View style={style}>{children}</View>;
  return (
    <>
      <Pressable
        ref={ancla}
        collapsable={false}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={abanico ? { expanded: abierto } : undefined}
        onPress={abrir}
        style={style}
      >
        {children}
      </Pressable>
      {abanico ? (
        <AbanicoMoneda visible={abierto} onClose={cerrar} ancla={ancla} value={currency} onChange={onChange} />
      ) : (
        <CurrencySheet visible={abierto} value={currency} onChange={onChange} onClose={cerrar} title={title} />
      )}
    </>
  );
}
