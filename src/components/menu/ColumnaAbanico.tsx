import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { FundidoBorde } from '@/src/components/menu/FundidoBorde';
import { FilaCubo } from '@/src/components/menu/FilaCubo';
import { GAP_CUBOS, PAD_SOMBRA, type Abanico } from '@/src/components/menu/calcularAbanico';
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
  const scroll = useRef<ScrollView>(null);
  // Con la entrada asentada el indicador destella: es lo que avisa que hay más abajo.
  useEffect(() => {
    if (tocable && geo.scrolla) scroll.current?.flashScrollIndicators();
  }, [tocable, geo.scrolla]);
  return (
    <View
      testID={testID} accessibilityRole="menu" accessibilityLabel={accessibilityLabel}
      onAccessibilityEscape={onClose}
      pointerEvents={tocable ? 'auto' : 'none'}
      style={{ position: 'absolute', left: geo.left, top: geo.top, width: geo.ancho }}
    >
      {/* Ventana de alto fijo y recortada: nunca se ve más que VISIBLES filas. Se abre a la
          izquierda hasta el cubo original para no cortar la cápsula en su viaje de entrada. */}
      <View
        testID={testID ? `${testID}-ventana` : undefined}
        style={{
          height: geo.alto + 2 * PAD_SOMBRA, marginTop: -PAD_SOMBRA, marginLeft: geo.desdeX,
          width: geo.ancho - geo.desdeX, overflow: 'hidden',
        }}
      >
      <ScrollView
        ref={scroll} scrollEnabled={geo.scrolla} bounces={false} showsVerticalScrollIndicator={geo.scrolla}
        style={{ flex: 1 }} scrollEventThrottle={16}
        onScroll={e => { scrollY.value = Math.max(0, e.nativeEvent.contentOffset.y); }}
        contentContainerStyle={[styles.columna, { paddingLeft: -geo.desdeX }]}
      >
        {opciones.map((o, i) => (
          <FilaCubo
            key={String(o.valor)} indice={i} desdeX={geo.desdeX} testID={testID} visible={visible} entrar sinAnimacion={sinAnimacion}
            opcion={o} scrollY={scrollY} seleccionado={o.valor === seleccionado} onPress={() => onElegir(o.valor)}
          />
        ))}
      </ScrollView>
      </View>
      {geo.scrolla && (
        <FundidoBorde
          scrollY={scrollY} maxScroll={geo.altoColumna - geo.alto} testID={testID ? `${testID}-fundido` : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  columna: { gap: GAP_CUBOS, paddingVertical: PAD_SOMBRA },
});
