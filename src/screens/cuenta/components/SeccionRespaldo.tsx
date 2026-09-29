import React from 'react';
import { Linking } from 'react-native';
import { useTranslation } from 'react-i18next';

import { TIENDA_DISPONIBLE, urlDeTienda } from '@/src/constants/tienda';
import { Band, SectionLabel } from '@/src/components/Band';
import { LinkRow } from '@/src/screens/cuenta/components/FilasDeCuenta';
import type { useRespaldo } from '@/src/screens/cuenta/hooks/useRespaldo';

function handleRateApp() {
  void Linking.openURL(urlDeTienda());
}

/** Tienda (si existe) y copia de seguridad. Fragmento: hijos directos del scroll. */
export function SeccionRespaldo({ respaldo }: { respaldo: ReturnType<typeof useRespaldo> }) {
  const { t } = useTranslation();
  const { handleExport, handleImport, handleExportDiagnostico, erroresAnotados } = respaldo;
  return (
    <>
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
    </>
  );
}
