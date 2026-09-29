import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { UserAvatar } from '@/src/components/UserAvatar';
import { useColors } from '@/src/skins/useSkin';
import { GAP_FILA } from '@/src/components/sheet/constantes';

/**
 * Fila de opción. De borde a borde, con hairline abajo salvo la última.
 * Seleccionada: fondo tenue de marca, label en 700 y check a la derecha —
 * sin cambiar de forma, así la lista no salta al elegir.
 */
export function SheetOption({
  icon, label, sublabel, selected, onPress, destructive, last, testID,
}: {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  sublabel?: string;
  selected?: boolean;
  onPress: () => void;
  /** Rojo para borrar / salir del grupo. */
  destructive?: boolean;
  last?: boolean;
  testID?: string;
}) {
  const c = useColors();

  const tint = destructive ? c.semantic.negative : selected ? c.brand.primary : c.text;
  const iconTint = destructive ? c.semantic.negative : selected ? c.brand.primary : c.textSecondary;

  return (
    <Pressable
      testID={testID}
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
  const c = useColors();
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
  const c = useColors();
  return (
    <Text style={[Typography.bodyS, styles.note, { color: c.textSecondary }]}>{children}</Text>
  );
}

/** Etiqueta de sección dentro del sheet (uppercase, como en las pantallas). */
export function SheetLabel({ children }: { children: string }) {
  const c = useColors();
  return (
    <Text style={[Typography.label, styles.sheetLabel, { color: c.textTertiary, textTransform: 'uppercase' }]}>
      {children}
    </Text>
  );
}

/**
 * Fila de toggle del sheet (p.ej. "Sumar lo que me deben").
 * Es la misma pieza que las filas de Yo, para que no haya dos switches distintos.
 */
export function SheetToggle({
  label, sublabel, value, onChange,
}: { label: string; sublabel?: string; value: boolean; onChange: (v: boolean) => void }) {
  const c = useColors();
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

const styles = StyleSheet.create({
  // Las opciones llegan a los bordes; el aire vive adentro de la fila.
  option:    {
    flexDirection: 'row', alignItems: 'center', gap: GAP_FILA,
    marginHorizontal: -Spacing.screenPad,   // cancela `bodyPad`: la fila va al borde
    paddingHorizontal: Spacing.screenPad, paddingVertical: Spacing.rowPadV,
    minHeight: 56,
  },

  note:      {
    marginHorizontal: -Spacing.screenPad, paddingHorizontal: Spacing.screenPad,
    paddingTop: Spacing.rowPadV, lineHeight: 18,
  },
  sheetLabel:{
    marginHorizontal: -Spacing.screenPad, paddingHorizontal: Spacing.screenPad,
    paddingTop: Spacing[5], paddingBottom: 9,
  },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: GAP_FILA,
    marginHorizontal: -Spacing.screenPad,   // cancela `bodyPad`
    paddingHorizontal: Spacing.screenPad, paddingVertical: Spacing.rowPadV,
  },
  track:     { width: 44, height: 26, borderRadius: 13, padding: 3, flexShrink: 0 },
  knob:      { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  knobOn:    { transform: [{ translateX: 18 }] },
});
