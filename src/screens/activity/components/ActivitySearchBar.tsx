import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColors } from '@/src/skins/useSkin';

export function ActivitySearchBar({
  value, onChangeText,
}: { value: string; onChangeText: (v: string) => void }) {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <View style={[styles.searchBar, { backgroundColor: c.bgGrouped, borderColor: c.hair }]}>
      <Ionicons name="search-outline" size={15} color={c.textTertiary} />
      <TextInput
        testID="activity-search"
        value={value}
        onChangeText={onChangeText}
        placeholder={t('activity.search_placeholder')}
        placeholderTextColor={c.textTertiary}
        style={[Typography.bodyM, { color: c.text, flex: 1, padding: 0 }]}
        returnKeyType="search"
        autoCorrect={false}
      />
      {value !== '' && (
        <Pressable
          testID="activity-search-clear"
          accessibilityRole="button"
          onPress={() => onChangeText('')}
          hitSlop={10}
        >
          <Ionicons name="close-circle" size={16} color={c.textTertiary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    marginHorizontal: Spacing.screenPad, marginTop: 12, marginBottom: 12,
    paddingHorizontal: 13, height: 40,
    borderRadius: Radius.md, borderWidth: 1,
  },
});
