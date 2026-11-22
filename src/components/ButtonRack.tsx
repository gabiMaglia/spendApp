import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Spacing } from '@/src/constants/spacing';
import { useBaseInferior } from '@/src/hooks/useBaseInferior';

export interface ButtonRackProps {
  children: React.ReactNode;
  /**
   * `inline` (default) para racks dentro del contenido.
   *
   * **Para la botonera del pie NO se usa esto: se usa `FabRow` + `Fab`**
   * (decisión del PO, 2026-08-30 — "todas las botoneras del bottom van a ser
   * el fab flotante"). Ese patrón ya resuelve la posición flotante y el orden
   * secundario→primario. `bottom` queda para racks anclados que no floten y
   * toma su distancia al borde de `useBaseInferior` (T-281): la pantalla NO
   * debe sumar el inset con `SafeAreaView edges=['bottom']`.
   */
  placement?: 'bottom' | 'inline';
  /** `column` (default) apila; `row` reparte en la misma línea. */
  direction?: 'column' | 'row';
  style?: StyleProp<ViewStyle>;
}

/**
 * Contenedor de botones. **Toda botonera de la app pasa por acá.**
 *
 * Existe para que el espaciado y la posición no se re-decidan en cada pantalla:
 * antes cada una repetía su propio `paddingHorizontal` y su propio margen, así
 * que dos pantallas con la misma botonera se veían distintas y el margen
 * inferior dependía de quién la hubiera escrito.
 *
 * El margen inferior ya no es un 24 fijo: es la base de la píldora de pestañas
 * (T-281), así que botonera y barra quedan a la misma distancia del borde.
 */
export function ButtonRack({
  children, placement = 'bottom', direction = 'column', style,
}: ButtonRackProps) {
  const base = useBaseInferior();
  return (
    <View
      style={[
        styles.base,
        direction === 'row' ? styles.row : styles.column,
        placement === 'bottom' ? [styles.bottom, { marginBottom: base }] : styles.inline,
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

const styles = StyleSheet.create({
  base:   { gap: Spacing[2] },
  column: { flexDirection: 'column' },
  // En fila, cada botón se reparte el ancho por igual.
  row:    { flexDirection: 'row', alignItems: 'center' },
  /**
   * La botonera de una pantalla pone su propio aire lateral: nadie se lo da.
   *
   * `inline` NO lo pone, y es la diferencia entre las dos: se usa adentro de un
   * contenedor que YA tiene su padding —hoy, el cuerpo de un `BottomSheet`— y
   * repetirlo ahí daba el doble de margen que en el resto de la hoja.
   */
  bottom: { paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[3] },
  inline: { marginVertical: Spacing[3] },
  celda:  { flex: 1 },
});
