import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';
import { conAlfa } from '@/src/skins/color';

/**
 * «Pagado por [vos] y dividido [en partes iguales]» — la frase de Splitwise
 * (feat/reskin, B4). Cada parte resaltada abre su hoja; debajo, el resumen.
 */
export function FraseDeReparto({
  payerLabel, splitLabel, resumen, onOpenPayer, onOpenSplit,
}: {
  payerLabel: string;
  splitLabel: string;
  resumen: string;
  onOpenPayer: () => void;
  onOpenSplit: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  // PO 2026-11-03: el marco de 1,5 pt casi negro pesaba más que la frase.
  const boton = [styles.boton, { borderColor: conAlfa(c.brand.primary, 0.28), backgroundColor: conAlfa(c.brand.primary, 0.06) }];
  const textoBoton = [Typography.bodyL, { color: c.brand.primary, fontWeight: '700' as const }];
  return (
    <View style={styles.bloque}>
      <View style={styles.frase}>
        <Text style={[Typography.bodyM, styles.texto, { color: c.textSecondary }]}>{t('expense.phrase_paid_by')}</Text>
        <Pressable testID="frase-pagador" accessibilityRole="button" onPress={onOpenPayer} style={boton}>
          <Text style={textoBoton}>{payerLabel}</Text>
        </Pressable>
        <Text style={[Typography.bodyM, styles.texto, { color: c.textSecondary }]}>{t('expense.phrase_and_split')}</Text>
        <Pressable testID="frase-reparto" accessibilityRole="button" onPress={onOpenSplit} style={boton}>
          <Text style={textoBoton}>{splitLabel}</Text>
        </Pressable>
      </View>
      <Text style={[Typography.bodyS, { color: c.textTertiary }]}>{resumen}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bloque: { alignItems: 'center', gap: 8, paddingHorizontal: Spacing.screenPad + 4 },
  frase: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 6 },
  texto: { fontSize: 16 },
  boton: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, minHeight: 34, justifyContent: 'center' },
});
