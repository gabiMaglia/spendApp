import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { compartirArchivoTemporal } from '@/src/services/compartirArchivoTemporal';
import {
  buildBackup, serializeBackup, parseBackup, applyBackup, backupFileName,
} from '@/src/services/backup';
import { listErrors } from '@/src/services/errorLog';
import { exportarDiagnostico } from '@/src/services/exportDiagnostico';
import { useLiveValue } from '@/src/hooks/useLiveValue';
import { esYo } from '@/src/store/identityAlias';
import { claveDeErrorDeImport } from '@/src/screens/cuenta/perfilDeCuenta';

/** Exportar/importar el respaldo y exportar el diagnóstico de errores. */
export function useRespaldo() {
  const { t } = useTranslation();

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

  /** Tras aplicar el backup: T-188b · si el archivo no traía claves (v1, o un
   * export viejo), avisa que hay que reinvitar a cada grupo para sincronizar. */
  function avisarSinClavesSiHaceFalta(backup: ReturnType<typeof parseBackup>) {
    if (!backup.groupKeys?.length) {
      Alert.alert(t('backup.import_success'), t('backup.no_keys'));
    } else {
      Alert.alert(t('backup.import_success'));
    }
  }

  function confirmarYAplicar(backup: ReturnType<typeof parseBackup>) {
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
              avisarSinClavesSiHaceFalta(backup);
            } catch {
              Alert.alert(t('backup.import_error_title'));
            }
          },
        },
      ],
    );
  }

  async function handleImport() {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const raw = await new File(res.assets[0].uri).text();
      const backup = parseBackup(raw);

      // T-188b: un backup AJENO (ownerId de otra persona) importa los datos
      // igual, pero SIN sus claves ni un alta mía a ningún grupo — hay que
      // decírselo ANTES de que elija guardar, no después.
      if (backup.ownerId !== undefined && !esYo(backup.ownerId)) {
        Alert.alert(
          t('backup.foreign_title'),
          t('backup.foreign_body'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('backup.foreign_confirm'), onPress: () => confirmarYAplicar(backup) },
          ],
        );
        return;
      }

      confirmarYAplicar(backup);
    } catch (e) {
      Alert.alert(t('backup.import_error_title'), t(claveDeErrorDeImport(e)));
    }
  }

  return { handleExport, handleImport, handleExportDiagnostico, erroresAnotados };
}
