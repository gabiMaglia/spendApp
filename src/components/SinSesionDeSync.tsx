import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Band, BandRow } from '@/src/components/Band';
import { sinSesionDeSync } from '@/src/sync/sessionStatus';

/**
 * **T-147, enmienda del PO (2026-09-26).** Cuando el buzón SÍ está
 * configurado pero este teléfono no consiguió abrir ninguna sesión de
 * Supabase —el captcha nunca resolvió, o Auth está caído— sigue con el rol
 * `anon`: anda hasta que corra 011b, y después deja de poder sincronizar EN
 * SILENCIO. Vive junto a `SyncNoDisponible` en "Yo": misma sección, la otra
 * causa posible de "no me está llegando nada".
 *
 * Se retira solo en cuanto `ensureRelaySession()` vuelve a conseguir una
 * sesión (identidad o anónima) — no hace falta que el usuario la cierre.
 */
export function SinSesionDeSync({ sinSesion = sinSesionDeSync() }: { sinSesion?: boolean }) {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? 'light'];
  if (!sinSesion) return null;

  return (
    <Band>
      <BandRow last>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[Typography.bodyL, { color: c.text }]}>{t('sync.no_session_title')}</Text>
          <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('sync.no_session_body')}</Text>
        </View>
        <Ionicons name="cloud-offline-outline" size={18} color={c.semantic.warning} />
      </BandRow>
    </Band>
  );
}
