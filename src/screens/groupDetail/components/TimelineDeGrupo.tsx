import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { Band, SectionLabel } from '@/src/components/Band';
import type { TrustState } from '@/src/algorithms/recordTrust';
import { useColors } from '@/src/skins/useSkin';
import { ExpenseRow, PaymentRow } from '@/src/screens/groupDetail/components/FilasDeTimeline';
import type { TimelineItem } from '@/src/screens/groupDetail/detalleDeGrupo';

/** Historial del grupo (gastos + pagos). T-223: salió de `app/groups/[id].tsx`. */
export function TimelineDeGrupo({
  timeline, currentUserId, getUserName, marcaDeGasto, marcaDePago,
}: {
  timeline: TimelineItem[];
  currentUserId: string;
  getUserName: (id: string) => string;
  marcaDeGasto: Readonly<Record<string, TrustState>>;
  marcaDePago: Readonly<Record<string, TrustState>>;
}) {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <>
      <SectionLabel label={t('group_detail.activity_label', { count: timeline.length })} />
      {timeline.length === 0 ? (
        <Band>
          <View style={styles.emptyBox}>
            <Ionicons name="receipt-outline" size={26} color={c.textTertiary} />
            <Text style={[Typography.bodyM, { color: c.textTertiary, marginTop: 8 }]}>
              {t('group_detail.no_activity')}
            </Text>
          </View>
        </Band>
      ) : (
        <Band>
          {timeline.map((item, i) =>
            item.type === 'expense' ? (
              <ExpenseRow
                key={item.data.id}
                expense={item.data}
                currentUserId={currentUserId}
                getUserName={getUserName}
                trust={marcaDeGasto[item.data.id]}
                last={i === timeline.length - 1}
              />
            ) : (
              <PaymentRow
                key={item.data.id}
                payment={item.data}
                currentUserId={currentUserId}
                getUserName={getUserName}
                trust={marcaDePago[item.data.id]}
                last={i === timeline.length - 1}
              />
            ),
          )}
        </Band>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  emptyBox: { alignItems: 'center', justifyContent: 'center', padding: Spacing[6] },
});
