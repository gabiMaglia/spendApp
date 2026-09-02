import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Primitivas del reskin "flat bands".
 *
 * La tarjeta flotante desaparece: un bloque es una BANDA de ancho completo con
 * hairline arriba y abajo, y sus filas se separan con un hairline más suave.
 * El padding horizontal vive en la FILA, no en la banda, así el divisor llega
 * de borde a borde.
 */

export function useC() {
  const scheme = useColorScheme() ?? 'light';
  return Colors[scheme];
}

/** Etiqueta de sección sobre una banda. `right` es un link o accesorio opcional. */
export function SectionLabel({
  label, right, first,
}: { label: string; right?: React.ReactNode; first?: boolean }) {
  const c = useC();
  return (
    <View style={[styles.sectionLabel, first && { paddingTop: Spacing[2] }]}>
      <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
        {label}
      </Text>
      {right}
    </View>
  );
}

/** Link de texto a la derecha de una etiqueta de sección. */
export function BandLink({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useC();
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text style={{ fontSize: 11.5, fontWeight: '600', color: c.brand.primary }}>{label}</Text>
    </Pressable>
  );
}

/** Banda de ancho completo. `sunken` para el tono hundido (fila de neto, chips). */
export function Band({
  children, sunken, style, noBottom,
}: { children: React.ReactNode; sunken?: boolean; style?: ViewStyle; noBottom?: boolean }) {
  const c = useC();
  return (
    <View
      style={[
        {
          backgroundColor: sunken ? c.bgGrouped : c.surface,
          borderTopWidth: 1,
          borderBottomWidth: noBottom ? 0 : 1,
          borderColor: c.hair,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Fila de banda. `last` saca el divisor inferior. */
export function BandRow({
  children, onPress, last, style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
  style?: ViewStyle;
}) {
  const c = useC();
  const base: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: Spacing.screenPad,
    paddingVertical: Spacing.rowPadV,
    borderBottomWidth: last ? 0 : 1,
    borderBottomColor: c.hair2,
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [base, pressed && { backgroundColor: c.bgGrouped }, style]}
    >
      {children}
    </Pressable>
  );
}

/**
 * Banda de estadísticas partida por divisores verticales.
 * 2 columnas = alineadas a la izquierda; 3 o más = centradas.
 */
export function SplitStat({
  items, sunken,
}: {
  items: { label: string; value: string; color?: string }[];
  sunken?: boolean;
}) {
  const c = useC();
  const centered = items.length > 2;
  return (
    <Band sunken={sunken}>
      <View style={{ flexDirection: 'row' }}>
        {items.map((it, i) => (
          <React.Fragment key={it.label}>
            {i > 0 && <View style={{ width: 1, backgroundColor: c.hair }} />}
            <View
              style={{
                flex: 1,
                paddingVertical: Spacing[4],
                paddingHorizontal: centered ? Spacing[3] : Spacing.screenPad,
                alignItems: centered ? 'center' : 'flex-start',
              }}
            >
              <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
                {it.label}
              </Text>
              <Text style={[Typography.amountM, { color: it.color ?? c.text }]}>{it.value}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>
    </Band>
  );
}

/** Barra de progreso plana de 4-5pt. */
export function Meter({ pct, color, height = 5 }: { pct: number; color?: string; height?: number }) {
  const c = useC();
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: c.hair2, overflow: 'hidden' }}>
      <View
        style={{
          width: `${Math.max(0, Math.min(pct, 1)) * 100}%`,
          height: '100%',
          backgroundColor: color ?? c.brand.primary,
        }}
      />
    </View>
  );
}

/** Control segmentado (Activos/Archivados, Tema, Idioma). */
export function Segmented<T extends string>({
  options, value, onChange, compact,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  compact?: boolean;
}) {
  const c = useC();
  return (
    <View style={[styles.segWrap, { backgroundColor: c.hair2, borderRadius: compact ? 9 : 11 }]}>
      {options.map(o => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            onPress={() => onChange(o.key)}
            style={[
              compact ? styles.segTabCompact : styles.segTab,
              on && {
                backgroundColor: c.surface,
                boxShadow: '0 1px 2px rgba(20,25,20,0.12)',
              },
            ]}
          >
            <Text
              style={{
                fontSize: compact ? 11.5 : 13,
                fontWeight: on ? '700' : '500',
                color: on ? c.text : c.textTertiary,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Badge de esquina para estados no implementados. */
export function SoonBadge({ label = 'SOON' }: { label?: string }) {
  const c = useC();
  return (
    <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: c.hair2 }}>
      <Text style={{ fontSize: 9.5, fontWeight: '600', letterSpacing: 0.6, color: c.textTertiary }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad,
    paddingTop: 22,
    paddingBottom: 9,
  },
  segWrap: { flexDirection: 'row', padding: 4, gap: 4 },
  segTab: {
    flex: 1, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  segTabCompact: {
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center',
  },
});
