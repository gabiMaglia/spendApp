import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ActionButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ActionButtonSize = 'sm' | 'md' | 'lg';

export interface ActionButtonProps {
  /** Qué pasa al tocarlo. */
  action: () => void;
  /** Texto. Siempre ya traducido: acá no se llama a `t()`. */
  label: string;
  /** Ícono a la izquierda. */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** Flecha "→" a la derecha, para lo que lleva a otra pantalla. */
  arrow?: boolean;
  variant?: ActionButtonVariant;
  size?: ActionButtonSize;
  /** Ocupa todo el ancho disponible. Es lo normal dentro de un ButtonRack. */
  full?: boolean;
  disabled?: boolean;
  /** Muestra un spinner y bloquea el toque. */
  loading?: boolean;
  /** Línea chica debajo del label, para explicar sin abrir un diálogo. */
  sub?: string;
  testID?: string;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

/**
 * El botón de acción de la app. **Es el único**: no se escriben `Pressable`
 * sueltos con estilo propio para acciones.
 *
 * Existe porque la misma acción estaba dibujada distinta en cada pantalla —
 * "saldar deudas" y "invitar por link" compartían `styles.inviteRow`, el CTA
 * del dashboard tenía otro, y cada uno repetía colores y padding a mano. Un
 * botón que se escribe cinco veces termina viéndose de cinco formas.
 *
 * No sabe de i18n a propósito: recibe el texto ya traducido. Un componente que
 * llama a `t()` adentro obliga a que su test conozca las claves y deja de ser
 * reutilizable fuera de una pantalla traducida.
 */
export function ActionButton({
  action, label, icon, arrow = false,
  variant = 'primary', size = 'md', full = false,
  disabled = false, loading = false, sub,
  testID, accessibilityLabel, style,
}: ActionButtonProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const inactivo = disabled || loading;

  const paleta: Record<ActionButtonVariant, { bg: string; fg: string; border: string }> = {
    primary:   { bg: c.brand.primary,  fg: '#FFFFFF',          border: c.brand.primary },
    secondary: { bg: 'transparent',    fg: c.brand.primary,    border: c.brand.primary },
    ghost:     { bg: c.surfaceSunken,  fg: c.text,             border: 'transparent' },
    danger:    { bg: 'transparent',    fg: c.semantic.negative, border: c.semantic.negative },
  };
  const p = paleta[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactivo }}
      testID={testID}
      disabled={inactivo}
      onPress={action}
      style={[
        styles.base,
        size === 'lg' ? styles.lg : size === 'sm' ? styles.sm : styles.md,
        full && { alignSelf: 'stretch' },
        { backgroundColor: p.bg, borderColor: p.border },
        inactivo && styles.inactivo,
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator size="small" color={p.fg} />
        : icon && <Ionicons name={icon} size={size === 'lg' ? 20 : size === 'sm' ? 14 : 18} color={p.fg} />}

      <View style={size === 'sm' ? undefined : styles.textos}>
        <Text style={[size === 'sm' ? Typography.caption : Typography.bodyM, { color: p.fg, fontWeight: '700' }]} numberOfLines={1}>
          {label}
        </Text>
        {sub && (
          <Text style={[Typography.caption, { color: p.fg, opacity: 0.75 }]} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>

      {arrow && <Ionicons name="arrow-forward" size={size === 'lg' ? 20 : size === 'sm' ? 14 : 18} color={p.fg} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing[2],
    borderRadius: Radius.md, borderWidth: 1,
  },
  // `sm` es para afordancias compactas que viven DENTRO de otro control (el
  // "MAX" del input de monto). No respeta el tapTarget de 44 por definición:
  // quien lo use tiene que compensar con hitSlop.
  sm:       { paddingVertical: 6, paddingHorizontal: Spacing[3], borderRadius: Radius.sm },
  md:       { paddingVertical: 12, paddingHorizontal: Spacing[4], minHeight: Spacing.tapTarget },
  lg:       { paddingVertical: 16, paddingHorizontal: Spacing[5], minHeight: 52 },
  // El texto empuja la flecha al borde y deja el ícono pegado a la izquierda.
  textos:   { flex: 1, gap: 1 },
  inactivo: { opacity: 0.45 },
});
