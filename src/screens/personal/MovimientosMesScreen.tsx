import React, { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { DetailHeader, useRellenoDetailHeader } from '@/src/components/CollapsibleHeader';
import { useColors } from '@/src/skins/useSkin';
import { toMonthKey } from '@/src/store/personalStore';
import { monthLabel } from '@/src/screens/personal/utils/monthLabel';
import { mesDeParams } from '@/src/screens/personal/utils/rutaVerTodos';
import { movimientosDelMes } from '@/src/screens/personal/utils/movimientosDelMes';
import { useMovimientosPersonales } from '@/src/screens/personal/hooks/useMovimientosPersonales';
import { useRemoveEntry } from '@/src/screens/personal/hooks/useRemoveEntry';
import { MovimientosList } from '@/src/screens/personal/components/MovimientosList';

/** Todos los movimientos del mes que se estaba viendo en Personal (T-277). */
export default function MovimientosMesScreen() {
  const c = useColors();
  const { t } = useTranslation();
  const relleno = useRellenoDetailHeader();
  const { month } = useLocalSearchParams<{ month?: string }>();
  const mes = mesDeParams(month, toMonthKey(Date.now()));
  const todos = useMovimientosPersonales();
  const handleRemove = useRemoveEntry();
  // Mismo orden que Personal: más reciente primero.
  const entries = useMemo(
    () => [...movimientosDelMes(todos, mes)].sort((a, b) => b.date - a.date),
    [todos, mes],
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={relleno ? [] : ['top']}>
      <DetailHeader title={t('personal.all_movements_title')} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingTop: relleno, paddingBottom: 24 }}>
        <MovimientosList entries={entries} monthLabelText={monthLabel(mes)} onRemove={handleRemove} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1 } });
