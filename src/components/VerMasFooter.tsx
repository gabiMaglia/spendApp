import React from 'react';
import { View } from 'react-native';
import { ActionButton } from '@/src/components/ActionButton';
import { Spacing } from '@/src/constants/spacing';

/** Pie de lista «Ver más». Recibe el texto ya traducido (sin `t()` en reutilizables). */
export function VerMasFooter({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <View style={{ paddingTop: Spacing[4] }}>
      <ActionButton action={onPress} label={label} variant="secondary" full testID="ver-mas" />
    </View>
  );
}
