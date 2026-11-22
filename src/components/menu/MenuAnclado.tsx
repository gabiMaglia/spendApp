import React from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Spacing } from '@/src/constants/spacing';
import { useColors, useSkin } from '@/src/skins/useSkin';
import { SheetOption, SheetOptionAvatar } from '@/src/components/Sheet';
import { FilaMenu } from '@/src/components/menu/FilaMenu';
import { useAnimacionMenu } from '@/src/components/menu/useAnimacionMenu';
import { VeloMenu } from '@/src/components/menu/VeloMenu';
import { useEleccionUnica } from '@/src/components/menu/useEleccionUnica';
import { usePosicionMenu } from '@/src/components/menu/usePosicionMenu';
import { BORDE_MENU, MAX_FILAS_COMPLETAS } from '@/src/components/menu/calcularPosicionMenu';
import type { OpcionMenu } from '@/src/components/menu/tipos';

export type MenuAncladoProps<V> = {
  visible: boolean;
  onClose: () => void;
  ancla: React.RefObject<View | null>;
  opciones: OpcionMenu<V>[];
  seleccionado?: V;
  onElegir: (v: V) => void;
  accessibilityLabel: string;
  /** Etiqueta (ya traducida) del velo, que para el lector de pantalla es el botón «cerrar». */
  etiquetaCerrar: string;
  testID?: string;
};

export function MenuAnclado<V>({
  visible, onClose, ancla, opciones, seleccionado, onElegir, accessibilityLabel, etiquetaCerrar, testID,
}: MenuAncladoProps<V>) {
  const c = useColors();
  const { skin, degradado } = useSkin();
  const { posicion, maxHeight, onLayoutFila, anchoProvisional, rect } = usePosicionMenu({
    visible, ancla, cantidad: opciones.length, onCerrar: onClose,
  });

  const { montado, sinAnimacion, estiloVelo, estiloMenu, origen } = useAnimacionMenu({
    visible, listo: !!posicion, lado: posicion?.lado,
  });

  const elegir = useEleccionUnica<V>({ visible, tocable: visible && !!posicion, onElegir, onClose });

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
      <Animated.View
        pointerEvents={visible && posicion ? 'auto' : 'none'}
        testID={testID} accessibilityRole="menu" accessibilityLabel={accessibilityLabel}
        onAccessibilityEscape={onClose}
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
