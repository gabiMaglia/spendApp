import React, { useRef, useState } from 'react';
import {
  Alert, Animated, Linking, Pressable, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { claveDeFallo, elegirAvatarDeGaleria, recortarAAvatar } from '@/src/services/avatar';
import { AvatarCropSheet } from '@/src/components/AvatarCropSheet';
import type { Recorte } from '@/src/algorithms/avatarCrop';
import { useAuthStore } from '@/src/store/authStore';
import { PRO_DISPONIBLE } from '@/src/store/tierStore';
import { actualizarMiPerfil } from '@/src/store/miPerfil';
import { useThemeStore } from '@/src/store/themeStore';
import { useLangStore, type LanguageChoice } from '@/src/store/langStore';
import { SUPPORTED_LANGUAGES } from '@/src/i18n';
import { useSettingsStore } from '@/src/store/settingsStore';
import { hueForUser } from '@/src/utils/hueForUser';
import { sanitizeUserName } from '@/src/utils/sanitizeUserName';
import { Avatar } from '@/src/components/Avatar';
import { BottomSheet } from '@/src/components/Sheet';
import { CurrencyPicker } from '@/src/components/CurrencyPicker';
import { useCurrenciesInUse } from '@/src/store/currenciesInUse';
import { needsRates, readCache } from '@/src/services/fx';
import { Band, BandRow, SectionLabel, Segmented, SoonBadge } from '@/src/components/Band';
import { TabHeader } from '@/src/components/TabHeader';
import { useHeaderPadding } from '@/src/components/CollapsibleHeader';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import {
  buildBackup, serializeBackup, parseBackup, applyBackup, backupFileName,
} from '@/src/services/backup';

export default function UserScreen() {
  const scheme = useColorScheme() ?? 'light';
  const headerPad = useHeaderPadding();
  const c = Colors[scheme];
  const { t, i18n } = useTranslation();
  const { currentUser, isPro, signOut } = useAuthStore();
  const scrollY = useRef(new Animated.Value(0)).current;

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');

  /** La imagen elegida, esperando que la persona ajuste el encuadre. */
  const [aRecortar, setARecortar] = useState<{ uri: string; width: number; height: number } | null>(null);

  async function cambiarFoto() {
    const r = await elegirAvatarDeGaleria();
    if (!r.ok) {
      const clave = claveDeFallo(r.motivo);
      if (clave) Alert.alert(t('profile.photo_error_title'), t(clave));
      return;
    }
    // No se guarda todavía: primero se elige QUÉ parte de la foto queda
    // (T-067). Antes se guardaba en el acto y el redimensionado la achataba.
    setARecortar({ uri: r.uri, width: r.width, height: r.height });
  }

  async function confirmarRecorte(recorte: Recorte) {
    const elegida = aRecortar;
    setARecortar(null);
    if (!elegida) return;

    const r = await recortarAAvatar(elegida.uri, recorte);
    if (!r.ok) {
      const clave = claveDeFallo(r.motivo);
      if (clave) Alert.alert(t('profile.photo_error_title'), t(clave));
      return;
    }
    actualizarMiPerfil({ avatar: r.dataUri });
  }

  function openEditName() {
    setDraftName(currentUser?.name ?? '');
    setEditingName(true);
  }

  function handleSaveName() {
    const clean = sanitizeUserName(draftName);
    if (!clean) return;
    if (!actualizarMiPerfil({ name: clean })) return;
    setEditingName(false);
  }

  const {
    notifExpenses, setNotifExpenses,
    notifDeletions, setNotifDeletions,
    notifInvites, setNotifInvites,
    notifSettlements, setNotifSettlements,
  } = useSettingsStore();
  const displayCurrency    = useSettingsStore(s => s.displayCurrency);
  const setDisplayCurrency = useSettingsStore(s => s.setDisplayCurrency);

  const monedasEnUso = useCurrenciesInUse();
  const fxCache      = readCache();

  const { themeChoice, setThemeChoice } = useThemeStore();

  const { choice: langChoice, setLanguage } = useLangStore();
  const langOptions: LanguageChoice[] = ['auto', ...SUPPORTED_LANGUAGES];
  const langLabel = (opt: LanguageChoice) =>
    opt === 'auto' ? t('profile.language_auto') : opt.toUpperCase();

  function handleSignOut() {
    Alert.alert(
      t('profile.sign_out'),
      t('profile.sign_out_confirm_body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('profile.sign_out'), style: 'destructive', onPress: signOut },
      ],
    );
  }

  function handleRateApp() {
    Linking.openURL('https://apps.apple.com/app/id000000000');
  }

  async function handleExport() {
    try {
      const file = new File(Paths.cache, backupFileName());
      file.write(serializeBackup(buildBackup()));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: t('backup.export'),
        });
      } else {
        Alert.alert(t('backup.export'), file.uri);
      }
    } catch {
      Alert.alert(t('backup.export_error'));
    }
  }

  async function handleImport() {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const raw = await new File(res.assets[0].uri).text();
      const backup = parseBackup(raw);
      Alert.alert(
        t('backup.import_confirm_title'),
        t('backup.import_confirm_body'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.save'),
            onPress: () => {
              try {
                applyBackup(backup);
                Alert.alert(t('backup.import_success'));
              } catch {
                Alert.alert(t('backup.import_error_title'));
              }
            },
          },
        ],
      );
    } catch (e: any) {
      const msg: string = typeof e?.message === 'string' ? e.message : '';
      const key = msg.startsWith('backup.') ? msg : 'backup.error_invalid_format';
      Alert.alert(t('backup.import_error_title'), t(key));
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        contentContainerStyle={{ paddingTop: headerPad, paddingBottom: 120 }}
      >
        <Text style={[Typography.display, styles.title, { color: c.text }]}>{t('profile.title')}</Text>

        {/* Mi cuenta */}
        <Band>
          <BandRow last>
            <Pressable
              testID="change-photo"
              accessibilityRole="button"
              accessibilityLabel={t('profile.change_photo')}
              onPress={cambiarFoto}
              hitSlop={8}
            >
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
                {currentUser?.email ?? ''}
              </Text>
            </View>
            <Pressable hitSlop={10} onPress={openEditName}>
              <Ionicons name="pencil-outline" size={17} color={c.textTertiary} />
            </Pressable>
          </BandRow>
        </Band>

        <BottomSheet visible={editingName} onClose={() => setEditingName(false)}>
          <Text style={[Typography.h3, { color: c.text, marginBottom: Spacing[3] }]}>
            {t('profile.edit_name_title')}
          </Text>
          <TextInput
            value={draftName}
            onChangeText={setDraftName}
            placeholder={t('profile.edit_name_placeholder')}
            placeholderTextColor={c.textTertiary}
            style={[styles.nameInput, { color: c.text, borderColor: c.hair, backgroundColor: c.bgGrouped }]}
            autoFocus
            maxLength={60}
            returnKeyType="done"
            onSubmitEditing={handleSaveName}
          />
          <View style={styles.sheetActions}>
            <Pressable style={[styles.sheetBtn, { backgroundColor: c.bgGrouped }]} onPress={() => setEditingName(false)}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.sheetBtn, {
                backgroundColor: c.brand.primary,
                opacity: sanitizeUserName(draftName) ? 1 : 0.5,
              }]}
              onPress={handleSaveName}
              disabled={!sanitizeUserName(draftName)}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>{t('common.save')}</Text>
            </Pressable>
          </View>
        </BottomSheet>

        {/* Plan — oculto mientras Pro no exista: ver PRO_DISPONIBLE en tierStore. */}
        {PRO_DISPONIBLE && (<>
        <SectionLabel label={t('profile.section_plan')} />
        <Band>
          <BandRow last>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[Typography.bodyL, { color: c.text }]}>
                {isPro ? t('profile.plan_pro') : t('profile.plan_free')}
              </Text>
              {!isPro && (
                <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('profile.free_daily')}</Text>
              )}
            </View>
            {isPro ? (
              <View style={[styles.pill, { backgroundColor: c.brand.primary }]}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>PRO</Text>
              </View>
            ) : (
              <Pressable style={[styles.pill, { backgroundColor: c.brand.primary }]}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>{t('profile.try_pro')}</Text>
              </Pressable>
            )}
          </BandRow>
        </Band>
        </>)}

        {/* Notificaciones */}
        <SectionLabel label={t('profile.section_notifications')} />
        <Band>
          <ToggleRow label={t('profile.notif_expenses')}    value={notifExpenses}    onChange={setNotifExpenses} />
          <ToggleRow label={t('profile.notif_deletions')}   value={notifDeletions}   onChange={setNotifDeletions} />
          <ToggleRow label={t('profile.notif_invites')}     value={notifInvites}     onChange={setNotifInvites} />
          <ToggleRow label={t('profile.notif_settlements')} value={notifSettlements} onChange={setNotifSettlements} last />
        </Band>

        {/* Apariencia */}
        <SectionLabel label={t('profile.section_appearance')} />
        <Band>
          <BandRow>
            <Text style={[Typography.bodyL, { color: c.text, flex: 1 }]}>{t('profile.theme')}</Text>
            <Segmented
              compact
              value={themeChoice}
              onChange={setThemeChoice}
              options={[
                { key: 'auto',  label: t('profile.theme_auto') },
                { key: 'light', label: t('profile.theme_light') },
                { key: 'dark',  label: t('profile.theme_dark') },
              ]}
            />
          </BandRow>
          <BandRow last>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[Typography.bodyL, { color: c.text }]}>{t('profile.skins')}</Text>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('profile.coming_soon')}</Text>
            </View>
            <SoonBadge />
          </BandRow>
        </Band>

        {/* Moneda */}
        <SectionLabel label={t('profile.section_currency')} />
        <Band>
          <CurrencyPicker
            value={displayCurrency}
            onChange={setDisplayCurrency}
            ratesFetchedAt={fxCache?.fetchedAt ?? null}
            ratesNeeded={needsRates(monedasEnUso, displayCurrency)}
            locale={i18n.language}
          />
        </Band>

        {/* Idioma */}
        <SectionLabel label={t('profile.section_language')} />
        <Band>
          <BandRow last>
            <Text style={[Typography.bodyL, { color: c.text, flex: 1 }]}>{t('profile.language')}</Text>
            <Segmented
              compact
              value={langChoice}
              onChange={setLanguage}
              options={langOptions.map(opt => ({ key: opt, label: langLabel(opt) }))}
            />
          </BandRow>
        </Band>

        {/* Tienda */}
        <SectionLabel label={t('profile.section_store')} />
        <Band>
          <LinkRow label={t('profile.rate')}     icon="star-outline"      onPress={handleRateApp} />
          <LinkRow label={t('profile.feedback')} icon="chatbubble-outline" onPress={handleRateApp} last />
        </Band>

        {/* Copia de seguridad */}
        <SectionLabel label={t('backup.section')} />
        <Band>
          <LinkRow label={t('backup.export')} icon="download-outline"     onPress={handleExport} />
          <LinkRow label={t('backup.import')} icon="cloud-upload-outline" onPress={handleImport} last />
        </Band>

        {/* Seguridad */}
        <SectionLabel label={t('profile.section_security')} />
        <Band>
          <BandRow last>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[Typography.bodyL, { color: c.text }]}>{t('profile.biometric')}</Text>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('profile.biometric_sub')}</Text>
            </View>
            <SoonBadge />
          </BandRow>
        </Band>

        <View style={{ paddingHorizontal: Spacing.screenPad, paddingTop: 26 }}>
          <Pressable
            onPress={handleSignOut}
            style={[styles.signOutBtn, { backgroundColor: c.surface, borderColor: c.hair }]}
          >
            <Ionicons name="log-out-outline" size={17} color={c.semantic.negative} />
            <Text style={{ fontSize: 14, fontWeight: '700', color: c.semantic.negative }}>
              {t('profile.sign_out')}
            </Text>
          </Pressable>
        </View>

        {__DEV__ && (
          <>
            <SectionLabel label="DEV" />
            <Band>
              <LinkRow label="WebRTC spike"          icon="hardware-chip-outline" onPress={() => router.push('/debug/webrtc' as any)} />
              <LinkRow label="Identidad de cuentas"  icon="finger-print-outline"  onPress={() => router.push('/debug/identity' as any)} />
              <LinkRow label="Relay (buzón)"         icon="cloud-upload-outline"  onPress={() => router.push('/debug/relay' as any)} last />
            </Band>
          </>
        )}

        <Text style={[Typography.caption, styles.version, { color: c.textTertiary }]}>
          {t('profile.version', { version: '1.0.0' })}
        </Text>
      </Animated.ScrollView>

      <TabHeader title={t('profile.title')} scrollY={scrollY} />

      <AvatarCropSheet
        visible={aRecortar !== null}
        uri={aRecortar?.uri ?? null}
        width={aRecortar?.width ?? 1}
        height={aRecortar?.height ?? 1}
        onCancel={() => setARecortar(null)}
        onConfirm={confirmarRecorte}
      />
    </SafeAreaView>
  );
}

function ToggleRow({
  label, value, onChange, last,
}: { label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <BandRow last={last}>
      <Text style={[Typography.bodyL, { color: c.text, flex: 1 }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: c.hair, true: c.brand.primary }}
        thumbColor="#fff"
      />
    </BandRow>
  );
}

function LinkRow({
  label, icon, onPress, last,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  last?: boolean;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <BandRow onPress={onPress} last={last}>
      <Ionicons name={icon} size={17} color={c.textSecondary} />
      <Text style={[Typography.bodyL, { color: c.text, flex: 1 }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={15} color={c.textTertiary} />
    </BandRow>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1 },
  title:     { paddingHorizontal: Spacing.screenPad, paddingBottom: 16 },
  pill:      { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full },
  nameInput: {
    borderWidth: 1, borderRadius: Radius.md,
    paddingHorizontal: Spacing[4], paddingVertical: 12, fontSize: 16,
  },
  sheetActions: { flexDirection: 'row', gap: Spacing[2], marginTop: Spacing[4] },
  sheetBtn:     { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: Radius.md },
  signOutBtn:   {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: Radius.lg, borderWidth: 1,
  },
  version:      { textAlign: 'center', marginTop: 18 },
});
