import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useColors } from '@/src/skins/useSkin';

/**
 * Lápiz y tacho a la derecha del header del Detalle de gasto.
 * T-223: salió de `app/expense/[id].tsx`.
 */
export function AccionesDelHeader({ expenseId, puedeEditar, puedeBorrar, onBorrar }: {
  expenseId: string;
  puedeEditar: boolean;
  puedeBorrar: boolean;
  onBorrar: () => void;
}) {
  const c = useColors();
  return (
    <View style={styles.headerRight}>
      {/* T-185: en `open`, cualquier miembro — no sólo el creador. El
          borrado del creador (atajo rápido, distinto de la acción de
          abajo que ven todos) sigue siendo sólo suyo. */}
      {puedeEditar && (
        <Pressable
          testID="edit-expense-btn"
          onPress={() => router.push(`/expense/new?expenseId=${expenseId}` as any)}
          style={styles.iconBtn}
        >
          <Ionicons name="pencil-outline" size={20} color={c.brand.primary} />
        </Pressable>
      )}
      {puedeBorrar && (
        <Pressable onPress={onBorrar} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={20} color={c.semantic.negative} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRight:{ flexDirection: 'row', alignItems: 'center' },
  iconBtn:    { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
});
