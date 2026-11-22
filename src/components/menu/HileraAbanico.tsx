import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { Typography } from '@/src/constants/typography';
import { CapsulaFila } from '@/src/components/menu/CapsulaFila';
import { FundidoBorde } from '@/src/components/menu/FundidoBorde';
import { PAD_SOMBRA } from '@/src/components/menu/calcularAbanico';
import {
  ALTO_CAPSULA, GAP_FILA, SEPARACION_FILA, scrollInicial, type Hilera,
} from '@/src/components/menu/calcularFila';
import type { OpcionCubo } from '@/src/components/menu/tipos';

// El viaje vertical de entrada no necesita llegar al centro del ancla: la ventana recorta y
// el cubo ya nace transparente. Se limita para que la ventana no tape el ancla.
const VIAJE_MAX = SEPARACION_FILA + ALTO_CAPSULA / 3;

/**
 * La fila de UNA apertura (hermana de `ColumnaAbanico`): ventana de ancho fijo y recortada,
 * scroll horizontal y cápsulas verticales. Se monta con `key` por apertura. Si crece hacia
 * la izquierda las cápsulas van en orden inverso, así la primera queda junto al ancla.
 */
export function HileraAbanico<V>({
  geo, opciones, seleccionado, visible, sinAnimacion, tocable, onElegir, onClose, accessibilityLabel, pie, testID,
}: {
  geo: Hilera;
  opciones: OpcionCubo<V>[];
  seleccionado?: V;
  visible: boolean;
  sinAnimacion: boolean;
  tocable: boolean;
  onElegir: (v: V) => void;
  onClose: () => void;
  accessibilityLabel: string;
  /** Texto de ayuda (ya traducido) que va junto a la fila, del lado opuesto al ancla. */
  pie?: string;
  testID?: string;
}) {
  const maxScroll = Math.max(0, geo.anchoContenido - geo.anchoVentana);
  const indiceActual = Math.max(0, opciones.findIndex(o => o.valor === seleccionado));
  const inicio = useRef(scrollInicial(geo, indiceActual)).current;
  const scrollX = useSharedValue(inicio);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (tocable && geo.scrolla) scroll.current?.flashScrollIndicators();
  }, [tocable, geo.scrolla]);

  const abajo = geo.lado === 'abajo';
  const ext = SEPARACION_FILA;
  const desdeY = Math.sign(geo.desdeY) * Math.min(Math.abs(geo.desdeY), VIAJE_MAX);
  const orden = opciones.map((o, i) => ({ o, i }));
  const visibles = geo.haciaDerecha ? orden : [...orden].reverse();

  return (
    <View
      testID={testID} accessibilityRole="menu" accessibilityLabel={accessibilityLabel}
      onAccessibilityEscape={onClose}
      pointerEvents={tocable ? 'auto' : 'none'}
      style={{ position: 'absolute', left: geo.left, top: geo.top, width: geo.anchoVentana, height: ALTO_CAPSULA }}
    >
      {/* Ventana de ancho fijo y recortada: el aire de la sombra es menor que el GAP, así
          nunca asoma una 5ª cápsula, ni parcial. Se abre `ext` hacia el ancla para el viaje. */}
      <View
        testID={testID ? `${testID}-ventana` : undefined}
        style={{
          position: 'absolute', left: -PAD_SOMBRA, width: geo.anchoVentana + 2 * PAD_SOMBRA, overflow: 'hidden',
          top: -PAD_SOMBRA - (abajo ? ext : 0), height: ALTO_CAPSULA + 2 * PAD_SOMBRA + ext,
        }}
      >
        <ScrollView
          ref={scroll} horizontal scrollEnabled={geo.scrolla} bounces={false}
          showsHorizontalScrollIndicator={geo.scrolla} scrollEventThrottle={16}
          contentOffset={{ x: inicio, y: 0 }}
          onContentSizeChange={() => { if (inicio > 0) scroll.current?.scrollTo({ x: inicio, animated: false }); }}
          onScroll={e => { scrollX.value = Math.max(0, e.nativeEvent.contentOffset.x); }}
          contentContainerStyle={[styles.fila, {
            paddingHorizontal: PAD_SOMBRA, paddingTop: PAD_SOMBRA + (abajo ? ext : 0), paddingBottom: PAD_SOMBRA + (abajo ? 0 : ext),
          }]}
        >
          {visibles.map(({ o, i }, posicion) => (
            <CapsulaFila
              key={String(o.valor)} indice={i} posicion={posicion} testID={testID}
              visible={visible} sinAnimacion={sinAnimacion} opcion={o}
              seleccionado={o.valor === seleccionado} onPress={() => onElegir(o.valor)}
              scrollX={scrollX} origenX={geo.origenX} desdeY={desdeY}
            />
          ))}
        </ScrollView>
        {geo.scrolla && (
          <View pointerEvents="none" style={[styles.pistaFundido, { top: abajo ? ext + PAD_SOMBRA : PAD_SOMBRA, height: ALTO_CAPSULA }]}>
            <FundidoBorde
              horizontal alIzquierda={!geo.haciaDerecha} scrollY={scrollX} maxScroll={maxScroll}
              testID={testID ? `${testID}-fundido` : undefined}
            />
          </View>
        )}
      </View>
      {pie !== undefined && (
        <Text
          testID={testID ? `${testID}-pie` : undefined}
          style={[Typography.caption, styles.pie, abajo ? { top: ALTO_CAPSULA + PAD_SOMBRA + 8 } : { bottom: ALTO_CAPSULA + PAD_SOMBRA + 8 }]}
        >
          {pie}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fila: { gap: GAP_FILA },
  pistaFundido: { position: 'absolute', left: 0, right: 0 },
  // Sobre el velo oscuro: el texto va claro en los dos skins.
  pie: { position: 'absolute', left: 0, right: 0, color: '#fff', opacity: 0.85, textAlign: 'center' },
});
