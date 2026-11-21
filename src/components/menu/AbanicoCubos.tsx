import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilaCubo } from '@/src/components/menu/FilaCubo';
import { VeloMenu } from '@/src/components/menu/VeloMenu';
import { GAP_CUBOS, calcularAbanico } from '@/src/components/menu/calcularAbanico';
import { useAnimacionMenu } from '@/src/components/menu/useAnimacionMenu';
import { useEleccionUnica } from '@/src/components/menu/useEleccionUnica';
import { useRectAncla } from '@/src/components/menu/useRectAncla';
import type { OpcionCubo } from '@/src/components/menu/tipos';

/** Lo que tarda la entrada en asentar: hasta entonces los cubos no reciben toques. */
export const ASENTAR_MS = 260;

export type AbanicoCubosProps<V> = {
  visible: boolean;
  onClose: () => void;
  /** El cubo original: el primer cubo del abanico cae exactamente sobre su rect. */
  ancla: React.RefObject<View | null>;
  opciones: OpcionCubo<V>[];
  seleccionado?: V;
  onElegir: (v: V) => void;
  accessibilityLabel: string;
  /** Etiqueta (ya traducida) del velo, que para el lector de pantalla es el botón «cerrar». */
  etiquetaCerrar: string;
  testID?: string;
};

/**
 * Columna de cubos que sale del cubo de la tarjeta (T-283). Sin recuadro: cubos
 * flotando sobre el velo. Comparte con `MenuAnclado` el velo, el guard de
 * elección, la medición del ancla y el desmontaje, no la forma.
 */
export function AbanicoCubos<V>({
  visible, onClose, ancla, opciones, seleccionado, onElegir, accessibilityLabel, etiquetaCerrar, testID,
}: AbanicoCubosProps<V>) {
  const ventana = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const rect = useRectAncla({ visible, ancla, onCerrar: onClose });
  const geo = rect ? calcularAbanico(rect, ventana, insets, opciones.length) : null;

  const { montado, sinAnimacion, estiloVelo } = useAnimacionMenu({ visible, listo: !!geo, lado: undefined });
  // Durante la apertura el cubo 0 está invisible justo sobre el ancla: un segundo toque
  // del doble toque no puede elegirlo. Se toca recién con la entrada asentada.
  const [asentado, setAsentado] = useState(false);
  useEffect(() => {
    if (!visible || !geo) { setAsentado(false); return; }
    const id = setTimeout(() => setAsentado(true), ASENTAR_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, !!geo]);
  const scrollY = useSharedValue(0);
  const tocable = visible && !!geo && asentado;
  const elegir = useEleccionUnica<V>({ visible, tocable, onElegir, onClose });

  if (!montado) return null;

  return (
    <Modal
      transparent animationType="none" onRequestClose={onClose}
      statusBarTranslucent navigationBarTranslucent
    >
      <VeloMenu
        visible={visible} estilo={estiloVelo} onClose={onClose} etiquetaCerrar={etiquetaCerrar}
        testID={testID ? `${testID}-velo` : undefined}
      />
      {geo && (
        <View
          testID={testID} accessibilityRole="menu" accessibilityLabel={accessibilityLabel}
          onAccessibilityEscape={onClose}
          pointerEvents={tocable ? 'auto' : 'none'}
          style={{ position: 'absolute', left: geo.left, top: geo.top, width: geo.ancho }}
        >
          <ScrollView
            scrollEnabled={geo.scrolla} bounces={false} showsVerticalScrollIndicator={false}
            style={{ maxHeight: geo.alto }}
            scrollEventThrottle={16}
            onScroll={e => { scrollY.value = Math.max(0, e.nativeEvent.contentOffset.y); }} contentContainerStyle={styles.columna}
          >
            {opciones.map((o, i) => (
              <FilaCubo
                key={String(o.valor)} indice={i} visible={visible} entrar sinAnimacion={sinAnimacion}
                opcion={o} scrollY={scrollY} seleccionado={o.valor === seleccionado} onPress={() => elegir(o.valor)}
              />
            ))}
          </ScrollView>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  columna: { gap: GAP_CUBOS },
});
