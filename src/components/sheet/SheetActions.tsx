import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';
import { BottomSheet } from '@/src/components/sheet/BottomSheet';

/** Botón del pie. `variant`: primary (lleno), ghost (plano), danger (rojo). */
export function SheetButton({
  label, onPress, variant = 'primary', disabled, flex = 1, testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  flex?: number;
  testID?: string;
}) {
  const c = useColors();

  const bg = disabled ? c.bgGrouped
    : variant === 'primary' ? c.brand.primary
    : variant === 'danger'  ? c.semantic.negative
    : c.bgGrouped;
  const fg = disabled ? c.textTertiary
    : variant === 'ghost' ? c.text
    : '#fff';

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, flex },
        pressed && !disabled && { opacity: 0.9 },
      ]}
    >
      <Text style={{ fontSize: 15, fontWeight: '700', color: fg }}>{label}</Text>
    </Pressable>
  );
}

/** Dos botones al pie, en fila. */
export function SheetActions({ children }: { children: React.ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

/**
 * Confirmación destructiva sin `Alert` del sistema: mismo papel, mismo tipo.
 * Para borrar un grupo, un gasto o un contacto.
 */
export function ConfirmSheet({
  visible, onClose, title, body, confirmLabel, cancelLabel = 'Cancelar', onConfirm, danger = true,
  confirmTestID, cancelTestID,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  danger?: boolean;
  /** Para tests que necesitan tocar un botón puntual (varias hojas en la misma pantalla). */
  confirmTestID?: string;
  cancelTestID?: string;
}) {
  const c = useColors();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      scroll={false}
      footer={
        <SheetActions>
          <SheetButton testID={cancelTestID} label={cancelLabel} variant="ghost" onPress={onClose} />
          <SheetButton
            testID={confirmTestID}
            label={confirmLabel}
            variant={danger ? 'danger' : 'primary'}
            onPress={() => { onConfirm(); onClose(); }}
          />
        </SheetActions>
      }
    >
      <View style={styles.confirmPad}>
        <View style={[styles.confirmIcon, { backgroundColor: danger ? c.semantic.negativeSoft : c.brand.primarySoft }]}>
          <Ionicons
            name={danger ? 'alert-circle-outline' : 'help-circle-outline'}
            size={22}
            color={danger ? c.semantic.negative : c.brand.primary}
          />
        </View>
        <Text style={[styles.confirmTitle, { color: c.text }]}>{title}</Text>
        {body ? (
          <Text style={[Typography.bodyM, { color: c.textSecondary, textAlign: 'center' }]}>{body}</Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions:   { flexDirection: 'row', gap: Spacing[2] },
  button:    { height: 52, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },

  // Cancela `bodyPad` y pone el suyo, que es mayor: un diálogo de confirmación
  // respira más que una lista de opciones.
  confirmPad:  { alignItems: 'center', gap: Spacing[3], marginHorizontal: -Spacing.screenPad, paddingHorizontal: Spacing[6], paddingTop: Spacing[5], paddingBottom: Spacing[5] },
  confirmIcon: { width: Spacing.tapTarget, height: Spacing.tapTarget, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing[1] },
  confirmTitle:{ fontSize: 18, fontWeight: '700', letterSpacing: -0.3, textAlign: 'center' },
});
