import React from 'react';
import { Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Typography } from '@/src/constants/typography';
import { BandRow } from '@/src/components/Band';
import { useColors } from '@/src/skins/useSkin';

export function ToggleRow({
  label, value, onChange, last, sub,
}: {
  label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean;
  /** Segunda línea, para las filas que necesitan aclarar qué hacen. */
  sub?: string;
}) {
  const c = useColors();
  return (
    <BandRow last={last}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[Typography.bodyL, { color: c.text }]}>{label}</Text>
        {sub ? <Text style={[Typography.caption, { color: c.textTertiary }]}>{sub}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: c.hair, true: c.brand.primary }}
        thumbColor="#fff"
      />
    </BandRow>
  );
}

export function LinkRow({
  label, icon, onPress, last, sub,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  last?: boolean;
  /** Segunda línea, para las filas que necesitan aclarar qué hacen. */
  sub?: string;
}) {
  const c = useColors();
  return (
    <BandRow onPress={onPress} last={last}>
      <Ionicons name={icon} size={17} color={c.textSecondary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[Typography.bodyL, { color: c.text }]}>{label}</Text>
        {sub ? <Text style={[Typography.caption, { color: c.textTertiary }]}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={15} color={c.textTertiary} />
    </BandRow>
  );
}
