import React from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View, type TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { UserAvatar } from './UserAvatar';

/**
 * Sheets y modales — vocabulario "flat bands".
 *
 * El sheet viejo era una tarjeta con opciones-pastilla apiladas y gap: cada
 * opción parecía un botón suelto. Acá el sheet es una hoja de papel con
 * secciones: título fijo arriba con hairline, opciones como filas de borde a
 * borde separadas por hairline, y las acciones abajo. Mismo lenguaje que las
 * bandas de las pantallas, así que abrir un sheet no cambia de idioma visual.
 *
 * El contenido scrollea si no entra; el título y el pie quedan fijos.
 */

const SCRIM = 'rgba(12, 16, 14, 0.5)';

export function BottomSheet({
  visible, onClose, children, title, footer, scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Título fijo + botón de cerrar. Sin él, el sheet arranca en el contenido. */
  title?: string;
  /** Acciones fijas al pie (usar `SheetButton`). */
  footer?: React.ReactNode;
  /** false para contenido que ya scrollea o mide poco (pickers de 3 filas). */
  scroll?: boolean;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();

  const Body: any = scroll ? ScrollView : View;
  const bodyProps = scroll
    ? { bounces: false, showsVerticalScrollIndicator: false, contentContainerStyle: { paddingBottom: 4 } }
    : {};

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + Spacing[3] }]}>
            <View style={[styles.grabber, { backgroundColor: c.hair }]} />

            {title ? (
              <View style={[styles.titleRow, { borderBottomColor: c.hair }]}>
                <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>{title}</Text>
                <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
                  <Ionicons name="close" size={20} color={c.textTertiary} />
                </Pressable>
              </View>
            ) : null}

            <Body style={styles.body} {...bodyProps}>{children}</Body>

            {footer ? (
              <View style={[styles.footer, { borderTopColor: c.hair }]}>{footer}</View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/**
 * Fila de opción. De borde a borde, con hairline abajo salvo la última.
 * Seleccionada: fondo tenue de marca, label en 700 y check a la derecha —
 * sin cambiar de forma, así la lista no salta al elegir.
 */
export function SheetOption({
  icon, label, sublabel, selected, onPress, destructive, last,
}: {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  sublabel?: string;
  selected?: boolean;
  onPress: () => void;
  /** Rojo para borrar / salir del grupo. */
  destructive?: boolean;
  last?: boolean;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const tint = destructive ? c.semantic.negative : selected ? c.brand.primary : c.text;
  const iconTint = destructive ? c.semantic.negative : selected ? c.brand.primary : c.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: c.hair2,
          backgroundColor: selected ? c.brand.primarySoft : 'transparent',
        },
        pressed && !selected && { backgroundColor: c.bgGrouped },
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={iconTint} /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: Spacing[1] }}>
        <Text style={[Typography.bodyL, { color: tint, fontWeight: selected ? '700' : '600' }]} numberOfLines={1}>
          {label}
        </Text>
        {sublabel ? (
          <Text style={[Typography.caption, { color: c.textTertiary }]} numberOfLines={1}>{sublabel}</Text>
        ) : null}
      </View>
      {selected ? <Ionicons name="checkmark" size={18} color={c.brand.primary} /> : null}
    </Pressable>
  );
}

/** Igual que `SheetOption` pero con avatar: elegir persona. */
export function SheetOptionAvatar({
  userId, name, selected, onPress, hint, last,
}: {
  userId: string;
  name: string;
  selected?: boolean;
  onPress: () => void;
  /** Dato para poder elegir con criterio (p.ej. cuánto debe esta persona). */
  hint?: string;
  last?: boolean;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: c.hair2,
          backgroundColor: selected ? c.brand.primarySoft : 'transparent',
        },
        pressed && !selected && { backgroundColor: c.bgGrouped },
      ]}
    >
      <UserAvatar userId={userId} name={name} size={34} />
      <View style={{ flex: 1, minWidth: 0, gap: Spacing[1] }}>
        <Text
          style={[Typography.bodyL, { color: selected ? c.brand.primary : c.text, fontWeight: selected ? '700' : '600' }]}
          numberOfLines={1}
        >
          {name}
        </Text>
        {hint ? (
          <Text style={[Typography.caption, { color: c.textTertiary }]} numberOfLines={1}>{hint}</Text>
        ) : null}
      </View>
      {selected ? <Ionicons name="checkmark" size={18} color={c.brand.primary} /> : null}
    </Pressable>
  );
}

/** Bajada bajo el título: una línea de contexto, no un párrafo. */
export function SheetNote({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Text style={[Typography.bodyS, styles.note, { color: c.textSecondary }]}>{children}</Text>
  );
}

/** Etiqueta de sección dentro del sheet (uppercase, como en las pantallas). */
export function SheetLabel({ children }: { children: string }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Text style={[Typography.label, styles.sheetLabel, { color: c.textTertiary, textTransform: 'uppercase' }]}>
      {children}
    </Text>
  );
}

