import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { textFor } from '@/src/services/notifications';
import type { StoredNotice } from '@/src/store/noticeInboxStore';
import { BottomSheet } from './Sheet';

/**
 * La bandeja: qué pasó mientras no mirabas.
 *
 * Tocar un aviso lo marca leído y lleva a su grupo. Marcar como leído NO borra:
 * el aviso queda en la lista, apagado. Borrarlo al leerlo haría que revisar la
 * bandeja destruyera la información que uno fue a buscar.
 */
export function NoticeInboxSheet({
  visible, items, onClose, onOpenNotice, onMarkAll,
}: {
  visible: boolean;
  items: StoredNotice[];
  onClose: () => void;
  onOpenNotice: (item: StoredNotice) => void;
  onMarkAll: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();
  const haySinLeer = items.some(i => i.readAt === null);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={[Typography.bodyL, { color: c.text, fontWeight: '700', flex: 1 }]}>
          {t('notifications.inbox_title')}
        </Text>
        {haySinLeer && (
          <Pressable accessibilityRole="button" onPress={onMarkAll} hitSlop={6}>
            <Text style={[Typography.bodyS, { color: c.brand.primary, fontWeight: '600' }]}>
              {t('notifications.inbox_mark_all')}
            </Text>
          </Pressable>
        )}
      </View>

      {items.length === 0 ? (
        <View testID="inbox-empty" style={styles.vacio}>
          <Ionicons name="notifications-off-outline" size={26} color={c.textTertiary} />
          <Text style={[Typography.bodyM, { color: c.textSecondary, fontWeight: '600' }]}>
            {t('notifications.inbox_empty')}
          </Text>
          <Text style={[Typography.bodyS, { color: c.textTertiary, textAlign: 'center' }]}>
            {t('notifications.inbox_empty_hint')}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.lista}>
          {items.map(item => {
            const { title, body } = textFor(item.notice);
            const sinLeer = item.readAt === null;
            return (
              <Pressable
                key={item.id}
                testID={`notice-${item.id}`}
                accessibilityRole="button"
                onPress={() => onOpenNotice(item)}
                style={[styles.item, { backgroundColor: sinLeer ? c.brand.primarySoft : c.surfaceSunken }]}
              >
                <View style={[styles.punto, { backgroundColor: sinLeer ? c.brand.primary : 'transparent' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[Typography.bodyM, {
                    color: sinLeer ? c.text : c.textSecondary,
                    fontWeight: sinLeer ? '700' : '500',
                  }]}>
                    {title}
                  </Text>
                  <Text style={[Typography.bodyS, { color: c.textTertiary }]}>{body}</Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={c.textTertiary} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], paddingBottom: Spacing[3] },
  vacio:  { alignItems: 'center', gap: Spacing[2], paddingVertical: Spacing[7] },
  lista:  { maxHeight: 380 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing[3],
    padding: Spacing[3], borderRadius: Radius.sm, marginBottom: Spacing[2],
  },
  punto:  { width: 7, height: 7, borderRadius: 4 },
});
