import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';

import { Colors } from '@/src/constants/colors';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Band, BandRow } from '@/src/components/Band';
import { sinSesionDeSync } from '@/src/sync/sessionStatus';
import { useLiveValue } from '@/src/hooks/useLiveValue';
import { useEntryGateStore } from '@/src/store/entryGateStore';

/**
 * Cuando este teléfono no consigue tener sesión del buzón —cuenta sin
 * reconectar, invitado que saltó el captcha, o Auth caído—, sigue sin poder
 * sincronizar hasta que alguien haga algo. Vive junto a `SyncNoDisponible`
 * en "Yo": misma sección, la otra causa posible de "no me está llegando
 * nada".
 *
 * El mensaje es el mismo para invitado y para cuenta (el motivo exacto no
 * cambia la acción disponible), pero **T-147-b (`engram/plans/T-147.md`,
 * Task 4, sellado por el PO 2026-09-27) agrega una acción — filas 9 (cuenta
 * sin sesión) y 10 (invitado que saltó la verificación) de la tabla: tocar
 * el aviso pide la verificación de nuevo (`entryGateStore.pedirVerificacion`
 * — sin esto, `AuthGuard` lo manda directo de vuelta a tabs) y navega a
 * `app/auth/verify.tsx`, que sabe sola qué hacer con cada modo.**
 *
 * También se retira solo en cuanto `ensureRelaySession()` vuelve a
 * conseguir sesión — no hace falta tocarlo para eso.
 *
 * **Verifier D3 (heredado):** `sinSesionDeSync()` lee una variable de
 * MÓDULO — React no se entera cuando cambia sola. Se sondea con
 * `useLiveValue`, el mismo hook que ya usa el repo para este problema exacto.
 */
export function SinSesionDeSync({ sinSesion }: { sinSesion?: boolean } = {}) {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? 'light'];
  const enVivo = useLiveValue(sinSesionDeSync);
  const activo = sinSesion ?? enVivo;
  if (!activo) return null;

  function volverAVerificar(): void {
    useEntryGateStore.getState().pedirVerificacion();
    router.push('/auth/verify');
  }

  return (
    <Band>
      <BandRow last onPress={volverAVerificar} accessibilityRole="button">
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[Typography.bodyL, { color: c.text }]}>{t('sync.no_session_title')}</Text>
          <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('sync.no_session_body')}</Text>
        </View>
        <Ionicons name="cloud-offline-outline" size={18} color={c.semantic.warning} />
      </BandRow>
    </Band>
  );
}
