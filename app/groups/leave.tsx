import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupBalance } from '@/src/store/selectors';
import { Avatar } from '@/src/components/Avatar';
import { UserAvatar } from '@/src/components/UserAvatar';
import { hueForUser } from '@/src/utils/hueForUser';
import { hapticLight, hapticSuccess, hapticWarning } from '@/src/utils/haptics';
import { planAbsorption, planSettlesLeaver, type BalanceEntry } from '@/src/algorithms/absorbBalance';
import type { SplitMode } from '@/src/types/models';
import { esYo } from '@/src/store/identityAlias';

/**
 * Salir de un grupo con saldo abierto, repartiéndolo entre los que quedan.
 *
 * Irse debiendo no es gratis: esa plata la pierde alguien. Acá el que se va
 * elige QUIÉN absorbe y CUÁNTO, y el pedido queda esperando que **todos**
 * aprueben — nadie se come una deuda ajena sin decir que sí.
 *
 * El reparto se expresa como PAGOS y no como un concepto nuevo: los balances,
 * la simplificación de deudas y el sync ya saben tratarlos.
 */

const MODOS: { id: SplitMode; label: string }[] = [
  { id: 'equal',      label: 'leave.mode_equal' },
  { id: 'percentage', label: 'leave.mode_percentage' },
];

