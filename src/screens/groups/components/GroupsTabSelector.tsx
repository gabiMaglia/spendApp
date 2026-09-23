import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Segmented } from '@/src/components/Band';
import { hapticLight } from '@/src/utils/haptics';
import type { GroupsTab } from '@/src/screens/groups/hooks/useGroupsList';

/** Selector Activos/Archivados — pegado a los casilleros de arriba y al primer grupo (PO 2026-09-21). */
export function GroupsTabSelector({
  value, onChange,
}: { value: GroupsTab; onChange: (v: GroupsTab) => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.segPad}>
      <Segmented
        variant="tabs"
        borde="abajo"
        value={value}
        onChange={v => { hapticLight(); onChange(v); }}
        options={[
          { key: 'activos',    label: t('groups.tab_active'),   icon: 'folder-open-outline' },
          { key: 'archivados', label: t('groups.tab_archived'), icon: 'archive-outline' },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Sin padding lateral: las pestañas («T invertida») van de borde a borde.
  segPad: { paddingTop: 0, paddingBottom: 0 },
});
