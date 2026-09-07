import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import i18n from '@/src/i18n';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { hapticLight } from '@/src/utils/haptics';
import { UserAvatar } from './UserAvatar';
import type { ExpenseComment } from '@/src/types/models';
import { mismaPersona } from '@/src/store/identityAlias';

const MAX_LENGTH = 500;

export type CommentThreadProps = {
  comments: ExpenseComment[];
  currentUserId: string;
  /** Nombre a mostrar para cada autor. */
  authorName: (userId: string) => string;
  onAdd: (text: string) => void;
  onDelete: (commentId: string) => void;
};

/**
 * Hilo de comentarios de un gasto.
 *
 * Sólo se puede borrar lo propio: un comentario ajeno es dato de otra persona,
 * y borrarlo desde acá se propagaría por el sync sin que se entere.
 */
export function CommentThread({
  comments, currentUserId, authorName, onAdd, onDelete,
}: CommentThreadProps) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [draft, setDraft] = useState('');

  const canSend = draft.trim().length > 0;

  function send() {
    if (!canSend) return;
    hapticLight();
    onAdd(draft.trim());
    setDraft('');
  }

  function confirmDelete(comment: ExpenseComment) {
    Alert.alert(t('comments.delete_title'), t('comments.delete_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => onDelete(comment.id) },
    ]);
  }

  return (
    <View style={styles.wrap}>
      <Text style={[Typography.label, { color: c.textSecondary }]}>
        {t('comments.title')}
      </Text>

      {comments.length === 0 ? (
        <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
          {t('comments.empty')}
        </Text>
      ) : (
        <View style={styles.list}>
          {comments.map(comment => {
            const mine = mismaPersona(comment.authorId, currentUserId);
            const name = authorName(comment.authorId);
            return (
              <View key={comment.id} style={styles.row}>
                <UserAvatar userId={comment.authorId} name={name} size={28} />
                <View style={styles.bubbleWrap}>
                  <View style={styles.metaRow}>
                    <Text style={[Typography.bodyS, { color: c.text, fontWeight: '600' }]}>
                      {name}
                    </Text>
                    <Text style={[Typography.caption, { color: c.textTertiary }]}>
                      {new Date(comment.createdAt).toLocaleDateString(i18n.language, {
                        day: 'numeric', month: 'short',
                      })}
                    </Text>
                    {mine && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('comments.delete_title')}
                        onPress={() => confirmDelete(comment)}
                        hitSlop={10}
                        style={styles.deleteBtn}
                      >
                        <Ionicons name="trash-outline" size={14} color={c.textTertiary} />
                      </Pressable>
                    )}
                  </View>
                  <Text style={[Typography.bodyM, { color: c.text }]}>{comment.text}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={[styles.composer, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('comments.placeholder')}
          placeholderTextColor={c.textTertiary}
          maxLength={MAX_LENGTH}
          multiline
          style={[Typography.bodyM, styles.input, { color: c.text }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('comments.send')}
          accessibilityState={{ disabled: !canSend }}
          onPress={send}
          disabled={!canSend}
          hitSlop={8}
        >
          <Ionicons
            name="send"
            size={18}
            color={canSend ? c.brand.primary : c.textDisabled}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:       { gap: Spacing[3] },
  list:       { gap: Spacing[3] },
  row:        { flexDirection: 'row', gap: Spacing[2], alignItems: 'flex-start' },
  bubbleWrap: { flex: 1, gap: 2 },
  metaRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  deleteBtn:  { marginLeft: 'auto' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
  },
  input: { flex: 1, maxHeight: 120, padding: 0 },
});
