import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Swipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { hapticLight } from '@/src/utils/haptics';
import { useTranslation } from 'react-i18next';

/**
 * Deslizar hacia la izquierda para archivar (o desarchivar).
 *
 * La acción se cierra sola después de ejecutarse: si la fila quedara abierta,
 * el elemento ya no está en esa lista y el panel quedaría flotando sobre otra
 * cosa.
 *
 * Archivar NO es borrar, y el rótulo lo dice: el grupo sigue entero con sus
 * gastos y sus saldos, sólo deja la lista principal.
 */
export function SwipeToArchive({
  onAction, archived = false, children,
}: {
  onAction: () => void;
  /** `true` cuando ya está archivado: el gesto pasa a desarchivar. */
  archived?: boolean;
  children: React.ReactNode;
}) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const c = Colors[scheme];
  const row = useRef<SwipeableMethods>(null);

  const color = archived ? c.brand.primary : c.semantic.neutral;

  return (
    <Swipeable
      ref={row}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      onSwipeableOpen={() => {
        hapticLight();
        onAction();
        row.current?.close();
      }}
      renderRightActions={() => (
        <View style={[styles.action, { backgroundColor: color }]}>
          <Ionicons
            name={archived ? 'arrow-undo-outline' : 'archive-outline'}
            size={20}
            color="#fff"
          />
          <Text style={[Typography.caption, styles.label]}>
            {archived ? t('groups.unarchive') : t('groups.archive')}
          </Text>
        </View>
      )}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    justifyContent: 'center', alignItems: 'center',
    width: 92, marginLeft: Spacing[2],
    borderRadius: Radius.md, gap: 4,
  },
  label: { color: '#fff', fontWeight: '600' },
});
