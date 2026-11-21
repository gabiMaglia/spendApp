import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Spacing } from '@/src/constants/spacing';
import { SheetOption, SheetOptionAvatar } from '@/src/components/Sheet';
import { usePosicionMenu } from '@/src/components/menu/usePosicionMenu';
import { MAX_FILAS_COMPLETAS } from '@/src/components/menu/calcularPosicionMenu';
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
  const { posicion, onLayoutFila, anchoProvisional, rect } = usePosicionMenu({
    visible, ancla, cantidad: opciones.length, onCerrar: onClose,
  });

  if (!visible) return null;

  const elegir = (v: V) => { onElegir(v); onClose(); };

  return (
    <Modal
      transparent animationType="none" onRequestClose={onClose}
      statusBarTranslucent navigationBarTranslucent
    >
      <Pressable
        testID={testID ? `${testID}-velo` : undefined}
        style={[StyleSheet.absoluteFillObject, { backgroundColor: SCRIM }]}
        onPress={onClose}
      />
      <View
        testID={testID} accessibilityRole="menu" accessibilityLabel={accessibilityLabel}
        style={[
          styles.menu,
          posicion
            ? { left: posicion.left, top: posicion.top, width: posicion.width, maxHeight: posicion.maxHeight }
            : { left: rect?.x ?? 0, top: 0, width: anchoProvisional },
          { opacity: posicion ? 1 : 0 },
        ]}
      >
        <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
          {opciones.map((o, i) => {
            const sel = o.valor === seleccionado;
            const last = i === opciones.length - 1;
            const press = () => elegir(o.valor);
            return (
              <View
                key={String(o.valor)}
                onLayout={i < MAX_FILAS_COMPLETAS ? e => onLayoutFila(i, e.nativeEvent.layout.height) : undefined}
                accessible accessibilityRole="menuitem"
                accessibilityState={{ selected: sel }} onAccessibilityTap={press}
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
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // R6: el padding cancela el marginHorizontal negativo de las filas de la hoja.
  menu: { position: 'absolute', paddingHorizontal: Spacing.screenPad },
});
