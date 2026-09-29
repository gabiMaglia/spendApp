import React from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';
import { GAP_FILA } from '@/src/components/sheet/constantes';

/** Campo de texto del sheet: fondo hundido, borde hairline, 48pt. */
export const SheetInput = React.forwardRef<
  TextInput,
  TextInputProps & { icon?: React.ComponentProps<typeof Ionicons>['name'] }
>(function SheetInput({ icon, style, multiline, ...rest }, ref) {
  const c = useColors();
  return (
    <View
      style={[
        styles.input,
        {
          backgroundColor: c.bgGrouped,
          borderColor: c.hair,
          alignItems: multiline ? 'flex-start' : 'center',
          minHeight: multiline ? 104 : 48,
        },
      ]}
    >
      {icon ? (
        <Ionicons name={icon} size={17} color={c.textTertiary} style={{ marginTop: multiline ? 2 : 0 }} />
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={c.textTertiary}
        multiline={multiline}
        style={[
          Typography.bodyM,
          { flex: 1, color: c.text, padding: 0, textAlignVertical: multiline ? 'top' : 'center' },
          style,
        ]}
        {...rest}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  input:     {
    flexDirection: 'row', gap: GAP_FILA,
    // Sin margen propio: el aire lateral ya lo pone `bodyPad`.
    marginTop: Spacing[3],
    paddingHorizontal: Spacing[4], paddingVertical: Spacing[3],
    borderRadius: Radius.md, borderWidth: 1,
  },
});
