import React, { useEffect, useRef } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Spacing } from '@/src/constants/spacing';
import { useColors, useSkin } from '@/src/skins/useSkin';
import { SheetOption, SheetOptionAvatar } from '@/src/components/Sheet';
import { FilaMenu } from '@/src/components/menu/FilaMenu';
import { useAnimacionMenu } from '@/src/components/menu/useAnimacionMenu';
import { usePosicionMenu } from '@/src/components/menu/usePosicionMenu';
import { BORDE_MENU, MAX_FILAS_COMPLETAS } from '@/src/components/menu/calcularPosicionMenu';
import type { OpcionMenu } from '@/src/components/menu/tipos';

const SCRIM = 'rgba(12, 16, 14, 0.5)';

export type MenuAncladoProps<V> = {
  visible: boolean;
  onClose: () => void;
  ancla: React.RefObject<View | null>;
  opciones: OpcionMenu<V>[];
  seleccionado?: V;
  onElegir: (v: V) => void;
  accessibilityLabel: string;
  testID?: string;
};

export function MenuAnclado<V>({
  visible, onClose, ancla, opciones, seleccionado, onElegir, accessibilityLabel, testID,
}: MenuAncladoProps<V>) {
  const c = useColors();
  const { skin, degradado } = useSkin();
  const { posicion, maxHeight, onLayoutFila, anchoProvisional, rect } = usePosicionMenu({
    visible, ancla, cantidad: opciones.length, onCerrar: onClose,
  });

  const { montado, sinAnimacion, estiloVelo, estiloMenu, origen } = useAnimacionMenu({
    visible, listo: !!posicion, lado: posicion?.lado,
  });

  // Se puede tocar sólo abierto y medido: ni el frame invisible de medición ni la
  // salida (110 ms montado) eligen, y un doble toque elige una sola vez.
  const tocable = visible && !!posicion;
  const elegido = useRef(false);
  useEffect(() => { if (visible) elegido.current = false; }, [visible]);

  if (!montado) return null;

  const elegir = (v: V) => {
    if (!tocable || elegido.current) return;
    elegido.current = true;
    onElegir(v);
    onClose();
  };

  return (
    <Modal
      transparent animationType="none" onRequestClose={onClose}
      statusBarTranslucent navigationBarTranslucent
    >
      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFillObject, { backgroundColor: SCRIM }, estiloVelo]}
      >
        <Pressable
          testID={testID ? `${testID}-velo` : undefined}
          style={StyleSheet.absoluteFillObject}
          onPress={onClose}
        />
      </Animated.View>
      <Animated.View
        pointerEvents={tocable ? 'auto' : 'none'}
        testID={testID} accessibilityRole="menu" accessibilityLabel={accessibilityLabel}
        style={[
          styles.menu,
          {
            backgroundColor: c.surface, borderColor: c.hair,
            ...(degradado ? { elevation: skin.elevation.e3.elevationFallback } : { boxShadow: skin.elevation.e3.boxShadow }),
          },
          posicion
            ? { left: posicion.left, top: posicion.top, width: posicion.width, maxHeight }
            : { left: rect?.x ?? 0, top: 0, width: anchoProvisional },
          estiloMenu,
          { transformOrigin: origen },
          // Sin posición todavía: invisible, sólo para poder medir las filas.
          !posicion && { opacity: 0 },
        ]}
      >
        <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
          {opciones.map((o, i) => {
            const sel = o.valor === seleccionado;
            const last = i === opciones.length - 1;
            const press = () => elegir(o.valor);
            return (
              <FilaMenu
                key={String(o.valor)} indice={i} entrar={!!posicion} sinAnimacion={sinAnimacion}
                selected={sel} onPress={press}
                onLayout={i < MAX_FILAS_COMPLETAS ? e => onLayoutFila(i, e.nativeEvent.layout.height) : undefined}
              >
                {o.avatar ? (
                  <SheetOptionAvatar
                    userId={o.avatar.userId} name={o.avatar.name} hint={o.sublabel}
                    selected={sel} onPress={press} last={last}
                  />
                ) : (
                  <SheetOption
                    icon={o.icon} label={o.label} sublabel={o.sublabel} selected={sel}
                    destructive={o.destructive} onPress={press} last={last} testID={o.testID}
                  />
                )}
              </FilaMenu>
            );
          })}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // R6: el padding cancela el marginHorizontal negativo de las filas de la hoja.
  menu: { position: 'absolute', borderRadius: 20, borderWidth: BORDE_MENU, overflow: 'hidden', paddingHorizontal: Spacing.screenPad },
});
