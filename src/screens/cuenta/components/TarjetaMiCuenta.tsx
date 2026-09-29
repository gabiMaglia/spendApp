import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Typography } from '@/src/constants/typography';
import { hueForUser } from '@/src/utils/hueForUser';
import { Avatar } from '@/src/components/Avatar';
import { Band, BandRow } from '@/src/components/Band';
import { useColors } from '@/src/skins/useSkin';
import type { User } from '@/src/types/models';

/** «Mi cuenta»: foto (tocable para cambiarla), nombre, email y el lápiz. */
export function TarjetaMiCuenta({ currentUser, onCambiarFoto, onEditar }: {
  currentUser: User | null;
  onCambiarFoto: () => void;
  onEditar: () => void;
}) {
  const c = useColors();
  const { t } = useTranslation();
  return (
    <Band noTop>
      <BandRow last>
        <Pressable
          testID="change-photo"
          accessibilityRole="button"
          accessibilityLabel={t('profile.change_photo')}
          onPress={onCambiarFoto}
          hitSlop={8}
        >
          {/* El propio perfil: la foto sale de `authStore` y se pasa explícita. */}
          <Avatar
            name={currentUser?.name ?? '?'}
            hue={hueForUser(currentUser?.id ?? '')}
            photo={currentUser?.avatar}
            size={52}
          />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[Typography.h3, { color: c.text }]} numberOfLines={1}>
            {currentUser?.name ?? t('profile.no_name')}
          </Text>
          <Text style={[Typography.caption, { color: c.textTertiary }]} numberOfLines={1}>
            {currentUser?.email || t('profile.no_email')}
          </Text>
        </View>
        <Pressable testID="edit-profile-btn" hitSlop={10} onPress={onEditar}>
          <Ionicons name="pencil-outline" size={17} color={c.textTertiary} />
        </Pressable>
      </BandRow>
    </Band>
  );
}
