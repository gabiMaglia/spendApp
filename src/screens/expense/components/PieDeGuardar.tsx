import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { RecurrencePicker, type RecurrenceValue } from '@/src/components/RecurrencePicker';
import { ADS_DISPONIBLES } from '@/src/store/tierStore';
import { useColors } from '@/src/skins/useSkin';

/**
 * Lo que va debajo del reparto en Nuevo gasto: contador de gastos gratis,
 * repetición, avisos de grupo archivado / al tope, y Guardar. Devuelve un
 * fragmento: cada pieza es un bloque del scroll, con el mismo aire entre
 * bloques. T-223: salió de `app/expense/new.tsx`.
 */
export function PieDeGuardar({
  isEditMode, isPro, dailyCount, pasoElTope, recurrence, onRecurrenceChange,
  grupoArchivado, grupoBloqueadoPorLimite, canSave, needsAd, onSave,
}: {
  isEditMode: boolean;
  isPro: boolean;
  dailyCount: number;
  pasoElTope: boolean;
  recurrence: RecurrenceValue;
  onRecurrenceChange: (v: RecurrenceValue) => void;
  grupoArchivado: boolean;
  grupoBloqueadoPorLimite: boolean;
  canSave: boolean;
  needsAd: boolean;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <>
      {/* El contador de gastos gratis del día. Oculto mientras no haya
          anuncios: sin anuncios no hay tope que cruzar —`requiresRewardedAd`
          devuelve siempre false— y mostrarlo anuncia un límite que la app no
          aplica. Vuelve solo el día que `ADS_DISPONIBLES` pase a true. */}
      {ADS_DISPONIBLES && !isEditMode && !isPro && (
        <View style={[styles.tierRow, {
          backgroundColor: c.semantic.warningSoft,
          borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.hair,
        }]}>
          <Ionicons name="information-circle-outline" size={16} color={c.semantic.warning} />
          <Text style={[Typography.bodyS, { color: c.semantic.warning, flex: 1 }]}>
            {t('expense.free_count', { count: dailyCount })}{' '}
            {pasoElTope ? t('expense.free_over') : ''}
          </Text>
        </View>
      )}

      {/* Repetición — sólo al crear; editar una ocurrencia no toca la serie.
          El padding lateral vive DENTRO de `RecurrencePicker` (T-118). */}
      {!isEditMode && <RecurrencePicker value={recurrence} onChange={onRecurrenceChange} />}

      {grupoArchivado && (
        <Text style={[Typography.caption, styles.aviso, { color: c.semantic.negative }]}>
          {t('groups.archived_readonly_hint')}
        </Text>
      )}

      {grupoBloqueadoPorLimite && (
        <Text style={[Typography.caption, styles.aviso, { color: c.semantic.negative }]}>
          {t('groups.limit_blocked_hint')}
        </Text>
      )}

      {/* Save button — píldora con ícono (rediseño 2026-09-22). */}
      <Pressable
        onPress={onSave}
        disabled={!canSave}
        testID="expense-save-btn"
        style={[styles.saveBtn, styles.savePad, { backgroundColor: canSave ? c.brand.primary : c.bgGrouped }]}
      >
        <Ionicons
          name="checkmark-circle"
          size={19}
          color={canSave ? '#fff' : c.textDisabled}
        />
        <Text style={[Typography.bodyL, { color: canSave ? '#fff' : c.textDisabled, fontWeight: '700' }]}>
          {/* El botón NO promete un anuncio que no existe. */}
          {!isEditMode && needsAd ? t('expense.save_with_ad') : t('expense.save')}
        </Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  tierRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: Spacing.screenPad, paddingVertical: Spacing.rowPadV,
  },
  aviso: { textAlign: 'center', marginBottom: 8 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: Radius.full, borderCurve: 'continuous', height: 52,
  },
  /**
   * `marginTop: 'auto'` empuja Guardar al fondo cuando sobra lugar: un gasto
   * personal tiene la mitad de bloques que uno de grupo y quedaba un vacío
   * enorme debajo del botón. Necesita el `flexGrow: 1` del contenedor del
   * scroll en la pantalla.
   */
  savePad: { marginHorizontal: Spacing.screenPad, marginTop: 'auto' },
});
