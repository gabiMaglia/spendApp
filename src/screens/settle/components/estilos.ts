import { StyleSheet } from 'react-native';

import { Radius } from '@/src/constants/spacing';

/** La caja de las dos bandas de Saldar (transferencia; grupo y fecha). */
export const estilos = StyleSheet.create({
  card: { borderRadius: Radius.xl, borderCurve: 'continuous', borderWidth: 1, overflow: 'hidden' },
  /**
   * Aero: la banda se dibuja como `Panel`, que ya pone fondo, radio y sombra.
   * Sin borde (salía negro: `borderWidth` sin color) y sin el margen lateral
   * ni el de arriba del panel — el scroll de Saldar ya pone los suyos, y
   * sumados quedaba más angosta y más separada que el resto (PO 2026-10-11).
   */
  cardAero: { marginHorizontal: 0, marginTop: 0 },
});
