import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { SelectorAdaptativo } from '@/src/components/SelectorAdaptativo';
import type { OpcionMenu } from '@/src/components/menu/tipos';
import { conAlfa } from '@/src/skins/color';
import { useSkin } from '@/src/skins/useSkin';
import type { PersonalCategory } from '@/src/types/models';
import { hapticSelection } from '@/src/utils/haptics';
import { CATEGORIES } from '@/src/screens/expense/repartoDeGasto';
import { tinteDeCategoria } from '@/src/screens/expense/components/GrillaCategorias';

/**
 * Categoría del alta en Aero: un disparador quieto (ícono con su tinte, nombre
 * y chevron) que abre el menú anclado con las categorías de gasto (T-282).
 * El `t()` vive acá: el menú recibe las opciones ya traducidas.
 */
export function SelectorCategoria({
  value, onChange,
}: { value: PersonalCategory; onChange: (c: PersonalCategory) => void }) {
  const { t } = useTranslation();
  const { skin } = useSkin();
  const c = skin.colors;
  const ancla = useRef<View>(null);
  const [abierto, setAbierto] = useState(false);

  const actual = CATEGORIES.find(x => x.id === value) ?? CATEGORIES[CATEGORIES.length - 1];
  const nombre = t(`categories.${actual.id}`);
  const tinte = tinteDeCategoria(c.category, actual.id);
  const opciones: OpcionMenu<PersonalCategory>[] = CATEGORIES.map(x => ({
    valor: x.id, label: t(`categories.${x.id}`), icon: x.icon,
  }));

  const elegir = (v: PersonalCategory) => {
    if (v !== value) hapticSelection();
    onChange(v);
  };

  return (
    <>
      <Pressable
        ref={ancla}
        collapsable={false}
        testID="selector-categoria-boton"
        accessibilityRole="button"
        accessibilityLabel={`${t('expense.category_selector_label')}: ${nombre}`}
        accessibilityState={{ expanded: abierto }}
        onPress={() => setAbierto(true)}
        style={[styles.disparador, { backgroundColor: c.surface, boxShadow: skin.elevation.e1.boxShadow }]}
      >
        <View style={[styles.icono, { backgroundColor: conAlfa(tinte, 0.16) }]}>
          <Ionicons name={actual.icon} size={20} color={tinte} />
        </View>
        <Text style={[Typography.bodyL, styles.nombre, { color: c.text }]} numberOfLines={1}>{nombre}</Text>
        <Ionicons name="chevron-down" size={18} color={c.textSecondary} />
      </Pressable>
      <SelectorAdaptativo
        visible={abierto} onClose={() => setAbierto(false)} ancla={ancla}
        opciones={opciones} seleccionado={value} onElegir={elegir}
        titulo={t('expense.category_selector_label')}
        accessibilityLabel={t('expense.category_selector_label')} testID="selector-categoria"
      />
    </>
  );
}

const styles = StyleSheet.create({
  disparador: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing[3],
    marginHorizontal: Spacing.screenPad, paddingHorizontal: Spacing[4], paddingVertical: Spacing[3],
    borderRadius: 18, borderCurve: 'continuous', minHeight: Spacing.tapTarget + Spacing[2],
  },
  icono: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  nombre: { flex: 1, fontWeight: '600' },
});
