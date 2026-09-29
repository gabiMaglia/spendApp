import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { DetailHeader } from '@/src/components/CollapsibleHeader';
import { ActionButton } from '@/src/components/ActionButton';
import { ButtonRack } from '@/src/components/ButtonRack';
import { Band, BandRow } from '@/src/components/Band';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import { useAuthStore } from '@/src/store/authStore';
import { useColors } from '@/src/skins/useSkin';
import { TarjetaTransferencia } from '@/src/screens/settle/components/TarjetaTransferencia';
import { estilos } from '@/src/screens/settle/components/estilos';
import { useSaldoConAmigo } from '@/src/screens/settle/hooks/useSaldoConAmigo';

/**
 * Saldar desde Amigos (T-225): lo que le debo en cada grupo compartido y el
 * total. No hay monto editable — el PO decidió que desde acá se salda todo.
 */
export function SaldarConAmigo({ amigoId }: { amigoId: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const yo = useAuthStore(s => s.currentUser?.id ?? '');
  const { pagos, totales, confirmar, puedeGuardar } = useSaldoConAmigo(amigoId);

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      <DetailHeader icon="close" title={t('settle.title')} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <TarjetaTransferencia fromId={yo} toId={amigoId} onPressFrom={undefined} onPressTo={undefined} />

        {pagos.length === 0 ? (
          <Text style={[Typography.bodyM, { color: c.textSecondary }]}>{t('settle.friend_nothing')}</Text>
        ) : (
          <>
            <Text style={[Typography.label, { color: c.textTertiary }]}>{t('settle.friend_groups_label')}</Text>
            <Band style={estilos.card}>
              {pagos.map(p => (
                <BandRow key={`${p.groupId}|${p.currency}`} testID={`settle-friend-${p.groupId}`}>
                  <Text style={[Typography.bodyM, { color: c.text, flex: 1 }]} numberOfLines={1}>{p.groupName}</Text>
                  <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]}>
                    {formatMoney(p.amount, p.currency)}
                  </Text>
                </BandRow>
              ))}
              <BandRow last testID="settle-friend-total">
                <Text style={[Typography.bodyM, { color: c.textSecondary, flex: 1 }]}>{t('settle.friend_total')}</Text>
                {/* Una línea por moneda: los totales nunca se mezclan ni se convierten. */}
                <View style={styles.totales}>
                  {totales.map(x => (
                    <Text key={x.currency} style={[Typography.bodyL, { color: c.text, fontWeight: '700' }]}>
                      {formatMoney(x.amount, x.currency)}
                    </Text>
                  ))}
                </View>
              </BandRow>
            </Band>
            <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('settle.friend_whole_only')}</Text>
          </>
        )}

        <ButtonRack>
          <ActionButton
            testID="settle-save"
            label={t('settle.title')}
            size="lg"
            full
            disabled={!puedeGuardar}
            action={confirmar}
          />
        </ButtonRack>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1 },
  scroll:  { paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[4], gap: Spacing[3] },
  totales: { alignItems: 'flex-end' },
});
