import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColors, useSkinTokens } from '@/src/skins/useSkin';

/**
 * **T-203 (PO):** en Clásico esto era una píldora con fondo y borde
 * redondeado — pensada para Aero, rompía con el resto de la pantalla (las
 * pestañas de arriba ya ponen `borde="abajo"` y hacen de techo). Clásico pasa
 * a ser "línea del libro": ancho completo, transparente, sin borde alguno
 * (PO 2026-09-28: el piso hairline también se sacó; la franja «Hoy» que sigue
 * cierra la línea). El foco se expone por `accessibilityState`. Aero
 * conserva la pastilla de siempre — mismo split que `RecurrencePicker.tsx`
 * (`useSkinTokens().flags.soft`).
 */
export function ActivitySearchBar({
  value, onChangeText,
}: { value: string; onChangeText: (v: string) => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const soft = useSkinTokens().flags.soft;
  const [enfocado, setEnfocado] = useState(false);

  const input = (
    <TextInput
      testID="activity-search"
      value={value}
      onChangeText={onChangeText}
      onFocus={() => setEnfocado(true)}
      onBlur={() => setEnfocado(false)}
      placeholder={t('activity.search_placeholder')}
      placeholderTextColor={c.textTertiary}
      style={[Typography.bodyM, { color: c.text, flex: 1, padding: 0 }]}
      returnKeyType="search"
      autoCorrect={false}
    />
  );

  const clear = value !== '' && (
    <Pressable
      testID="activity-search-clear"
      accessibilityRole="button"
      onPress={() => onChangeText('')}
      hitSlop={10}
    >
      <Ionicons name="close-circle" size={16} color={c.textTertiary} />
    </Pressable>
  );

  if (soft) {
    return (
      <View style={[styles.searchBar, { backgroundColor: c.bgGrouped, borderColor: c.hair }]}>
        <Ionicons name="search-outline" size={15} color={c.textTertiary} />
        {input}
        {clear}
      </View>
    );
  }

  return (
    <View
      testID="activity-search-line"
      accessibilityState={{ selected: enfocado }}
      // Piso hairline (PO 2026-09-29, probando en el Moto): la línea vuelve a
      // cerrarse abajo — antes (T-211) se apoyaba en la franja «Hoy» y quedaba abierta.
      style={[styles.linea, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hair }]}
    >
      <Ionicons name="search-outline" size={15} color={c.textTertiary} />
      {input}
      {clear}
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    marginHorizontal: Spacing.screenPad, marginTop: 12, marginBottom: 12,
    // `minHeight` y no `height` (PO 2026-09-29, Aero): con alto fijo, el
    // TextInput de Android —más alto que el hueco— quedaba encima del borde de
    // abajo y la pastilla se veía sin piso (medido en píxeles en el Moto).
    paddingHorizontal: 13, minHeight: 40,
    borderRadius: Radius.md, borderWidth: 1,
  },
  // "Línea del libro" (Clásico, T-203): sin fondo, sin radio, sin bordes
  // laterales ni techo — las pestañas de arriba ya hacen de techo. El piso
  // hairline se pone en el render (necesita el color del skin).
  linea: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingHorizontal: Spacing.screenPad,
    height: 36,
    marginTop: 0, marginBottom: 0,
  },
});
