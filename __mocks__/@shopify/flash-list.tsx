import React from 'react';
import { View } from 'react-native';

/**
 * Mock de Jest para @shopify/flash-list v2 (T-154): jsdom no mide layout
 * real, así que FlashList real no puede decidir su ventana de recorte. Este
 * mock renderiza TODOS los items de `data` (no recorta) — la métrica de
 * T-154/T-216 (nodos host montados) mide el árbol que el PRODUCTO arma por
 * fila (aplanado, sin envoltorios de sección extra fuera de la lista), no
 * el reciclado nativo de la ventana visible, que sólo se puede medir en
 * dispositivo real (T-216 pregunta 2, pendiente de medición en Moto).
 */
export function FlashList(props: any) {
  const {
    data, renderItem, keyExtractor, ListHeaderComponent, ListEmptyComponent,
    ListFooterComponent, onScroll, onLayout, style, contentContainerStyle,
  } = props;

  const asElement = (C: any) => (C ? (React.isValidElement(C) ? C : React.createElement(C)) : null);

  const header = asElement(ListHeaderComponent);
  const footer = asElement(ListFooterComponent);
  const isEmpty = !data || data.length === 0;
  const empty = isEmpty ? asElement(ListEmptyComponent) : null;

  return (
    <View testID="flash-list-mock" style={style} onLayout={onLayout}>
      {header}
      {empty}
      {!isEmpty && data.map((item: any, index: number) => (
        <View key={keyExtractor ? keyExtractor(item, index) : index}>
          {renderItem({ item, index, target: 'Cell' })}
        </View>
      ))}
      {footer}
    </View>
  );
}

export const AnimatedFlashList = FlashList;
export default { FlashList, AnimatedFlashList };