export default function LeaveGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const currentUser = useAuthStore(s => s.currentUser);
  const group = useGroupStore(s => s.groups.find(g => g.id === id));
  const requestLeave = useGroupStore(s => s.requestLeave);
  const { getUserName } = useUserStore();

  const balances = useGroupBalance(id ?? '', currentUser?.id ?? '');

  const otros = useMemo(
    () => (group?.memberIds ?? []).filter(uid => !esYo(uid)),
    [group, currentUser],
  );

  const [absorben, setAbsorben] = useState<string[]>(otros);
  const [modo, setModo] = useState<SplitMode>('equal');
  const [porcentajes, setPorcentajes] = useState<Record<string, string>>({});

  const saldos: BalanceEntry[] = balances
    .filter(b => b.amount !== 0)
    .map(b => ({ currency: b.currency, amount: b.amount }));

  const valores = modo === 'percentage'
    ? absorben.map(uid => Number(porcentajes[uid] ?? '') || 0)
    : undefined;

  const plan = useMemo(() => {
    if (absorben.length === 0) return [];
    try {
      return planAbsorption(currentUser?.id ?? '', saldos, absorben, modo, valores);
    } catch {
      return []; // porcentajes que no cierran: se avisa abajo, no se rompe
    }
  }, [currentUser, JSON.stringify(saldos), absorben, modo, JSON.stringify(valores)]);

  // Un plan que no deja en cero al que se va es PEOR que no tener plan: el
  // usuario cree que saldó y le queda saldo fantasma.
  const cierra = plan.length > 0 && planSettlesLeaver(plan, currentUser?.id ?? '', saldos);
  const sumaPorcentajes = (valores ?? []).reduce((a, b) => a + b, 0);

  function toggle(uid: string) {
    hapticLight();
    setAbsorben(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]);
  }

  function confirmar() {
    if (!group || !currentUser || !cierra) return;
    hapticWarning();

    Alert.alert(
      t('leave.confirm_title'),
      t('leave.confirm_body', { count: otros.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('leave.confirm_send'),
          onPress: () => {
            requestLeave(group.id, currentUser.id, plan);
            hapticSuccess();
            router.back();
          },
        },
      ],
    );
  }

  if (!group || !currentUser) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
        <Text style={[Typography.bodyM, { color: c.textSecondary, padding: Spacing[5] }]}>
          {t('group_detail.not_found')}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <Ionicons name="close" size={24} color={c.text} />
        </Pressable>
        <Text style={[Typography.h3, { color: c.text }]}>{t('leave.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
          {t('leave.intro')}
        </Text>

        {/* Lo que hay que repartir */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.hair }]}>
          <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
            {t('leave.your_balance')}
          </Text>
          {saldos.map(s => (
            <Text
              key={s.currency}
              style={[Typography.amountM, {
                color: s.amount < 0 ? c.semantic.negative : c.semantic.positive, marginTop: 4,
              }]}
            >
              {formatMoney(Math.abs(s.amount), s.currency)}
              {' '}
              <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
                {s.amount < 0 ? t('leave.you_owe') : t('leave.owed_to_you')}
              </Text>
            </Text>
          ))}
        </View>

        {/* Quiénes absorben */}
        <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
          {t('leave.who_absorbs')}
        </Text>
        {otros.map(uid => (
          <Pressable
            key={uid}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: absorben.includes(uid) }}
            onPress={() => toggle(uid)}
            style={[styles.row, {
              backgroundColor: absorben.includes(uid) ? c.brand.primarySoft : c.bgGrouped,
            }]}
          >
            <UserAvatar userId={uid} name={getUserName(uid)} size={32} />
            <Text style={[Typography.bodyM, { flex: 1, color: c.text, fontWeight: '600' }]}>
              {getUserName(uid)}
            </Text>
            {modo === 'percentage' && absorben.includes(uid) && (
              <TextInput
                value={porcentajes[uid] ?? ''}
                onChangeText={v => setPorcentajes(p => ({ ...p, [uid]: v.replace(/[^0-9]/g, '') }))}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={c.textTertiary}
                style={[styles.pct, { color: c.text, borderColor: c.border }]}
              />
            )}
            {absorben.includes(uid) && (
              <Ionicons name="checkmark-circle" size={20} color={c.brand.primary} />
            )}
          </Pressable>
        ))}

        {/* Cómo se reparte */}
        <View style={[styles.segmented, { backgroundColor: c.bgGrouped }]}>
          {MODOS.map(m => (
            <Pressable
              key={m.id}
              accessibilityRole="button"
              onPress={() => { hapticLight(); setModo(m.id); }}
              style={[styles.segTab, m.id === modo && { backgroundColor: c.surface }]}
            >
              <Text style={[Typography.bodyS, {
                color: m.id === modo ? c.text : c.textSecondary, fontWeight: '600',
              }]}>
                {t(m.label)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Qué va a pasar, en plata. Sin esto el usuario aprueba a ciegas. */}
        {plan.length > 0 && (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.hair }]}>
            <Text style={[Typography.label, { color: c.textTertiary, textTransform: 'uppercase' }]}>
              {t('leave.preview')}
            </Text>
            {plan.map((p, i) => (
              <Text key={i} style={[Typography.bodyS, { color: c.text, marginTop: 6 }]}>
                {t('leave.preview_line', {
                  from: esYo(p.fromUserId) ? t('common.you') : getUserName(p.fromUserId),
                  to:   esYo(p.toUserId) ? t('common.you') : getUserName(p.toUserId),
                  amount: formatMoney(p.amount, p.currency),
                })}
              </Text>
            ))}
          </View>
        )}

        {absorben.length === 0 && (
          <Text style={[Typography.bodyS, { color: c.semantic.negative }]}>
            {t('leave.nobody_selected')}
          </Text>
        )}
        {modo === 'percentage' && absorben.length > 0 && sumaPorcentajes !== 100 && (
          <Text style={[Typography.bodyS, { color: c.semantic.negative }]}>
            {t('leave.percent_must_be_100', { total: sumaPorcentajes })}
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={!cierra}
          onPress={confirmar}
          style={[styles.cta, {
            backgroundColor: cierra ? c.brand.primary : c.bgGrouped,
          }]}
        >
          <Text style={[Typography.bodyM, {
            color: cierra ? '#fff' : c.textTertiary, fontWeight: '600',
          }]}>
            {t('leave.request', { count: otros.length })}
          </Text>
        </Pressable>

        <View style={{ height: Spacing[9] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1 },
  header:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingVertical: Spacing[3],
  },
  scroll:    { paddingHorizontal: Spacing.screenPad, gap: Spacing[4], paddingTop: Spacing[4] },
  // Banda embutida: sin radio, hairline arriba y abajo, borde a borde.
  card:      {
    marginHorizontal: -Spacing.screenPad,
    borderTopWidth: 1, borderBottomWidth: 1,
    paddingHorizontal: Spacing.screenPad, paddingVertical: Spacing[4],
  },
  row:       {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 13, borderRadius: Radius.sm,
  },
  pct:       {
    borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 10,
    paddingVertical: 4, minWidth: 56, textAlign: 'right',
  },
  segmented: { flexDirection: 'row', borderRadius: Radius.md, padding: 4, gap: 4 },
  segTab:    { flex: 1, alignItems: 'center', height: 32, justifyContent: 'center', borderRadius: 8 },
  cta:       {
    height: 52, borderRadius: Radius.lg,
    alignItems: 'center', justifyContent: 'center', marginTop: Spacing[2],
  },
});
