import React from 'react';
import { View } from 'react-native';

/**
 * Mock de Jest para @shopify/flash-list v2 (T-154): jsdom no mide layout
 * real, así que FlashList real no puede decidir su ventana de recorte por sí
 * sola en un test. FlashList v2 no tiene `initialNumToRender`/`windowSize`
 * (confirmado en `FlashListProps.d.ts` — no existen en v2, sólo en v1), así
 * que este mock simula la ventana con una constante propia
 * (`VENTANA_SIMULADA`): renderiza el header + los primeros N ítems del array
 * aplanado, igual que un `FlatList`/`FlashList` real montado en pantalla
 * renderiza sólo lo visible + el draw distance, nunca el dataset completo.
 * La métrica T-154/T-216 (nodos host) mide ESE árbol acotado — el ahorro
 * real es justamente no montar los ~230 eventos de una vez, que es lo que
 * hacía el `.map()` de antes. El reciclado nativo real (qué pasa scrolleando)
 * sólo se puede medir en dispositivo (T-216 pregunta 2, pendiente).
 */
const VENTANA_SIMULADA = 20;

export function FlashList(props: any) {
  const {
    data, renderItem, keyExtractor, ListHeaderComponent, ListEmptyComponent,
    ListFooterComponent, onLayout, style,
  } = props;

  const asElement = (C: any) => (C ? (React.isValidElement(C) ? C : React.createElement(C)) : null);

  const header = asElement(ListHeaderComponent);
  const footer = asElement(ListFooterComponent);
  const isEmpty = !data || data.length === 0;
  const empty = isEmpty ? asElement(ListEmptyComponent) : null;
  const visibles = isEmpty ? [] : data.slice(0, VENTANA_SIMULADA);

  return (
    <View testID="flash-list-mock" style={style} onLayout={onLayout}>
      {header}
      {empty}
      {visibles.map((item: any, index: number) => (
        // Fragment, no View: un `CellContainer` real sí agrega un host node
        // por celda, pero acá no queremos que el propio MOCK infle la
        // métrica que mide el árbol del PRODUCTO — con Fragment, contar
        // nodos host mide sólo lo que `renderItem` devuelve.
        <React.Fragment key={keyExtractor ? keyExtractor(item, index) : index}>
          {renderItem({ item, index, target: 'Cell' })}
        </React.Fragment>
      ))}
      {footer}
    </View>
  );
}

export const AnimatedFlashList = FlashList;
export default { FlashList, AnimatedFlashList };
