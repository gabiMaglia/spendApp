import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Radius } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { BottomSheet } from '@/src/components/Sheet';
import { traspasarGrupo } from '@/src/services/groupTraspaso';
import { useColors } from '@/src/skins/useSkin';
import type { Group, User } from '@/src/types/models';

/**
 * Confirmación del traspaso (T-058): crea el grupo nuevo con los saldos
 * arrastrados y navega a él. T-223: salió de `app/groups/[id].tsx`.
 */
export function HojaDeTraspaso({
  visible, onClose, group, currentUser, cantidadGastos,
}: {
  visible: boolean;
  onClose: () => void;
  group: Group;
  currentUser: User | null;
  cantidadGastos: number;
}) {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={[Typography.h3, { color: c.text, marginBottom: 8 }]}>
        {t('groups.traspaso_confirm_title')}
      </Text>
      <Text style={[Typography.bodyM, { color: c.textSecondary, marginBottom: 20 }]}>
        {t('groups.traspaso_confirm_body', { count: cantidadGastos })}
      </Text>
      <Pressable
        testID="traspaso-confirmar-btn"
        onPress={() => {
          if (!group || !currentUser) return;
          const nuevo = traspasarGrupo(
            group,
            t('groups.carryover_description', { name: group.name }),
            currentUser.id,
          );
          onClose();
          router.replace(`/groups/${nuevo.id}` as any);
        }}
        style={[styles.confirmBtn, { backgroundColor: c.brand.primary }]}
      >
        <Text style={{ color: '#fff', fontWeight: '700' }}>{t('groups.traspaso_confirm_action')}</Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  confirmBtn: { height: 50, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
});
