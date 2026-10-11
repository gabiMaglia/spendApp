import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { hapticSelection } from '@/src/utils/haptics';
import { conAlfa } from '@/src/skins/color';
import { useSkin } from '@/src/skins/useSkin';
import type { PersonalCategory } from '@/src/types/models';
import { CATEGORIES } from '@/src/screens/expense/repartoDeGasto';

/** Color de la categoría; las que no tienen uno propio (p. ej. `income`) usan el de «otro». */
export function tinteDeCategoria(paleta: Record<string, string>, id: string): string {
  return paleta[id] ?? paleta.other;
}

/**
 * Tiles de categoría del alta estilo Splitwise (feat/reskin, B4): cada uno con
 * el color de su categoría. El elegido va relleno con un aro; los demás,
 * blancos con sombra suave.
 */
export function GrillaCategorias({
  value, onChange,
}: { value: PersonalCategory; onChange: (c: PersonalCategory) => void }) {
  const { t } = useTranslation();
  const { skin } = useSkin();
  const c = skin.colors;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Sin `flexGrow: 0` el scroll horizontal se come el sobrante del
      // contenedor que empuja Guardar al fondo (ver `CategoriaChips`).
      style={styles.caja}
      contentContainerStyle={styles.fila}
    >
      {CATEGORIES.map(cat => {
        const activa = value === cat.id;
        const tinte = tinteDeCategoria(c.category, cat.id);
        return (
          <Pressable
            key={cat.id}
            accessibilityRole="button"
            accessibilityState={{ selected: activa }}
            onPress={() => { if (!activa) hapticSelection(); onChange(cat.id); }}
            style={styles.item}
          >
            <View style={[
              styles.tile,
              activa
                ? { backgroundColor: conAlfa(tinte, 0.16), borderColor: tinte, borderWidth: 2 }
                : { backgroundColor: c.surface, boxShadow: skin.elevation.e1.boxShadow },
            ]}>
              <Ionicons name={cat.icon} size={24} color={tinte} />
            </View>
            <Text
              numberOfLines={1}
              style={[Typography.caption, { color: activa ? c.text : c.textSecondary, fontWeight: activa ? '700' : '500' }]}
            >
              {t(`categories.${cat.id}`)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  caja: { flexGrow: 0 },
  fila: { gap: 6, paddingHorizontal: Spacing.screenPad, paddingVertical: 4, alignItems: 'center' },
  item: { width: 76, alignItems: 'center', gap: 7 },
  tile: {
    width: 54, height: 54, borderRadius: 17, borderCurve: 'continuous',
    alignItems: 'center', justifyContent: 'center',
  },
});