/** Campo de texto del sheet: fondo hundido, borde hairline, 48pt. */
export const SheetInput = React.forwardRef<
  TextInput,
  TextInputProps & { icon?: React.ComponentProps<typeof Ionicons>['name'] }
>(function SheetInput({ icon, style, multiline, ...rest }, ref) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View
      style={[
        styles.input,
        {
          backgroundColor: c.bgGrouped,
          borderColor: c.hair,
          alignItems: multiline ? 'flex-start' : 'center',
          minHeight: multiline ? 104 : 48,
        },
      ]}
    >
      {icon ? (
        <Ionicons name={icon} size={17} color={c.textTertiary} style={{ marginTop: multiline ? 2 : 0 }} />
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={c.textTertiary}
        multiline={multiline}
        style={[
          Typography.bodyM,
          { flex: 1, color: c.text, padding: 0, textAlignVertical: multiline ? 'top' : 'center' },
          style,
        ]}
        {...rest}
      />
    </View>
  );
});

/**
 * Fila de toggle del sheet (p.ej. "Sumar lo que me deben").
 * Es la misma pieza que las filas de Yo, para que no haya dos switches distintos.
 */
export function SheetToggle({
  label, sublabel, value, onChange,
}: { label: string; sublabel?: string; value: boolean; onChange: (v: boolean) => void }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Pressable onPress={() => onChange(!value)} style={styles.toggleRow}>
      <View style={{ flex: 1, minWidth: 0, gap: Spacing[1] }}>
        <Text style={[Typography.bodyL, { color: c.text }]}>{label}</Text>
        {sublabel ? (
          <Text style={[Typography.caption, { color: c.textTertiary }]}>{sublabel}</Text>
        ) : null}
      </View>
      <View style={[styles.track, { backgroundColor: value ? c.brand.primary : c.hair }]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

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
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

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
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  danger?: boolean;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      scroll={false}
      footer={
        <SheetActions>
          <SheetButton label={cancelLabel} variant="ghost" onPress={onClose} />
          <SheetButton
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

/**
 * El gap entre el ícono y el texto de una fila. Sale de `Band.tsx`, que ya usa
 * 13 para exactamente la misma pieza: si el sheet usara otro, una fila de banda
 * y una de sheet se verían distintas al lado de la otra. El reskin traía CUATRO
 * valores para este mismo patrón (13, 12, 12 y 10).
 */
const GAP_FILA = 13;

const styles = StyleSheet.create({
  root:      { flex: 1, justifyContent: 'flex-end', backgroundColor: SCRIM },
  // El sheet nunca tapa toda la pantalla: siempre se ve un poco del fondo,
  // así se entiende que es una capa y no una pantalla nueva.
  sheet:     {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 8, maxHeight: '86%',
  },
  grabber:   { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing[3] },

  titleRow:  {
    flexDirection: 'row', alignItems: 'center', gap: GAP_FILA,
    paddingHorizontal: Spacing.screenPad, paddingBottom: Spacing.rowPadV,
    borderBottomWidth: 1,
  },
  title:     { flex: 1, fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  closeBtn:  { width: 28, alignItems: 'flex-end' },

  body:      { flexGrow: 0 },

  // Las opciones llegan a los bordes; el aire vive adentro de la fila.
  option:    {
    flexDirection: 'row', alignItems: 'center', gap: GAP_FILA,
    paddingHorizontal: Spacing.screenPad, paddingVertical: Spacing.rowPadV,
    minHeight: 56,
  },

  note:      { paddingHorizontal: Spacing.screenPad, paddingTop: Spacing.rowPadV, lineHeight: 18 },
  sheetLabel:{ paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[5], paddingBottom: 9 },

  input:     {
    flexDirection: 'row', gap: GAP_FILA,
    marginHorizontal: Spacing.screenPad, marginTop: Spacing[3],
    paddingHorizontal: Spacing[4], paddingVertical: Spacing[3],
    borderRadius: Radius.md, borderWidth: 1,
  },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: GAP_FILA,
    paddingHorizontal: Spacing.screenPad, paddingVertical: Spacing.rowPadV,
  },
  track:     { width: 44, height: 26, borderRadius: 13, padding: 3, flexShrink: 0 },
  knob:      { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  knobOn:    { transform: [{ translateX: 18 }] },

  footer:    {
    borderTopWidth: 1,
    paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[3],
  },
  actions:   { flexDirection: 'row', gap: Spacing[2] },
  button:    { height: 52, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },

  confirmPad:  { alignItems: 'center', gap: Spacing[3], paddingHorizontal: Spacing[6], paddingTop: Spacing[5], paddingBottom: Spacing[5] },
  confirmIcon: { width: Spacing.tapTarget, height: Spacing.tapTarget, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing[1] },
  confirmTitle:{ fontSize: 18, fontWeight: '700', letterSpacing: -0.3, textAlign: 'center' },
});
