import React, { useState } from 'react';
import {
  Alert, Linking, Pressable, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderColapsable } from '@/src/hooks/useHeaderColapsable';
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
import { TIENDA_DISPONIBLE, urlDeTienda } from '@/src/constants/tienda';
import { APP_VERSION } from '@/src/constants/version';
import { actualizarMiPerfil } from '@/src/store/miPerfil';
import { useThemeStore } from '@/src/store/themeStore';
import { useLangStore, type LanguageChoice } from '@/src/store/langStore';
import { SUPPORTED_LANGUAGES } from '@/src/i18n';
import { useSettingsStore } from '@/src/store/settingsStore';
import { hueForUser } from '@/src/utils/hueForUser';
import { sanitizeUserName } from '@/src/utils/sanitizeUserName';
import { sanitizeEmail } from '@/src/utils/sanitizeEmail';
import { Avatar } from '@/src/components/Avatar';
import { BottomSheet } from '@/src/components/Sheet';
import { CurrencyPicker } from '@/src/components/CurrencyPicker';
import { SkinPicker } from '@/src/components/SkinPicker';
import { useCurrenciesInUse } from '@/src/store/currenciesInUse';
import { needsRates, readCache } from '@/src/services/fx';
import { Band, BandRow, SectionLabel, Segmented, SoonBadge } from '@/src/components/Band';
import { SyncNoDisponible } from '@/src/components/SyncNoDisponible';
import { listErrors } from '@/src/services/errorLog';
import { exportarDiagnostico } from '@/src/services/exportDiagnostico';
import { useLiveValue } from '@/src/hooks/useLiveValue';
import { TabHeader } from '@/src/components/TabHeader';
import { useHeaderPadding, useLimiteContenido } from '@/src/components/CollapsibleHeader';
import { BudgetSheet } from '@/src/components/BudgetSheet';
import { usePersonalStore } from '@/src/store/personalStore';
import { formatMoney } from '@/src/constants/currencies';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { compartirArchivoTemporal } from '@/src/services/compartirArchivoTemporal';
import {
  buildBackup, serializeBackup, parseBackup, applyBackup, backupFileName,
} from '@/src/services/backup';

