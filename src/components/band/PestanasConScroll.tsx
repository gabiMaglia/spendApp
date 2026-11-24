import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView, StyleSheet, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { FundidoBorde } from '@/src/components/menu/FundidoBorde';
import { DURACION } from '@/src/constants/movimiento';
import { useAnimacionesReducidas } from '@/src/hooks/useAnimacionesReducidas';

type Medida = { x: number; ancho: number };

/**
 * Fila de pestañas deslizable en X (T-305). Suma dos cosas al ScrollView pelado:
 * un fundido en el borde que tiene más pestañas fuera de la vista, y que la elegida
 * se traiga sola al centro (sin animar al montar, animada al cambiar).
 * `children` recibe el medidor de cada pestaña (`onLayout` por clave).
 */
export function PestanasConScroll({ value, fondo, contentContainerStyle, children }: {
  value: string;
  /** Color del fondo sobre el que están las pestañas: el fundido se funde con ese. */
  fondo: string;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children: (medir: (clave: string) => (e: LayoutChangeEvent) => void) => React.ReactNode;
}) {
  const ref = useRef<ScrollView>(null);
  const x = useSharedValue(0);
  const [ventana, setVentana] = useState(0);
  const [contenido, setContenido] = useState(0);
  // Qué bordes tienen más pestañas fuera: sólo cambia de estado al cruzar el extremo,
  // no en cada frame del scroll.
  const [bordes, setBordes] = useState({ izq: false, der: true });
  const medidas = useRef<Record<string, Medida>>({});
  const pendiente = useRef(true);
  const primera = useRef(true);
  const reducidas = useAnimacionesReducidas();

  const intentar = useCallback(() => {
    const m = medidas.current[value];
    if (!pendiente.current || !m || ventana <= 0) return;
    const tope = contenido > 0 ? Math.max(0, contenido - ventana) : Infinity;
    const destino = Math.min(tope, Math.max(0, m.x + m.ancho / 2 - ventana / 2));
    ref.current?.scrollTo({ x: destino, animated: !primera.current && reducidas === false });
    pendiente.current = false;
    primera.current = false;
  }, [value, ventana, contenido, reducidas]);

  useEffect(() => { pendiente.current = true; intentar(); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { intentar(); }, [intentar]);

  const medir = (clave: string) => (e: LayoutChangeEvent) => {
    const { x: px, width } = e.nativeEvent.layout;
    medidas.current[clave] = { x: px, ancho: width };
    intentar();
  };

  const maxScroll = Math.max(0, contenido - ventana);
  const hayMas = ventana > 0 && maxScroll > 1;

  return (
    <>
      <ScrollView
        ref={ref}
        testID="segmented-tabs-scroll"
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        contentContainerStyle={contentContainerStyle}
        onLayout={e => setVentana(e.nativeEvent.layout.width)}
        onContentSizeChange={w => setContenido(w)}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          const px = e.nativeEvent.contentOffset.x;
          x.value = px;
          const izq = px > 1;
          const der = px < maxScroll - 1;
          setBordes(b => (b.izq === izq && b.der === der ? b : { izq, der }));
        }}
      >
        {children(medir)}
      </ScrollView>
      {hayMas && (
        <>
          <FundidoAnimado visible={bordes.izq} reducidas={reducidas === true} testID="segmented-fundido-izquierda">
            <FundidoBorde horizontal alIzquierda scrollY={x} maxScroll={maxScroll} color={fondo} />
          </FundidoAnimado>
          <FundidoAnimado visible={bordes.der} reducidas={reducidas === true} testID="segmented-fundido-derecha">
            <FundidoBorde horizontal scrollY={x} maxScroll={maxScroll} color={fondo} />
          </FundidoAnimado>
        </>
      )}
    </>
  );
}

/**
 * Prende/apaga el fundido con un fade corto en vez de a golpe. `visible` queda en
 * `accessibilityElementsHidden` (invertido) para que sea observable sin leer la animación.
 */
function FundidoAnimado({ visible, reducidas, testID, children }: {
  visible: boolean; reducidas: boolean; testID: string; children: React.ReactNode;
}) {
  const opacidad = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    opacidad.value = reducidas ? (visible ? 1 : 0) : withTiming(visible ? 1 : 0, { duration: DURACION.corta });
  }, [visible, reducidas, opacidad]);
  const estilo = useAnimatedStyle(() => ({ opacity: opacidad.value }));
  return (
    <Animated.View
      testID={testID} pointerEvents="none" accessibilityElementsHidden={!visible}
      style={[StyleSheet.absoluteFill, estilo]}
    >
      {children}
    </Animated.View>
  );
}
