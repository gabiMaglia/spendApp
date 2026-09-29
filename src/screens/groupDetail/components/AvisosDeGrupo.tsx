import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { SyncWarningBanner } from '@/src/components/SyncWarningBanner';
import { claveDeFalloDeSync, type useGroupSyncFailure } from '@/src/hooks/useSyncFailure';
import { debeAvisar } from '@/src/algorithms/groupExpenseLimit';
import { useColors } from '@/src/skins/useSkin';

/**
 * Los avisos de arriba del detalle: sync fallido, manifiesto incompleto y
 * el aviso de traspaso por límite de gastos. Devuelve un fragmento: cada
 * aviso es un bloque del scroll. T-223: salió de `app/groups/[id].tsx`.
 */
export function AvisosDeGrupo({
  falloDeSync, manifiestoIncompleto, cantidadGastos, grupoArchivado, onTraspasar,
}: {
  falloDeSync: ReturnType<typeof useGroupSyncFailure>;
  manifiestoIncompleto: boolean;
  cantidadGastos: number;
  grupoArchivado: boolean;
  onTraspasar: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <>
      {falloDeSync && (
        <SyncWarningBanner
          title={t('sync.failure_title')}
          body={t(claveDeFalloDeSync(falloDeSync.reason))}
        />
      )}

      {manifiestoIncompleto && !falloDeSync && (
        <SyncWarningBanner
          title={t('sync.manifest_gap_title')}
          body={t('sync.manifest_gap_body')}
        />
      )}

      {debeAvisar(cantidadGastos) && !grupoArchivado && (
        <View testID="traspaso-banner" style={[styles.avisoTraspaso, { backgroundColor: c.semantic.warningSoft }]}>
          <Text style={[Typography.bodyS, { color: c.semantic.warning }]}>
            {t('groups.limit_warning_body', { count: cantidadGastos })}
          </Text>
          <Pressable
            onPress={onTraspasar}
            style={[styles.avisoBtn, { backgroundColor: c.brand.primary }]}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>{t('groups.limit_warning_action')}</Text>
          </Pressable>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  avisoTraspaso: {
    marginHorizontal: Spacing.screenPad, marginTop: Spacing[3],
    padding: Spacing[4], borderRadius: Radius.md, gap: Spacing[2],
  },
  avisoBtn: {
    alignSelf: 'flex-start', paddingHorizontal: Spacing[4], paddingVertical: Spacing[2],
    borderRadius: Radius.sm,
  },
});
