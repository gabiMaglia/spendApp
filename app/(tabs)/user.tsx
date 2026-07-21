import React, { useState } from 'react';
import {
  Alert, Linking, Pressable, SafeAreaView, ScrollView,
  StyleSheet, Switch, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useThemeStore } from '@/src/store/themeStore';
import { hueForUser } from '@/src/utils/hueForUser';
import { Avatar } from '@/src/components/Avatar';

export default function UserScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { currentUser, isPro, signOut } = useAuthStore();

  // Notification preferences (persisted would use MMKV in production)
  const [notifExpenses,  setNotifExpenses]  = useState(true);
  const [notifDeletions, setNotifDeletions] = useState(true);
  const [notifInvites,   setNotifInvites]   = useState(true);

  // Appearance
  const { themeChoice, setThemeChoice } = useThemeStore();

  function handleSignOut() {
    Alert.alert(
      'Cerrar sesión',
      '¿Estás seguro? Tus datos locales se conservan en el dispositivo.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar sesión', style: 'destructive', onPress: signOut },
      ],
    );
  }

  function handleRateApp() {
    Linking.openURL('https://apps.apple.com/app/id000000000');
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        <Text style={[Typography.display, styles.pageTitle, { color: c.text }]}>Yo</Text>

        {/* ── Mi cuenta ────────────────────────────────────────────────── */}
        <View style={[styles.profileCard, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
          <Avatar
            name={currentUser?.name ?? '?'}
            hue={hueForUser(currentUser?.id ?? '')}
            size={56}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[Typography.bodyL, { color: c.text, fontWeight: '700' }]} numberOfLines={1}>
              {currentUser?.name ?? 'Sin nombre'}
            </Text>
            <Text style={[Typography.bodyS, { color: c.textTertiary }]} numberOfLines={1}>
              {currentUser?.email ?? ''}
            </Text>
          </View>
          <Pressable hitSlop={10}>
            <Ionicons name="pencil-outline" size={18} color={c.textTertiary} />
          </Pressable>
        </View>

        {/* ── Plan ─────────────────────────────────────────────────────── */}
        <SectionLabel label="PLAN" />
        <View style={[styles.section, { borderColor: c.borderHair }]}>
          <View style={[styles.row, { backgroundColor: c.surface }]}>
            <View style={{ flex: 1 }}>
              <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]}>
                {isPro ? 'Pro ✦' : 'Plan Free'}
              </Text>
              {!isPro && (
                <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
                  4 gastos gratis por día
                </Text>
              )}
            </View>
            {isPro ? (
              <View style={[styles.proBadge, { backgroundColor: c.brand.primary }]}>
                <Text style={[Typography.caption, { color: '#fff', fontWeight: '700' }]}>PRO</Text>
              </View>
            ) : (
              <Pressable style={[styles.upgradeBtn, { backgroundColor: c.brand.primary }]}>
                <Text style={[Typography.bodyS, { color: '#fff', fontWeight: '700' }]}>
                  Probar Pro gratis
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* ── Notificaciones ───────────────────────────────────────────── */}
        <SectionLabel label="NOTIFICACIONES" />
        <View style={[styles.section, { borderColor: c.borderHair }]}>
          <ToggleRow
            label="Nuevos gastos"
            value={notifExpenses}
            onChange={setNotifExpenses}
          />
          <Divider color={c.borderHair} />
          <ToggleRow
            label="Solicitudes de borrado"
            value={notifDeletions}
            onChange={setNotifDeletions}
          />
          <Divider color={c.borderHair} />
          <ToggleRow
            label="Invitaciones a grupos"
            value={notifInvites}
            onChange={setNotifInvites}
          />
        </View>

        {/* ── Apariencia ───────────────────────────────────────────────── */}
        <SectionLabel label="APARIENCIA" />
        <View style={[styles.section, { borderColor: c.borderHair }]}>
          <View style={[styles.row, { backgroundColor: c.surface }]}>
            <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]}>Tema</Text>
            <View style={[styles.themeSegment, { backgroundColor: c.surfaceSunken }]}>
              {(['auto', 'light', 'dark'] as const).map(opt => (
                <Pressable
                  key={opt}
                  onPress={() => setThemeChoice(opt)}
                  style={[
                    styles.themeTab,
                    themeChoice === opt && { backgroundColor: c.surface },
                  ]}
                >
                  <Text style={[Typography.caption, {
                    color:      themeChoice === opt ? c.text : c.textTertiary,
                    fontWeight: themeChoice === opt ? '700' : '500',
                  }]}>
                    {opt === 'auto' ? 'Auto' : opt === 'light' ? 'Claro' : 'Oscuro'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Divider color={c.borderHair} />
          <View style={[styles.row, { backgroundColor: c.surface }]}>
            <View style={{ flex: 1 }}>
              <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]}>Skins</Text>
              <Text style={[Typography.bodyS, { color: c.textTertiary }]}>Próximamente</Text>
            </View>
            <View style={[styles.soonBadge, { backgroundColor: c.surfaceSunken }]}>
              <Text style={[Typography.caption, { color: c.textTertiary, fontWeight: '600' }]}>
                SOON
              </Text>
            </View>
          </View>
        </View>

        {/* ── Tienda ───────────────────────────────────────────────────── */}
        <SectionLabel label="TIENDA" />
        <View style={[styles.section, { borderColor: c.borderHair }]}>
          <LinkRow
            label="Calificar la app"
            icon="star-outline"
            onPress={handleRateApp}
          />
          <Divider color={c.borderHair} />
          <LinkRow
            label="Dejar un comentario"
            icon="chatbubble-outline"
            onPress={handleRateApp}
          />
        </View>

        {/* ── Seguridad ────────────────────────────────────────────────── */}
        <SectionLabel label="SEGURIDAD" />
        <View style={[styles.section, { borderColor: c.borderHair }]}>
          <View style={[styles.row, { backgroundColor: c.surface }]}>
            <View style={{ flex: 1 }}>
              <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]}>
                Face ID / Touch ID
              </Text>
              <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
                Requerir biometría al abrir
              </Text>
            </View>
            <View style={[styles.soonBadge, { backgroundColor: c.surfaceSunken }]}>
              <Text style={[Typography.caption, { color: c.textTertiary, fontWeight: '600' }]}>
                SOON
              </Text>
            </View>
          </View>
        </View>

        {/* ── Cerrar sesión ────────────────────────────────────────────── */}
        <Pressable
          onPress={handleSignOut}
          style={[styles.signOutBtn, { backgroundColor: c.surface, borderColor: c.borderHair }]}
        >
          <Ionicons name="log-out-outline" size={18} color={c.semantic.negative} />
          <Text style={[Typography.bodyM, { color: c.semantic.negative, fontWeight: '600' }]}>
            Cerrar sesión
          </Text>
        </Pressable>

        <Text style={[Typography.caption, styles.version, { color: c.textTertiary }]}>
          SplitP2P v1.0.0 · P2P sin servidor
        </Text>

        <View style={{ height: Spacing[6] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Text style={[Typography.label, styles.sectionLabel, { color: c.textTertiary }]}>
      {label}
    </Text>
  );
}

