import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Spacing } from '@/src/constants/spacing';

export interface ButtonRackProps {
  children: React.ReactNode;
  /**
   * `bottom` (default) pega la botonera al pie de la pantalla, con el padding
   * lateral de siempre y **24 de margen inferior** — la regla del PO para toda
   * pantalla con botonera abajo. Va FUERA del ScrollView: la acción principal
   * no puede depender de cuánto scrolleaste.
   *
   * `inline` es para racks que viven dentro del contenido.
   */
  placement?: 'bottom' | 'inline';
  /** `column` (default) apila; `row` reparte en la misma línea. */
  direction?: 'column' | 'row';
  style?: ViewStyle;
}

/**
 * Contenedor de botones. **Toda botonera de la app pasa por acá.**
 *
 * Existe para que el espaciado y la posición no se re-decidan en cada pantalla:
 * antes cada una repetía su propio `paddingHorizontal` y su propio margen, así
 * que dos pantallas con la misma botonera se veían distintas y el margen
 * inferior dependía de quién la hubiera escrito.
 *
 * El margen de 24 vive acá y en un solo lugar: si el PO lo cambia, cambia en
 * toda la app de una.
 */
export function ButtonRack({
  children, placement = 'bottom', direction = 'column', style,
}: ButtonRackProps) {
  return (
    <View
      style={[
        styles.base,
        direction === 'row' ? styles.row : styles.column,
        placement === 'bottom' ? styles.bottom : styles.inline,
        style,
      ]}
    >
      {/* En fila, cada botón se lleva la misma porción del ancho. Se resuelve
          acá y no en cada pantalla: si lo decidiera quien la escribe, dos
          pantallas con la misma botonera terminarían con anchos distintos.
          Admite varios primary y varios secondary sin cambiar nada. */}
      {direction === 'row'
        ? React.Children.map(children, hijo =>
            hijo == null ? null : <View style={styles.celda}>{hijo}</View>)
        : children}
    </View>
  );
}

const MARGEN_INFERIOR = 24; // regla del PO, 2026-08-30

const styles = StyleSheet.create({
  base:   { paddingHorizontal: Spacing.screenPad, gap: Spacing[2] },
  column: { flexDirection: 'column' },
  // En fila, cada botón se reparte el ancho por igual.
  row:    { flexDirection: 'row', alignItems: 'center' },
  bottom: { paddingTop: Spacing[3], marginBottom: MARGEN_INFERIOR },
  inline: { marginVertical: Spacing[3] },
  celda:  { flex: 1 },
});
