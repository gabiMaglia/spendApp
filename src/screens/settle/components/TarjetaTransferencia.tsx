import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Band } from '@/src/components/Band';
import { UserAvatar } from '@/src/components/UserAvatar';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useUserStore } from '@/src/store/userStore';
import { esYo } from '@/src/store/identityAlias';
import { useColors } from '@/src/skins/useSkin';
import { estilos } from '@/src/screens/settle/components/estilos';

/**
 * Quién le paga a quién. T-223: salió de `app/settle/new.tsx`; los dos lados
 * eran el mismo JSX repetido, ahora son `LadoTransferencia`.
 */
export function TarjetaTransferencia({
  fromId, toId, onPressFrom, onPressTo,
}: {
  fromId: string;
  toId: string;
  onPressFrom: (() => void) | undefined;
  onPressTo: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const getUserName = useUserStore(s => s.getUserName);

  return (
    <Band style={estilos.card}>
    <View style={styles.transferCard}>
      <LadoTransferencia
        label={t('settle.from_label')}
        userId={fromId}
        nombre={esYo(fromId) ? t('common.you') : getUserName(fromId)}
        vacio={t('settle.select')}
        onPress={onPressFrom}
      />

      <View style={[styles.arrowBox, { backgroundColor: c.bgGrouped }]}>
        <Ionicons name="arrow-forward" size={18} color={c.textSecondary} />
      </View>

      <LadoTransferencia
        label={t('settle.to_label')}
        userId={toId}
        nombre={getUserName(toId)}
        vacio={t('settle.select')}
        onPress={onPressTo}
      />
    </View>
    </Band>
  );
}

function LadoTransferencia({
  label, userId, nombre, vacio, onPress,
}: {
  label: string;
  userId: string;
  nombre: string;
  vacio: string;
  onPress: (() => void) | undefined;
}) {
  const c = useColors();
  const getUserName = useUserStore(s => s.getUserName);

  return (
    <Pressable onPress={onPress} style={styles.transferSide}>
      <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', marginBottom: 8 }]}>
        {label}
      </Text>
      {userId ? (
        <View style={styles.transferUser}>
          <UserAvatar userId={userId} name={getUserName(userId)} size={36} />
          <Text style={[Typography.bodyS, { color: c.text, fontWeight: '600', textAlign: 'center' }]} numberOfLines={2}>
            {nombre}
          </Text>
        </View>
      ) : (
        <Text style={[Typography.bodyM, { color: c.textTertiary }]}>{vacio}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Ídem: la caja es de `Band`, esto es sólo el reparto en dos columnas.
  transferCard:   { flexDirection: 'row', alignItems: 'center', padding: Spacing[4] },
  transferSide:   { flex: 1, alignItems: 'center' },
  transferUser:   { alignItems: 'center', gap: 6, maxWidth: 90 },
  arrowBox:       {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 8,
  },
});