function Divider({ color }: { color: string }) {
  return <View style={[styles.divider, { backgroundColor: color }]} />;
}

function ToggleRow({
  label, value, onChange,
}: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View style={[styles.row, { backgroundColor: c.surface }]}>
      <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600', flex: 1 }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: c.borderStrong, true: c.brand.primary }}
        thumbColor="#fff"
      />
    </View>
  );
}

function LinkRow({
  label, icon, onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Pressable onPress={onPress} style={[styles.row, { backgroundColor: c.surface }]}>
      <Ionicons name={icon} size={18} color={c.textSecondary} />
      <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600', flex: 1 }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={c.textTertiary} />
    </Pressable>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:          { flex: 1 },
  scroll:        { paddingTop: Spacing[3] },
  pageTitle:     { paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[4] },
  profileCard:   {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
    padding: Spacing[4], borderRadius: Radius.lg, borderWidth: 1,
  },
  sectionLabel:  {
    paddingHorizontal: Spacing.screenPad,
    marginBottom: Spacing[1], marginTop: Spacing[1],
  },
  section:       {
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
    borderRadius: Radius.lg, borderWidth: 1, overflow: 'hidden',
  },
  row:           {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: Spacing[4], paddingVertical: 14,
  },
  divider:       { height: StyleSheet.hairlineWidth, marginLeft: Spacing[4] },
  proBadge:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  upgradeBtn:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full },
  themeSegment:  { flexDirection: 'row', padding: 3, borderRadius: Radius.md, gap: 2 },
  themeTab:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.sm },
  soonBadge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  signOutBtn:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[3],
    padding: Spacing[4], borderRadius: Radius.lg, borderWidth: 1,
  },
  version:       { textAlign: 'center', marginBottom: Spacing[2] },
});
