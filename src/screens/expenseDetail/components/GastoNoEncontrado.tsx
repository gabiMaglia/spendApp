import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';

/** Pantalla vacía cuando el id no resuelve a un gasto. T-223: salió de `app/expense/[id].tsx`. */
export function GastoNoEncontrado() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <View style={styles.notFound}>
        <Text style={[Typography.bodyL, { color: c.textSecondary }]}>
          {t('expense.not_found')}
        </Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[Typography.bodyM, { color: c.brand.primary }]}>
            {t('common.go_back')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1 },
  backBtn:   { width: 40, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  notFound:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});
