import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { FilaCubo } from '@/src/components/menu/FilaCubo';
import { GAP_CUBOS, type Abanico } from '@/src/components/menu/calcularAbanico';
import type { OpcionCubo } from '@/src/components/menu/tipos';

/**
 * La columna de UNA apertura. Es dueña de lo que nace y muere con ella (el scroll,
 * las filas): se monta con `key` por apertura, así ninguna reapertura hereda estado
 * y nadie tiene que acordarse de resetearlo (T-283, N1).
 */
export function ColumnaAbanico<V>({
  geo, opciones, seleccionado, visible, sinAnimacion, tocable, onElegir, onClose,
  accessibilityLabel, testID,
}: {
  geo: Abanico;
  opciones: OpcionCubo<V>[];
  seleccionado?: V;
  visible: boolean;
  sinAnimacion: boolean;
  tocable: boolean;
  onElegir: (v: V) => void;
  onClose: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const scrollY = useSharedValue(0);
  return (
    <View
      testID={testID} accessibilityRole="menu" accessibilityLabel={accessibilityLabel}
      onAccessibilityEscape={onClose}
      pointerEvents={tocable ? 'auto' : 'none'}
      style={{ position: 'absolute', left: geo.left, top: geo.top, width: geo.ancho }}
    >
      <ScrollView
        scrollEnabled={geo.scrolla} bounces={false} showsVerticalScrollIndicator={false}
        style={{ maxHeight: geo.alto }} scrollEventThrottle={16}
        onScroll={e => { scrollY.value = Math.max(0, e.nativeEvent.contentOffset.y); }}
        contentContainerStyle={styles.columna}
      >
        {opciones.map((o, i) => (
          <FilaCubo
            key={String(o.valor)} indice={i} visible={visible} entrar sinAnimacion={sinAnimacion}
            opcion={o} scrollY={scrollY} seleccionado={o.valor === seleccionado} onPress={() => onElegir(o.valor)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  columna: { gap: GAP_CUBOS },
});
