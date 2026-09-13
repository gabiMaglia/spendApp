import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Band, BandRow, SectionLabel } from '@/src/components/Band';
import { isRelayConfigured } from '@/src/sync/relay';

/**
 * **La app dice cuando no puede sincronizar** (T-099).
 *
 * Un build sin el buzón configurado abre, guarda gastos y nunca sincroniza. El único
 * indicador estaba en una pantalla de debug que no existe en producción.
 * Decisión del PO: el aviso vive sólo en Yo.
 */
export function SyncNoDisponible({ configurado = isRelayConfigured() }: { configurado?: boolean }) {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? 'light'];
  if (configurado) return null;

  return (
    <>
      <SectionLabel label={t('profile.section_sync')} />
      <Band>
        <BandRow last>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[Typography.bodyL, { color: c.text }]}>{t('profile.sync_unavailable')}</Text>
            <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('profile.sync_unavailable_sub')}</Text>
          </View>
          <Ionicons name="cloud-offline-outline" size={18} color={c.semantic.warning} />
        </BandRow>
      </Band>
    </>
  );
}
