import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { BottomSheet } from '@/src/components/Sheet';
import { useColors } from '@/src/skins/useSkin';
import type { useEditarPerfil } from '@/src/screens/cuenta/hooks/useEditarPerfil';

/** Hoja única para editar nombre y email (PO 2026-09-22). */
export function HojaEditarPerfil({ perfil }: { perfil: ReturnType<typeof useEditarPerfil> }) {
  const c = useColors();
  const { t } = useTranslation();
  const {
    editingProfile, cerrar, draftName, setDraftName, draftEmail, setDraftEmail,
    emailEditable, valido, handleSaveProfile,
  } = perfil;

  return (
    <BottomSheet visible={editingProfile} onClose={cerrar}>
      <Text style={[Typography.h3, { color: c.text, marginBottom: Spacing[3] }]}>
        {t('profile.edit_profile_title')}
      </Text>

      <Text style={[Typography.label, styles.upper, { color: c.textTertiary, marginBottom: 6 }]}>
        {t('profile.name_label')}
      </Text>
      <TextInput
        value={draftName}
        onChangeText={setDraftName}
        placeholder={t('profile.edit_name_placeholder')}
        placeholderTextColor={c.textTertiary}
        style={[styles.nameInput, { color: c.text, borderColor: c.hair, backgroundColor: c.bgGrouped }]}
        autoFocus
        maxLength={60}
        returnKeyType="next"
      />

      <Text style={[Typography.label, styles.upper, { color: c.textTertiary, marginTop: Spacing[3], marginBottom: 6 }]}>
        {t('profile.edit_email_title')}
      </Text>
      {emailEditable ? (
        // PO 2026-09-22: Apple sólo manda el email la 1ª vez por Apple ID
        // (y nunca con "Ocultar mi correo"). Editarlo a mano es la única
        // forma de completarlo o corregirlo acá; queda opcional, no como
        // el nombre.
        <TextInput
          value={draftEmail}
          onChangeText={setDraftEmail}
          placeholder={t('profile.edit_email_placeholder')}
          placeholderTextColor={c.textTertiary}
          style={[styles.nameInput, { color: c.text, borderColor: c.hair, backgroundColor: c.bgGrouped }]}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          maxLength={120}
          returnKeyType="done"
          onSubmitEditing={handleSaveProfile}
        />
      ) : (
        // Google: el email es el de la cuenta con la que se entra — se
        // muestra pero no se edita, para no desincronizarlo sin arreglar
        // nada (PO 2026-09-22).
        <View style={[styles.nameInput, { borderColor: c.hair, backgroundColor: c.bgGrouped, justifyContent: 'center' }]}>
          <Text testID="email-readonly" style={{ fontSize: 16, color: c.textSecondary }} numberOfLines={1}>
            {draftEmail || t('profile.no_email')}
          </Text>
        </View>
      )}

      <View style={styles.sheetActions}>
        <Pressable style={[styles.sheetBtn, { backgroundColor: c.bgGrouped }]} onPress={cerrar}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{t('common.cancel')}</Text>
        </Pressable>
        <Pressable
          style={[styles.sheetBtn, {
            backgroundColor: c.brand.primary,
            opacity: valido ? 1 : 0.5,
          }]}
          onPress={handleSaveProfile}
          disabled={!valido}
        >
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>{t('common.save')}</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  upper:     { textTransform: 'uppercase' },
  nameInput: {
    borderWidth: 1, borderRadius: Radius.md,
    paddingHorizontal: Spacing[4], paddingVertical: 12, fontSize: 16,
    minHeight: 48,
  },
  sheetActions: { flexDirection: 'row', gap: Spacing[2], marginTop: Spacing[4] },
  sheetBtn:     { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: Radius.md },
});