export default function UserScreen() {
  const scheme = useColorScheme() ?? 'light';
  const headerPad = useHeaderPadding(0);
  const limiteContenido = useLimiteContenido();
  const c = Colors[scheme];
  const { t, i18n } = useTranslation();
  const { currentUser, isPro, signOut } = useAuthStore();
  const { scrollHandler, progress, contenidoMinimo, alMedirScroll } = useHeaderColapsable();

  // Un solo botón/hoja para nombre y email (PO 2026-09-22): antes de esto había
  // dos hojas separadas. Apple sólo manda el email en el primer login de cada
  // Apple ID (y nunca si el usuario elige "Ocultar mi correo") — a diferencia
  // de Google, que siempre lo trae. Editarlo a mano es la única forma de que
  // quien entra con Apple pueda verlo/completarlo, igual que ya pasa con el
  // nombre (`mergeProviderUser`: lo guardado localmente gana sobre el proveedor).
  const [editingProfile, setEditingProfile] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftEmail, setDraftEmail] = useState('');

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

  function openEditProfile() {
    setDraftName(currentUser?.name ?? '');
    setDraftEmail(currentUser?.email ?? '');
    setEditingProfile(true);
  }

  // Google SIEMPRE manda el email y es el dato de la cuenta con la que se
  // entra — editarlo acá lo desincroniza de la cuenta real sin arreglar nada
  // (PO 2026-09-22). Apple es el caso contrario: sólo lo manda una vez y a
  // veces nunca, así que ahí sí hace falta poder completarlo/corregirlo.
  const emailEditable = currentUser?.authProvider !== 'google';

  /** El email es opcional (puede quedar vacío); si se escribe algo, tiene que
   *  tener forma de email. El nombre siempre es obligatorio. */
  function perfilDraftValido(): boolean {
    if (!sanitizeUserName(draftName)) return false;
    if (!emailEditable) return true;
    return draftEmail.trim() === '' || !!sanitizeEmail(draftEmail);
  }

  function handleSaveProfile() {
    const cleanName = sanitizeUserName(draftName);
    if (!cleanName) return;
    const cambios: { name: string; email?: string } = { name: cleanName };
    if (emailEditable) {
      const cleanEmail = draftEmail.trim() === '' ? '' : sanitizeEmail(draftEmail);
      if (cleanEmail === null) return;
      cambios.email = cleanEmail;
    }
    if (!actualizarMiPerfil(cambios)) return;
    setEditingProfile(false);
  }

  const {
    notifExpenses, setNotifExpenses,
    notifDeletions, setNotifDeletions,
    notifInvites, setNotifInvites,
    notifSettlements, setNotifSettlements,
    reduceAnimations, setReduceAnimations,
  } = useSettingsStore();
  const displayCurrency    = useSettingsStore(s => s.displayCurrency);
  const setDisplayCurrency = useSettingsStore(s => s.setDisplayCurrency);

  const monedasEnUso = useCurrenciesInUse();
  const fxCache      = readCache();

  const { budget } = usePersonalStore();
  const [showBudgetSheet, setShowBudgetSheet] = useState(false);

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
    void Linking.openURL(urlDeTienda());
  }

  // T-124 · SEC L-F: el respaldo trae nombre/email/gastos/comentarios de OTRAS
  // personas del grupo, en claro. El usuario tiene que saberlo ANTES de
  // elegir a dónde lo manda (WhatsApp, iCloud Drive, lo que sea) — confirmar
  // acá, no después, es lo único que puede evitar que lo mande sin pensar.
  function handleExport() {
    Alert.alert(
      t('backup.export_warning_title'),
      t('backup.export_warning_body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('backup.export_warning_confirm'), onPress: () => void ejecutarExport() },
      ],
    );
  }

  async function ejecutarExport() {
    try {
      await compartirArchivoTemporal(backupFileName(), serializeBackup(buildBackup()), t('backup.export'));
    } catch {
      Alert.alert(t('backup.export_error'));
    }
  }

  /**
   * El registro vive fuera de React (variable de módulo + storage), así que hay
   * que releerlo: si se lee sólo al montar, un error ocurrido con esta pantalla
   * abierta no hace aparecer la fila. Es el mismo motivo por el que existe
   * `useLiveValue`.
   */
  const erroresAnotados = useLiveValue(() => listErrors().length);

  async function handleExportDiagnostico() {
    await exportarDiagnostico({
      dialogTitle: t('error.export_diagnostics'),
      error: t('error.export_error'),
    });
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
        style={limiteContenido}
        onLayout={alMedirScroll}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        // paddingBottom 120→Spacing[6] (PO 2026-09-13): ese colchón grande era
        // para dejar lugar al FAB de otras tabs; "Yo" no tiene uno y el fondo
        // de la versión quedaba con un salto enorme y vacío. La SafeAreaView
        // (`edges=['bottom']`) ya cubre el inset del sistema, y como la tab
        // bar no es `position:absolute` React Navigation ya reserva su alto.
        contentContainerStyle={[{ paddingTop: headerPad, paddingBottom: Spacing[6] }, contenidoMinimo]}
      >

        {/* Mi cuenta */}
        <Band noTop>
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
                {currentUser?.email || t('profile.no_email')}
              </Text>
            </View>
            <Pressable testID="edit-profile-btn" hitSlop={10} onPress={openEditProfile}>
              <Ionicons name="pencil-outline" size={17} color={c.textTertiary} />
            </Pressable>
          </BandRow>
        </Band>

        <BottomSheet visible={editingProfile} onClose={() => setEditingProfile(false)}>
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
            <Pressable style={[styles.sheetBtn, { backgroundColor: c.bgGrouped }]} onPress={() => setEditingProfile(false)}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.sheetBtn, {
                backgroundColor: c.brand.primary,
                opacity: perfilDraftValido() ? 1 : 0.5,
              }]}
              onPress={handleSaveProfile}
              disabled={!perfilDraftValido()}
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

        {/* Presupuesto — editar el ya armado (PO 2026-09-22). La configuración
            INICIAL sigue siendo el estado vacío de Personal; esta fila monta
            el mismo BudgetSheet para ajustarlo una vez que ya existe. */}
        <SectionLabel label={t('profile.section_budget')} />
        <Band>
          <LinkRow
            label={t('personal.budget_sheet_title')}
            icon="wallet-outline"
            sub={budget.monthlyAmount > 0 ? formatMoney(budget.monthlyAmount, budget.currency) : undefined}
            onPress={() => setShowBudgetSheet(true)}
            last
          />
        </Band>

        {/* Notificaciones */}
        <SectionLabel label={t('profile.section_notifications')} />
        <Band>
          <ToggleRow label={t('profile.notif_expenses')}    value={notifExpenses}    onChange={setNotifExpenses} />
          <ToggleRow label={t('profile.notif_deletions')}   value={notifDeletions}   onChange={setNotifDeletions} />
          <ToggleRow label={t('profile.notif_invites')}     value={notifInvites}     onChange={setNotifInvites} />
          <ToggleRow label={t('profile.notif_settlements')} value={notifSettlements} onChange={setNotifSettlements} last />
        </Band>

        {/* Rendimiento (PO 2026-09-22): apaga el odómetro de números y la
            animación de entrada/salida de los sheets — pensado para equipos
            de gama baja, pero visible y disponible para cualquiera. */}
        <SectionLabel label={t('profile.section_performance')} />
        <Band>
          <ToggleRow
            label={t('profile.reduce_animations')}
            sub={t('profile.reduce_animations_sub')}
            value={reduceAnimations}
            onChange={setReduceAnimations}
            last
          />
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
          <SkinPicker last />
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

        {/* Tienda — oculta hasta que la app exista en las tiendas y los ids sean
            reales: ver TIENDA_DISPONIBLE. Ojo al encenderla: «Enviar comentarios»
            NO es un link de tienda y hoy comparte handler con «Calificar». */}
        {TIENDA_DISPONIBLE && (<>
        <SectionLabel label={t('profile.section_store')} />
        <Band>
          <LinkRow label={t('profile.rate')}     icon="star-outline"      onPress={handleRateApp} />
          <LinkRow label={t('profile.feedback')} icon="chatbubble-outline" onPress={handleRateApp} last />
        </Band>
        </>)}

        {/* Copia de seguridad */}
        <SectionLabel label={t('backup.section')} />
        <Band>
          <LinkRow label={t('backup.export')} icon="download-outline"     onPress={handleExport} />
          <LinkRow label={t('backup.import')} icon="cloud-upload-outline" onPress={handleImport}
                   last={erroresAnotados === 0} />
          {/*
            Sólo si hay algo que exportar. Una fila que siempre dice «0 errores»
            es ruido permanente para el caso raro, y la primera vez que el
            usuario la toque y no pase nada deja de creerle a la pantalla.
          */}
          {erroresAnotados > 0 && (
            <LinkRow label={t('error.export_diagnostics')} icon="bug-outline"
                     sub={t('error.export_diagnostics_sub')}
                     onPress={handleExportDiagnostico} last />
          )}
        </Band>

        <SyncNoDisponible />

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

        {/*
          * Borrar cuenta va DEBAJO de cerrar sesión y en la misma jerarquía
          * visual: las dos tiendas exigen que se llegue desde la app y que no
          * esté escondido detrás de «contactá al soporte».
          */}
        <View style={{ paddingHorizontal: Spacing.screenPad, paddingTop: 10 }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings/borrar-cuenta' as any)}
            style={[styles.signOutBtn, { backgroundColor: 'transparent', borderColor: 'transparent' }]}
          >
            <Ionicons name="trash-outline" size={16} color={c.textTertiary} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: c.textTertiary }}>
              {t('account_delete.row')}
            </Text>
          </Pressable>
        </View>

        {__DEV__ && (
          <>
            <SectionLabel label="DEV" />
            <Band>
              <LinkRow label="Identidad de cuentas"  icon="finger-print-outline"  onPress={() => router.push('/debug/identity' as any)} />
              <LinkRow label="Relay (buzón)"         icon="cloud-upload-outline"  onPress={() => router.push('/debug/relay' as any)} last />
            </Band>
          </>
        )}

        <Text style={[Typography.caption, styles.version, { color: c.textTertiary }]}>
          {t('profile.version', { version: APP_VERSION })}
        </Text>
      </Animated.ScrollView>

      <TabHeader title={t('profile.title')} progress={progress} />

      <AvatarCropSheet
        visible={aRecortar !== null}
        uri={aRecortar?.uri ?? null}
        width={aRecortar?.width ?? 1}
        height={aRecortar?.height ?? 1}
        onCancel={() => setARecortar(null)}
        onConfirm={confirmarRecorte}
      />

      <BudgetSheet visible={showBudgetSheet} onClose={() => setShowBudgetSheet(false)} />
    </SafeAreaView>
  );
}

function ToggleRow({
  label, value, onChange, last, sub,
}: {
  label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean;
  /** Segunda línea, para las filas que necesitan aclarar qué hacen. */
  sub?: string;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
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

function LinkRow({
  label, icon, onPress, last, sub,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  last?: boolean;
  /** Segunda línea, para las filas que necesitan aclarar qué hacen. */
  sub?: string;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
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

const styles = StyleSheet.create({
  safe:      { flex: 1 },
  pill:      { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full },
  upper:     { textTransform: 'uppercase' },
  nameInput: {
    borderWidth: 1, borderRadius: Radius.md,
    paddingHorizontal: Spacing[4], paddingVertical: 12, fontSize: 16,
    minHeight: 48,
  },
  sheetActions: { flexDirection: 'row', gap: Spacing[2], marginTop: Spacing[4] },
  sheetBtn:     { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: Radius.md },
  signOutBtn:   {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: Radius.lg, borderWidth: 1,
  },
  version:      { textAlign: 'center', marginTop: 18 },
});
