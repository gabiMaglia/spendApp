import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Band, BandRow } from '@/src/components/Band';
import { ActionButton } from '@/src/components/ActionButton';
import { ButtonRack } from '@/src/components/ButtonRack';
import { sinSesionDeSync } from '@/src/sync/sessionStatus';
import { useLiveValue } from '@/src/hooks/useLiveValue';
import { useAuthStore } from '@/src/store/authStore';
import { reconectarCuentaInteractivo } from '@/src/sync/accountReconnect';

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
 *
 * **Verifier D3:** `sinSesionDeSync()` lee una variable de MÓDULO —React no
 * se entera cuando cambia sola—. Un default param la evalúa una vez, al
 * montar, y se queda pegado ahí; en la app real "parecía" andar sólo porque
 * "Yo" volvía a renderizar cada 2s por otro efecto (`useLiveValue` en la
 * medición de errores). Acá se sondea con el mismo hook que ya usa el repo
 * para este problema exacto (ver su docblock).
 *
 * **Verifier R3-1 (ronda 3): el texto "se va a resolver solo" no es cierto
 * para toda cuenta.** Para el invitado sí lo es (la anónima se reintenta
 * sola con backoff). Para una cuenta (Google/Apple), `relaySession` también
 * reintenta en silencio — pero SÓLO Google puede realmente lograrlo sin
 * ayuda; Apple nunca tiene reconexión silenciosa, y un Google con el token
 * revocado tampoco. Por eso una cuenta muestra un texto distinto y un botón
 * «Reconectar» (`reconectarCuentaInteractivo`, abre el diálogo real del
 * proveedor) — el invitado no lo necesita.
 */
export function SinSesionDeSync({ sinSesion }: { sinSesion?: boolean } = {}) {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? 'light'];
  const enVivo = useLiveValue(sinSesionDeSync);
  const activo = sinSesion ?? enVivo;
  const [reconectando, setReconectando] = useState(false);
  if (!activo) return null;

  const proveedor = useAuthStore.getState().currentUser?.authProvider;
  const esCuenta = proveedor === 'google' || proveedor === 'apple';

  async function reconectar() {
    setReconectando(true);
    try { await reconectarCuentaInteractivo(); } finally { setReconectando(false); }
  }

  return (
    <Band>
      <BandRow last={!esCuenta}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[Typography.bodyL, { color: c.text }]}>{t('sync.no_session_title')}</Text>
          <Text style={[Typography.caption, { color: c.textTertiary }]}>
            {t(esCuenta ? 'sync.no_session_account_body' : 'sync.no_session_body')}
          </Text>
        </View>
        <Ionicons name="cloud-offline-outline" size={18} color={c.semantic.warning} />
      </BandRow>
      {esCuenta && (
        <BandRow last>
          <ButtonRack placement="inline">
            <ActionButton
              label={t('sync.reconnect')}
              action={() => { void reconectar(); }}
              loading={reconectando}
              variant="secondary"
              full
            />
          </ButtonRack>
        </BandRow>
      )}
    </Band>
  );
}
