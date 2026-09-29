import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { UserAvatar } from '@/src/components/UserAvatar';
import { Band, SectionLabel } from '@/src/components/Band';
import { useColors } from '@/src/skins/useSkin';

/**
 * Fila horizontal de miembros; tocar uno ofrece expulsarlo (sólo al creador).
 * T-223: salió de `app/groups/[id].tsx`.
 */
export function MiembrosDeGrupo({
  uids, getUserName, onPressMember,
}: {
  uids: string[];
  getUserName: (id: string) => string;
  onPressMember: (uid: string) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <>
      <SectionLabel label={t('group_detail.members_label', { count: uids.length })} />
      <Band>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.members}>
          {uids.map(uid => (
            <Pressable
              key={uid}
              testID={`member-${uid}`}
              onPress={() => onPressMember(uid)}
              style={{ alignItems: 'center', gap: 5, width: 56 }}
            >
              <UserAvatar userId={uid} name={getUserName(uid)} size={40} />
              <Text style={[Typography.caption, { color: c.textTertiary }]} numberOfLines={1}>
                {getUserName(uid).split(' ')[0]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </Band>
    </>
  );
}

const styles = StyleSheet.create({
  members: { paddingHorizontal: Spacing.screenPad, paddingVertical: 14, gap: 14 },
});
