import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { hapticLight, hapticSuccess } from '@/src/utils/haptics';
import { inviteFromParams, isInviteExpired } from '@/src/sync/groupInvite';
import { publishClaim, processInvite } from '@/src/sync/inviteEngine';
import { deviceId, drainNow, startRelay } from '@/src/sync/relayEngine';
import { esYo } from '@/src/store/identityAlias';

/**
 * Pantalla que recibe el link de invitación (`spendapp://groups/join?...`).
 *
 * Entrar a un grupo NO es instantáneo por diseño: hace falta que alguien que ya
 * está adentro entregue la clave, y esa persona puede tener la app cerrada. Por
 * eso la pantalla distingue dos finales buenos:
 *
 *  - **entré**: llegó la clave, ya se ve el grupo;
 *  - **quedó pedido**: el reclamo está publicado y espera. No es un error, y
 *    decirle "falló" al usuario lo haría reintentar para nada.
 *
 * El pedido queda persistido, así que se completa solo cuando el otro abra la
 * app — el usuario puede cerrar todo sin perder nada.
 */

/** Cuánto esperamos con la pantalla abierta antes de pasar a "quedó pedido". */
const ESPERA_MS = 25_000;
const REINTENTO_MS = 3_000;

type Estado = 'listo' | 'entrando' | 'entre' | 'esperando';

export default function JoinGroupScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();

  const params = useLocalSearchParams();
  const currentUser = useAuthStore(s => s.currentUser);
  const getById = useGroupStore(s => s.getById);

  const invite = useMemo(() => inviteFromParams(params as Record<string, unknown>), [params]);
  const [estado, setEstado] = useState<Estado>('listo');
  const vivo = useRef(true);

  useEffect(() => () => { vivo.current = false; }, []);

  const yaSoyMiembro = Boolean(
    invite && currentUser &&
    getById(invite.groupId)?.memberIds.some(esYo),
  );

  async function handleJoin() {
    if (!invite || estado !== 'listo') return;
    hapticLight();
    setEstado('entrando');

    await publishClaim(invite, deviceId());
    // Deja la app escuchando el buzón: si el otro contesta mientras miramos la
    // pantalla, entra por acá sin esperar al próximo sondeo.
    void startRelay();

    const limite = Date.now() + ESPERA_MS;
    while (vivo.current && Date.now() < limite) {
      const adoptados = await processInvite(invite, deviceId());
      if (adoptados.length > 0) {
        await drainNow(invite.groupId);
        if (!vivo.current) return;
        hapticSuccess();
        setEstado('entre');
        void startRelay(); // ahora sí, suscripción al grupo nuevo
        return;
      }
      await new Promise(r => setTimeout(r, REINTENTO_MS));
    }

    if (vivo.current) setEstado('esperando');
  }

  function cerrar() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }

  const contenido = () => {
    if (!invite) return mensaje('alert-circle-outline', c.semantic.error, t('join.invalid_title'), t('join.invalid_body'));
    if (isInviteExpired(invite)) return mensaje('time-outline', c.semantic.error, t('join.expired_title'), t('join.expired_body'));
    if (!currentUser) return mensaje('person-outline', c.textSecondary, t('join.need_login_title'), t('join.need_login_body'));

    if (estado === 'entre' || yaSoyMiembro) {
      return (
        <>
          {mensaje('checkmark-circle-outline', c.semantic.positive, t('join.joined_title'), t('join.joined_body', { group: invite.groupName }))}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace(`/groups/${invite.groupId}`)}
            style={[styles.cta, { backgroundColor: c.brand.primary }]}
          >
            <Text style={[Typography.bodyM, styles.ctaText]}>{t('join.open_group')}</Text>
          </Pressable>
        </>
      );
    }

    if (estado === 'esperando') {
      return (
        <>
          {mensaje('hourglass-outline', c.textSecondary, t('join.pending_title'), t('join.pending_body'))}
          <Pressable
            accessibilityRole="button"
            onPress={cerrar}
            style={[styles.cta, { backgroundColor: c.brand.primary }]}
          >
            <Text style={[Typography.bodyM, styles.ctaText]}>{t('common.close')}</Text>
          </Pressable>
        </>
      );
    }

    return (
      <>
        <View style={[styles.icon, { backgroundColor: c.brand.primary + '1A' }]}>
          <Ionicons name="people-outline" size={32} color={c.brand.primary} />
        </View>
        <Text style={[Typography.h2, styles.centro, { color: c.text }]}>{invite.groupName}</Text>
        <Text style={[Typography.bodyS, styles.centro, { color: c.textSecondary }]}>
          {t('join.intro')}
        </Text>

        <Pressable
          accessibilityRole="button"
          disabled={estado === 'entrando'}
          onPress={handleJoin}
          style={[styles.cta, { backgroundColor: c.brand.primary, opacity: estado === 'entrando' ? 0.6 : 1 }]}
        >
          {estado === 'entrando'
            ? <ActivityIndicator color="#fff" />
            : <Text style={[Typography.bodyM, styles.ctaText]}>{t('join.accept')}</Text>}
        </Pressable>

        {estado === 'entrando' && (
          <Text style={[Typography.caption, styles.centro, { color: c.textSecondary }]}>
            {t('join.waiting_key')}
          </Text>
        )}
      </>
    );
  };

  function mensaje(icon: keyof typeof Ionicons.glyphMap, color: string, titulo: string, cuerpo: string) {
    return (
      <>
        <View style={[styles.icon, { backgroundColor: color + '1A' }]}>
          <Ionicons name={icon} size={32} color={color} />
        </View>
        <Text style={[Typography.h3, styles.centro, { color: c.text }]}>{titulo}</Text>
        <Text style={[Typography.bodyS, styles.centro, { color: c.textSecondary }]}>{cuerpo}</Text>
      </>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={cerrar} hitSlop={12} accessibilityRole="button">
          <Ionicons name="close" size={24} color={c.text} />
        </Pressable>
      </View>

      <View style={styles.body}>{contenido()}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1 },
  header:  { paddingHorizontal: Spacing.screenPad, height: 52, justifyContent: 'center' },
  body:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing[3], paddingHorizontal: Spacing[7] },
  icon:    { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  centro:  { textAlign: 'center' },
  cta:     {
    marginTop: Spacing[5], height: 52, paddingHorizontal: Spacing[7],
    borderRadius: Radius.lg, minWidth: 200,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
