import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Band, BandRow } from '@/src/components/Band';
import { sinSesionDeSync } from '@/src/sync/sessionStatus';
import { useLiveValue } from '@/src/hooks/useLiveValue';

/**
 * **T-147 (SIMPLIFICACIÓN, PO 2026-09-27).** Cuando este teléfono no consigue
 * abrir la sesión ANÓNIMA del buzón —el captcha nunca resolvió, o Auth está
 * caído—, sigue sin poder sincronizar hasta que se recupere solo. Vive junto
 * a `SyncNoDisponible` en "Yo": misma sección, la otra causa posible de "no
 * me está llegando nada".
 *
 * A diferencia del diseño anterior (sesión atada a la cuenta), acá NO
 * importa si el usuario es invitado o tiene cuenta: el buzón usa la MISMA
 * sesión anónima por instalación para los dos, así que el mensaje y el
 * reintento automático son iguales para cualquiera. No hay botón
 * «Reconectar» — no hay ninguna cuenta que reconectar del lado del buzón.
 *
 * Se retira solo en cuanto `ensureRelaySession()` vuelve a conseguir sesión —
 * no hace falta que el usuario haga nada.
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
