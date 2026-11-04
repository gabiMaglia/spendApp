import React, { useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import type { CurrencyCode } from '@/src/constants/currencies';
import { CurrencySheet } from '@/src/components/CurrencyPicker';

/**
 * Badge de moneda del gasto, compartido por la tarjeta Aero y el héroe Clásico.
 * Sin `onChange` (gasto de grupo: la moneda es la del grupo, regla 7) es un
 * contenedor inerte; con `onChange` (gasto personal) es un botón que abre la
 * hoja con las monedas soportadas. Los textos llegan traducidos de afuera.
 */
export function MonedaTocable({
  currency, onChange, label, title, style, children,
}: {
  currency: CurrencyCode;
  onChange?: (code: CurrencyCode) => void;
  label: string;
  title: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const [abierta, setAbierta] = useState(false);

  if (!onChange) return <View style={style}>{children}</View>;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setAbierta(true)}
        style={style}
      >
        {children}
      </Pressable>
      <CurrencySheet
        visible={abierta}
        value={currency}
        onChange={onChange}
        onClose={() => setAbierta(false)}
        title={title}
      />
    </>
  );
}
